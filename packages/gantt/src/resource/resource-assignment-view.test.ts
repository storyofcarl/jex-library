import { describe, it, expect, afterEach } from 'vitest';
import { ResourceAssignmentView, initials } from './resource-assignment-view.js';
import { ResourceManager } from './resource-manager.js';
import type { GanttApi, TaskModel } from '../contract.js';
import type { ResourceModel } from './resource-contract.js';

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
];

let host: HTMLElement;
let view: ResourceAssignmentView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
  host?.remove();
});

function setup(): { mgr: ResourceManager; api: GanttApi } {
  host = document.createElement('div');
  document.body.append(host);
  const api = fakeApi([{ id: 't1', effort: 3_600_000 } as TaskModel]);
  const mgr = new ResourceManager({ resources });
  mgr.init(api);
  return { mgr, api };
}

describe('initials', () => {
  it('produces up to two letters', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('Boris')).toBe('BO');
    expect(initials('')).toBe('?');
  });
});

describe('ResourceAssignmentView', () => {
  it('renders an unassigned placeholder when empty', () => {
    const { mgr } = setup();
    view = new ResourceAssignmentView(host, { api: mgr, taskId: 't1' });
    expect(host.querySelector('.jects-resource-chips__empty')?.textContent).toBe('Unassigned');
    expect(host.querySelector('[role="list"]')).toBeTruthy();
  });

  it('renders a chip per assignment with name + avatar', () => {
    const { mgr } = setup();
    mgr.assign('t1', 'r1', 100);
    mgr.assign('t1', 'r2', 50);
    view = new ResourceAssignmentView(host, { api: mgr, taskId: 't1' });
    const chips = host.querySelectorAll('.jects-resource-chips__chip');
    expect(chips).toHaveLength(2);
    expect(host.querySelector('.jects-resource-chips__avatar')?.textContent).toBe('AL');
    // 50% chip shows a units badge
    const badge = host.querySelector('.jects-resource-chips__units');
    expect(badge?.textContent).toBe('50%');
  });

  it('marks over-allocated resources and labels them accessibly', () => {
    const { mgr } = setup();
    mgr.assign('t1', 'r1', 100);
    mgr.assign('t2', 'r1', 100); // r1 now 200 > capacity 100 ⇒ over
    view = new ResourceAssignmentView(host, { api: mgr, taskId: 't1' });
    const chip = host.querySelector<HTMLElement>('.jects-resource-chips__chip--over');
    expect(chip).toBeTruthy();
    expect(chip!.getAttribute('aria-label')).toContain('over-allocated');
  });

  it('emits chipActivate on click', () => {
    const { mgr } = setup();
    mgr.assign('t1', 'r1');
    view = new ResourceAssignmentView(host, { api: mgr, taskId: 't1' });
    let fired: string | number | undefined;
    view.on('chipActivate', ({ resourceId }) => (fired = resourceId));
    host.querySelector<HTMLElement>('.jects-resource-chips__chip')!.click();
    expect(fired).toBe('r1');
  });

  it('emits chipActivate on Enter key', () => {
    const { mgr } = setup();
    mgr.assign('t1', 'r1');
    view = new ResourceAssignmentView(host, { api: mgr, taskId: 't1' });
    let fired = false;
    view.on('chipActivate', () => (fired = true));
    const chip = host.querySelector<HTMLElement>('.jects-resource-chips__chip')!;
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(fired).toBe(true);
  });

  it('destroy() removes the element and is idempotent', () => {
    const { mgr } = setup();
    mgr.assign('t1', 'r1');
    view = new ResourceAssignmentView(host, { api: mgr, taskId: 't1' });
    view.destroy();
    expect(host.querySelector('.jects-resource-chips')).toBeNull();
    expect(() => view!.destroy()).not.toThrow();
    view = undefined;
  });
});
