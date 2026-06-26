/**
 * jsdom unit tests for the MS Project (MSPDI) ⇄ Gantt glue.
 *
 * Covers the two seams the codec was missing:
 *   1. {@link fromMsProject} / {@link importMsProjectAsOptions} — an imported
 *      `MsProjectBundle` (or raw MSPDI text) becomes `GanttOptions` that
 *      reconstruct the project (tree + deps + lag + calendars + constraints +
 *      resources + assignments) in a real `Gantt`.
 *   2. {@link toMsProject} / {@link ganttToMsProjectXml} — a live `Gantt` is
 *      gathered back into a bundle/XML, and the round-trip preserves the data.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Gantt } from '../ui/gantt.js';
import type { MsProjectBundle } from './msproject.js';
import { importMsProject, exportMsProject } from './msproject.js';
import {
  fromMsProject,
  toMsProject,
  importMsProjectAsOptions,
  ganttToMsProjectXml,
  roundTripMsProject,
} from './gantt-bridge.js';
import type { ResourceModel, AssignmentModel } from '../resource/resource-contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 8, 0, 0); // Mon 2026-01-05 08:00 UTC

let host: HTMLElement | null = null;
let gantt: Gantt | null = null;

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host?.remove();
  host = null;
});

function mount(): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  return host;
}

function sampleBundle(): MsProjectBundle {
  const resources: ResourceModel[] = [
    { id: 'r1', name: 'Ada', type: 'work', maxUnits: 100, hourlyCost: 80 },
    { id: 'r2', name: 'Steel', type: 'material' },
  ];
  const assignments: AssignmentModel[] = [
    { id: 'as1', taskId: 'a', resourceId: 'r1', units: 100 },
    { id: 'as2', taskId: 'b', resourceId: 'r1', units: 50 },
  ];
  return {
    name: 'Bridge Project',
    projectStart: T0,
    defaultCalendarId: 'std',
    tasks: [
      { id: 'p', name: 'Phase 1', summary: true },
      {
        id: 'a',
        name: 'Design',
        parentId: 'p',
        start: T0,
        end: T0 + 3 * DAY,
        duration: 3 * DAY,
        percentDone: 0.5,
        constraintType: 'mustStartOn',
        constraintDate: T0,
      },
      {
        id: 'b',
        name: 'Build',
        parentId: 'p',
        start: T0 + 3 * DAY,
        end: T0 + 6 * DAY,
        duration: 3 * DAY,
      },
      { id: 'm', name: 'Launch', parentId: 'p', start: T0 + 6 * DAY, end: T0 + 6 * DAY, milestone: true },
    ],
    dependencies: [
      { id: 'd1', fromId: 'a', toId: 'b', type: 'FS', lag: DAY },
      { id: 'd2', fromId: 'b', toId: 'm', type: 'FS' },
    ],
    calendars: [
      {
        id: 'std',
        name: 'Standard',
        week: [
          { weekday: 1, intervals: [{ from: 480, to: 1020 }] },
          { weekday: 2, intervals: [{ from: 480, to: 1020 }] },
          { weekday: 3, intervals: [{ from: 480, to: 1020 }] },
          { weekday: 4, intervals: [{ from: 480, to: 1020 }] },
          { weekday: 5, intervals: [{ from: 480, to: 1020 }] },
        ],
      },
    ],
    resources,
    assignments,
    baselines: [],
  };
}

describe('fromMsProject', () => {
  it('maps a bundle into GanttOptions with tree, deps, calendars, resources', () => {
    const opts = fromMsProject(sampleBundle());
    expect(Array.isArray(opts.tasks)).toBe(true);
    expect((opts.tasks as unknown[]).length).toBe(4);
    expect(opts.dependencies?.length).toBe(2);
    expect(opts.calendars?.length).toBe(1);
    expect(opts.defaultCalendarId).toBe('std');
    expect(opts.projectStart).toBe(T0);
    expect(opts.resources?.length).toBe(2);
    expect(opts.assignments?.length).toBe(2);
    // parentId tree preserved
    const a = (opts.tasks as Array<{ id: string; parentId?: string }>).find((t) => t.id === 'a');
    expect(a?.parentId).toBe('p');
  });

  it('clones the bundle (no shared task/dep references)', () => {
    const bundle = sampleBundle();
    const opts = fromMsProject(bundle);
    (opts.tasks as Array<{ name?: string }>)[0]!.name = 'mutated';
    expect(bundle.tasks[0]!.name).toBe('Phase 1');
  });

  it('applies overrides over bundle-derived options', () => {
    const opts = fromMsProject(sampleBundle(), {
      overrides: { treeWidth: 333, defaultCalendarId: 'override-cal' },
    });
    expect(opts.treeWidth).toBe(333);
    expect(opts.defaultCalendarId).toBe('override-cal');
  });

  it('constructs a live Gantt from the derived options', () => {
    const opts = fromMsProject(sampleBundle());
    gantt = new Gantt(mount(), opts);
    expect(gantt.getTask('a')?.name).toBe('Design');
    expect(gantt.getTask('a')?.parentId).toBe('p');
    expect(gantt.getDependenciesFor('b').some((d) => d.fromId === 'a')).toBe(true);
    expect(gantt.resources?.getResources().length).toBe(2);
  });
});

describe('importMsProjectAsOptions', () => {
  it('parses MSPDI XML straight into GanttOptions', () => {
    const xml = exportMsProject(sampleBundle());
    const { options, warnings, bundle } = importMsProjectAsOptions(xml);
    expect(warnings).toEqual([]);
    expect((options.tasks as unknown[]).length).toBe(4);
    expect(bundle.dependencies.length).toBe(2);
    gantt = new Gantt(mount(), options);
    expect(gantt.getTask('1')?.name ?? gantt.getTask('p')?.name).toBeDefined();
  });

  it('rejects binary .mpp (OLE2) with a descriptive error', () => {
    const ole2 = String.fromCharCode(0xd0, 0xcf, 0x11, 0xe0) + 'rest-of-binary';
    expect(() => importMsProjectAsOptions(ole2)).toThrow(/binary \.mpp/i);
  });

  it('does not throw on malformed XML — yields empty options + warning', () => {
    const { options, warnings } = importMsProjectAsOptions('<not-closed');
    expect((options.tasks as unknown[]).length).toBe(0);
    expect(warnings.some((w) => w.code === 'malformedXml')).toBe(true);
  });
});

describe('toMsProject', () => {
  it('gathers a bundle from a live Gantt via the public API', () => {
    gantt = new Gantt(mount(), fromMsProject(sampleBundle()));
    const out = toMsProject(gantt);
    expect(out.tasks.length).toBe(4);
    // dependencies recovered (deduped) from per-task reads
    expect(out.dependencies.length).toBe(2);
    const ids = out.dependencies.map((d) => d.id).sort();
    expect(ids).toEqual(['d1', 'd2']);
    // resources + assignments gathered from the live resource layer
    expect(out.resources.length).toBe(2);
    expect(out.assignments.length).toBe(2);
    expect(out.calendars.length).toBe(1);
    expect(out.defaultCalendarId).toBe('std');
  });

  it('reflects live engine spans (the gathered task carries the engine value)', () => {
    // Author "b" with a deliberately WRONG start; the engine, given the FS link
    // a→b + 1-day lag, reschedules it. The gathered bundle must carry the engine's
    // computed span, not the bogus authored one.
    const bundle = sampleBundle();
    const b0 = bundle.tasks.find((t) => t.id === 'b')!;
    b0.start = T0 - 30 * DAY; // nonsense authored start
    b0.end = T0 - 27 * DAY;
    gantt = new Gantt(mount(), fromMsProject(bundle));

    const engineStart = gantt.getTask('b')!.start!;
    expect(engineStart).not.toBe(T0 - 30 * DAY); // engine corrected it

    const out = toMsProject(gantt);
    const b = out.tasks.find((t) => t.id === 'b')!;
    expect(b.start).toBe(engineStart);
  });

  it('embeds caller-supplied baselines + name override', () => {
    gantt = new Gantt(mount(), fromMsProject(sampleBundle()));
    const baseline = gantt.captureBaseline('baseline', 'Baseline');
    const out = toMsProject(gantt, { baselines: [baseline], name: 'Renamed' });
    expect(out.name).toBe('Renamed');
    expect(out.baselines.length).toBe(1);
    expect(out.baselines[0]!.tasks.size).toBeGreaterThan(0);
  });
});

describe('ganttToMsProjectXml + full round-trip', () => {
  it('exports a live Gantt to XML that re-imports with the same data', () => {
    gantt = new Gantt(mount(), fromMsProject(sampleBundle()));
    const xml = ganttToMsProjectXml(gantt, { name: 'RT' });
    expect(xml).toContain('<Project');
    expect(xml).toContain('schemas.microsoft.com/project');

    const { bundle } = importMsProject(xml);
    expect(bundle.name).toBe('RT');
    expect(bundle.tasks.length).toBe(4);
    expect(bundle.dependencies.length).toBe(2);
    // FS + 1-day lag survives the trip
    const linkAB = bundle.dependencies.find(
      (d) => bundle.tasks.find((t) => t.id === d.fromId)?.name === 'Design',
    );
    expect(linkAB?.type).toBe('FS');
    expect(linkAB?.lag).toBe(DAY);
    expect(bundle.resources.length).toBe(2);
    expect(bundle.assignments.length).toBe(2);
  });

  it('roundTripMsProject preserves tasks, deps, calendars, resources', () => {
    const { bundle, warnings } = roundTripMsProject(sampleBundle());
    expect(warnings).toEqual([]);
    expect(bundle.tasks.length).toBe(4);
    expect(bundle.dependencies.length).toBe(2);
    expect(bundle.calendars.length).toBe(1);
    expect(bundle.calendars[0]!.week.filter((w) => w.intervals.length > 0).length).toBe(5);
    expect(bundle.resources.length).toBe(2);
    // constraint preserved on task "a"
    const a = bundle.tasks.find((t) => t.name === 'Design');
    expect(a?.constraintType).toBe('mustStartOn');
  });

  it('bundle → options → live Gantt → bundle is stable across the public API', () => {
    const original = sampleBundle();
    gantt = new Gantt(mount(), fromMsProject(original));
    const gathered = toMsProject(gantt);
    // Re-export the gathered bundle and re-import — task/dep counts hold.
    const reimported = importMsProject(exportMsProject(gathered)).bundle;
    expect(reimported.tasks.length).toBe(original.tasks.length);
    expect(reimported.dependencies.length).toBe(original.dependencies.length);
    expect(reimported.resources.length).toBe(original.resources.length);
  });
});
