/**
 * jsdom unit tests for the Resource Histogram feature.
 *
 * Splits cleanly into:
 *   - PURE CORE: bucket planning, working-overlap (calendar-aware), and the
 *     {@link computeHistogram} allocation math — including concurrent
 *     over-allocation summing and the calendar-honoring weight.
 *   - THE VIEW WIDGET: render produces rows/bars with the over band + capacity
 *     guide, emits `bucketActivate`, and tears down cleanly.
 *   - THE FEATURE: locates the ResourceManager, mounts a panel, repaints on
 *     assignment/schedule changes, and disposes everything on destroy.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { TimeSpan, TimeAxis } from '@jects/timeline-core';
import type { RecordId } from '@jects/core';
import {
  planBuckets,
  floorToBucket,
  nextBucket,
  workingOverlap,
  bucketWorkingMs,
  computeHistogram,
  ResourceHistogramView,
  GanttResourceHistogramFeature,
  createResourceHistogram,
  FULL_UNITS,
  type HistogramBucket,
  type HistogramAssignment,
  type WorkingTimeCalculator,
} from './histogram.js';
import { ResourceManager } from './resource-manager.js';
import type { ResourceModel } from './resource-contract.js';
import { buildCalculator } from '../engine/calendar.js';
import { Gantt } from '../ui/gantt.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5); // Monday 2026-01-05

/* ════════════════════════════════ PURE: BUCKETS ═══════════════════════════ */

describe('planBuckets', () => {
  it('floors/advances day buckets aligned to UTC midnight, clamped to range', () => {
    const range: TimeSpan = { start: T0 + 6 * HOUR, end: T0 + 2 * DAY + 6 * HOUR };
    const buckets = planBuckets(range, 'day');
    expect(buckets.length).toBe(3);
    // First bucket clamps its start up to the range start.
    expect(buckets[0]!.span.start).toBe(range.start);
    expect(buckets[0]!.span.end).toBe(T0 + DAY);
    // Middle bucket is a full natural day.
    expect(buckets[1]!.span.start).toBe(T0 + DAY);
    expect(buckets[1]!.span.end).toBe(T0 + 2 * DAY);
    // Last bucket clamps its end down to the range end.
    expect(buckets[2]!.span.end).toBe(range.end);
  });

  it('returns an empty plan for a non-positive range', () => {
    expect(planBuckets({ start: T0, end: T0 }, 'day')).toEqual([]);
    expect(planBuckets({ start: T0, end: T0 - DAY }, 'day')).toEqual([]);
  });

  it('floorToBucket anchors weeks to Monday', () => {
    // T0 is a Monday; a Wednesday floors back to that Monday.
    const wed = T0 + 2 * DAY;
    expect(floorToBucket(wed, 'week')).toBe(T0);
    expect(nextBucket(T0, 'week')).toBe(T0 + 7 * DAY);
  });

  it('handles month buckets across a boundary', () => {
    const jan15 = Date.UTC(2026, 0, 15);
    expect(floorToBucket(jan15, 'month')).toBe(Date.UTC(2026, 0, 1));
    expect(nextBucket(Date.UTC(2026, 0, 1), 'month')).toBe(Date.UTC(2026, 1, 1));
  });
});

/* ═══════════════════════════ PURE: WORKING OVERLAP ════════════════════════ */

describe('workingOverlap / bucketWorkingMs', () => {
  it('is plain wall-clock overlap with no calculator', () => {
    const task: TimeSpan = { start: T0, end: T0 + 2 * DAY };
    const bucket: TimeSpan = { start: T0 + DAY, end: T0 + 3 * DAY };
    expect(workingOverlap(task, bucket)).toBe(DAY);
    expect(bucketWorkingMs(bucket)).toBe(2 * DAY);
  });

  it('returns 0 for disjoint spans', () => {
    expect(
      workingOverlap({ start: T0, end: T0 + DAY }, { start: T0 + 2 * DAY, end: T0 + 3 * DAY }),
    ).toBe(0);
  });

  it('honors a calendar (weekend has no working time)', () => {
    // Mon–Fri 24h calendar: Sat/Sun are non-working.
    const calc = mondayToFridayCalc();
    // T0 = Monday; T0 + 5*DAY = Saturday.
    const sat: TimeSpan = { start: T0 + 5 * DAY, end: T0 + 6 * DAY };
    expect(bucketWorkingMs(sat, calc)).toBe(0);
    const fri: TimeSpan = { start: T0 + 4 * DAY, end: T0 + 5 * DAY };
    expect(bucketWorkingMs(fri, calc)).toBe(DAY);
  });
});

/* ════════════════════════════ PURE: HISTOGRAM ═════════════════════════════ */

function res(id: RecordId, extra: Partial<ResourceModel> = {}): ResourceModel {
  return { id, name: String(id), type: 'work', capacity: 1, ...extra };
}

describe('computeHistogram', () => {
  it('sums concurrent units across overlapping tasks per bucket', () => {
    // Resource r1: two full-time tasks both span the single day bucket → 200.
    const buckets: HistogramBucket[] = [{ span: { start: T0, end: T0 + DAY } }];
    const taskSpans = new Map<RecordId, TimeSpan>([
      ['t1', { start: T0, end: T0 + DAY }],
      ['t2', { start: T0, end: T0 + DAY }],
    ]);
    const assignments: HistogramAssignment[] = [
      { resourceId: 'r1', taskId: 't1', units: 100 },
      { resourceId: 'r1', taskId: 't2', units: 100 },
    ];
    const result = computeHistogram({
      resources: [res('r1')],
      assignments,
      taskSpans,
      buckets,
    });
    const cell = result.series[0]!.cells[0]!;
    expect(cell.units).toBe(200);
    expect(cell.capacityUnits).toBe(FULL_UNITS); // capacity 1 → 100
    expect(cell.allocated).toBe(100);
    expect(cell.overAllocated).toBe(100);
    expect(cell.isOver).toBe(true);
    expect(result.series[0]!.hasOver).toBe(true);
    expect(result.globalPeak).toBe(200);
  });

  it('weights units by the working overlap fraction inside a bucket', () => {
    // Task covers only the first half of the day bucket at 100% → 50 units.
    const buckets: HistogramBucket[] = [{ span: { start: T0, end: T0 + DAY } }];
    const taskSpans = new Map<RecordId, TimeSpan>([
      ['t1', { start: T0, end: T0 + DAY / 2 }],
    ]);
    const result = computeHistogram({
      resources: [res('r1')],
      assignments: [{ resourceId: 'r1', taskId: 't1', units: 100 }],
      taskSpans,
      buckets,
    });
    expect(result.series[0]!.cells[0]!.units).toBe(50);
    expect(result.series[0]!.cells[0]!.isOver).toBe(false);
  });

  it('respects a higher capacity (capacity 2 → 200% ceiling, no over)', () => {
    const buckets: HistogramBucket[] = [{ span: { start: T0, end: T0 + DAY } }];
    const taskSpans = new Map<RecordId, TimeSpan>([
      ['t1', { start: T0, end: T0 + DAY }],
      ['t2', { start: T0, end: T0 + DAY }],
    ]);
    const result = computeHistogram({
      resources: [res('r1', { capacity: 2 })],
      assignments: [
        { resourceId: 'r1', taskId: 't1', units: 100 },
        { resourceId: 'r1', taskId: 't2', units: 100 },
      ],
      taskSpans,
      buckets,
    });
    const cell = result.series[0]!.cells[0]!;
    expect(cell.units).toBe(200);
    expect(cell.capacityUnits).toBe(200);
    expect(cell.isOver).toBe(false);
    expect(cell.overAllocated).toBe(0);
  });

  it('honors a resource calendar: no load on a non-working weekend bucket', () => {
    const calc = mondayToFridayCalc();
    // Two day buckets: Friday (working) and Saturday (non-working).
    const buckets: HistogramBucket[] = [
      { span: { start: T0 + 4 * DAY, end: T0 + 5 * DAY } }, // Fri
      { span: { start: T0 + 5 * DAY, end: T0 + 6 * DAY } }, // Sat
    ];
    const taskSpans = new Map<RecordId, TimeSpan>([
      ['t1', { start: T0 + 4 * DAY, end: T0 + 6 * DAY }], // spans both
    ]);
    const result = computeHistogram({
      resources: [res('r1')],
      assignments: [{ resourceId: 'r1', taskId: 't1', units: 100 }],
      taskSpans,
      buckets,
      calculatorFor: () => calc,
    });
    expect(result.series[0]!.cells[0]!.units).toBe(100); // Fri: full working day
    expect(result.series[0]!.cells[1]!.units).toBe(0); // Sat: no working time
  });

  it('skips cost resources from the capacity-ceiling concept (infinite capacity)', () => {
    const buckets: HistogramBucket[] = [{ span: { start: T0, end: T0 + DAY } }];
    const taskSpans = new Map<RecordId, TimeSpan>([['t1', { start: T0, end: T0 + DAY }]]);
    const result = computeHistogram({
      resources: [res('cost1', { type: 'cost' })],
      assignments: [{ resourceId: 'cost1', taskId: 't1', units: 100 }],
      taskSpans,
      buckets,
    });
    expect(result.series[0]!.capacityUnits).toBe(Number.POSITIVE_INFINITY);
    expect(result.series[0]!.cells[0]!.isOver).toBe(false);
  });

  it('produces one series per resource in order, ignoring unknown task spans', () => {
    const buckets: HistogramBucket[] = [{ span: { start: T0, end: T0 + DAY } }];
    const result = computeHistogram({
      resources: [res('r1'), res('r2')],
      assignments: [{ resourceId: 'r1', taskId: 'missing', units: 100 }],
      taskSpans: new Map(),
      buckets,
    });
    expect(result.series.map((s) => s.resource.id)).toEqual(['r1', 'r2']);
    expect(result.series[0]!.cells[0]!.units).toBe(0);
  });
});

/* ════════════════════════════ THE VIEW WIDGET ═════════════════════════════ */

/** A minimal linear TimeAxis stub mapping the project span over `width` px. */
function makeAxis(range: TimeSpan, width = 700): TimeAxis {
  const toX = (t: number): number =>
    ((t - range.start) / (range.end - range.start)) * width;
  return {
    range,
    preset: 'day' as TimeAxis['preset'],
    zoom: 1,
    contentWidth: width,
    toX,
    toTime: (x: number) => range.start + (x / width) * (range.end - range.start),
    spanToBox: (s: TimeSpan) => ({ x: toX(s.start), width: toX(s.end) - toX(s.start) }),
    durationToWidth: (d: number) => (d / (range.end - range.start)) * width,
    ticksInRange: () => [],
    snap: (t: number) => t,
    setView: () => {},
    setRange: () => {},
  } as TimeAxis;
}

describe('ResourceHistogramView', () => {
  let host: HTMLElement;
  let view: ResourceHistogramView | null = null;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    view?.destroy();
    view = null;
    host.remove();
  });

  function manager(): ResourceManager {
    return new ResourceManager({
      resources: [res('r1', { name: 'Ada' })],
      assignments: [
        { id: 'a1', taskId: 't1', resourceId: 'r1', units: 100 },
        { id: 'a2', taskId: 't2', resourceId: 'r1', units: 100 },
      ],
    });
  }

  it('renders one row per resource with bars, an over band, and a capacity guide', () => {
    const mgr = manager();
    const range: TimeSpan = { start: T0, end: T0 + DAY };
    view = new ResourceHistogramView(host, {
      api: mgr,
      axis: makeAxis(range),
      bucketUnit: 'day',
      getTask: (id) =>
        ({ id, start: T0, end: T0 + DAY } as TaskModel),
    });

    const rows = host.querySelectorAll('.jects-resource-histogram-chart__row');
    expect(rows.length).toBe(1);
    // Over-allocated (200 vs capacity 100) → row modifier + over segment.
    expect(rows[0]!.classList.contains('jects-resource-histogram-chart__row--over')).toBe(true);
    expect(host.querySelector('.jects-resource-histogram-chart__over')).not.toBeNull();
    expect(host.querySelector('.jects-resource-histogram-chart__capacity')).not.toBeNull();

    const bar = host.querySelector<HTMLElement>('.jects-resource-histogram-chart__bar');
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute('role')).toBe('button');
    expect(bar!.tabIndex).toBe(0);
    expect(bar!.getAttribute('aria-label')).toContain('over capacity');
  });

  it('emits bucketActivate on click and on Enter', () => {
    const mgr = manager();
    const range: TimeSpan = { start: T0, end: T0 + DAY };
    view = new ResourceHistogramView(host, {
      api: mgr,
      axis: makeAxis(range),
      bucketUnit: 'day',
      getTask: (id) => ({ id, start: T0, end: T0 + DAY } as TaskModel),
    });

    const events: Array<{ resourceId: RecordId; bucketIndex: number }> = [];
    view.on('bucketActivate', (p) =>
      events.push({ resourceId: p.resourceId, bucketIndex: p.bucketIndex }),
    );

    const bar = host.querySelector<HTMLElement>('.jects-resource-histogram-chart__bar')!;
    bar.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(events.length).toBe(2);
    expect(events[0]).toEqual({ resourceId: 'r1', bucketIndex: 0 });
  });

  it('exposes the last computed result and an empty state with no resources', () => {
    const mgr = new ResourceManager({ resources: [], assignments: [] });
    const range: TimeSpan = { start: T0, end: T0 + DAY };
    view = new ResourceHistogramView(host, { api: mgr, axis: makeAxis(range) });
    expect(host.querySelector('.jects-resource-histogram-chart__empty')).not.toBeNull();
    expect(view.getResult()!.series.length).toBe(0);
  });
});

/* ═══════════════════════════════ THE FEATURE ══════════════════════════════ */

describe('GanttResourceHistogramFeature', () => {
  let host: HTMLElement;
  let gantt: Gantt | null = null;

  beforeEach(() => {
    host = document.createElement('div');
    host.style.height = '420px';
    host.style.width = '900px';
    document.body.appendChild(host);
  });

  afterEach(() => {
    gantt?.destroy();
    gantt = null;
    host.remove();
    // Clean up any owned panels left as siblings.
    document.querySelectorAll('.jects-gantt__histogram-panel').forEach((n) => n.remove());
  });

  function tasks(): TaskModel[] {
    return [
      { id: 't1', name: 'A', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY },
      { id: 't2', name: 'B', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY },
    ];
  }

  it('locates the ResourceManager, mounts a panel, and paints over-allocation', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(
      new ResourceManager({
        resources: [res('r1', { name: 'Ada' })],
        assignments: [
          { id: 'a1', taskId: 't1', resourceId: 'r1', units: 100 },
          { id: 'a2', taskId: 't2', resourceId: 'r1', units: 100 },
        ],
      }),
    );
    const feat = createResourceHistogram();
    gantt.use(feat);

    const panel = document.querySelector('.jects-gantt__histogram-panel');
    expect(panel).not.toBeNull();
    const result = feat.getResult();
    expect(result).not.toBeNull();
    expect(result!.series.length).toBe(1);
    // Both full-time tasks overlap → over-allocated somewhere.
    expect(result!.series[0]!.hasOver).toBe(true);
  });

  it('repaints when assignments change and tears down cleanly on destroy', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const mgr = new ResourceManager({
      resources: [res('r1', { name: 'Ada' })],
      assignments: [{ id: 'a1', taskId: 't1', resourceId: 'r1', units: 100 }],
    });
    gantt.use(mgr);
    const feat = new GanttResourceHistogramFeature();
    gantt.use(feat);

    expect(feat.getResult()!.series[0]!.hasOver).toBe(false);

    // Add the concurrent assignment → repaint should now show over-allocation.
    mgr.assign('t2', 'r1', 100);
    feat.repaint();
    expect(feat.getResult()!.series[0]!.hasOver).toBe(true);

    feat.destroy();
    expect(document.querySelector('.jects-gantt__histogram-panel')).toBeNull();
    expect(feat.getView()).toBeNull();
  });

  it('is a safe no-op when no resource layer is installed', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = new GanttResourceHistogramFeature();
    expect(() => gantt!.use(feat)).not.toThrow();
    expect(feat.getResult()).toBeNull();
    expect(document.querySelector('.jects-gantt__histogram-panel')).toBeNull();
  });
});

/* ════════════════════════════════ FIXTURES ════════════════════════════════ */

/** A Mon–Fri, 24-hours-a-day working calendar calculator. */
function mondayToFridayCalc(): WorkingTimeCalculator {
  return buildCalculator({
    id: 'mf',
    week: [1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      intervals: [{ from: 0, to: 1440 }],
    })),
  });
}
