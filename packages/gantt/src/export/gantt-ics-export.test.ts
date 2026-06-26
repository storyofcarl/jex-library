/**
 * jsdom unit tests for the ICS-export FEATURE: it grafts `exportIcs()` /
 * `getIcsString()` onto a Gantt-shaped API, reads the task tree through
 * `timeline.rows` + `getChildren`, resolves attendees through the resource layer,
 * triggers a download anchor, and cleans up on `destroy()`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GanttIcsExportFeature,
  createGanttIcsExport,
  installIcsExport,
  ganttTreeSource,
  resourceAttendeeResolvers,
  downloadIcs,
  GANTT_ICS_EXPORT_FEATURE,
  type GanttWithIcsExport,
} from './gantt-ics-export.js';
import type { GanttApi, GanttFeature, TaskModel } from '../contract.js';
import type { ResourceApi, ResolvedAssignment } from '../resource/resource-contract.js';

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 0, 5, 0, 0, 0);
const STAMP = Date.UTC(2026, 0, 1, 9, 30, 0);

type Task = TaskModel & { children?: Task[] };

/**
 * A minimal fake `GanttApi` sufficient for the export feature: a flat task list
 * surfaced through a `timeline.rows` virtualizer-shaped object, parent/child
 * resolution, a feature registry with `use`, an optional resource surface, and a
 * `track` disposer sink.
 */
function fakeGantt(
  tasks: Task[],
  resources?: ResourceApi,
): GanttApi & { _disposers: Array<() => void> } {
  const byId = new Map<TaskModel['id'], Task>(tasks.map((t) => [t.id, t]));
  const features = new Map<string, GanttFeature>();
  const disposers: Array<() => void> = [];

  const api = {
    timeline: {
      rows: {
        count: tasks.length,
        rowAt: (i: number) => (tasks[i] ? { record: tasks[i] } : undefined),
      },
    },
    resources,
    features,
    _disposers: disposers,
    getTask: (id: TaskModel['id']) => byId.get(id),
    getChildren: (id: TaskModel['id']) =>
      tasks.filter((t) => t.parentId === id) as ReadonlyArray<TaskModel>,
    track: (fn: () => void) => disposers.push(fn),
    use: (feature: GanttFeature) => {
      features.set(feature.name, feature);
      feature.init(api as unknown as GanttApi);
      return feature;
    },
  } as unknown as GanttApi & { _disposers: Array<() => void> };
  return api;
}

const FLAT_TASKS: Task[] = [
  { id: 'p1', name: 'Phase 1', start: BASE, end: BASE + 5 * DAY },
  { id: 't1', name: 'Design', parentId: 'p1', start: BASE, end: BASE + 2 * DAY, percentDone: 0.5 },
  { id: 'm1', name: 'Sign-off', parentId: 'p1', start: BASE + 2 * DAY, milestone: true },
];

describe('ganttTreeSource', () => {
  it('reconstructs roots + children from the timeline rows', () => {
    const api = fakeGantt(FLAT_TASKS);
    const src = ganttTreeSource(api);
    expect(src.items.map((t) => t.id)).toEqual(['p1']);
    expect(src.getChildren(src.items[0]!).map((t) => t.id)).toEqual(['t1', 'm1']);
  });
});

describe('GanttIcsExportFeature', () => {
  it('grafts exportIcs/getIcsString onto the host on init and removes them on destroy', () => {
    const api = fakeGantt(FLAT_TASKS);
    const feature = new GanttIcsExportFeature();
    feature.init(api);
    const host = api as GanttWithIcsExport;
    expect(typeof host.exportIcs).toBe('function');
    expect(typeof host.getIcsString).toBe('function');

    feature.destroy();
    expect(host.exportIcs).toBeUndefined();
    expect(host.getIcsString).toBeUndefined();
  });

  it('registers under the icsExport feature name and disposes via api.track', () => {
    const api = fakeGantt(FLAT_TASKS);
    const g = installIcsExport(api);
    expect(api.features.get(GANTT_ICS_EXPORT_FEATURE)).toBeInstanceOf(
      GanttIcsExportFeature,
    );
    // Running the tracked disposer tears the methods off.
    api._disposers.forEach((d) => d());
    expect((g as Partial<GanttWithIcsExport>).exportIcs).toBeUndefined();
  });

  it('installIcsExport adopts an already-installed feature (no double install)', () => {
    const api = fakeGantt(FLAT_TASKS);
    installIcsExport(api);
    const before = api.features.get(GANTT_ICS_EXPORT_FEATURE);
    installIcsExport(api);
    expect(api.features.get(GANTT_ICS_EXPORT_FEATURE)).toBe(before);
    expect(api.features.size).toBe(1);
  });

  it('getIcsString serializes the whole tree to a VCALENDAR', () => {
    const api = fakeGantt(FLAT_TASKS);
    const g = installIcsExport(api);
    const ics = g.getIcsString({ dtstamp: STAMP });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('UID:p1@jects.gantt');
    expect(ics).toContain('UID:t1@jects.gantt');
    expect(ics).toContain('UID:m1@jects.gantt');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('merges construction defaults under per-call options', () => {
    const api = fakeGantt(FLAT_TASKS);
    const feature = createGanttIcsExport({ defaults: { include: 'milestones', dtstamp: STAMP } });
    api.use(feature);
    const g = api as GanttWithIcsExport;
    const ics = g.getIcsString();
    const uids = ics.split('\r\n').filter((l) => l.startsWith('UID:'));
    expect(uids).toEqual(['UID:m1@jects.gantt']);
  });
});

describe('resourceAttendeeResolvers', () => {
  function resourceApi(): ResourceApi {
    const resolved: Record<string, ResolvedAssignment[]> = {
      t1: [
        {
          assignment: { id: 'a1', taskId: 't1', resourceId: 'r1' },
          resource: { id: 'r1', name: 'Alice', type: 'work', data: { email: 'alice@acme.test' } },
          units: 100,
          effortShare: 1,
          effort: 0,
          cost: 0,
        },
        {
          assignment: { id: 'a2', taskId: 't1', resourceId: 'r2' },
          resource: { id: 'r2', name: 'Crane', type: 'equipment' },
          units: 100,
          effortShare: 1,
          effort: 0,
          cost: 0,
        },
      ],
    };
    return {
      getResources: () => [],
      getResource: () => undefined,
      getAssignmentsFor: (taskId) => resolved[String(taskId)] ?? [],
      getAssignmentsOf: () => [],
      getResourceTasks: () => [],
      assign: () => undefined,
      unassign: () => false,
      allocationOf: () => 0,
      isOverAllocated: () => false,
    };
  }

  it('builds attendees from the resource layer (email from data, cutype from type)', () => {
    const api = fakeGantt(FLAT_TASKS, resourceApi());
    const resolvers = resourceAttendeeResolvers(api, {});
    const attendees = resolvers.attendeesOf!({ id: 't1' } as TaskModel);
    expect(attendees).toEqual([
      { id: 'r1', name: 'Alice', email: 'alice@acme.test', cutype: 'INDIVIDUAL' },
      { id: 'r2', name: 'Crane', cutype: 'RESOURCE' },
    ]);
  });

  it('end-to-end: exportIcs emits ATTENDEE/ORGANIZER lines from assignments', () => {
    const api = fakeGantt(FLAT_TASKS, resourceApi());
    const g = installIcsExport(api);
    const ics = g.getIcsString({ dtstamp: STAMP });
    expect(ics).toContain('ORGANIZER;CN=Alice:mailto:alice@acme.test');
    expect(ics).toContain('CUTYPE=RESOURCE');
    expect(ics).toContain('urn:jects:resource:r2');
  });

  it('yields no resolver when a consumer-supplied attendeesOf is present (theirs wins)', () => {
    const api = fakeGantt(FLAT_TASKS, resourceApi());
    const out = resourceAttendeeResolvers(api, { attendeesOf: () => [] });
    expect(out).toEqual({});
  });

  it('yields no resolver when no resource layer is active', () => {
    const api = fakeGantt(FLAT_TASKS);
    expect(resourceAttendeeResolvers(api, {})).toEqual({});
  });
});

describe('downloadIcs (jsdom)', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:mock');
    revokeObjectURL = vi.fn();
    // jsdom lacks URL.createObjectURL; stub it.
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
  });

  it('creates and clicks a download anchor with the .ics file name', () => {
    const clicks: string[] = [];
    const realCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLElement;
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = () => clicks.push((el as HTMLAnchorElement).download);
      }
      return el;
    });

    const ok = downloadIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', 'project.ics');
    expect(ok).toBe(true);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicks).toEqual(['project.ics']);
    spy.mockRestore();
  });

  it('exportIcs({ download: true }) returns the string AND triggers the download', () => {
    const api = fakeGantt(FLAT_TASKS);
    const g = installIcsExport(api);
    const clicked: string[] = [];
    const realCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLElement;
      if (tag === 'a') (el as HTMLAnchorElement).click = () => clicked.push((el as HTMLAnchorElement).download);
      return el;
    });

    const ics = g.exportIcs({ download: true, fileName: 'plan', dtstamp: STAMP });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(clicked).toEqual(['plan.ics']);
    spy.mockRestore();
  });

  it('returns false in a host without URL.createObjectURL', () => {
    delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    expect(downloadIcs('x', 'y.ics')).toBe(false);
  });
});
