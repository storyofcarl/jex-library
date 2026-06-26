import { describe, it, expect, afterEach } from 'vitest';
import {
  UtilizationMatrix,
  ResourceUtilizationView,
  resolveBuckets,
  type UtilizationTimeAxis,
} from './utilization.js';
import { ResourceManager } from './resource-manager.js';
import type { GanttApi, TaskModel } from '../contract.js';
import type { ResourceModel } from './resource-contract.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
// Monday 2026-01-05 .. so weeks fall on clean ISO boundaries.
const MON = Date.UTC(2026, 0, 5);

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

const resources: ResourceModel[] = [
  { id: 'r1', name: 'Ada Lovelace', capacity: 1 },
  { id: 'r2', name: 'Boris', capacity: 1 },
  { id: 'rc', name: 'License', type: 'cost', capacity: 1, hourlyCost: 50 },
];

/** Two tasks: t1 spans week0 (5 working days = 40h effort), t2 spans week1. */
function makeTasks(): TaskModel[] {
  return [
    { id: 't1', name: 'Design', start: MON, end: MON + 5 * DAY, effort: 40 * HOUR } as TaskModel,
    {
      id: 't2',
      name: 'Build',
      start: MON + 7 * DAY,
      end: MON + 12 * DAY,
      effort: 40 * HOUR,
    } as TaskModel,
  ];
}

function setupMgr(): ResourceManager {
  const api = fakeApi(makeTasks());
  const mgr = new ResourceManager({ resources });
  mgr.init(api);
  return mgr;
}

const weekAxis: UtilizationTimeAxis = {
  start: MON,
  end: MON + 21 * DAY,
  granularity: 'week',
};

describe('resolveBuckets', () => {
  it('discretises a range into contiguous week buckets', () => {
    const buckets = resolveBuckets(weekAxis);
    expect(buckets).toHaveLength(3);
    expect(buckets[0]!.index).toBe(0);
    expect(buckets[0]!.start).toBe(MON);
    expect(buckets[1]!.start).toBe(MON + 7 * DAY);
    // Labels are ISO week strings.
    expect(buckets[0]!.label).toMatch(/^Wk \d\d$/);
  });

  it('discretises by day and by month', () => {
    const days = resolveBuckets({ start: MON, end: MON + 3 * DAY, granularity: 'day' });
    expect(days).toHaveLength(3);
    expect(days[0]!.end - days[0]!.start).toBe(DAY);

    const months = resolveBuckets({
      start: Date.UTC(2026, 0, 10),
      end: Date.UTC(2026, 2, 5),
      granularity: 'month',
    });
    expect(months.map((m) => m.label)).toEqual(['Jan 2026', 'Feb 2026', 'Mar 2026']);
  });

  it('honours explicit buckets and re-indexes them', () => {
    const buckets = resolveBuckets({
      buckets: [
        { index: 9, start: 0, end: DAY, label: 'A' },
        { index: 4, start: DAY, end: 2 * DAY, label: 'B' },
      ],
    });
    expect(buckets.map((b) => b.index)).toEqual([0, 1]);
  });

  it('returns no buckets for an invalid range', () => {
    expect(resolveBuckets({ start: 10, end: 5 })).toEqual([]);
    expect(resolveBuckets({})).toEqual([]);
  });

  it('applies a custom header formatter', () => {
    const buckets = resolveBuckets({
      start: MON,
      end: MON + 2 * DAY,
      granularity: 'day',
      formatHeader: ({ index }) => `D${index}`,
    });
    expect(buckets.map((b) => b.label)).toEqual(['D0', 'D1']);
  });
});

describe('UtilizationMatrix', () => {
  it('produces one row per resource over the bucket axis', () => {
    const mgr = setupMgr();
    const m = new UtilizationMatrix(mgr, weekAxis);
    expect(m.rows).toHaveLength(3);
    expect(m.buckets).toHaveLength(3);
    for (const row of m.rows) expect(row.cells).toHaveLength(3);
  });

  it('distributes a task effort into the bucket its span overlaps', () => {
    const mgr = setupMgr();
    mgr.assign('t1', 'r1', 100); // 40h effort, fully in week0
    const m = new UtilizationMatrix(mgr, weekAxis);
    const r1 = m.rows.find((r) => r.resource.id === 'r1')!;
    // Week 0 gets the full 40h; weeks 1 & 2 nothing.
    expect(Math.round(r1.cells[0]!.allocated)).toBe(40);
    expect(r1.cells[1]!.allocated).toBe(0);
    expect(r1.totalAllocated).toBeCloseTo(40, 5);
  });

  it('measures availability from capacity and flags neither over nor idle at full', () => {
    const mgr = setupMgr();
    mgr.assign('t1', 'r1', 100);
    const m = new UtilizationMatrix(mgr, weekAxis); // 8h/day, 5 working days = 40h/week available
    const r1 = m.rows.find((r) => r.resource.id === 'r1')!;
    expect(Math.round(r1.cells[0]!.available)).toBe(40);
    expect(r1.cells[0]!.ratio).toBeCloseTo(1, 2);
    expect(r1.cells[0]!.over).toBe(false);
  });

  it('flags over-allocation when allocated exceeds available', () => {
    const mgr = setupMgr();
    // Two 40h tasks both landing in week0 for r1 ⇒ 80h vs 40h available.
    const api = fakeApi([
      { id: 't1', name: 'A', start: MON, end: MON + 5 * DAY, effort: 40 * HOUR } as TaskModel,
      { id: 't2', name: 'B', start: MON, end: MON + 5 * DAY, effort: 40 * HOUR } as TaskModel,
    ]);
    const mgr2 = new ResourceManager({ resources });
    mgr2.init(api);
    mgr2.assign('t1', 'r1', 100);
    mgr2.assign('t2', 'r1', 100);
    const m = new UtilizationMatrix(mgr2, weekAxis);
    const r1 = m.rows.find((r) => r.resource.id === 'r1')!;
    expect(Math.round(r1.cells[0]!.allocated)).toBe(80);
    expect(r1.cells[0]!.over).toBe(true);
    expect(r1.anyOver).toBe(true);
    expect(m.hasOverAllocation).toBe(true);
    void mgr; // silence unused
  });

  it('builds per-task drill rows sorted by total allocation', () => {
    const mgr = setupMgr();
    mgr.assign('t1', 'r1', 100); // 40h week0
    mgr.assign('t2', 'r1', 100); // 40h week1
    const m = new UtilizationMatrix(mgr, weekAxis);
    const r1 = m.rows.find((r) => r.resource.id === 'r1')!;
    expect(r1.tasks).toHaveLength(2);
    // Both 40h total; names come through.
    expect(r1.tasks.map((t) => t.name).sort()).toEqual(['Build', 'Design']);
    // Each task's contribution lands in its own week.
    const design = r1.tasks.find((t) => t.name === 'Design')!;
    expect(Math.round(design.cells[0]!.allocated)).toBe(40);
    expect(design.cells[1]!.allocated).toBe(0);
  });

  it('treats cost resources as having zero availability', () => {
    const mgr = setupMgr();
    mgr.assign('t1', 'rc', 100);
    const m = new UtilizationMatrix(mgr, weekAxis);
    const rc = m.rows.find((r) => r.resource.id === 'rc')!;
    expect(rc.cells[0]!.available).toBe(0);
  });

  it('splits multi-resource task effort by units share', () => {
    const mgr = setupMgr();
    mgr.assign('t1', 'r1', 100); // 2/3 of 40h
    mgr.assign('t1', 'r2', 50); // 1/3 of 40h
    const m = new UtilizationMatrix(mgr, weekAxis);
    const r1 = m.rows.find((r) => r.resource.id === 'r1')!;
    const r2 = m.rows.find((r) => r.resource.id === 'r2')!;
    expect(r1.cells[0]!.allocated).toBeCloseTo((40 * 2) / 3, 4);
    expect(r2.cells[0]!.allocated).toBeCloseTo((40 * 1) / 3, 4);
  });

  it('recomputes on compute() after an assignment change', () => {
    const mgr = setupMgr();
    const m = new UtilizationMatrix(mgr, weekAxis);
    expect(m.grandTotalAllocated).toBe(0);
    mgr.assign('t1', 'r1', 100);
    m.compute();
    expect(m.grandTotalAllocated).toBeCloseTo(40, 4);
  });

  it('respects custom hoursPerDay / workingDaysPerWeek options', () => {
    const mgr = setupMgr();
    mgr.assign('t1', 'r1', 100);
    const m = new UtilizationMatrix(mgr, weekAxis, { hoursPerDay: 6, workingDaysPerWeek: 4 });
    const r1 = m.rows.find((r) => r.resource.id === 'r1')!;
    // capacity 1 * 6h * 7 days * (4/7) = 24h available in a week bucket.
    expect(Math.round(r1.cells[0]!.available)).toBe(24);
  });
});

describe('ResourceUtilizationView', () => {
  let host: HTMLElement;
  let view: ResourceUtilizationView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
    host?.remove();
  });

  function mount(mgr: ResourceManager, expandedByDefault = false): ResourceUtilizationView {
    host = document.createElement('div');
    document.body.append(host);
    view = new ResourceUtilizationView(host, { api: mgr, axis: weekAxis, expandedByDefault });
    return view;
  }

  it('renders an ARIA grid with a header row and one row per resource', () => {
    const mgr = setupMgr();
    mgr.assign('t1', 'r1', 100);
    const v = mount(mgr);
    expect(v.el.getAttribute('role')).toBe('treegrid');
    expect(v.el.querySelector('[role="row"][aria-rowindex="1"]')).toBeTruthy();
    const resourceRows = v.el.querySelectorAll('.jects-resource-util__row--resource');
    expect(resourceRows).toHaveLength(3);
    // Column count = buckets (3) + name + total = 5.
    expect(v.el.getAttribute('aria-colcount')).toBe('5');
  });

  it('renders a columnheader per bucket plus name + total', () => {
    const mgr = setupMgr();
    const v = mount(mgr);
    const headers = v.el.querySelectorAll('[role="columnheader"]');
    expect(headers).toHaveLength(5);
    expect(headers[0]!.textContent).toBe('Resource');
    expect(headers[headers.length - 1]!.textContent).toBe('Total');
  });

  it('shows an over-allocation flag + class on a hot resource row', () => {
    const api = fakeApi([
      { id: 't1', name: 'A', start: MON, end: MON + 5 * DAY, effort: 40 * HOUR } as TaskModel,
      { id: 't2', name: 'B', start: MON, end: MON + 5 * DAY, effort: 40 * HOUR } as TaskModel,
    ]);
    const mgr = new ResourceManager({ resources });
    mgr.init(api);
    mgr.assign('t1', 'r1', 100);
    mgr.assign('t2', 'r1', 100);
    const v = mount(mgr);
    expect(v.el.querySelector('.jects-resource-util__row--over')).toBeTruthy();
    expect(v.el.querySelector('.jects-resource-util__over-flag')).toBeTruthy();
    expect(v.el.querySelector('.jects-resource-util__cell--over')).toBeTruthy();
  });

  it('expands a resource into per-task drill rows and emits toggleRow', () => {
    const mgr = setupMgr();
    mgr.assign('t1', 'r1', 100);
    mgr.assign('t2', 'r1', 100);
    const v = mount(mgr);
    let evt: { resourceId: unknown; expanded: boolean } | undefined;
    v.on('toggleRow', (e) => (evt = e));
    expect(v.el.querySelectorAll('.jects-resource-util__row--task')).toHaveLength(0);
    v.setExpanded('r1', true);
    expect(v.isExpanded('r1')).toBe(true);
    expect(v.el.querySelectorAll('.jects-resource-util__row--task')).toHaveLength(2);
    expect(evt).toEqual({ resourceId: 'r1', expanded: true });
    // Collapse again.
    v.setExpanded('r1', false);
    expect(v.el.querySelectorAll('.jects-resource-util__row--task')).toHaveLength(0);
  });

  it('toggles via the row twisty button', () => {
    const mgr = setupMgr();
    mgr.assign('t1', 'r1', 100);
    const v = mount(mgr);
    const twisty = v.el.querySelector<HTMLButtonElement>(
      '.jects-resource-util__row--resource .jects-resource-util__twisty',
    )!;
    expect(twisty.tagName).toBe('BUTTON');
    twisty.click();
    expect(v.isExpanded('r1')).toBe(true);
    expect(v.el.querySelectorAll('.jects-resource-util__row--task')).toHaveLength(1);
  });

  it('starts expanded when expandedByDefault is set', () => {
    const mgr = setupMgr();
    mgr.assign('t1', 'r1', 100);
    const v = mount(mgr, true);
    expect(v.el.querySelectorAll('.jects-resource-util__row--task').length).toBeGreaterThan(0);
  });

  it('emits cellActivate on a gridcell click with coordinates', () => {
    const mgr = setupMgr();
    mgr.assign('t1', 'r1', 100);
    const v = mount(mgr);
    let payload: { resourceId: unknown; bucket: number } | undefined;
    v.on('cellActivate', (e) => (payload = e));
    const cell = v.el.querySelector<HTMLElement>('.jects-resource-util__cell--alloc')!;
    cell.click();
    expect(payload?.resourceId).toBe('r1');
    expect(payload?.bucket).toBe(0);
  });

  it('uses a roving tabindex: exactly one focusable cell', () => {
    const mgr = setupMgr();
    mgr.assign('t1', 'r1', 100);
    const v = mount(mgr);
    const focusable = v.el.querySelectorAll('[tabindex="0"]');
    expect(focusable).toHaveLength(1);
  });

  it('moves the active cell with ArrowRight/ArrowDown', () => {
    const mgr = setupMgr();
    mgr.assign('t1', 'r1', 100);
    const v = mount(mgr);
    v.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    v.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const focusable = v.el.querySelectorAll('[tabindex="0"]');
    expect(focusable).toHaveLength(1);
  });

  it('refresh() recomputes after a model change', () => {
    const mgr = setupMgr();
    const v = mount(mgr);
    expect(v.el.querySelector('.jects-resource-util__cell--alloc')).toBeNull();
    mgr.assign('t1', 'r1', 100);
    v.refresh();
    expect(v.el.querySelector('.jects-resource-util__cell--alloc')).toBeTruthy();
  });

  it('destroy() removes the element and is idempotent', () => {
    const mgr = setupMgr();
    const v = mount(mgr);
    v.destroy();
    expect(host.querySelector('.jects-resource-util')).toBeNull();
    expect(() => v.destroy()).not.toThrow();
    view = undefined;
  });
});
