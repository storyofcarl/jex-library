/**
 * jsdom unit tests for the Resource assignment feature: the AssignmentStore
 * routing layer, the avatar/label helpers, the task-tree column renderer, the
 * assignment editor field (multi-select + units %), and the per-bar resource
 * label GanttFeature.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  AssignmentStore,
  resourceInitials,
  resourceColorToken,
  assignmentLabelText,
  renderAssignmentAvatars,
  clampUnits,
  AssignmentColumnRenderer,
  GanttResourceLabelsFeature,
  RESOURCE_AVATAR_TOKENS,
  type ResourceModel,
} from './resource-assignment.js';
import { ResourceAssignmentField } from './resource-assignment-field.js';
import type { Model } from '@jects/core';
import type { TaskModel, GanttApi } from '../contract.js';

const RES: ResourceModel[] = [
  { id: 'r1', name: 'Ada Lovelace' },
  { id: 'r2', name: 'Grace Hopper', initials: 'GH' },
  { id: 'r3', name: 'Alan Turing', maxUnits: 100 },
  { id: 'r4', name: 'Linus' },
];

function freshStore(): AssignmentStore {
  return new AssignmentStore({ resources: RES });
}

describe('AssignmentStore', () => {
  let store: AssignmentStore;
  beforeEach(() => {
    store = freshStore();
  });

  it('exposes the resource catalogue in order', () => {
    expect(store.getResources().map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(store.getResource('r2')?.name).toBe('Grace Hopper');
  });

  it('assigns a resource to a task and fans out a typed event', () => {
    const events: string[] = [];
    store.events.on('assign', () => events.push('assign'));
    store.events.on('change', (p) => events.push(`change:${p.action}`));

    const a = store.assign('t1', 'r1', 80);
    expect(a.taskId).toBe('t1');
    expect(a.resourceId).toBe('r1');
    expect(a.units).toBe(80);
    expect(store.isAssigned('t1', 'r1')).toBe(true);
    expect(events).toContain('assign');
    expect(events).toContain('change:assign');
  });

  it('is idempotent per (resource, task) pair — re-assign updates units, no dup', () => {
    store.assign('t1', 'r1', 100);
    store.assign('t1', 'r1', 50);
    const rows = store.getAssignmentsForTask('t1');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.units).toBe(50);
  });

  it('orders a task’s assignments by resource catalogue order', () => {
    store.assign('t1', 'r3');
    store.assign('t1', 'r1');
    store.assign('t1', 'r2');
    expect(store.getResourcesForTask('t1').map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('unassigns and clears the reverse index', () => {
    const a = store.assign('t1', 'r1');
    store.assign('t1', 'r2');
    let removed: string | null = null;
    store.events.on('unassign', (p) => (removed = String(p.assignmentId)));
    store.unassign(a.id);
    expect(removed).toBe(a.id);
    expect(store.isAssigned('t1', 'r1')).toBe(false);
    expect(store.getResourcesForTask('t1').map((r) => r.id)).toEqual(['r2']);
    expect(store.getTasksForResource('r1')).toEqual([]);
  });

  it('unassignResource removes by pair', () => {
    store.assign('t1', 'r1');
    store.unassignResource('t1', 'r1');
    expect(store.isAssigned('t1', 'r1')).toBe(false);
  });

  it('setUnits changes allocation and emits unitsChange with previous', () => {
    const a = store.assign('t1', 'r1', 100);
    let prev = -1;
    store.events.on('unitsChange', (p) => (prev = p.previousUnits));
    store.setUnits(a.id, 60);
    expect(store.getAssignment('t1', 'r1')!.units).toBe(60);
    expect(prev).toBe(100);
  });

  it('tracks resource over-allocation across tasks', () => {
    store.assign('t1', 'r3', 70);
    store.assign('t2', 'r3', 50);
    expect(store.totalUnitsForResource('r3')).toBe(120);
    expect(store.isOverAllocated('r3')).toBe(true); // maxUnits 100
    expect(store.isOverAllocated('r1')).toBe(false);
  });

  it('setAssignmentsForTask diffs: adds, removes, re-units', () => {
    store.assign('t1', 'r1', 100);
    store.assign('t1', 'r2', 100);
    const actions: string[] = [];
    store.events.on('assign', () => actions.push('assign'));
    store.events.on('unassign', () => actions.push('unassign'));
    store.events.on('unitsChange', () => actions.push('units'));

    // Keep r1 (new units), drop r2, add r3.
    store.setAssignmentsForTask('t1', [
      { resourceId: 'r1', units: 50 },
      { resourceId: 'r3', units: 100 },
    ]);

    expect(store.getResourcesForTask('t1').map((r) => r.id)).toEqual(['r1', 'r3']);
    expect(store.getAssignment('t1', 'r1')!.units).toBe(50);
    expect(actions).toContain('unassign'); // r2 dropped
    expect(actions).toContain('units'); // r1 re-united
    expect(actions).toContain('assign'); // r3 added
  });

  it('seeds from constructor assignments', () => {
    const s = new AssignmentStore({
      resources: RES,
      assignments: [{ id: 'a1', taskId: 't9', resourceId: 'r1', units: 40 }],
    });
    expect(s.getAssignment('t9', 'r1')!.units).toBe(40);
  });
});

describe('avatar / label helpers', () => {
  it('derives initials from one or two words, honoring explicit initials', () => {
    expect(resourceInitials({ id: 'a', name: 'Ada Lovelace' })).toBe('AL');
    expect(resourceInitials({ id: 'b', name: 'Linus' })).toBe('LI');
    expect(resourceInitials({ id: 'c', name: 'x', initials: 'gh' })).toBe('GH');
    expect(resourceInitials({ id: 'd', name: '   ' })).toBe('?');
  });

  it('picks a stable token colour and honors explicit colorToken', () => {
    const t1 = resourceColorToken({ id: 'r1', name: 'A' });
    const t1b = resourceColorToken({ id: 'r1', name: 'A' });
    expect(t1).toBe(t1b); // deterministic
    expect(RESOURCE_AVATAR_TOKENS).toContain(t1);
    expect(resourceColorToken({ id: 'x', name: 'A', colorToken: 'cmyk-yellow' })).toBe('cmyk-yellow');
  });

  it('builds comma-joined label text with +N overflow', () => {
    expect(assignmentLabelText(RES.slice(0, 2))).toBe('Ada Lovelace, Grace Hopper');
    expect(assignmentLabelText(RES, 3)).toBe('Ada Lovelace, Grace Hopper, Alan Turing +1');
    expect(assignmentLabelText([])).toBe('');
  });

  it('clampUnits coerces to a sane non-negative rounded percent', () => {
    expect(clampUnits(50.6)).toBe(51);
    expect(clampUnits(-5)).toBe(0);
    expect(clampUnits(Number.NaN)).toBe(0);
  });

  it('renderAssignmentAvatars builds chips with avatar colour, names and overflow', () => {
    const el = renderAssignmentAvatars(RES, { max: 2, showNames: true });
    expect(el.getAttribute('role')).toBe('group');
    expect(el.getAttribute('aria-label')).toContain('Ada Lovelace');
    const chips = el.querySelectorAll('.jects-gantt__assignee');
    // 2 shown + 1 overflow chip
    expect(chips.length).toBe(3);
    const firstAvatar = el.querySelector('.jects-gantt__avatar') as HTMLElement;
    expect(firstAvatar.style.getPropertyValue('--jects-avatar-color')).toContain('var(--jects-');
    expect(firstAvatar.textContent).toBe('AL');
    expect(el.querySelector('.jects-gantt__avatar--more')!.textContent).toBe('+2');
  });

  it('renders an <img> avatar when a resource has an image', () => {
    const el = renderAssignmentAvatars([{ id: 'p', name: 'Pic', image: 'http://x/y.png' }]);
    const img = el.querySelector('img.jects-gantt__avatar-img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.alt).toBe('');
  });

  it('shows units beside names when showUnits and non-100', () => {
    const el = renderAssignmentAvatars(
      [RES[0]!, RES[1]!],
      { showNames: true, showUnits: true },
      (r) => (r.id === 'r1' ? 50 : 100),
    );
    expect(el.textContent).toContain('Ada Lovelace (50%)');
    expect(el.textContent).toContain('Grace Hopper'); // 100% omitted
    expect(el.textContent).not.toContain('Grace Hopper (100%)');
  });
});

describe('AssignmentColumnRenderer', () => {
  it('renders live assignments as a cell and as text', () => {
    const store = freshStore();
    store.assign('t1', 'r1', 100);
    store.assign('t1', 'r2', 100);
    const r = new AssignmentColumnRenderer<Model>(store, { max: 3 });
    const task = { id: 't1', name: 'Task' } as TaskModel;
    const cell = r.renderCell(task);
    expect(cell.querySelectorAll('.jects-gantt__assignee').length).toBe(2);
    expect(r.renderText(task)).toBe('Ada Lovelace, Grace Hopper');

    // Reflects a later unassign.
    store.unassignResource('t1', 'r1');
    expect(r.renderText(task)).toBe('Grace Hopper');
  });
});

describe('ResourceAssignmentField', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
  });

  it('seeds checkboxes + units from current assignments', () => {
    const store = freshStore();
    store.assign('t1', 'r2', 75);
    const field = new ResourceAssignmentField({ store, taskId: 't1' });
    host.append(field.el);

    const rows = field.el.querySelectorAll('.jects-gantt__assign-row');
    expect(rows.length).toBe(4);
    const checks = field.el.querySelectorAll<HTMLInputElement>('.jects-gantt__assign-check');
    // r2 (index 1) is checked.
    expect(checks[1]!.checked).toBe(true);
    expect(checks[0]!.checked).toBe(false);
    const unitsInputs = field.el.querySelectorAll<HTMLInputElement>('.jects-gantt__assign-units-input');
    expect(unitsInputs[1]!.value).toBe('75');
    expect(unitsInputs[1]!.disabled).toBe(false);
    expect(unitsInputs[0]!.disabled).toBe(true); // unchecked → disabled

    field.destroy();
  });

  it('toggling a checkbox enables units and updates getValue + onChange', () => {
    const store = freshStore();
    let last: Array<{ resourceId: unknown; units?: number }> = [];
    const field = new ResourceAssignmentField({
      store,
      taskId: 't1',
      onChange: (v) => (last = v),
    });
    host.append(field.el);

    const checks = field.el.querySelectorAll<HTMLInputElement>('.jects-gantt__assign-check');
    const units = field.el.querySelectorAll<HTMLInputElement>('.jects-gantt__assign-units-input');

    checks[0]!.checked = true;
    checks[0]!.dispatchEvent(new Event('change'));
    expect(units[0]!.disabled).toBe(false);
    expect(last).toEqual([{ resourceId: 'r1', units: 100 }]);

    units[0]!.value = '40';
    units[0]!.dispatchEvent(new Event('input'));
    expect(field.getValue()).toEqual([{ resourceId: 'r1', units: 40 }]);

    field.destroy();
  });

  it('commitTo routes the draft through the store (assign + unassign)', () => {
    const store = freshStore();
    store.assign('t1', 'r1', 100); // will be removed
    const field = new ResourceAssignmentField({ store, taskId: 't1' });
    host.append(field.el);

    const checks = field.el.querySelectorAll<HTMLInputElement>('.jects-gantt__assign-check');
    // Uncheck r1, check r3.
    checks[0]!.checked = false;
    checks[0]!.dispatchEvent(new Event('change'));
    checks[2]!.checked = true;
    checks[2]!.dispatchEvent(new Event('change'));

    field.commitTo();
    expect(store.getResourcesForTask('t1').map((r) => r.id)).toEqual(['r3']);

    field.destroy();
  });

  it('shows an empty message when there are no resources', () => {
    const store = new AssignmentStore();
    const field = new ResourceAssignmentField({ store, taskId: 't1' });
    host.append(field.el);
    expect(field.el.querySelector('.jects-gantt__assign-empty')).not.toBeNull();
    field.destroy();
  });
});

/* ── GanttResourceLabelsFeature (decorates bars; pure GanttApi usage) ──────── */

function makeFakeApi(barTasks: TaskModel[]): {
  api: GanttApi;
  barsLayer: HTMLElement;
  root: HTMLElement;
} {
  const root = document.createElement('div');
  root.className = 'jects-gantt';
  const barsLayer = document.createElement('div');
  barsLayer.className = 'jects-gantt__bars';
  root.append(barsLayer);
  document.body.append(root);
  for (const t of barTasks) {
    const bar = document.createElement('div');
    bar.className = 'jects-gantt__bar';
    bar.dataset.taskId = String(t.id);
    barsLayer.append(bar);
  }
  const trackers: Array<() => void> = [];
  const taskById = new Map(barTasks.map((t) => [String(t.id), t]));
  const api = {
    el: root,
    getTask: (id: unknown) => taskById.get(String(id)),
    track: (d: () => void) => trackers.push(d),
  } as unknown as GanttApi;
  return { api, barsLayer, root };
}

describe('GanttResourceLabelsFeature', () => {
  it('decorates bars with a resource label and strips it on destroy', () => {
    const store = freshStore();
    store.assign('t1', 'r1', 100);
    store.assign('t1', 'r2', 100);
    const { api, barsLayer } = makeFakeApi([{ id: 't1', name: 'A' } as TaskModel]);

    const feat = new GanttResourceLabelsFeature({ store, avatars: true });
    feat.init(api);

    const label = barsLayer.querySelector('.jects-gantt__bar-resources');
    expect(label).not.toBeNull();
    expect(label!.getAttribute('aria-hidden')).toBe('true');
    expect((label as HTMLElement).title).toContain('Ada Lovelace');
    expect(label!.querySelectorAll('.jects-gantt__assignee').length).toBeGreaterThan(0);

    feat.destroy();
    expect(barsLayer.querySelector('.jects-gantt__bar-resources')).toBeNull();
  });

  it('adds no label for an unassigned bar', () => {
    const store = freshStore();
    const { api, barsLayer } = makeFakeApi([{ id: 't1', name: 'A' } as TaskModel]);
    const feat = new GanttResourceLabelsFeature({ store });
    feat.init(api);
    expect(barsLayer.querySelector('.jects-gantt__bar-resources')).toBeNull();
    feat.destroy();
  });

  it('re-decorates when the assignment store changes', () => {
    const store = freshStore();
    const { api, barsLayer } = makeFakeApi([{ id: 't1', name: 'A' } as TaskModel]);
    const feat = new GanttResourceLabelsFeature({ store });
    feat.init(api);
    expect(barsLayer.querySelector('.jects-gantt__bar-resources')).toBeNull();

    store.assign('t1', 'r1', 100);
    expect(barsLayer.querySelector('.jects-gantt__bar-resources')).not.toBeNull();

    feat.destroy();
  });

  // Regression: destroy() set this.destroyed=true but init() never cleared it,
  // so after a destroy→init reuse cycle decorateAll() early-returned forever and
  // the feature silently painted nothing. init() must reset the flag (matching
  // indicators.ts/progress-line.ts instance-reuse contract).
  it('repaints after a destroy()→init() reuse cycle', () => {
    const store = freshStore();
    store.assign('t1', 'r1', 100);
    const { api, barsLayer } = makeFakeApi([{ id: 't1', name: 'A' } as TaskModel]);

    const feat = new GanttResourceLabelsFeature({ store, avatars: true });
    feat.init(api);
    expect(barsLayer.querySelector('.jects-gantt__bar-resources')).not.toBeNull();

    feat.destroy();
    expect(barsLayer.querySelector('.jects-gantt__bar-resources')).toBeNull();

    // Re-init the SAME instance against the same (still-live) api.
    feat.init(api);
    expect(barsLayer.querySelector('.jects-gantt__bar-resources')).not.toBeNull();

    // And it still reacts to store changes after the reuse (subscription live).
    store.assign('t1', 'r2', 50);
    const label = barsLayer.querySelector('.jects-gantt__bar-resources');
    expect(label).not.toBeNull();
    expect((label as HTMLElement).title).toContain('Grace Hopper');

    feat.destroy();
  });
});
