/**
 * axe-core a11y + visual/interaction browser test for the ProjectLines feature
 * and the Gantt print path (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the feature end to
 * end in a real engine: project-boundary + deadline + custom marker lines paint
 * full-height across the timeline at their real pixel positions, a click on a
 * marker routes to the handler, and the print controller injects + tears down
 * the scoped print stylesheet while `window.print` is stubbed (no dialog).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Load the real package stylesheet so the geometry assertions below exercise the
// shipped, token-pure CSS (full-height rules, label boxes) rather than unstyled
// defaults.
import '../styles.css';
import { DefaultTimeAxis, WEEK_AND_DAY } from '@jects/timeline-core';
import {
  ProjectLines,
  GanttPrintController,
  type ProjectLine,
} from './project-lines.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const range = { start: T0 - 7 * DAY, end: T0 + 40 * DAY };
const projectSpan = { start: T0, end: T0 + 30 * DAY };

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  host.style.position = 'relative';
  host.style.height = '320px';
  host.style.width = '960px';
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

describe('ProjectLines a11y + visual (real Chromium)', () => {
  let lines: ProjectLines | null = null;
  afterEach(() => {
    lines?.destroy();
    lines = null;
  });

  it('paints named marker lines full-height with no serious/critical violations', async () => {
    const axis = new DefaultTimeAxis({ range, preset: WEEK_AND_DAY, zoom: 1 });
    const config: ProjectLine[] = [
      { id: 'ps', anchor: 'projectStart', kind: 'start', label: 'Project start' },
      { id: 'pe', anchor: 'projectEnd', kind: 'end', label: 'Project finish' },
      { id: 'beta', date: T0 + 14 * DAY, kind: 'deadline', label: 'Beta deadline' },
      { id: 'gate', date: T0 + 21 * DAY, kind: 'milestone', label: 'Gate review' },
    ];
    let clicked: string | null = null;
    lines = new ProjectLines({
      axis,
      projectSpan,
      lines: config,
      onLineClick: (id) => {
        clicked = id;
      },
    });
    host.append(lines.el);
    lines.setHeight(300);

    await expectNoA11yViolations(host);

    const rules = [...host.querySelectorAll('.jects-gantt__project-line')] as HTMLElement[];
    expect(rules.length).toBe(4);

    // Each rule paints full content height (the layer was given an explicit height).
    expect(lines.el.getBoundingClientRect().height).toBeGreaterThan(250);
    const rect = rules[0]!.getBoundingClientRect();
    expect(rect.height).toBeGreaterThan(250);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.width).toBeLessThan(6);

    // Visual ordering: project-start sits left of the beta deadline, which sits
    // left of the project-finish (a real left-to-right time axis).
    const left = (id: string): number =>
      (host.querySelector(`[data-line-id="${id}"]`) as HTMLElement).getBoundingClientRect().left;
    expect(left('ps')).toBeLessThan(left('beta'));
    expect(left('beta')).toBeLessThan(left('pe'));

    // Labels are visible and carry their text.
    const betaLabel = host.querySelector(
      '[data-line-id="beta"] .jects-gantt__project-line-label',
    ) as HTMLElement;
    expect(betaLabel.textContent).toBe('Beta deadline');
    expect(betaLabel.getBoundingClientRect().width).toBeGreaterThan(0);

    // The interactive marker is exposed to AT as a focusable button (WCAG 2.1.1 /
    // 4.1.2): role=button + tabindex=0, so keyboard + screen-reader users can use it.
    const gate = host.querySelector('[data-line-id="gate"]') as HTMLElement;
    expect(gate.getAttribute('role')).toBe('button');
    expect(gate.tabIndex).toBe(0);

    // The interactive marker routes a click to the handler.
    gate.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicked).toBe('gate');

    // …and a real keyboard activation reaches the same handler. Focus it, then
    // press Enter — the marker behaves like a button.
    clicked = null;
    gate.focus();
    expect(host.ownerDocument.activeElement).toBe(gate);
    gate.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(clicked).toBe('gate');

    // Space activates too (and is prevented so the page does not scroll).
    clicked = null;
    const spaceEvt = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    gate.dispatchEvent(spaceEvt);
    expect(clicked).toBe('gate');
    expect(spaceEvt.defaultPrevented).toBe(true);
  });

  it('print controller injects + tears down a scoped print stylesheet', () => {
    const root = document.createElement('div');
    root.className = 'jects-gantt';
    host.append(root);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    const ctrl = new GanttPrintController(root);

    ctrl.print({ title: 'Gantt plan' });
    expect(printSpy).toHaveBeenCalledTimes(1);
    const style = document.getElementById('jects-gantt-print-style') as HTMLStyleElement;
    expect(style).not.toBeNull();
    expect(style.media).toBe('print');
    expect(root.hasAttribute('data-jects-print-root')).toBe(true);

    window.dispatchEvent(new Event('afterprint'));
    expect(document.getElementById('jects-gantt-print-style')).toBeNull();
    expect(root.hasAttribute('data-jects-print-root')).toBe(false);

    ctrl.destroy();
    printSpy.mockRestore();
  });
});
