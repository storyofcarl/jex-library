/**
 * Real-browser (Chromium) interaction + a11y test for the dependency drawing /
 * editing UI. Unlike jsdom these have real layout + `elementFromPoint`, so the
 * pointer-driven drag-from-terminal-to-terminal gesture runs against actual
 * geometry. Also asserts zero serious/critical axe violations with the feature on.
 */
import { describe, it, afterEach, expect } from 'vitest';
import { HOUR_AND_DAY } from '@jects/timeline-core';
import '@jects/theme/style.css';
import '../styles.css';
import { Scheduler } from './scheduler.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const HOUR = 3_600_000;
const start = Date.UTC(2025, 0, 1);

let host: HTMLElement;
let sched: Scheduler | undefined;

afterEach(() => {
  sched?.destroy();
  sched = undefined;
  host?.remove();
});

function mount(): HTMLElement {
  host = document.createElement('div');
  host.style.width = '380px';
  host.style.height = '240px';
  document.body.appendChild(host);
  return host;
}

function pointer(type: string, target: Element, x: number, y: number): void {
  target.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0 }),
  );
}

function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

describe('Scheduler dependency editing (browser)', () => {
  function make(): Scheduler {
    const h = mount();
    // The vitest/playwright viewport can be narrow; keep both bars near the left
    // (a short range) so they fall inside the real layout viewport and
    // `elementFromPoint` hit-tests them during the pointer gesture.
    sched = new Scheduler(h, {
      resources: [
        { id: 'r1', name: 'Alice' },
        { id: 'r2', name: 'Bob' },
      ],
      events: [
        { id: 'e1', resourceId: 'r1', name: 'Task A', startDate: start + HOUR, endDate: start + HOUR * 2 },
        { id: 'e2', resourceId: 'r2', name: 'Task B', startDate: start + HOUR * 3, endDate: start + HOUR * 4 },
      ],
      preset: HOUR_AND_DAY,
      range: { start, end: start + HOUR * 6 },
      dependenciesEditable: true,
      snap: false,
    });
    return sched;
  }

  it('shows terminal handles on hover over a bar', () => {
    const s = make();
    const bar = s.el.querySelector('[data-event-id="e1"]') as HTMLElement;
    const c = center(bar);
    pointer('pointerover', bar, c.x, c.y);
    const terminals = s.el.querySelectorAll('.jects-scheduler__terminal');
    expect(terminals.length).toBe(2);
  });

  it('draws a link by dragging from a start terminal to another bar and infers FS', () => {
    const s = make();
    let createdType: string | undefined;
    s.on('dependencyCreate', ({ dependency }) => {
      createdType = dependency.type;
    });

    const fromBar = s.el.querySelector('[data-event-id="e1"]') as HTMLElement;
    const toBar = s.el.querySelector('[data-event-id="e2"]') as HTMLElement;
    // Hover to reveal terminals on the source bar.
    pointer('pointerover', fromBar, center(fromBar).x, center(fromBar).y);
    const endTerminal = s.el.querySelector(
      '.jects-scheduler__terminal[data-side="end"]',
    ) as HTMLElement;
    expect(endTerminal).toBeTruthy();

    const tEnd = center(endTerminal);
    const toRect = toBar.getBoundingClientRect();
    // Aim at the LEFT edge (start terminal) of the target bar → FS.
    const targetX = toRect.left + 3;
    const targetY = toRect.top + toRect.height / 2;
    // Guard: the target must be inside the real layout viewport for elementFromPoint.
    expect(targetX).toBeLessThan(window.innerWidth);

    pointer('pointerdown', endTerminal, tEnd.x, tEnd.y);
    // A live rubber-band line should exist mid-gesture.
    pointer('pointermove', window.document.body, targetX, targetY);
    expect(s.el.querySelector('.jects-scheduler__dep-rubber')).toBeTruthy();
    pointer('pointerup', window.document.body, targetX, targetY);

    expect(s.getDependencyStore().count).toBe(1);
    expect(createdType).toBe('FS');
    // The rubber band is removed after the gesture.
    expect(s.el.querySelector('.jects-scheduler__dep-rubber')).toBeNull();
    // A real dependency line is painted.
    expect(s.el.querySelector('.jects-scheduler__dep-line')).toBeTruthy();
  });

  it('selects a dependency line on click and deletes it via the editor', () => {
    const s = make();
    s.getDependencyStore().add({ id: 'd1', fromId: 'e1', toId: 'e2', type: 'FS' });
    const line = s.el.querySelector('.jects-scheduler__dep-line') as SVGPathElement;
    expect(line).toBeTruthy();
    line.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(s.getDependencyEditor()!.selectedDependencyId).toBe('d1');
    expect(line.classList.contains('jects-scheduler__dep-line--selected')).toBe(true);

    let deleted = false;
    s.on('dependencyDelete', () => {
      deleted = true;
    });
    s.getDependencyEditor()!.deleteSelected();
    expect(deleted).toBe(true);
    expect(s.getDependencyStore().count).toBe(0);
  });

  it('has no serious/critical a11y violations with editing enabled', async () => {
    const s = make();
    s.getDependencyStore().add({ id: 'd1', fromId: 'e1', toId: 'e2', type: 'FS' });
    await expectNoA11yViolations(s.el);
  });
});
