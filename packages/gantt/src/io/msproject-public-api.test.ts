/**
 * jsdom unit tests for the PUBLIC MS Project (MSPDI) import/export surface of
 * `@jects/gantt` — the parity item "wire/export MSPDI import+export into the
 * public API".
 *
 * These exercise the seam END-TO-END through the io barrel (`io/index.ts`):
 *   - raw codec (`importMsProject`/`exportMsProject`/`isBinaryMpp`),
 *   - Gantt-level glue (`fromMsProject`/`importMsProjectAsOptions` →
 *     `new Gantt(...)`, and `toMsProject`/`ganttToMsProjectXml` ← a live Gantt),
 * so that a `.mpp` exported as XML imports into a live Gantt and what the Gantt
 * emits opens back in MS Project. This file is self-contained (it makes no
 * assumptions about how the scheduler resolves a manual drag) so it stays green
 * independent of the engine's reschedule policy.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Gantt } from '../ui/gantt.js';
import {
  // raw codec
  importMsProject,
  importMsProjectFile,
  exportMsProject,
  isBinaryMpp,
  // value codecs
  parseMsDate,
  formatMsDate,
  parseMsDuration,
  formatMsDuration,
  // Gantt glue
  fromMsProject,
  toMsProject,
  importMsProjectAsOptions,
  ganttToMsProjectXml,
  roundTripMsProject,
  type MsProjectBundle,
} from './index.js';
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
    name: 'Public API Project',
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
      {
        id: 'm',
        name: 'Launch',
        parentId: 'p',
        start: T0 + 6 * DAY,
        end: T0 + 6 * DAY,
        milestone: true,
      },
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

/* ── value codecs (the building blocks the public surface re-exports) ─────── */
describe('MSPDI value codecs (re-exported from the io barrel)', () => {
  it('round-trips an MSPDI date string ⇄ epoch ms', () => {
    const text = formatMsDate(T0);
    expect(text).toBe('2026-01-05T08:00:00');
    expect(parseMsDate(text)).toBe(T0);
  });

  it('round-trips an MSPDI ISO duration ⇄ working ms', () => {
    // 3h30m → PT3H30M0S → 3h30m
    const ms = 3 * 3_600_000 + 30 * 60_000;
    const text = formatMsDuration(ms);
    expect(text).toBe('PT3H30M0S');
    expect(parseMsDuration(text)).toBe(ms);
  });

  it('parseMsDate / parseMsDuration return undefined on garbage', () => {
    expect(parseMsDate('not-a-date')).toBeUndefined();
    expect(parseMsDuration('not-a-duration')).toBeUndefined();
  });
});

/* ── raw codec surface ────────────────────────────────────────────────────── */
describe('raw MSPDI codec (public)', () => {
  it('exportMsProject emits a namespaced MSPDI <Project> document', () => {
    const xml = exportMsProject(sampleBundle());
    expect(xml).toContain('<?xml');
    expect(xml).toContain('<Project');
    expect(xml).toContain('schemas.microsoft.com/project');
    expect(xml).toContain('<Name>Public API Project</Name>');
  });

  it('importMsProject parses what exportMsProject produced (lossless core)', () => {
    const { bundle, warnings } = importMsProject(exportMsProject(sampleBundle()));
    expect(warnings).toEqual([]);
    expect(bundle.tasks.length).toBe(4);
    expect(bundle.dependencies.length).toBe(2);
    expect(bundle.calendars.length).toBe(1);
    expect(bundle.resources.length).toBe(2);
    expect(bundle.assignments.length).toBe(2);
  });

  it('FS dependency + 1-day lag survives the codec round-trip', () => {
    const { bundle } = importMsProject(exportMsProject(sampleBundle()));
    const ab = bundle.dependencies.find(
      (d) => bundle.tasks.find((t) => t.id === d.fromId)?.name === 'Design',
    );
    expect(ab?.type).toBe('FS');
    expect(ab?.lag).toBe(DAY);
  });

  it('constraint + milestone + summary flags survive the round-trip', () => {
    const { bundle } = importMsProject(exportMsProject(sampleBundle()));
    expect(bundle.tasks.find((t) => t.name === 'Design')?.constraintType).toBe('mustStartOn');
    expect(bundle.tasks.find((t) => t.name === 'Launch')?.milestone).toBe(true);
    expect(bundle.tasks.find((t) => t.name === 'Phase 1')?.summary).toBe(true);
  });

  it('isBinaryMpp detects the OLE2 magic header; importMsProjectFile rejects it', () => {
    const ole2 = String.fromCharCode(0xd0, 0xcf, 0x11, 0xe0) + 'rest';
    expect(isBinaryMpp(ole2)).toBe(true);
    expect(isBinaryMpp('<Project/>')).toBe(false);
    expect(() => importMsProjectFile(ole2)).toThrow(/binary \.mpp/i);
  });

  it('roundTripMsProject preserves tasks/deps/calendars/resources with no warnings', () => {
    const { bundle, warnings } = roundTripMsProject(sampleBundle());
    expect(warnings).toEqual([]);
    expect(bundle.tasks.length).toBe(4);
    expect(bundle.dependencies.length).toBe(2);
    expect(bundle.calendars[0]!.week.filter((w) => w.intervals.length > 0).length).toBe(5);
    expect(bundle.resources.length).toBe(2);
  });
});

/* ── Gantt-level import: bundle / XML → live Gantt ───────────────────────── */
describe('importing MS Project into a live Gantt (public API)', () => {
  it('fromMsProject builds GanttOptions that construct the full project', () => {
    gantt = new Gantt(mount(), fromMsProject(sampleBundle()));
    expect(gantt.getTask('a')?.name).toBe('Design');
    expect(gantt.getTask('a')?.parentId).toBe('p');
    expect(gantt.getTask('m')?.milestone).toBe(true);
    // dependency + resource layer both wired
    expect(gantt.getDependenciesFor('b').some((d) => d.fromId === 'a')).toBe(true);
    expect(gantt.resources?.getResources().length).toBe(2);
  });

  it('importMsProjectAsOptions parses raw XML straight into a constructible Gantt', () => {
    const xml = exportMsProject(sampleBundle());
    const { options, warnings, bundle } = importMsProjectAsOptions(xml);
    expect(warnings).toEqual([]);
    expect(bundle.tasks.length).toBe(4);
    gantt = new Gantt(mount(), options);
    // task ids are re-derived from MSPDI <ID> on export; the names must be intact
    const names = (options.tasks as Array<{ name?: string }>).map((t) => t.name).sort();
    expect(names).toEqual(['Build', 'Design', 'Launch', 'Phase 1']);
  });

  it('does not throw on malformed XML — yields empty options + a warning', () => {
    const { options, warnings } = importMsProjectAsOptions('<not-closed');
    expect((options.tasks as unknown[]).length).toBe(0);
    expect(warnings.some((w) => w.code === 'malformedXml')).toBe(true);
  });
});

/* ── Gantt-level export: live Gantt → bundle / XML ───────────────────────── */
describe('exporting a live Gantt to MS Project (public API)', () => {
  it('toMsProject gathers the full project from the public GanttApi', () => {
    gantt = new Gantt(mount(), fromMsProject(sampleBundle()));
    const out = toMsProject(gantt);
    expect(out.tasks.length).toBe(4);
    expect(out.dependencies.map((d) => d.id).sort()).toEqual(['d1', 'd2']);
    expect(out.resources.length).toBe(2);
    expect(out.assignments.length).toBe(2);
    expect(out.calendars.length).toBe(1);
    expect(out.defaultCalendarId).toBe('std');
  });

  it('toMsProject reflects the live engine span after an edit, not the authored one', () => {
    gantt = new Gantt(mount(), fromMsProject(sampleBundle()));
    // Move "b" explicitly via the public mutation; the gathered bundle must carry
    // whatever the engine resolved (which equals the live getTask value).
    gantt.updateTaskSpan('b', { start: T0 + 10 * DAY, end: T0 + 13 * DAY });
    const liveStart = gantt.getTask('b')!.start!;
    const out = toMsProject(gantt);
    expect(out.tasks.find((t) => t.id === 'b')!.start).toBe(liveStart);
  });

  it('embeds caller-supplied baselines and a name override', () => {
    gantt = new Gantt(mount(), fromMsProject(sampleBundle()));
    const baseline = gantt.captureBaseline('baseline', 'Baseline');
    const out = toMsProject(gantt, { baselines: [baseline], name: 'Renamed' });
    expect(out.name).toBe('Renamed');
    expect(out.baselines.length).toBe(1);
    expect(out.baselines[0]!.tasks.size).toBeGreaterThan(0);
  });

  it('ganttToMsProjectXml emits XML that re-imports with the same data', () => {
    gantt = new Gantt(mount(), fromMsProject(sampleBundle()));
    const xml = ganttToMsProjectXml(gantt, { name: 'RT' });
    const { bundle } = importMsProject(xml);
    expect(bundle.name).toBe('RT');
    expect(bundle.tasks.length).toBe(4);
    expect(bundle.dependencies.length).toBe(2);
    expect(bundle.resources.length).toBe(2);
  });
});

/* ── full public round-trip: XML → Gantt → XML → bundle ──────────────────── */
describe('full public round-trip is stable', () => {
  it('XML → Gantt → XML preserves task / dependency / resource counts', () => {
    const original = sampleBundle();
    const { options } = importMsProjectAsOptions(exportMsProject(original));
    gantt = new Gantt(mount(), options);
    const reExported = ganttToMsProjectXml(gantt);
    const { bundle } = importMsProject(reExported);
    expect(bundle.tasks.length).toBe(original.tasks.length);
    expect(bundle.dependencies.length).toBe(original.dependencies.length);
    expect(bundle.resources.length).toBe(original.resources.length);
  });
});
