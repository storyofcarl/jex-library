/**
 * jsdom unit tests for the Gantt **split / segmented tasks** feature
 * (`ui/segmented-tasks.ts`).
 *
 * Two layers:
 *   1. Pure geometry — `computeSegmentBoxes` projects segment spans (absolute
 *      content-pixel space) into bar-local sub-bar boxes + gap connectors.
 *   2. Integration — installed on a real `Gantt` + engine, it overlays one
 *      sub-bar per segment on a split task's bar with connectors across the gaps,
 *      programmatic `split`/`join` route through the engine and toggle the split
 *      state, and the feature cleans up on `destroy()`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { type RecordId } from '@jects/core';
import { Gantt } from './gantt.js';
import {
  GanttSegmentedTasksFeature,
  createSegmentedTasksFeature,
  computeSegmentBoxes,
  MIN_SEGMENT_WIDTH,
} from './segmented-tasks.js';
import { readSegments, type TaskSegment } from '../engine/segments.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

const seg = (start: number, end: number): TaskSegment => ({ start, end });

/* ── pure geometry ─────────────────────────────────────────────────────── */

describe('computeSegmentBoxes', () => {
  // A linear projector: 1 ms == 1e-7 px → easy exact pixels for the test.
  const toX = (t: number): number => (t - T0) / 1e7;

  it('translates each segment into bar-local px and floors a minimum width', () => {
    const segments = [seg(T0, T0 + DAY), seg(T0 + 3 * DAY, T0 + 5 * DAY)];
    const barLeft = toX(T0);
    const { boxes } = computeSegmentBoxes(segments, barLeft, toX);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.left).toBeCloseTo(0, 5);
    expect(boxes[0]!.width).toBeGreaterThanOrEqual(MIN_SEGMENT_WIDTH);
    // Second box starts at the 3-day offset.
    expect(boxes[1]!.left).toBeCloseTo((3 * DAY) / 1e7, 3);
  });

  it('emits a connector spanning the gap between consecutive segments', () => {
    const segments = [seg(T0, T0 + DAY), seg(T0 + 3 * DAY, T0 + 5 * DAY)];
    const { connectors } = computeSegmentBoxes(segments, toX(T0), toX);
    expect(connectors).toHaveLength(1);
    const c = connectors[0]!;
    expect(c.gapIndex).toBe(0);
    expect(c.left).toBeGreaterThan(0);
    expect(c.width).toBeGreaterThan(0);
  });

  it('produces no connectors for a single segment', () => {
    const { connectors } = computeSegmentBoxes([seg(T0, T0 + DAY)], toX(T0), toX);
    expect(connectors).toHaveLength(0);
  });
});

/* ── integration on a real Gantt ───────────────────────────────────────── */

function splitPlan(): TaskModel[] {
  return [
    {
      id: 't1',
      name: 'Foundations',
      start: T0,
      end: T0 + 6 * DAY,
      duration: 4 * DAY,
      // Authored as a split task: two working pieces with a 2-day gap.
      segments: [seg(T0, T0 + 2 * DAY), seg(T0 + 4 * DAY, T0 + 6 * DAY)],
    } as TaskModel,
    { id: 't2', name: 'Walls', start: T0 + 7 * DAY, end: T0 + 9 * DAY, duration: 2 * DAY } as TaskModel,
  ];
}

function getTask(g: Gantt, id: RecordId): TaskModel {
  return g.getTask(id) as TaskModel;
}

describe('GanttSegmentedTasksFeature integration', () => {
  it('renders one sub-bar per segment plus a connector on a split task', () => {
    gantt = new Gantt(host, { tasks: splitPlan(), projectStart: T0 });
    const feature = new GanttSegmentedTasksFeature();
    gantt.use(feature);
    feature.paint();

    const bar = gantt.el.querySelector(
      '.jects-gantt__bar[data-task-id="t1"]',
    ) as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.dataset.split).toBe('2');

    const overlay = bar.querySelector('.jects-gantt__segments') as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.getAttribute('role')).toBe('group');
    expect(overlay.querySelectorAll('.jects-gantt__segment')).toHaveLength(2);
    expect(overlay.querySelectorAll('.jects-gantt__segment-connector')).toHaveLength(1);
  });

  it('does not decorate a contiguous (non-split) task', () => {
    gantt = new Gantt(host, { tasks: splitPlan(), projectStart: T0 });
    const feature = new GanttSegmentedTasksFeature();
    gantt.use(feature);
    feature.paint();

    const bar = gantt.el.querySelector('.jects-gantt__bar[data-task-id="t2"]') as HTMLElement;
    expect(bar.dataset.split).toBeUndefined();
    expect(bar.querySelector('.jects-gantt__segments')).toBeNull();
  });

  it('split() cuts a contiguous task into two segments through the engine', () => {
    gantt = new Gantt(host, { tasks: [
      { id: 'a', name: 'A', start: T0, end: T0 + 4 * DAY, duration: 4 * DAY } as TaskModel,
    ], projectStart: T0 });
    const feature = new GanttSegmentedTasksFeature();
    gantt.use(feature);

    expect(readSegments(getTask(gantt, 'a'))).toHaveLength(0);
    const ok = feature.split('a', T0 + 2 * DAY);
    expect(ok).toBe(true);

    const segs = readSegments(getTask(gantt, 'a'));
    expect(segs.length).toBeGreaterThanOrEqual(2);
    // There is a real interruption: a positive gap between the two pieces.
    expect(segs[1]!.start).toBeGreaterThan(segs[0]!.end);
    // The task's outer span (gap-inclusive) is wider than its summed working time.
    const calc = gantt.engine.getCalculatorFor('a');
    const work = segs.reduce(
      (sum, s) => sum + calc.workingDurationBetween(s.start, s.end),
      0,
    );
    const span = getTask(gantt, 'a').end! - getTask(gantt, 'a').start!;
    expect(span).toBeGreaterThan(work);
  });

  it('join() collapses two segments back to a contiguous task', () => {
    gantt = new Gantt(host, { tasks: splitPlan(), projectStart: T0 });
    const feature = new GanttSegmentedTasksFeature();
    gantt.use(feature);

    expect(readSegments(getTask(gantt, 't1'))).toHaveLength(2);
    const ok = feature.join('t1', 0);
    expect(ok).toBe(true);
    // Single segment ⇒ the feature clears the segments field entirely.
    expect(readSegments(getTask(gantt, 't1')).length).toBeLessThan(2);
  });

  it('layoutFor() reports the bar-local boxes for a rendered split task', () => {
    gantt = new Gantt(host, { tasks: splitPlan(), projectStart: T0 });
    const feature = createSegmentedTasksFeature();
    gantt.use(feature);
    feature.paint();

    const layout = feature.layoutFor('t1');
    expect(layout.boxes).toHaveLength(2);
    expect(layout.connectors).toHaveLength(1);
    // Boxes are ordered left→right.
    expect(layout.boxes[0]!.left).toBeLessThanOrEqual(layout.boxes[1]!.left);
  });

  it('cleans up its overlays and observer on destroy()', () => {
    gantt = new Gantt(host, { tasks: splitPlan(), projectStart: T0 });
    const feature = new GanttSegmentedTasksFeature();
    gantt.use(feature);
    feature.paint();
    expect(gantt.el.querySelector('.jects-gantt__segments')).not.toBeNull();

    feature.destroy();
    expect(gantt.el.querySelector('.jects-gantt__segments')).toBeNull();
    const bar = gantt.el.querySelector('.jects-gantt__bar[data-task-id="t1"]') as HTMLElement;
    expect(bar.dataset.split).toBeUndefined();
  });

  it('is reusable after destroy() (re-init paints again)', () => {
    gantt = new Gantt(host, { tasks: splitPlan(), projectStart: T0 });
    const feature = new GanttSegmentedTasksFeature();
    gantt.use(feature);
    feature.paint();
    feature.destroy();

    gantt.use(feature);
    feature.paint();
    expect(gantt.el.querySelector('.jects-gantt__segments')).not.toBeNull();
  });
});
