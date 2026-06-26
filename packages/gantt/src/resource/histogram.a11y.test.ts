/**
 * axe-core a11y + visual/interaction browser test for the Resource Histogram
 * feature (Quality Gate Q2 + a feature-exercising visual check). Runs in REAL
 * Chromium via `pnpm --filter @jects/gantt test:browser`.
 *
 * Exercises the parity behaviour end to end with real layout/geometry:
 *   1. A resource over-booked across two concurrent full-time tasks paints an
 *      over-allocation band with real pixel height stacked above the in-capacity
 *      fill (the single-segment path could never show the surplus).
 *   2. Bars are positioned against the shared time axis at real left/width
 *      pixels and ascend left→right with the timeline.
 *   3. Each bucket bar is an operable button (role=button, tabindex=0) reachable
 *      by keyboard, and Enter activates it.
 *   4. The mounted view has zero serious/critical a11y violations.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the real package stylesheet so geometry assertions exercise the shipped,
// token-pure CSS (segment heights, capacity guide) rather than unstyled defaults.
import '../styles.css';
import { DefaultTimeAxis, WEEK_AND_DAY } from '@jects/timeline-core';
import { ResourceHistogramView } from './histogram.js';
import { ResourceManager } from './resource-manager.js';
import type { ResourceModel } from './resource-contract.js';
import type { TaskModel } from '../contract.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const range = { start: T0, end: T0 + 6 * DAY };

let host: HTMLElement;
let view: ResourceHistogramView | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.position = 'relative';
  host.style.height = '220px';
  host.style.width = '900px';
  document.body.appendChild(host);
});

afterEach(() => {
  view?.destroy();
  view = null;
  host.remove();
});

function resources(): ResourceModel[] {
  return [
    { id: 'ada', name: 'Ada Lovelace', type: 'work', capacity: 1 },
    { id: 'cal', name: 'Calm Resource', type: 'work', capacity: 2 },
  ];
}

/** Ada is double-booked on two concurrent full-time tasks; Cal is single. */
function manager(): ResourceManager {
  return new ResourceManager({
    resources: resources(),
    assignments: [
      { id: 'a1', taskId: 't1', resourceId: 'ada', units: 100 },
      { id: 'a2', taskId: 't2', resourceId: 'ada', units: 100 },
      { id: 'a3', taskId: 't1', resourceId: 'cal', units: 100 },
    ],
  });
}

const tasksById: Record<string, TaskModel> = {
  t1: { id: 't1', name: 'A', start: T0, end: T0 + 4 * DAY },
  t2: { id: 't2', name: 'B', start: T0, end: T0 + 4 * DAY },
};

describe('ResourceHistogram a11y + visual (real Chromium)', () => {
  it('paints an over-allocation band with real geometry and no serious/critical violations', async () => {
    const axis = new DefaultTimeAxis({ range, preset: WEEK_AND_DAY, zoom: 1 });
    view = new ResourceHistogramView(host, {
      api: manager(),
      axis,
      bucketUnit: 'day',
      rowHeight: 56,
      getTask: (id) => tasksById[String(id)],
    });

    await expectNoA11yViolations(host);

    // Two resource rows (work resources; cost lines excluded by default).
    const rows = [...host.querySelectorAll<HTMLElement>(
      '.jects-resource-histogram-chart__row',
    )];
    expect(rows.length).toBe(2);

    // Ada's row is flagged over-allocated; her bars carry an over band with real
    // pixel height stacked above the in-capacity fill.
    const adaRow = host.querySelector<HTMLElement>('[data-resource-id="ada"]')!;
    expect(adaRow.classList.contains('jects-resource-histogram-chart__row--over')).toBe(true);
    const overSeg = adaRow.querySelector<HTMLElement>('.jects-resource-histogram-chart__over');
    expect(overSeg).not.toBeNull();
    expect(overSeg!.getBoundingClientRect().height).toBeGreaterThan(0);

    // Cal (capacity 2) is NOT over-allocated under a single full-time task.
    const calRow = host.querySelector<HTMLElement>('[data-resource-id="cal"]')!;
    expect(calRow.classList.contains('jects-resource-histogram-chart__row--over')).toBe(false);
    expect(calRow.querySelector('.jects-resource-histogram-chart__over')).toBeNull();

    // Capacity guide line rendered for a finite-capacity resource.
    expect(host.querySelector('.jects-resource-histogram-chart__capacity')).not.toBeNull();

    // Bars are positioned against the axis: real widths, ascending left→right.
    const bars = [...adaRow.querySelectorAll<HTMLElement>(
      '.jects-resource-histogram-chart__bar',
    )];
    expect(bars.length).toBeGreaterThan(1);
    for (const bar of bars) {
      expect(bar.getBoundingClientRect().width).toBeGreaterThan(0);
    }
    const firstLeft = bars[0]!.getBoundingClientRect().left;
    const lastLeft = bars[bars.length - 1]!.getBoundingClientRect().left;
    expect(lastLeft).toBeGreaterThan(firstLeft);
  });

  it('bucket bars are keyboard-operable buttons that emit bucketActivate', async () => {
    const axis = new DefaultTimeAxis({ range, preset: WEEK_AND_DAY, zoom: 1 });
    view = new ResourceHistogramView(host, {
      api: manager(),
      axis,
      bucketUnit: 'day',
      getTask: (id) => tasksById[String(id)],
    });

    const events: Array<{ resourceId: string; bucketIndex: number }> = [];
    view.on('bucketActivate', (p) =>
      events.push({ resourceId: String(p.resourceId), bucketIndex: p.bucketIndex }),
    );

    const bar = host.querySelector<HTMLElement>('.jects-resource-histogram-chart__bar')!;
    expect(bar.getAttribute('role')).toBe('button');
    expect(bar.tabIndex).toBe(0);

    bar.focus();
    expect(host.ownerDocument.activeElement).toBe(bar);
    bar.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(events.length).toBe(1);

    // Space activates too and is prevented (no page scroll).
    const spaceEvt = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    bar.dispatchEvent(spaceEvt);
    expect(events.length).toBe(2);
    expect(spaceEvt.defaultPrevented).toBe(true);
  });
});
