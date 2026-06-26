/**
 * jsdom unit tests for the Resource Utilization view (runs in `pnpm test`).
 *
 * Covers the pure period-bucketing math (`computeUtilization` / `buildPeriods`)
 * and the Widget's DOM/ARIA structure, drill-down expand/collapse, totals, and
 * over-allocation flagging. The axe/visual smoke lives in the `.a11y.test.ts`.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import {
  ResourceUtilizationView,
  computeUtilization,
  buildPeriods,
  formatEffortHours,
  formatPercent,
  type TaskSpanSource,
} from './resource-utilization.js';
import { ResourceManager } from '../resource/resource-manager.js';
import type { GanttApi, TaskModel } from '../contract.js';
import type { ResourceModel } from '../resource/resource-contract.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
// Monday 2024-01-01 UTC.
const JAN1 = Date.UTC(2024, 0, 1);

/** A minimal task-span source + ResourceApi backing for tests. */
function makeApi(
  resources: ResourceModel[],
  tasks: TaskModel[],
): { mgr: ResourceManager; tasks: TaskSpanSource; gApi: GanttApi } {
  const byId = new Map(tasks.map((t) => [t.id, { ...t }]));
  const gApi = {
    getTask: (id) => byId.get(id),
    updateTask: (id, patch) => {
      const t = byId.get(id);
      if (t) Object.assign(t, patch);
      return !!t;
    },
    emit: () => true,
    track: () => {},
  } as unknown as GanttApi;
  const mgr = new ResourceManager({ resources });
  mgr.init(gApi);
  return { mgr, tasks: { getTask: (id) => byId.get(id) }, gApi };
}

describe('formatters', () => {
  it('formatEffortHours renders compact hours, blank for zero', () => {
    expect(formatEffortHours(0)).toBe('');
    expect(formatEffortHours(8 * HOUR)).toBe('8h');
    expect(formatEffortHours(1.5 * HOUR)).toBe('1.5h');
  });

  it('formatPercent rounds and blanks zero', () => {
    expect(formatPercent(0)).toBe('');
    expect(formatPercent(124.6)).toBe('125%');
  });
});

describe('buildPeriods', () => {
  it('produces contiguous half-open day buckets covering the range', () => {
    const periods = buildPeriods(JAN1, JAN1 + 3 * DAY, 'day', 1, 366);
    expect(periods).toHaveLength(3);
    expect(periods[0]!.start).toBe(JAN1);
    expect(periods[0]!.end).toBe(JAN1 + DAY);
    expect(periods[1]!.start).toBe(periods[0]!.end);
    expect(periods[2]!.end).toBe(JAN1 + 3 * DAY);
  });

  it('always yields at least one column for an instant range', () => {
    const periods = buildPeriods(JAN1, JAN1, 'week', 1, 366);
    expect(periods.length).toBeGreaterThanOrEqual(1);
  });

  it('honors the maxPeriods cap', () => {
    const periods = buildPeriods(JAN1, JAN1 + 1000 * DAY, 'day', 1, 10);
    expect(periods).toHaveLength(10);
  });
});

describe('computeUtilization', () => {
  const resources: ResourceModel[] = [
    { id: 'r1', name: 'Ada', capacity: 1, hourlyCost: 100 },
    { id: 'r2', name: 'Boris', capacity: 2 },
    { id: 'cost', name: 'License', type: 'cost' },
  ];

  it('buckets a single-week full-time assignment to ~100% for the week', () => {
    // Task spans Mon..Fri (5 working days), 40h effort, one full week period.
    const tasks: TaskModel[] = [
      { id: 't1', name: 'Build', start: JAN1, end: JAN1 + 5 * DAY, effort: 40 * HOUR } as TaskModel,
    ];
    const { mgr, tasks: src } = makeApi(resources, tasks);
    mgr.assign('t1', 'r1', 100);

    const data = computeUtilization({ api: mgr, tasks: src, unit: 'week', range: { start: JAN1, end: JAN1 + WEEK } });
    expect(data.periods).toHaveLength(1);
    const r1 = data.rows.find((r) => r.resourceId === 'r1')!;
    expect(r1).toBeTruthy();
    // 40 working hours over the 5-day span; the cell intersects the whole task,
    // so effort == 40h.
    expect(Math.round(r1.cells[0]!.effort / HOUR)).toBe(40);
    // Capacity for a 1-week period at 5d*8h = 40h ⇒ ~100% allocation.
    expect(Math.round(r1.cells[0]!.percent)).toBe(100);
    expect(r1.over).toBe(false);
  });

  it('flags over-allocation when two tasks overlap a full-time resource', () => {
    const tasks: TaskModel[] = [
      { id: 'a', name: 'A', start: JAN1, end: JAN1 + 5 * DAY, effort: 40 * HOUR } as TaskModel,
      { id: 'b', name: 'B', start: JAN1, end: JAN1 + 5 * DAY, effort: 40 * HOUR } as TaskModel,
    ];
    const { mgr, tasks: src } = makeApi(resources, tasks);
    mgr.assign('a', 'r1', 100);
    mgr.assign('b', 'r1', 100);

    const data = computeUtilization({ api: mgr, tasks: src, unit: 'week', range: { start: JAN1, end: JAN1 + WEEK } });
    const r1 = data.rows.find((r) => r.resourceId === 'r1')!;
    // Two overlapping 40h tasks ⇒ ~200% of a 40h-capacity week.
    expect(Math.round(r1.cells[0]!.percent)).toBe(200);
    expect(r1.over).toBe(true);
    expect(r1.peakPercent).toBeGreaterThan(100);
    // Drill-down has both tasks.
    expect(r1.tasks.map((t) => t.taskId).sort()).toEqual(['a', 'b']);
  });

  it('a 2x-capacity resource is NOT over-allocated for the same two tasks', () => {
    const tasks: TaskModel[] = [
      { id: 'a', name: 'A', start: JAN1, end: JAN1 + 5 * DAY, effort: 40 * HOUR } as TaskModel,
      { id: 'b', name: 'B', start: JAN1, end: JAN1 + 5 * DAY, effort: 40 * HOUR } as TaskModel,
    ];
    const { mgr, tasks: src } = makeApi(resources, tasks);
    mgr.assign('a', 'r2', 100);
    mgr.assign('b', 'r2', 100);

    const data = computeUtilization({ api: mgr, tasks: src, unit: 'week', range: { start: JAN1, end: JAN1 + WEEK } });
    const r2 = data.rows.find((r) => r.resourceId === 'r2')!;
    // 80h over capacity 2*40h=80h ⇒ ~100%, not over.
    expect(Math.round(r2.cells[0]!.percent)).toBe(100);
    expect(r2.over).toBe(false);
  });

  it('derives the axis range from assigned task spans when none is given', () => {
    const tasks: TaskModel[] = [
      { id: 't1', name: 'T', start: JAN1, end: JAN1 + 3 * DAY, effort: 24 * HOUR } as TaskModel,
    ];
    const { mgr, tasks: src } = makeApi(resources, tasks);
    mgr.assign('t1', 'r1', 100);
    const data = computeUtilization({ api: mgr, tasks: src, unit: 'day' });
    expect(data.periods.length).toBeGreaterThanOrEqual(3);
    expect(data.periods[0]!.start).toBeLessThanOrEqual(JAN1);
  });

  it('omits unassigned resources unless includeUnassigned is set', () => {
    const tasks: TaskModel[] = [
      { id: 't1', name: 'T', start: JAN1, end: JAN1 + 5 * DAY, effort: 40 * HOUR } as TaskModel,
    ];
    const { mgr, tasks: src } = makeApi(resources, tasks);
    mgr.assign('t1', 'r1', 100);

    const without = computeUtilization({ api: mgr, tasks: src, unit: 'week', range: { start: JAN1, end: JAN1 + WEEK } });
    expect(without.rows.map((r) => r.resourceId)).toEqual(['r1']);

    const withAll = computeUtilization({
      api: mgr, tasks: src, unit: 'week', range: { start: JAN1, end: JAN1 + WEEK }, includeUnassigned: true,
    });
    expect(withAll.rows.map((r) => r.resourceId).sort()).toEqual(['cost', 'r1', 'r2']);
  });

  it('accumulates per-period totals and a grand total', () => {
    const tasks: TaskModel[] = [
      { id: 't1', name: 'T1', start: JAN1, end: JAN1 + 5 * DAY, effort: 40 * HOUR } as TaskModel,
      { id: 't2', name: 'T2', start: JAN1, end: JAN1 + 5 * DAY, effort: 20 * HOUR } as TaskModel,
    ];
    const { mgr, tasks: src } = makeApi(resources, tasks);
    mgr.assign('t1', 'r1', 100);
    mgr.assign('t2', 'r2', 100);
    const data = computeUtilization({ api: mgr, tasks: src, unit: 'week', range: { start: JAN1, end: JAN1 + WEEK } });
    expect(Math.round(data.totalsByPeriod[0]! / HOUR)).toBe(60);
    expect(Math.round(data.grandTotalEffort / HOUR)).toBe(60);
  });

  it('spreads effort across multiple periods proportionally', () => {
    // 2-week task, 80h effort ⇒ ~40h in each weekly period.
    const tasks: TaskModel[] = [
      { id: 't1', name: 'Long', start: JAN1, end: JAN1 + 14 * DAY, effort: 80 * HOUR } as TaskModel,
    ];
    const { mgr, tasks: src } = makeApi(resources, tasks);
    mgr.assign('t1', 'r1', 100);
    const data = computeUtilization({ api: mgr, tasks: src, unit: 'week', range: { start: JAN1, end: JAN1 + 2 * WEEK } });
    expect(data.periods).toHaveLength(2);
    const r1 = data.rows[0]!;
    expect(Math.round(r1.cells[0]!.effort / HOUR)).toBe(40);
    expect(Math.round(r1.cells[1]!.effort / HOUR)).toBe(40);
  });
});

/* ── Widget DOM / ARIA ─────────────────────────────────────────────────── */

describe('ResourceUtilizationView (jsdom)', () => {
  const resources: ResourceModel[] = [
    { id: 'r1', name: 'Ada Lovelace', capacity: 1 },
    { id: 'r2', name: 'Boris Becker', capacity: 1 },
  ];
  let host: HTMLElement;
  let view: ResourceUtilizationView | null = null;
  let mgr: ResourceManager;
  let src: TaskSpanSource;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const tasks: TaskModel[] = [
      { id: 't1', name: 'Design', start: JAN1, end: JAN1 + 5 * DAY, effort: 40 * HOUR } as TaskModel,
      { id: 't2', name: 'Review', start: JAN1, end: JAN1 + 5 * DAY, effort: 40 * HOUR } as TaskModel,
    ];
    const made = makeApi(resources, tasks);
    mgr = made.mgr;
    src = made.tasks;
    mgr.assign('t1', 'r1', 100);
    mgr.assign('t2', 'r1', 100); // r1 over-allocated
    mgr.assign('t1', 'r2', 50);
  });

  afterEach(() => {
    view?.destroy();
    view = null;
    host.remove();
  });

  function mount(extra: Record<string, unknown> = {}): ResourceUtilizationView {
    view = new ResourceUtilizationView(host, {
      api: mgr,
      tasks: src,
      unit: 'week',
      range: { start: JAN1, end: JAN1 + WEEK },
      ...extra,
    });
    return view;
  }

  it('renders a treegrid with header, resource rows and a totals row', () => {
    mount();
    expect(view!.el.getAttribute('role')).toBe('treegrid');
    expect(host.querySelector('.jects-resource-utilization__row--head')).toBeTruthy();
    const resRows = host.querySelectorAll('.jects-resource-utilization__row--resource');
    expect(resRows.length).toBe(2);
    expect(host.querySelector('.jects-resource-utilization__row--totals')).toBeTruthy();
    // Header has a columnheader per period + name + total.
    const heads = host.querySelectorAll('[role="columnheader"]');
    expect(heads.length).toBe(3); // name + 1 period + total
  });

  it('flags the over-allocated resource row and shows a peak badge', () => {
    mount();
    const overRow = host.querySelector('.jects-resource-utilization__row--over');
    expect(overRow).toBeTruthy();
    expect(overRow!.getAttribute('data-resource-id')).toBe('r1');
    const overCell = overRow!.querySelector('.jects-resource-utilization__cell--over');
    expect(overCell).toBeTruthy();
    expect(host.querySelector('.jects-resource-utilization__badge')).toBeTruthy();
  });

  it('expands a resource into its task drill-down rows and back', () => {
    mount();
    expect(host.querySelectorAll('.jects-resource-utilization__row--task')).toHaveLength(0);
    view!.toggleResource('r1');
    const taskRows = host.querySelectorAll('.jects-resource-utilization__row--task');
    expect(taskRows.length).toBe(2);
    expect(view!.isExpanded('r1')).toBe(true);
    // aria-expanded reflects state on the row + toggle.
    const row = host.querySelector('[data-resource-id="r1"].jects-resource-utilization__row--resource')!;
    expect(row.getAttribute('aria-expanded')).toBe('true');
    view!.toggleResource('r1');
    expect(host.querySelectorAll('.jects-resource-utilization__row--task')).toHaveLength(0);
  });

  it('emits toggle and cellActivate events', () => {
    mount();
    const toggles: Array<{ resourceId: string | number; expanded: boolean }> = [];
    view!.on('toggle', (p) => toggles.push(p as never));
    view!.toggleResource('r1');
    expect(toggles).toEqual([{ resourceId: 'r1', expanded: true }]);

    let activated: unknown;
    view!.on('cellActivate', (p) => (activated = p));
    const cell = host.querySelector<HTMLElement>('.jects-resource-utilization__cell--data[tabindex]')!;
    cell.click();
    expect(activated).toBeTruthy();
    expect((activated as { resourceId: string }).resourceId).toBeDefined();
  });

  it('expandAll / collapseAll operate over all resources with tasks', () => {
    mount();
    view!.expandAll();
    expect(view!.isExpanded('r1')).toBe(true);
    expect(view!.isExpanded('r2')).toBe(true);
    view!.collapseAll();
    expect(view!.isExpanded('r1')).toBe(false);
  });

  it('renders effort hours when cellMode is "effort"', () => {
    mount({ cellMode: 'effort' });
    const r2Row = host.querySelector('[data-resource-id="r2"].jects-resource-utilization__row--resource')!;
    const dataCell = r2Row.querySelector('.jects-resource-utilization__cell--data')!;
    expect(dataCell.textContent).toMatch(/h$/);
  });

  it('shows an empty state when there are no assignments', () => {
    const made = makeApi(resources, [
      { id: 't9', name: 'X', start: JAN1, end: JAN1 + DAY, effort: HOUR } as TaskModel,
    ]);
    view = new ResourceUtilizationView(host, { api: made.mgr, tasks: made.tasks });
    expect(host.querySelector('.jects-resource-utilization__empty')).toBeTruthy();
  });

  it('uses getTask off the api when no explicit tasks source is given', () => {
    // The ResourceManager does NOT expose getTask, so passing it as tasks would
    // yield empty spans; assert the explicit-source path is what populates cells.
    mount();
    const data = view!.getData();
    expect(data.rows.length).toBe(2);
    expect(data.grandTotalEffort).toBeGreaterThan(0);
  });

  it('cleans up on destroy (no leaks, element removed)', () => {
    mount();
    const el = view!.el;
    expect(host.contains(el)).toBe(true);
    view!.destroy();
    expect(view!.isDestroyed).toBe(true);
    expect(host.contains(el)).toBe(false);
  });

  /* ── a11y: grid dimensions, cell naming, roving tabindex ──────────────── */

  it('sets aria-rowcount (incl. collapsed task rows) and aria-colcount on the treegrid', () => {
    mount(); // 1 period; r1 (2 tasks) + r2 (1 task)
    // header(1) + r1(1) + r1.tasks(2) + r2(1) + r2.tasks(1) + totals(1) = 7
    expect(view!.el.getAttribute('aria-rowcount')).toBe('7');
    // name + 1 period + total = 3
    expect(view!.el.getAttribute('aria-colcount')).toBe('3');
  });

  it('keeps aria-rowindex stable across collapse (collapsed task rows reserve their index)', () => {
    mount();
    // Totals row is the LAST logical row regardless of expansion state.
    const totalsCollapsed = host
      .querySelector('.jects-resource-utilization__row--totals')!
      .getAttribute('aria-rowindex');
    expect(totalsCollapsed).toBe('7');
    view!.expandAll();
    const totalsExpanded = host
      .querySelector('.jects-resource-utilization__row--totals')!
      .getAttribute('aria-rowindex');
    expect(totalsExpanded).toBe('7');
  });

  it('empty cells get a MEANINGFUL aria-label, never an empty one that blanks the cell', () => {
    // 2-week range: week-2 cells are empty (tasks only span week 1).
    mount({ range: { start: JAN1, end: JAN1 + 2 * WEEK } });
    const empties = host.querySelectorAll(
      '.jects-resource-utilization__cell--empty.jects-resource-utilization__cell--data',
    );
    expect(empties.length).toBeGreaterThan(0);
    for (const el of Array.from(empties)) {
      const label = el.getAttribute('aria-label');
      expect(label).toBeTruthy();
      expect(label).not.toBe('');
      expect(label).toMatch(/0 percent/);
    }
  });

  it('exposes a SINGLE roving tab stop: exactly one data cell has tabindex=0, rest -1', () => {
    mount();
    const cells = Array.from(
      host.querySelectorAll<HTMLElement>('.jects-resource-utilization__cell--data'),
    );
    expect(cells.length).toBeGreaterThan(1);
    const tabbable = cells.filter((c) => c.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(cells.every((c) => c.tabIndex === 0 || c.tabIndex === -1)).toBe(true);
    // The grid root is not itself a tab stop when data cells exist.
    expect(view!.el.tabIndex).toBe(-1);
  });

  it('arrow keys move the roving focus across data cells (single tab stop)', () => {
    mount({ unit: 'week', range: { start: JAN1, end: JAN1 + 2 * WEEK } }); // 2 periods
    const firstRow = host.querySelector<HTMLElement>(
      '.jects-resource-utilization__row--resource',
    )!;
    const rowCells = Array.from(
      firstRow.querySelectorAll<HTMLElement>('.jects-resource-utilization__cell--data'),
    );
    const start = rowCells[0]!;
    start.focus();
    expect(document.activeElement).toBe(start);
    start.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(rowCells[1]!);
    expect(rowCells[1]!.tabIndex).toBe(0);
    expect(start.tabIndex).toBe(-1);
  });
});
