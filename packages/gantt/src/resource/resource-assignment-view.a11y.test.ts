/**
 * axe-core a11y + interaction browser test for the resource data layer
 * (Quality Gate Q2). Run with `pnpm --filter @jects/gantt test:browser`.
 *
 * Mounts the `ResourceAssignmentView` (driven by a real `ResourceManager` over
 * the `ResourceStore` + `AssignmentStore`) in real Chromium, asserts zero
 * serious/critical axe violations, and exercises keyboard activation +
 * over-allocation flagging — the feature's primary visual surface.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { ResourceAssignmentView } from './resource-assignment-view.js';
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
  { id: 'r1', name: 'Ada Lovelace', hourlyCost: 120, capacity: 1, group: 'eng' },
  { id: 'r2', name: 'Boris Becker', hourlyCost: 80, capacity: 1, group: 'eng' },
  { id: 'r3', name: 'Crane', type: 'equipment', capacity: 1 },
];

let host: HTMLElement;
let view: ResourceAssignmentView | null = null;
let mgr: ResourceManager;

beforeEach(() => {
  host = document.createElement('div');
  host.style.padding = '16px';
  document.body.appendChild(host);
  const api = fakeApi([
    { id: 't1', name: 'Implement', effort: 16 * HOUR } as TaskModel,
    { id: 't2', name: 'Review', effort: 8 * HOUR } as TaskModel,
  ]);
  mgr = new ResourceManager({ resources });
  mgr.init(api);
});

afterEach(() => {
  view?.destroy();
  view = null;
  host.remove();
});

describe('ResourceAssignmentView a11y (axe-core, real Chromium)', () => {
  it('a populated chip row has no serious/critical violations', async () => {
    mgr.assign('t1', 'r1', 100);
    mgr.assign('t1', 'r2', 50);
    view = new ResourceAssignmentView(host, { api: mgr, taskId: 't1' });
    await expectNoA11yViolations(host);
  });

  it('the unassigned placeholder passes axe', async () => {
    view = new ResourceAssignmentView(host, { api: mgr, taskId: 't1' });
    await expectNoA11yViolations(host);
  });

  it('flags + labels an over-allocated resource and still passes axe', async () => {
    // r1 assigned 100% on two tasks ⇒ 200 units > capacity 100 ⇒ over-allocated.
    mgr.assign('t1', 'r1', 100);
    mgr.assign('t2', 'r1', 100);
    view = new ResourceAssignmentView(host, { api: mgr, taskId: 't1' });
    const over = host.querySelector<HTMLElement>('.jects-resource-chips__chip--over');
    expect(over).toBeTruthy();
    expect(over!.getAttribute('aria-label')).toContain('over-allocated');
    await expectNoA11yViolations(host);
  });

  it('chips are keyboard-focusable and activate with Enter', async () => {
    mgr.assign('t1', 'r1');
    view = new ResourceAssignmentView(host, { api: mgr, taskId: 't1' });
    let fired: string | number | undefined;
    view.on('chipActivate', ({ resourceId }) => (fired = resourceId));
    const chip = host.querySelector<HTMLElement>('.jects-resource-chips__chip')!;
    chip.focus();
    expect(document.activeElement).toBe(chip);
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(fired).toBe('r1');
  });
});
