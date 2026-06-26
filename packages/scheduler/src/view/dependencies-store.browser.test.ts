/**
 * Real-browser (Chromium) test for "dependencies as a reactive Store".
 *
 * Unlike jsdom, this has real layout + SVG geometry, so the orthogonal dependency
 * router actually routes paths between bars. It exercises the store-driven path:
 *   - a live `Store<DependencyModel>` supplied as config is adopted and painted,
 *   - runtime `add`/`remove` on that store reactively repaints the connectors
 *     (the Bryntum/DHTMLX DependencyStore discipline),
 *   - the painted connectors carry no serious/critical axe violations.
 */
import { describe, it, afterEach, expect } from 'vitest';
import { HOUR_AND_DAY } from '@jects/timeline-core';
import '@jects/theme/style.css';
import '../styles.css';
import { Scheduler } from './scheduler.js';
import { createDependencyStore } from '../stores/dependency-store.js';
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
  host.style.width = '420px';
  host.style.height = '260px';
  document.body.appendChild(host);
  return host;
}

function depLines(s: Scheduler): number {
  return s.el.querySelectorAll('.jects-scheduler__dep-line').length;
}

describe('Scheduler dependencies as a reactive Store (browser)', () => {
  function make(): { s: Scheduler; store: ReturnType<typeof createDependencyStore> } {
    const h = mount();
    const store = createDependencyStore([
      { id: 'd1', fromId: 'e1', toId: 'e2', type: 'FS' },
    ]);
    sched = new Scheduler(h, {
      resources: [
        { id: 'r1', name: 'Alice' },
        { id: 'r2', name: 'Bob' },
        { id: 'r3', name: 'Carol' },
      ],
      events: [
        { id: 'e1', resourceId: 'r1', name: 'Task A', startDate: start + HOUR, endDate: start + HOUR * 2 },
        { id: 'e2', resourceId: 'r2', name: 'Task B', startDate: start + HOUR * 3, endDate: start + HOUR * 4 },
        { id: 'e3', resourceId: 'r3', name: 'Task C', startDate: start + HOUR * 4, endDate: start + HOUR * 5 },
      ],
      preset: HOUR_AND_DAY,
      range: { start, end: start + HOUR * 7 },
      dependencies: store,
      snap: false,
    });
    return { s: sched, store };
  }

  it('adopts the live Store and routes a real connector path', () => {
    const { s, store } = make();
    expect(s.getDependencyStore()).toBe(store);
    const line = s.el.querySelector('.jects-scheduler__dep-line') as SVGPathElement;
    expect(line).toBeTruthy();
    // With real layout the router emits a non-empty SVG path.
    expect((line.getAttribute('d') ?? '').length).toBeGreaterThan(0);
  });

  it('reactively repaints when the store is mutated at runtime', () => {
    const { s, store } = make();
    expect(depLines(s)).toBe(1);

    store.add({ id: 'd2', fromId: 'e2', toId: 'e3', type: 'FS' });
    expect(depLines(s)).toBe(2);
    expect(s.el.querySelector('[data-dep-id="d2"]')).toBeTruthy();

    store.remove('d1');
    expect(depLines(s)).toBe(1);
    expect(s.el.querySelector('[data-dep-id="d1"]')).toBeNull();
  });

  it('has no serious/critical a11y violations with store-driven dependencies', async () => {
    const { s, store } = make();
    store.add({ id: 'd2', fromId: 'e2', toId: 'e3', type: 'SS' });
    await expectNoA11yViolations(s.el);
  });
});
