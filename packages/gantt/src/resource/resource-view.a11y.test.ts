/**
 * axe-core a11y + visual/interaction browser test for the Gantt **resources pane**
 * (`ResourceView`) — Quality Gate Q2. Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations it exercises the feature end to end
 * against a real `ResourceManager`: the pane paints grouped rows with real layout
 * (avatar, name, capacity, cost, allocation bar), the allocation bar fills
 * proportionally and flips to the over-allocated treatment, the roving tabindex
 * makes the list keyboard-operable, and a real HTML5 drag of a resource row onto a
 * registered task drop-zone assigns the resource (the keyboard-equivalent
 * `resourceActivate` is also asserted).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the shipped, token-pure stylesheet so the geometry assertions exercise the
// real CSS (grid rows, allocation-bar fill width) rather than unstyled defaults.
import './resource-view.css';
import { ResourceView, RESOURCE_DND_MIME } from './resource-view.js';
import { ResourceManager } from './resource-manager.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { GanttApi, TaskModel } from '../contract.js';
import type { ResourceModel } from './resource-contract.js';

const HOUR = 3_600_000;

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
  { id: 'r1', name: 'Ada Lovelace', group: 'Engineering', capacity: 1, hourlyCost: 120 },
  { id: 'r2', name: 'Boris Petrov', group: 'Engineering', capacity: 2, hourlyCost: 90 },
  { id: 'r3', name: 'Crane 7', group: 'Equipment', type: 'equipment', capacity: 1 },
  { id: 'r4', name: 'Travel budget', type: 'cost', hourlyCost: 0 },
];

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '420px';
  host.style.height = '420px';
  host.style.position = 'relative';
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

describe('ResourceView a11y + visual (real Chromium)', () => {
  let view: ResourceView | null = null;
  afterEach(() => {
    view?.destroy();
    view = null;
  });

  it('paints a grouped resources pane with no serious/critical violations', async () => {
    const mgr = new ResourceManager({ resources });
    mgr.init(fakeApi([{ id: 't1', effort: 8 * HOUR } as TaskModel]));
    // r1 is over-allocated (200 units over capacity 1).
    mgr.assign('t1', 'r1', 200);
    mgr.assign('t1', 'r2', 100); // r2 cap 2 → 50% (not over)

    view = new ResourceView(host, { api: mgr });

    await expectNoA11yViolations(host);

    // Group buckets in insertion order; the cost resource (no group) lands under
    // the Ungrouped bucket.
    const headers = [...host.querySelectorAll('.jects-resource-view__group-header')].map(
      (h) => h.firstChild?.textContent,
    );
    expect(headers).toEqual(['Engineering', 'Equipment', 'Ungrouped']);
    // Each bucket is its own labelled list (valid list semantics).
    expect(host.querySelectorAll('.jects-resource-view__group-list[role="list"]').length).toBe(3);

    // Rows render with real height (grid laid out).
    const rows = [...host.querySelectorAll<HTMLElement>('.jects-resource-view__row')];
    expect(rows).toHaveLength(4);
    expect(rows[0]!.getBoundingClientRect().height).toBeGreaterThan(20);

    // r1 over-allocated: row carries the modifier and the bar fill is the
    // destructive treatment, capped visually at the full track width.
    const r1 = host.querySelector<HTMLElement>('[data-resource-id="r1"]')!;
    expect(r1.classList.contains('jects-resource-view__row--over')).toBe(true);
    const fill1 = r1.querySelector<HTMLElement>('.jects-resource-view__alloc-fill')!;
    const track1 = r1.querySelector<HTMLElement>('.jects-resource-view__alloc')!;
    // 200% clamps to a full-width fill.
    expect(fill1.getBoundingClientRect().width).toBeGreaterThan(
      track1.getBoundingClientRect().width * 0.9,
    );

    // r2 fill is roughly half the track (50%).
    const r2 = host.querySelector<HTMLElement>('[data-resource-id="r2"]')!;
    const fill2 = r2.querySelector<HTMLElement>('.jects-resource-view__alloc-fill')!;
    const track2 = r2.querySelector<HTMLElement>('.jects-resource-view__alloc')!;
    const ratio = fill2.getBoundingClientRect().width / track2.getBoundingClientRect().width;
    expect(ratio).toBeGreaterThan(0.35);
    expect(ratio).toBeLessThan(0.65);

    // Cost resource shows its type pill and no allocation bar.
    const r4 = host.querySelector<HTMLElement>('[data-resource-id="r4"]')!;
    expect(r4.querySelector('.jects-resource-view__type--cost')).toBeTruthy();
    expect(r4.querySelector('.jects-resource-view__alloc')).toBeNull();
  });

  it('is keyboard operable: roving tabindex + Enter assignment hook', async () => {
    const mgr = new ResourceManager({ resources });
    mgr.init(fakeApi([{ id: 't1', effort: 8 * HOUR } as TaskModel]));
    view = new ResourceView(host, { api: mgr });

    const rows = [...host.querySelectorAll<HTMLElement>('.jects-resource-view__row')];
    // Exactly one row is in the tab order initially.
    expect(rows.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    expect(rows[0]!.tabIndex).toBe(0);

    rows[0]!.focus();
    expect(host.ownerDocument.activeElement).toBe(rows[0]);

    // ArrowDown advances the roving focus to the next row.
    rows[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(host.ownerDocument.activeElement).toBe(rows[1]);
    expect(rows[1]!.tabIndex).toBe(0);
    expect(rows[0]!.tabIndex).toBe(-1);

    // Enter emits the keyboard assignment hook for the focused resource.
    let activated: string | number | undefined;
    view.on('resourceActivate', ({ resource }) => (activated = resource.id));
    rows[1]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(activated).toBe('r2');
  });

  it('drag a resource row onto a task drop-zone assigns it', () => {
    const mgr = new ResourceManager({ resources });
    mgr.init(fakeApi([{ id: 't1', effort: 8 * HOUR } as TaskModel]));
    view = new ResourceView(host, { api: mgr });

    // A task bar acting as the drop target.
    const taskBar = document.createElement('div');
    taskBar.textContent = 'Task 1';
    taskBar.style.cssText = 'width:160px;height:28px;border:1px solid';
    host.append(taskBar);

    let dropped: { resourceId: unknown; taskId: unknown } | undefined;
    view.on('resourceAssignDrop', (p) => (dropped = p));
    view.dropTarget(taskBar, { taskId: 't1' });

    // Real DragEvents with a DataTransfer carrying the resource id.
    const dt = new DataTransfer();
    const row = host.querySelector<HTMLElement>('[data-resource-id="r1"]')!;
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    expect(dt.getData(RESOURCE_DND_MIME)).toBe('r1');
    expect(row.classList.contains('jects-resource-view__row--dragging')).toBe(true);

    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
    taskBar.dispatchEvent(over);
    expect(taskBar.classList.contains('jects-resource-view-drop-over')).toBe(true);

    taskBar.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));

    expect(dropped).toEqual({ resourceId: 'r1', taskId: 't1' });
    expect(taskBar.classList.contains('jects-resource-view-drop-over')).toBe(false);
    expect(row.classList.contains('jects-resource-view__row--dragging')).toBe(false);
    // The assignment landed.
    expect(mgr.getAssignmentsFor('t1').map((a) => a.assignment.resourceId)).toContain('r1');
  });
});
