/**
 * axe-core a11y + interaction browser test for the Resource Utilization view
 * (Quality Gate Q2). Run with `pnpm --filter @jects/gantt test:browser`.
 *
 * Mounts the `ResourceUtilizationView` (driven by a real `ResourceManager` over
 * the resource + assignment stores) in real Chromium, asserts zero
 * serious/critical axe violations across the collapsed grid, the expanded
 * drill-down, and the over-allocation state, and exercises keyboard-operable
 * disclosure toggles + cell activation — the feature's primary visual surface.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { ResourceUtilizationView, type TaskSpanSource } from './resource-utilization.js';
import { ResourceManager } from '../resource/resource-manager.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { GanttApi, TaskModel } from '../contract.js';
import type { ResourceModel } from '../resource/resource-contract.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const JAN1 = Date.UTC(2024, 0, 1);

const resources: ResourceModel[] = [
  { id: 'r1', name: 'Ada Lovelace', capacity: 1, hourlyCost: 120 },
  { id: 'r2', name: 'Boris Becker', capacity: 2 },
  { id: 'r3', name: 'Crane', type: 'equipment', capacity: 1 },
];

function makeApi(tasks: TaskModel[]): { mgr: ResourceManager; src: TaskSpanSource } {
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
  return { mgr, src: { getTask: (id) => byId.get(id) } };
}

let host: HTMLElement;
let view: ResourceUtilizationView | null = null;
let mgr: ResourceManager;
let src: TaskSpanSource;

beforeEach(() => {
  host = document.createElement('div');
  host.style.padding = '16px';
  host.style.maxWidth = '900px';
  document.body.appendChild(host);
  const made = makeApi([
    { id: 't1', name: 'Design', start: JAN1, end: JAN1 + 5 * DAY, effort: 40 * HOUR } as TaskModel,
    { id: 't2', name: 'Review', start: JAN1, end: JAN1 + 5 * DAY, effort: 40 * HOUR } as TaskModel,
    { id: 't3', name: 'Deploy', start: JAN1 + WEEK, end: JAN1 + WEEK + 3 * DAY, effort: 24 * HOUR } as TaskModel,
  ]);
  mgr = made.mgr;
  src = made.src;
  mgr.assign('t1', 'r1', 100);
  mgr.assign('t2', 'r1', 100); // r1 over-allocated in week 1
  mgr.assign('t1', 'r2', 50);
  mgr.assign('t3', 'r2', 100);
});

afterEach(() => {
  view?.destroy();
  view = null;
  host.remove();
});

describe('ResourceUtilizationView a11y (axe-core, real Chromium)', () => {
  it('the collapsed utilization grid has no serious/critical violations', async () => {
    view = new ResourceUtilizationView(host, {
      api: mgr,
      tasks: src,
      unit: 'week',
      range: { start: JAN1, end: JAN1 + 2 * WEEK },
    });
    expect(view.el.getAttribute('role')).toBe('treegrid');
    await expectNoA11yViolations(host);
  });

  it('the expanded drill-down (with over-allocation) passes axe', async () => {
    view = new ResourceUtilizationView(host, {
      api: mgr,
      tasks: src,
      unit: 'week',
      range: { start: JAN1, end: JAN1 + 2 * WEEK },
      expanded: ['r1', 'r2'],
    });
    expect(host.querySelectorAll('.jects-resource-utilization__row--task').length).toBeGreaterThan(0);
    expect(host.querySelector('.jects-resource-utilization__cell--over')).toBeTruthy();
    await expectNoA11yViolations(host);
  });

  it('disclosure toggles are keyboard-operable and update aria-expanded', async () => {
    view = new ResourceUtilizationView(host, {
      api: mgr,
      tasks: src,
      unit: 'week',
      range: { start: JAN1, end: JAN1 + 2 * WEEK },
    });
    const toggle = host.querySelector<HTMLButtonElement>('.jects-resource-utilization__toggle')!;
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    const row = host.querySelector('.jects-resource-utilization__row--resource')!;
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelectorAll('.jects-resource-utilization__row--task').length).toBeGreaterThan(0);
    await expectNoA11yViolations(host);
  });

  it('data cells are focusable and activate via keyboard, firing cellActivate', async () => {
    view = new ResourceUtilizationView(host, {
      api: mgr,
      tasks: src,
      unit: 'week',
      range: { start: JAN1, end: JAN1 + 2 * WEEK },
    });
    let fired: { resourceId: string | number; periodIndex: number } | undefined;
    view.on('cellActivate', (p) => (fired = p as never));
    const cell = host.querySelector<HTMLElement>('.jects-resource-utilization__cell--data[tabindex]')!;
    cell.focus();
    expect(document.activeElement).toBe(cell);
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(fired).toBeTruthy();
    expect(fired!.resourceId).toBeDefined();
  });

  it('exposes a single roving tab stop with a known grid size and named empty cells', async () => {
    view = new ResourceUtilizationView(host, {
      api: mgr,
      tasks: src,
      unit: 'week',
      range: { start: JAN1, end: JAN1 + 2 * WEEK },
    });
    // aria-rowcount / aria-colcount published so AT can resolve row/cell positions.
    expect(Number(view.el.getAttribute('aria-rowcount'))).toBeGreaterThan(0);
    expect(Number(view.el.getAttribute('aria-colcount'))).toBeGreaterThan(0);

    // Exactly ONE data cell is the Tab stop (roving tabindex), not one per cell.
    const cells = Array.from(
      host.querySelectorAll<HTMLElement>('.jects-resource-utilization__cell--data'),
    );
    expect(cells.filter((c) => c.tabIndex === 0)).toHaveLength(1);

    // Empty cells carry a meaningful accessible name (never a blanking '').
    const empties = host.querySelectorAll<HTMLElement>(
      '.jects-resource-utilization__cell--empty.jects-resource-utilization__cell--data',
    );
    for (const el of Array.from(empties)) {
      expect(el.getAttribute('aria-label')).toBeTruthy();
      expect(el.getAttribute('aria-label')).not.toBe('');
    }
    await expectNoA11yViolations(host);
  });

  it('arrow keys move the roving focus across data cells', async () => {
    view = new ResourceUtilizationView(host, {
      api: mgr,
      tasks: src,
      unit: 'week',
      range: { start: JAN1, end: JAN1 + 2 * WEEK },
    });
    const row = host.querySelector<HTMLElement>(
      '.jects-resource-utilization__row--resource',
    )!;
    const rowCells = Array.from(
      row.querySelectorAll<HTMLElement>('.jects-resource-utilization__cell--data'),
    );
    rowCells[0]!.focus();
    expect(document.activeElement).toBe(rowCells[0]);
    rowCells[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(rowCells[1]);
    expect(rowCells[1]!.tabIndex).toBe(0);
    expect(rowCells[0]!.tabIndex).toBe(-1);
  });
});
