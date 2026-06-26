/**
 * jsdom unit tests for the Resource Histogram view.
 *
 * Two layers:
 *   1. The PURE time-phasing math (`buildBuckets` / `computeHistogram`): bucket
 *      grids, overlap-weighted allocation, capacity ceilings, over-allocation
 *      flags, cost-resource exclusion — no DOM.
 *   2. The `ResourceHistogram` widget end to end against a `ResourceManager` + a
 *      fake shared axis: input assembly, lane/bar/capacity-line painting, the
 *      `bucketActivate` + `histogramRender` events, and leak-free `destroy()`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  ResourceHistogram,
  computeHistogram,
  buildBuckets,
  createResourceHistogram,
  type HistogramResourceInput,
} from './resource-histogram.js';
import { ResourceManager } from '../resource/resource-manager.js';
import type { GanttApi, TaskModel } from '../contract.js';
import type { ResourceModel } from '../resource/resource-contract.js';
import type { TimeAxis, TimeSpan } from '@jects/timeline-core';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5); // a Monday

/* ── a minimal, deterministic shared axis (1px per hour) ─────────────────── */
const PX_PER_MS = 1 / 3_600_000; // 1px = 1 hour

function fakeAxis(range: TimeSpan): TimeAxis {
  const toX = (t: number): number => (t - range.start) * PX_PER_MS;
  return {
    range,
    preset: {} as never,
    zoom: 1,
    contentWidth: (range.end - range.start) * PX_PER_MS,
    toX,
    toTime: (x: number) => range.start + x / PX_PER_MS,
    spanToBox: (s: TimeSpan) => ({ x: toX(s.start), width: (s.end - s.start) * PX_PER_MS }),
    durationToWidth: (d: number) => d * PX_PER_MS,
    ticksInRange: () => [],
    snap: (t: number) => t,
    setView: () => {},
    setRange: () => {},
  };
}

/* ── a fake GanttApi exposing task spans for the ResourceManager + resolver ── */
function fakeApi(tasks: TaskModel[]): GanttApi {
  const byId = new Map(tasks.map((t) => [t.id, { ...t }]));
  return {
    getTask: (id) => byId.get(id),
    updateTask: (id, patch) => {
      const t = byId.get(id);
      if (t) Object.assign(t, patch);
      return !!t;
    },
    emit: () => true,
    track: () => {},
  } as unknown as GanttApi;
}

/* ════════════════════════════════════════════════════════════════════════ */
/* 1. PURE MATH                                                               */
/* ════════════════════════════════════════════════════════════════════════ */

describe('buildBuckets', () => {
  it('tiles the range with uniform buckets anchored at the start', () => {
    const { starts, size } = buildBuckets({ range: { start: T0, end: T0 + 3 * DAY }, size: DAY });
    expect(size).toBe(DAY);
    expect(starts).toEqual([T0, T0 + DAY, T0 + 2 * DAY]);
  });

  it('falls back to a one-day bucket for a bad size and clamps tiny sizes', () => {
    const bad = buildBuckets({ range: { start: T0, end: T0 + DAY }, size: 0 });
    expect(bad.size).toBe(DAY);
    const tiny = buildBuckets({ range: { start: T0, end: T0 + DAY }, size: 1 });
    expect(tiny.size).toBe(60_000); // clamped to one minute
  });

  it('returns no buckets for an empty or inverted range', () => {
    expect(buildBuckets({ range: { start: T0, end: T0 }, size: DAY }).starts).toEqual([]);
    expect(buildBuckets({ range: { start: T0, end: T0 - DAY }, size: DAY }).starts).toEqual([]);
  });
});

describe('computeHistogram', () => {
  it('overlap-weights units so a full-bucket segment contributes its full units', () => {
    const resources: HistogramResourceInput[] = [
      {
        id: 'r1',
        name: 'Ada',
        capacity: 1,
        segments: [{ taskId: 't1', start: T0, end: T0 + 2 * DAY, units: 100 }],
      },
    ];
    const m = computeHistogram(resources, { range: { start: T0, end: T0 + 3 * DAY }, size: DAY });
    const lane = m.lanes[0]!;
    expect(lane.buckets.map((b) => b.units)).toEqual([100, 100, 0]);
    expect(lane.capacityUnits).toBe(100);
    expect(lane.over).toBe(false);
  });

  it('weights a half-covered bucket by its overlap fraction', () => {
    // Segment covers exactly the first half of bucket 0.
    const resources: HistogramResourceInput[] = [
      {
        id: 'r1',
        capacity: 1,
        segments: [{ taskId: 't1', start: T0, end: T0 + DAY / 2, units: 100 }],
      },
    ];
    const m = computeHistogram(resources, { range: { start: T0, end: T0 + DAY }, size: DAY });
    expect(m.lanes[0]!.buckets[0]!.units).toBe(50);
  });

  it('sums concurrent assignments and flags over-allocation past capacity', () => {
    const resources: HistogramResourceInput[] = [
      {
        id: 'r1',
        name: 'Ada',
        capacity: 1, // ceiling 100
        segments: [
          { taskId: 't1', start: T0, end: T0 + DAY, units: 100 },
          { taskId: 't2', start: T0, end: T0 + DAY, units: 60 },
        ],
      },
    ];
    const m = computeHistogram(resources, { range: { start: T0, end: T0 + DAY }, size: DAY });
    const lane = m.lanes[0]!;
    expect(lane.buckets[0]!.units).toBe(160);
    expect(lane.buckets[0]!.over).toBe(true);
    expect(lane.over).toBe(true);
    expect(lane.peakUnits).toBe(160);
  });

  it('does NOT flag an exactly-full bucket as over-allocated', () => {
    const resources: HistogramResourceInput[] = [
      { id: 'r1', capacity: 1, segments: [{ taskId: 't1', start: T0, end: T0 + DAY, units: 100 }] },
    ];
    const m = computeHistogram(resources, { range: { start: T0, end: T0 + DAY }, size: DAY });
    expect(m.lanes[0]!.buckets[0]!.over).toBe(false);
  });

  it('respects a higher capacity (a team) before flagging over-allocation', () => {
    const resources: HistogramResourceInput[] = [
      {
        id: 'team',
        capacity: 3, // ceiling 300
        segments: [{ taskId: 't1', start: T0, end: T0 + DAY, units: 250 }],
      },
    ];
    const m = computeHistogram(resources, { range: { start: T0, end: T0 + DAY }, size: DAY });
    expect(m.lanes[0]!.buckets[0]!.over).toBe(false);
    expect(m.lanes[0]!.capacityUnits).toBe(300);
  });

  it('excludes cost resources (no time component)', () => {
    const resources: HistogramResourceInput[] = [
      { id: 'money', capacity: 1, isCost: true, segments: [] },
      { id: 'r1', capacity: 1, segments: [] },
    ];
    const m = computeHistogram(resources, { range: { start: T0, end: T0 + DAY }, size: DAY });
    expect(m.lanes.map((l) => l.resourceId)).toEqual(['r1']);
  });
});

/* ════════════════════════════════════════════════════════════════════════ */
/* 2. WIDGET                                                                  */
/* ════════════════════════════════════════════════════════════════════════ */

const resources: ResourceModel[] = [
  { id: 'r1', name: 'Ada Lovelace', capacity: 1 },
  { id: 'r2', name: 'Boris', capacity: 1 },
];

let host: HTMLElement;
let view: ResourceHistogram | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
  host?.remove();
});

function setup(opts?: {
  tasks?: TaskModel[];
  assign?: Array<[string, string, number?]>;
}): { mgr: ResourceManager; api: GanttApi; axis: TimeAxis } {
  host = document.createElement('div');
  document.body.append(host);
  const tasks =
    opts?.tasks ??
    ([
      { id: 't1', start: T0, end: T0 + DAY } as TaskModel,
      { id: 't2', start: T0, end: T0 + DAY } as TaskModel,
    ] as TaskModel[]);
  const api = fakeApi(tasks);
  const mgr = new ResourceManager({ resources });
  mgr.init(api);
  for (const [taskId, resourceId, units] of opts?.assign ?? []) {
    mgr.assign(taskId, resourceId, units);
  }
  const axis = fakeAxis({ start: T0, end: T0 + 3 * DAY });
  return { mgr, api, axis };
}

describe('ResourceHistogram widget', () => {
  it('renders one lane per non-cost resource with the shared region role', () => {
    const { mgr, api, axis } = setup();
    view = new ResourceHistogram(host, {
      api: mgr,
      axis,
      getTaskSpan: (id) => api.getTask(id),
    });
    expect(host.querySelector('.jects-resource-histogram')?.getAttribute('aria-label')).toBe(
      'Resource histogram',
    );
    const lanes = host.querySelectorAll('.jects-resource-histogram__lane');
    expect(lanes).toHaveLength(2);
    expect(lanes[0]!.getAttribute('aria-label')).toContain('Ada Lovelace');
  });

  it('assembles allocation segments from the ResourceApi + task spans', () => {
    const { mgr, api, axis } = setup({ assign: [['t1', 'r1', 100]] });
    view = new ResourceHistogram(host, {
      api: mgr,
      axis,
      getTaskSpan: (id) => api.getTask(id),
    });
    const input = view.buildInput();
    const r1 = input.find((r) => r.id === 'r1')!;
    expect(r1.segments).toHaveLength(1);
    expect(r1.segments[0]).toMatchObject({ taskId: 't1', start: T0, end: T0 + DAY, units: 100 });
  });

  it('positions bucket bars on the shared axis (px lefts/widths align with the Gantt)', () => {
    const { mgr, api, axis } = setup({ assign: [['t1', 'r1', 100]] });
    view = new ResourceHistogram(host, {
      api: mgr,
      axis,
      getTaskSpan: (id) => api.getTask(id),
    });
    const lane = host.querySelector('.jects-resource-histogram__lane[data-resource-id="r1"]')!;
    const bars = lane.querySelectorAll<HTMLElement>('.jects-resource-histogram__bar');
    // 3-day range, one-day buckets ⇒ 3 columns.
    expect(bars).toHaveLength(3);
    // Bucket 0 starts at axis x=0, one day wide = 24 hours * 1px/hour = 24px.
    expect(bars[0]!.style.left).toBe('0px');
    expect(bars[0]!.style.width).toBe('24px');
    // Bucket 1 starts one day in.
    expect(bars[1]!.style.left).toBe('24px');
  });

  it('draws a capacity line and flags the over-allocated lane + bars', () => {
    // r1 assigned to BOTH t1 and t2 at 100% over the same day ⇒ 200% > 100% cap.
    const { mgr, api, axis } = setup({ assign: [['t1', 'r1', 100], ['t2', 'r1', 100]] });
    view = new ResourceHistogram(host, {
      api: mgr,
      axis,
      getTaskSpan: (id) => api.getTask(id),
    });
    const lane = host.querySelector('.jects-resource-histogram__lane[data-resource-id="r1"]')!;
    expect(lane.classList.contains('jects-resource-histogram__lane--over')).toBe(true);
    expect(lane.querySelector('.jects-resource-histogram__capacity')).toBeTruthy();
    const over = lane.querySelector('.jects-resource-histogram__bar--over') as HTMLElement;
    expect(over).toBeTruthy();
    expect(over.dataset.over).toBe('true');
    expect(over.getAttribute('aria-label')).toContain('over-allocated');
  });

  it('emits bucketActivate when a column is clicked', () => {
    const { mgr, api, axis } = setup({ assign: [['t1', 'r1', 100]] });
    view = new ResourceHistogram(host, {
      api: mgr,
      axis,
      getTaskSpan: (id) => api.getTask(id),
    });
    let payload: { resourceId: string | number; units: number } | undefined;
    view.on('bucketActivate', (p) => (payload = p));
    const bar = host.querySelector<HTMLElement>(
      '.jects-resource-histogram__lane[data-resource-id="r1"] .jects-resource-histogram__bar',
    )!;
    bar.click();
    expect(payload?.resourceId).toBe('r1');
    expect(payload?.units).toBe(100);
  });

  it('emits histogramRender with the computed model on paint + refresh', () => {
    const { mgr, api, axis } = setup({ assign: [['t1', 'r1', 100]] });
    let renders = 0;
    view = new ResourceHistogram(host, {
      api: mgr,
      axis,
      getTaskSpan: (id) => api.getTask(id),
    });
    view.on('histogramRender', () => renders++);
    const model = view.refresh();
    expect(model.lanes).toHaveLength(2);
    expect(renders).toBe(1);
    expect(view.getModel()).toBe(model);
  });

  it('reflects a new assignment after refresh()', () => {
    const { mgr, api, axis } = setup();
    view = new ResourceHistogram(host, {
      api: mgr,
      axis,
      getTaskSpan: (id) => api.getTask(id),
    });
    // Initially idle: every bar is empty.
    const bars = host.querySelectorAll('.jects-resource-histogram__bar--empty');
    expect(bars.length).toBeGreaterThan(0);
    mgr.assign('t1', 'r1', 100);
    view.refresh();
    const lane = host.querySelector('.jects-resource-histogram__lane[data-resource-id="r1"]')!;
    const loaded = lane.querySelector('.jects-resource-histogram__bar:not(.jects-resource-histogram__bar--empty)');
    expect(loaded).toBeTruthy();
  });

  it('honors resourceIds to restrict + order lanes', () => {
    const { mgr, api, axis } = setup();
    view = new ResourceHistogram(host, {
      api: mgr,
      axis,
      getTaskSpan: (id) => api.getTask(id),
      resourceIds: ['r2'],
    });
    const lanes = host.querySelectorAll('.jects-resource-histogram__lane');
    expect(lanes).toHaveLength(1);
    expect((lanes[0] as HTMLElement).dataset.resourceId).toBe('r2');
  });

  it('renders an empty placeholder when there are no resources', () => {
    host = document.createElement('div');
    document.body.append(host);
    const api = fakeApi([]);
    const mgr = new ResourceManager({ resources: [] });
    mgr.init(api);
    view = new ResourceHistogram(host, { api: mgr, axis: fakeAxis({ start: T0, end: T0 + DAY }) });
    expect(host.querySelector('.jects-resource-histogram__empty')).toBeTruthy();
  });

  it('createResourceHistogram mounts an instance', () => {
    const { mgr, axis } = setup();
    host = document.createElement('div');
    document.body.append(host);
    view = createResourceHistogram(host, { api: mgr, axis });
    expect(view).toBeInstanceOf(ResourceHistogram);
  });

  it('destroy() removes the element and is idempotent', () => {
    const { mgr, api, axis } = setup({ assign: [['t1', 'r1', 100]] });
    view = new ResourceHistogram(host, { api: mgr, axis, getTaskSpan: (id) => api.getTask(id) });
    view.destroy();
    expect(host.querySelector('.jects-resource-histogram')).toBeNull();
    expect(() => view!.destroy()).not.toThrow();
    view = undefined;
  });
});
