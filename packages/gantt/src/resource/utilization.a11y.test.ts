/**
 * axe-core a11y + visual/interaction browser test for the **Resource
 * Utilization** view (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the feature end to
 * end against a real `ResourceManager`: the resources × time-bucket matrix paints
 * as an ARIA grid with the right row/column structure, allocated cells carry a
 * non-zero painted background (token intensity), over-allocated cells are flagged
 * and visually distinct, expand/collapse reveals per-task drill rows, a click
 * routes a `cellActivate`, and full keyboard navigation (roving tabindex + arrow
 * keys + Enter-to-toggle) works.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the theme tokens so `oklch(var(--jects-*))` colors resolve to real
// values (the visual assertions below read computed backgrounds).
import '@jects/theme/base.css';
// Load the feature stylesheet so geometry/intensity assertions exercise the
// shipped token-pure CSS (the module imports it too; this makes it explicit).
import './utilization.css';
import {
  ResourceUtilizationView,
  type UtilizationTimeAxis,
} from './utilization.js';
import { ResourceManager } from './resource-manager.js';
import type { GanttApi, TaskModel } from '../contract.js';
import type { ResourceModel } from './resource-contract.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MON = Date.UTC(2026, 0, 5); // a Monday

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
  { id: 'r2', name: 'Boris Volkov', capacity: 1 },
];

const axis: UtilizationTimeAxis = { start: MON, end: MON + 21 * DAY, granularity: 'week' };

let host: HTMLElement;
let view: ResourceUtilizationView | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '360px';
  document.body.appendChild(host);
});

afterEach(() => {
  view?.destroy();
  view = null;
  host.remove();
});

function setup(): ResourceManager {
  const api = fakeApi([
    { id: 't1', name: 'Design', start: MON, end: MON + 5 * DAY, effort: 40 * HOUR } as TaskModel,
    { id: 't2', name: 'Build', start: MON, end: MON + 5 * DAY, effort: 40 * HOUR } as TaskModel,
    {
      id: 't3',
      name: 'Docs',
      start: MON + 7 * DAY,
      end: MON + 12 * DAY,
      effort: 20 * HOUR,
    } as TaskModel,
  ]);
  const mgr = new ResourceManager({ resources });
  mgr.init(api);
  // r1 is over-allocated in week 0 (two full-time 40h tasks vs 40h capacity).
  mgr.assign('t1', 'r1', 100);
  mgr.assign('t2', 'r1', 100);
  // r2 has a moderate load in week 1.
  mgr.assign('t3', 'r2', 100);
  return mgr;
}

describe('ResourceUtilizationView a11y + visual (real Chromium)', () => {
  it('paints an accessible utilization grid with no serious/critical violations', async () => {
    const mgr = setup();
    view = new ResourceUtilizationView(host, { api: mgr, axis });

    await expectNoA11yViolations(host);

    // ARIA structure: role=treegrid (expandable rows) + a header row + one row
    // per resource.
    expect(view.el.getAttribute('role')).toBe('treegrid');
    const rows = view.el.querySelectorAll('[role="row"]');
    expect(rows.length).toBe(1 /* header */ + 2 /* resources */);
    const headers = view.el.querySelectorAll('[role="columnheader"]');
    // name + 3 week buckets + total = 5
    expect(headers.length).toBe(5);
    expect(view.el.getAttribute('aria-colcount')).toBe('5');

    // Each resource row exposes a rowheader and a gridcell per bucket + total.
    const r1Row = view.el.querySelector<HTMLElement>('[data-resource-id="r1"]')!;
    expect(r1Row.querySelector('[role="rowheader"]')).toBeTruthy();
    expect(r1Row.querySelectorAll('[role="gridcell"]').length).toBe(3 + 1);
  });

  it('renders allocated cells with a painted background and flags over-allocation', async () => {
    const mgr = setup();
    view = new ResourceUtilizationView(host, { api: mgr, axis });

    // r1 week-0 cell is over-allocated → carries the over class + a flag on the row.
    const overCell = view.el.querySelector<HTMLElement>('.jects-resource-util__cell--over')!;
    expect(overCell).toBeTruthy();
    const overBg = getComputedStyle(overCell).backgroundColor;
    expect(overBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(overCell.getAttribute('aria-label')).toContain('over-allocated');

    expect(view.el.querySelector('.jects-resource-util__row--over')).toBeTruthy();
    expect(view.el.querySelector('.jects-resource-util__over-flag')).toBeTruthy();

    // r2's allocated (not over) cell gets a token-intensity background distinct
    // from a fully transparent (idle) cell.
    const r2Row = view.el.querySelector<HTMLElement>('[data-resource-id="r2"]')!;
    const allocCell = r2Row.querySelector<HTMLElement>('.jects-resource-util__cell--alloc');
    expect(allocCell).toBeTruthy();
    expect(getComputedStyle(allocCell!).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  });

  it('expands a resource into per-task drill rows on twisty activation', async () => {
    const mgr = setup();
    view = new ResourceUtilizationView(host, { api: mgr, axis });

    expect(view.el.querySelectorAll('.jects-resource-util__row--task').length).toBe(0);

    const twisty = view.el.querySelector<HTMLButtonElement>(
      '[data-resource-id="r1"] .jects-resource-util__twisty',
    )!;
    expect(twisty.tagName).toBe('BUTTON');
    twisty.click();

    // r1 has two tasks (t1, t2) ⇒ two drill rows appear directly under it.
    const taskRows = view.el.querySelectorAll<HTMLElement>('.jects-resource-util__row--task');
    expect(taskRows.length).toBe(2);
    expect([...taskRows].every((r) => r.dataset.resourceId === 'r1')).toBe(true);

    // Still accessible after expansion.
    await expectNoA11yViolations(host);
  });

  it('routes a click to cellActivate with grid coordinates', () => {
    const mgr = setup();
    view = new ResourceUtilizationView(host, { api: mgr, axis });
    let payload: { resourceId: unknown; bucket: number } | null = null;
    view.on('cellActivate', (e) => (payload = e as never));

    const cell = view.el.querySelector<HTMLElement>(
      '[data-resource-id="r1"] .jects-resource-util__cell--over',
    )!;
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(payload).not.toBeNull();
    expect(payload!.resourceId).toBe('r1');
    expect(payload!.bucket).toBe(0);
  });

  it('supports roving-tabindex keyboard navigation and Enter-to-expand', () => {
    const mgr = setup();
    view = new ResourceUtilizationView(host, { api: mgr, axis });

    // Exactly one cell is focusable at a time (roving tabindex).
    expect(view.el.querySelectorAll('[tabindex="0"]').length).toBe(1);

    // Move down to the first resource row, then activate the rowheader twisty via
    // Enter — navigate to col 0 first.
    view.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    view.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    // The active cell is now the r1 rowheader (contains the twisty button).
    const active = view.el.querySelector<HTMLElement>('[tabindex="0"]')!;
    active.focus();
    expect(active.getAttribute('role')).toBe('rowheader');

    view.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(view.isExpanded('r1')).toBe(true);
    expect(view.el.querySelectorAll('.jects-resource-util__row--task').length).toBe(2);

    // Still exactly one focusable cell after the structural change.
    expect(view.el.querySelectorAll('[tabindex="0"]').length).toBe(1);

    // Arrow navigation continues to work across the new rows.
    view.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    view.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(view.el.querySelectorAll('[tabindex="0"]').length).toBe(1);
  });
});
