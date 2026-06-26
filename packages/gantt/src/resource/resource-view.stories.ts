/**
 * Resource-view stories — framework-free usage examples for the Gantt
 * **resources pane** (`ResourceView`), used by the docs app and as a canonical
 * reference. Each story mounts a `ResourceManager` (the resource data layer) and a
 * `ResourceView` (its visible pane) into a host element and returns the view.
 *
 * The stories show: a grouped pane with avatars/capacity/cost, an over-allocated
 * resource, a flat (ungrouped) variant, and a drag-to-assign wiring where a mock
 * "task bar" is registered as a drop target so dropping a resource assigns it.
 */
import { ResourceManager } from './resource-manager.js';
import { ResourceView } from './resource-view.js';
import type { RecordId } from '@jects/core';
import type { GanttApi, TaskModel } from '../contract.js';
import type { ResourceModel } from './resource-contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => ResourceView;
}

const HOUR = 3_600_000;

/** A small standalone GanttApi double so the stories run without a full Gantt. */
function standaloneApi(tasks: TaskModel[]): GanttApi {
  const byId = new Map<RecordId, TaskModel>(tasks.map((t) => [t.id, { ...t }]));
  return {
    getTask: (id: RecordId) => byId.get(id),
    updateTask: (id: RecordId, patch: Partial<TaskModel>) => {
      const t = byId.get(id);
      if (t) Object.assign(t, patch);
      return !!t;
    },
    emit: () => true,
    track: () => {},
  } as unknown as GanttApi;
}

function team(): ResourceModel[] {
  return [
    { id: 'r1', name: 'Ada Lovelace', group: 'Engineering', capacity: 1, hourlyCost: 120, image: 'https://i.pravatar.cc/64?img=1' },
    { id: 'r2', name: 'Boris Petrov', group: 'Engineering', capacity: 2, hourlyCost: 90 },
    { id: 'r3', name: 'Carla Diaz', group: 'Design', capacity: 1, hourlyCost: 110 },
    { id: 'r4', name: 'Crane 7', group: 'Equipment', type: 'equipment', capacity: 1, hourlyCost: 300 },
    { id: 'r5', name: 'Travel budget', type: 'cost', hourlyCost: 0 },
    { id: 'r6', name: 'Solo Contractor' },
  ];
}

function makeManager(extraAssign?: (m: ResourceManager) => void): ResourceManager {
  const mgr = new ResourceManager({ resources: team() });
  mgr.init(
    standaloneApi([
      { id: 't1', name: 'Design', effort: 8 * HOUR } as TaskModel,
      { id: 't2', name: 'Build', effort: 16 * HOUR } as TaskModel,
    ]),
  );
  extraAssign?.(mgr);
  return mgr;
}

export const stories: Story[] = [
  {
    name: 'Grouped resources pane (avatar / capacity / cost)',
    render: (host) => {
      const mgr = makeManager();
      return new ResourceView(host, { api: mgr });
    },
  },
  {
    name: 'Over-allocation highlighting',
    render: (host) => {
      const mgr = makeManager((m) => {
        // Ada (capacity 1) booked at 200% across two tasks ⇒ over-allocated.
        m.assign('t1', 'r1', 100);
        m.assign('t2', 'r1', 100);
        // Boris (capacity 2) at 100% ⇒ comfortably within capacity.
        m.assign('t1', 'r2', 100);
      });
      return new ResourceView(host, { api: mgr });
    },
  },
  {
    name: 'Flat (ungrouped) list',
    render: (host) => {
      const mgr = makeManager();
      return new ResourceView(host, { api: mgr, grouped: false });
    },
  },
  {
    name: 'Drag-to-assign onto a task bar',
    render: (host) => {
      const mgr = makeManager();
      const view = new ResourceView(host, { api: mgr });

      // A mock task bar registered as a drop target: dropping a resource on it
      // assigns the resource to task `t1`.
      const bar = document.createElement('div');
      bar.className = 'demo-task-bar';
      bar.textContent = 'Drop a resource here → assigns to "Design"';
      bar.style.cssText =
        'margin-block-start:12px;padding:8px 12px;border:1px dashed currentColor;border-radius:8px;';
      host.append(bar);
      view.dropTarget(bar, { taskId: 't1' });
      view.on('resourceAssignDrop', ({ resourceId }) => {
        bar.textContent = `Assigned ${String(resourceId)} to "Design" — drop another`;
      });
      return view;
    },
  },
];
