import { describe, it, expect, afterEach } from 'vitest';
import {
  ResourceView,
  typeLabel,
  defaultFormatCost,
  RESOURCE_DND_MIME,
} from './resource-view.js';
import { ResourceManager } from './resource-manager.js';
import type { GanttApi, TaskModel } from '../contract.js';
import type { ResourceModel } from './resource-contract.js';

/* ── a minimal GanttApi double (same shape the assignment-view test uses) ── */
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

const HOUR = 3_600_000;

const resources: ResourceModel[] = [
  { id: 'r1', name: 'Ada Lovelace', group: 'Engineering', capacity: 1, hourlyCost: 120, image: 'a.png' },
  { id: 'r2', name: 'Boris Petrov', group: 'Engineering', capacity: 2, hourlyCost: 90 },
  { id: 'r3', name: 'Crane 7', group: 'Equipment', type: 'equipment', capacity: 1 },
  { id: 'r4', name: 'Travel budget', type: 'cost', hourlyCost: 0 },
  { id: 'r5', name: 'Solo' /* no group → Ungrouped */ },
];

let host: HTMLElement;
let view: ResourceView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
  host?.remove();
});

function setup(opts?: { tasks?: TaskModel[]; resources?: ResourceModel[] }): {
  mgr: ResourceManager;
} {
  host = document.createElement('div');
  document.body.append(host);
  const tasks = opts?.tasks ?? [{ id: 't1', effort: 4 * HOUR } as TaskModel];
  const api = fakeApi(tasks);
  const mgr = new ResourceManager({ resources: opts?.resources ?? resources });
  mgr.init(api);
  return { mgr };
}

describe('typeLabel / defaultFormatCost', () => {
  it('labels each resource type', () => {
    expect(typeLabel('work')).toBe('Work');
    expect(typeLabel('equipment')).toBe('Equipment');
    expect(typeLabel('material')).toBe('Material');
    expect(typeLabel('cost')).toBe('Cost');
    expect(typeLabel(undefined)).toBe('Work');
  });

  it('formats hourly cost as $N/h rounded', () => {
    expect(defaultFormatCost(120)).toBe('$120/h');
    expect(defaultFormatCost(89.6)).toBe('$90/h');
  });
});

describe('ResourceView — rendering', () => {
  it('renders an empty placeholder with no resources', () => {
    const { mgr } = setup({ resources: [] });
    view = new ResourceView(host, { api: mgr });
    expect(host.querySelector('.jects-resource-view__empty')?.textContent).toBe('No resources');
    // Empty pane presents as a labelled group region (no empty list semantics).
    const root = host.querySelector<HTMLElement>('.jects-resource-view')!;
    expect(root.getAttribute('role')).toBe('group');
    expect(root.getAttribute('aria-label')).toBe('Resources');
  });

  it('groups resources by the group field, with an Ungrouped bucket', () => {
    const { mgr } = setup();
    view = new ResourceView(host, { api: mgr });
    const groups = [...host.querySelectorAll('.jects-resource-view__group-header')].map(
      (h) => h.firstChild?.textContent,
    );
    expect(groups).toEqual(['Engineering', 'Equipment', 'Ungrouped']);
    // Engineering bucket holds r1 + r2.
    const engCount = host.querySelector('.jects-resource-view__group-count');
    expect(engCount?.textContent).toBe('2');
    // ARIA: grouped root is a region; each bucket is its own labelled list of rows.
    expect(host.querySelector('.jects-resource-view')?.getAttribute('role')).toBe('group');
    const lists = host.querySelectorAll('.jects-resource-view__group-list[role="list"]');
    expect(lists).toHaveLength(3);
    expect(lists[0]!.querySelectorAll('[role="listitem"]')).toHaveLength(2);
  });

  it('renders one row per resource with avatar image when provided, initials otherwise', () => {
    const { mgr } = setup();
    view = new ResourceView(host, { api: mgr });
    expect(host.querySelectorAll('.jects-resource-view__row')).toHaveLength(5);
    // r1 has an image → <img> avatar
    const r1 = host.querySelector<HTMLElement>('[data-resource-id="r1"]');
    expect(r1?.querySelector('img.jects-resource-view__avatar')).toBeTruthy();
    // r2 has no image → initials chip
    const r2 = host.querySelector<HTMLElement>('[data-resource-id="r2"]');
    expect(r2?.querySelector('span.jects-resource-view__avatar')?.textContent).toBe('BP');
  });

  it('shows capacity + cost, but hides capacity/allocation for cost resources', () => {
    const { mgr } = setup();
    view = new ResourceView(host, { api: mgr });
    const r2 = host.querySelector<HTMLElement>('[data-resource-id="r2"]')!;
    expect(r2.querySelector('.jects-resource-view__capacity')?.textContent).toBe('2× cap');
    expect(r2.querySelector('.jects-resource-view__cost')?.textContent).toBe('$90/h');
    // Cost resource: no capacity figure, no allocation bar.
    const r4 = host.querySelector<HTMLElement>('[data-resource-id="r4"]')!;
    expect(r4.querySelector('.jects-resource-view__capacity')).toBeNull();
    expect(r4.querySelector('.jects-resource-view__alloc')).toBeNull();
    expect(r4.querySelector('.jects-resource-view__type--cost')).toBeTruthy();
  });

  it('renders a flat list when grouped:false', () => {
    const { mgr } = setup();
    view = new ResourceView(host, { api: mgr, grouped: false });
    expect(host.querySelector('.jects-resource-view__group')).toBeNull();
    expect(host.querySelectorAll('.jects-resource-view__row')).toHaveLength(5);
  });
});

describe('ResourceView — allocation + over-allocation', () => {
  it('reflects allocation as a progressbar and flags over-allocation', () => {
    const { mgr } = setup({
      tasks: [
        { id: 't1', effort: 4 * HOUR } as TaskModel,
        { id: 't2', effort: 4 * HOUR } as TaskModel,
      ],
    });
    // r1 cap 1 (=100 units); assign 100 + 100 → 200 units → 200% → over.
    mgr.assign('t1', 'r1', 100);
    mgr.assign('t2', 'r1', 100);
    view = new ResourceView(host, { api: mgr });
    const r1 = host.querySelector<HTMLElement>('[data-resource-id="r1"]')!;
    expect(r1.classList.contains('jects-resource-view__row--over')).toBe(true);
    const bar = r1.querySelector('.jects-resource-view__alloc')!;
    expect(bar.getAttribute('role')).toBe('progressbar');
    // value is clamped to 100 even though raw allocation is 200%.
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(bar.querySelector('.jects-resource-view__alloc-label')?.textContent).toBe('200%');
    expect(r1.getAttribute('aria-label')).toContain('over-allocated');
  });

  it('does not flag a high-capacity resource as over-allocated', () => {
    const { mgr } = setup({
      tasks: [{ id: 't1', effort: 4 * HOUR } as TaskModel],
    });
    // r2 cap 2 (=200 units); 100 units → 50% → not over.
    mgr.assign('t1', 'r2', 100);
    view = new ResourceView(host, { api: mgr });
    const r2 = host.querySelector<HTMLElement>('[data-resource-id="r2"]')!;
    expect(r2.classList.contains('jects-resource-view__row--over')).toBe(false);
    expect(r2.querySelector('.jects-resource-view__alloc-label')?.textContent).toBe('50%');
  });
});

describe('ResourceView — interaction + events', () => {
  it('emits resourceActivate on click', () => {
    const { mgr } = setup();
    view = new ResourceView(host, { api: mgr });
    let fired: string | number | undefined;
    view.on('resourceActivate', ({ resource }) => (fired = resource.id));
    host.querySelector<HTMLElement>('[data-resource-id="r2"]')!.click();
    expect(fired).toBe('r2');
  });

  it('emits resourceActivate on Enter and moves roving focus with arrows', () => {
    const { mgr } = setup();
    view = new ResourceView(host, { api: mgr });
    let fired = false;
    view.on('resourceActivate', () => (fired = true));
    const rows = host.querySelectorAll<HTMLElement>('.jects-resource-view__row');
    // Only the first row is tabbable initially (roving tabindex).
    expect(rows[0]!.tabIndex).toBe(0);
    expect(rows[1]!.tabIndex).toBe(-1);
    // ArrowDown from the first row makes the second active.
    rows[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(rows[0]!.tabIndex).toBe(-1);
    expect(rows[1]!.tabIndex).toBe(0);
    // Enter activates.
    rows[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(fired).toBe(true);
  });

  it('sets the resource id on the dataTransfer at dragstart', () => {
    const { mgr } = setup();
    view = new ResourceView(host, { api: mgr });
    const row = host.querySelector<HTMLElement>('[data-resource-id="r1"]')!;
    expect(row.draggable).toBe(true);
    const store: Record<string, string> = {};
    const dt = {
      setData: (type: string, val: string) => (store[type] = val),
      effectAllowed: '',
    } as unknown as DataTransfer;
    const ev = new Event('dragstart', { bubbles: true }) as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    row.dispatchEvent(ev);
    expect(store[RESOURCE_DND_MIME]).toBe('r1');
    expect(store['text/plain']).toBe('r1');
    expect(row.classList.contains('jects-resource-view__row--dragging')).toBe(true);
  });

  it('is not draggable when draggable:false', () => {
    const { mgr } = setup();
    view = new ResourceView(host, { api: mgr, draggable: false });
    const row = host.querySelector<HTMLElement>('[data-resource-id="r1"]')!;
    expect(row.draggable).toBe(false);
  });
});

describe('ResourceView — drag-to-assign drop target', () => {
  function dropEvent(payload: Record<string, string>): DragEvent {
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    const dt = {
      types: Object.keys(payload),
      getData: (type: string) => payload[type] ?? '',
      dropEffect: '',
    } as unknown as DataTransfer;
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    return ev;
  }

  it('assigns a dropped resource to the target task and emits resourceAssignDrop', () => {
    const { mgr } = setup();
    view = new ResourceView(host, { api: mgr });
    const target = document.createElement('div');
    host.append(target);
    let dropped: { resourceId: unknown; taskId: unknown } | undefined;
    view.on('resourceAssignDrop', (p) => (dropped = p));

    view.dropTarget(target, { taskId: 't1' });
    target.dispatchEvent(dropEvent({ [RESOURCE_DND_MIME]: 'r1' }));

    expect(dropped).toEqual({ resourceId: 'r1', taskId: 't1' });
    // The assignment actually landed in the store.
    expect(mgr.getAssignmentsFor('t1').map((a) => a.assignment.resourceId)).toContain('r1');
  });

  it('resolves a dynamic taskId callback and honors a custom units value', () => {
    const { mgr } = setup();
    view = new ResourceView(host, { api: mgr });
    const target = document.createElement('div');
    host.append(target);
    view.dropTarget(target, { taskId: () => 't1', units: 50 });
    target.dispatchEvent(dropEvent({ [RESOURCE_DND_MIME]: 'r2' }));
    const a = mgr.getAssignmentsFor('t1').find((x) => x.assignment.resourceId === 'r2');
    expect(a?.units).toBe(50);
  });

  it('does nothing when the taskId resolver returns undefined', () => {
    const { mgr } = setup();
    view = new ResourceView(host, { api: mgr });
    const target = document.createElement('div');
    host.append(target);
    view.dropTarget(target, { taskId: () => undefined });
    target.dispatchEvent(dropEvent({ [RESOURCE_DND_MIME]: 'r1' }));
    expect(mgr.getAssignmentsFor('t1')).toHaveLength(0);
  });

  it('toggles a highlight class on dragover and clears it on drop', () => {
    const { mgr } = setup();
    view = new ResourceView(host, { api: mgr });
    const target = document.createElement('div');
    host.append(target);
    view.dropTarget(target, { taskId: 't1' });

    const over = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(over, 'dataTransfer', {
      value: { types: [RESOURCE_DND_MIME], dropEffect: '' } as unknown as DataTransfer,
    });
    target.dispatchEvent(over);
    expect(target.classList.contains('jects-resource-view-drop-over')).toBe(true);
    expect(over.defaultPrevented).toBe(true);

    target.dispatchEvent(dropEvent({ [RESOURCE_DND_MIME]: 'r1' }));
    expect(target.classList.contains('jects-resource-view-drop-over')).toBe(false);
  });

  it('drop target disposer + widget destroy() remove listeners (leak-safe)', () => {
    const { mgr } = setup();
    view = new ResourceView(host, { api: mgr });
    const target = document.createElement('div');
    host.append(target);
    const dispose = view.dropTarget(target, { taskId: 't1' });
    dispose();
    target.dispatchEvent(dropEvent({ [RESOURCE_DND_MIME]: 'r1' }));
    expect(mgr.getAssignmentsFor('t1')).toHaveLength(0);

    // A second target removed only by destroy().
    const target2 = document.createElement('div');
    host.append(target2);
    view.dropTarget(target2, { taskId: 't1' });
    view.destroy();
    target2.dispatchEvent(dropEvent({ [RESOURCE_DND_MIME]: 'r2' }));
    expect(mgr.getAssignmentsFor('t1')).toHaveLength(0);
    expect(host.querySelector('.jects-resource-view')).toBeNull();
    view = undefined;
  });
});

describe('ResourceView — lifecycle', () => {
  it('destroy() removes the element and is idempotent', () => {
    const { mgr } = setup();
    view = new ResourceView(host, { api: mgr });
    view.destroy();
    expect(host.querySelector('.jects-resource-view')).toBeNull();
    expect(() => view!.destroy()).not.toThrow();
    view = undefined;
  });

  it('update() re-renders against the current model (numeric ids round-trip)', () => {
    const { mgr } = setup({
      resources: [{ id: 1, name: 'One' } as ResourceModel],
      tasks: [{ id: 10, effort: HOUR } as TaskModel],
    });
    view = new ResourceView(host, { api: mgr });
    const target = document.createElement('div');
    host.append(target);
    view.dropTarget(target, { taskId: 10 });
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', {
      value: {
        types: [RESOURCE_DND_MIME],
        getData: (t: string) => (t === RESOURCE_DND_MIME ? '1' : ''),
      } as unknown as DataTransfer,
    });
    target.dispatchEvent(ev);
    // numeric id '1' coerced back to number 1 → matches the resource.
    const a = mgr.getAssignmentsFor(10).find((x) => x.assignment.resourceId === 1);
    expect(a).toBeTruthy();
  });
});
