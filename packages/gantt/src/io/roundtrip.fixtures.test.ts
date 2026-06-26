/**
 * KNOWN-ANSWER MS-Project ROUND-TRIP fixture suite for `@jects/gantt`.
 *
 * A single, representative multi-phase project (the WBS authored in
 * {@link authorProject}) is the SOURCE OF TRUTH / known answer. Each test pushes
 * that bundle through a codec and back, then asserts the re-imported bundle is
 * structurally equal to the source — task count + names + start/finish + working
 * durations + dependency edges (each of the four types) + percentDone + the
 * captured baseline — within a tight numeric tolerance.
 *
 * Two transports are exercised against the SAME authored project:
 *   1. MSPDI XML — `exportMsProject` → `importMsProject` (the data-layer codec)
 *      and the convenience `roundTripMsProject` wrapper.
 *   2. Native `.mpp` (OLE2/CFB) — `exportMpp` → `importMpp` (and `roundTripMpp`).
 *      Per the codec's documented scope, the `.mpp` is an OLE2 container that
 *      WRAPS the same MSPDI XML payload (not a native-binary parse); `isMpp`
 *      must recognise the produced container.
 *
 * Pure data/byte logic — runs in the default (jsdom) `pnpm test`; no DOM, no
 * scheduler, so the assertions are deterministic and engine-policy independent.
 */
import { describe, it, expect } from 'vitest';
import {
  // MSPDI XML codec
  exportMsProject,
  importMsProject,
  roundTripMsProject,
  // native .mpp (OLE2/CFB) codec
  exportMpp,
  importMpp,
  isMpp,
  roundTripMpp,
  listMppStreams,
  MPP_XML_STREAM,
  MPP_MARKER_STREAM,
  type MsProjectBundle,
} from './index.js';
import type { DependencyType, TaskModel, Baseline, BaselineTask } from '../contract.js';
import type { RecordId } from '@jects/core';

/* ── time helpers ─────────────────────────────────────────────────────────── */
const DAY = 86_400_000;
// Mon 2026-01-05 08:00:00 UTC. Minute-aligned so MSPDI second-precision dates
// (`YYYY-MM-DDThh:mm:ss`) round-trip exactly.
const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);

// Numeric tolerances. Dates are minute-aligned and durations are whole-hour
// multiples, so the round-trip is byte-exact; the epsilons guard against an
// off-by-a-millisecond regression without making the assertion brittle.
const TIME_TOL = 1_000; // ms
const DUR_TOL = 1_000; // ms
const PCT_TOL = 0.005; // percentDone fraction

/* ═══════════════════════════════════════════════════════════════════════════
   The source-of-truth project: an 8-summary, 30-leaf, multi-phase WBS with
   dependencies of every type (FS/SS/FF/SF), positive lag + negative lead,
   milestones, percent-complete, and a captured baseline.
   ═══════════════════════════════════════════════════════════════════════════ */

interface PhaseSpec {
  id: string;
  name: string;
  parentId?: string;
  /** Number of leaf children to generate directly under this summary. */
  leaves: number;
}

// 8 summary tasks. P4 is a pure parent whose work lives in two nested
// sub-summaries (P4a/P4b) — exercising a 3-deep outline (OutlineLevel 1/2/3).
const PHASES: PhaseSpec[] = [
  { id: 'P1', name: 'Initiation', leaves: 4 },
  { id: 'P2', name: 'Planning', leaves: 4 },
  { id: 'P3', name: 'Design', leaves: 5 },
  { id: 'P4', name: 'Development', leaves: 0 },
  { id: 'P4a', name: 'Backend', parentId: 'P4', leaves: 5 },
  { id: 'P4b', name: 'Frontend', parentId: 'P4', leaves: 5 },
  { id: 'P5', name: 'Testing', leaves: 4 },
  { id: 'P6', name: 'Deployment', leaves: 3 },
];

const PERCENTS = [0, 0.25, 0.5, 0.75, 1] as const;

function authorProject(): MsProjectBundle {
  const tasks: TaskModel[] = [];
  // Leaf ids in deterministic creation order, so dependencies can reference
  // specific leaves (e.g. the 1st leaf of P1) without hard-coding strings.
  const leavesByPhase: Record<string, string[]> = {};
  let g = 0; // global leaf counter — drives deterministic spans

  for (const phase of PHASES) {
    tasks.push({
      id: phase.id,
      name: phase.name,
      summary: true,
      ...(phase.parentId ? { parentId: phase.parentId } : {}),
    });
    const ids: string[] = [];
    for (let k = 0; k < phase.leaves; k++) {
      const id = `${phase.id}-L${k + 1}`;
      ids.push(id);
      const start = T0 + g * 2 * DAY;
      const duration = (1 + (g % 3)) * DAY; // 1..3 working days
      tasks.push({
        id,
        name: `${phase.name} ${k + 1}`,
        parentId: phase.id,
        start,
        end: start + duration,
        duration,
        percentDone: PERCENTS[g % PERCENTS.length],
      });
      g++;
    }
    leavesByPhase[phase.id] = ids;
  }

  // Two milestones (zero-duration leaves). Replace the LAST leaf of P3 and P6.
  const designLeaves = leavesByPhase['P3']!;
  const deployLeaves = leavesByPhase['P6']!;
  asMilestone(tasks, designLeaves[designLeaves.length - 1]!, 'Design Approved');
  asMilestone(tasks, deployLeaves[deployLeaves.length - 1]!, 'Go Live');

  // Dependencies — every type at least once, plus a positive lag and a lead.
  const dependencies = [
    edge('d1', leavesByPhase['P1']![0]!, leavesByPhase['P1']![1]!, 'FS'),
    edge('d2', leavesByPhase['P1']![1]!, leavesByPhase['P1']![2]!, 'FS', DAY), // +1d lag
    edge('d3', leavesByPhase['P2']![0]!, leavesByPhase['P2']![1]!, 'SS'),
    edge('d4', leavesByPhase['P3']![0]!, leavesByPhase['P3']![1]!, 'FF'),
    edge('d5', leavesByPhase['P4a']![0]!, leavesByPhase['P4b']![0]!, 'SF'),
    edge('d6', leavesByPhase['P5']![0]!, leavesByPhase['P5']![1]!, 'FS', -DAY), // 1d lead
    edge('d7', designLeaves[0]!, leavesByPhase['P4a']![0]!, 'FS', 2 * DAY), // cross-phase
    edge('d8', deployLeaves[0]!, deployLeaves[1]!, 'SS'),
  ];

  // A captured baseline over a representative subset of leaves. Snapshots carry
  // their OWN start/end/duration (a planned schedule offset from the current).
  const baselineTasks = new Map<RecordId, BaselineTask>();
  for (const id of [
    leavesByPhase['P1']![0]!,
    leavesByPhase['P3']![0]!,
    leavesByPhase['P4a']![0]!,
    leavesByPhase['P5']![0]!,
  ]) {
    const t = tasks.find((x) => x.id === id)!;
    baselineTasks.set(id, {
      taskId: id,
      start: t.start! - DAY, // planned a day earlier than current
      end: t.end!,
      duration: (t.duration ?? 0) + DAY,
      percentDone: t.percentDone,
    });
  }
  const baseline: Baseline = {
    id: 'baseline',
    name: 'Baseline',
    takenAt: T0,
    tasks: baselineTasks,
  };

  return {
    name: 'Atlas Build — Round-Trip Fixture',
    projectStart: T0,
    defaultCalendarId: 'std',
    tasks,
    dependencies,
    calendars: [
      {
        id: 'std',
        name: 'Standard',
        week: [1, 2, 3, 4, 5].map((weekday) => ({
          weekday,
          intervals: [{ from: 480, to: 1020 }], // 08:00–17:00
        })),
      },
    ],
    resources: [
      { id: 'r1', name: 'Ada', type: 'work', maxUnits: 100, hourlyCost: 90 },
      { id: 'r2', name: 'Grace', type: 'work', maxUnits: 100, hourlyCost: 110 },
      { id: 'r3', name: 'Steel', type: 'material' },
    ],
    assignments: [
      { id: 'as1', taskId: leavesByPhase['P1']![0]!, resourceId: 'r1', units: 100 },
      { id: 'as2', taskId: leavesByPhase['P4a']![0]!, resourceId: 'r2', units: 50 },
    ],
    baselines: [baseline],
  };
}

function asMilestone(tasks: TaskModel[], id: string, name: string): void {
  const t = tasks.find((x) => x.id === id)!;
  t.name = name;
  t.milestone = true;
  t.end = t.start; // zero-length
  t.duration = 0;
  delete t.percentDone;
}

function edge(
  id: string,
  fromId: string,
  toId: string,
  type: DependencyType,
  lag?: number,
) {
  return { id, fromId, toId, type, ...(lag !== undefined ? { lag } : {}) };
}

/* ── shared "known-answer" structural comparison ──────────────────────────── */

/** Canonical, order-independent edge key: from→to + type + lag. */
function edgeKey(d: { fromId: RecordId; toId: RecordId; type?: DependencyType; lag?: number }): string {
  return `${String(d.fromId)}->${String(d.toId)}:${d.type ?? 'FS'}@${d.lag ?? 0}`;
}

function assertBundleMatches(actual: MsProjectBundle, expected: MsProjectBundle): void {
  // ── task count ──
  expect(actual.tasks.length).toBe(expected.tasks.length);

  const actualById = new Map(actual.tasks.map((t) => [String(t.id), t]));

  for (const exp of expected.tasks) {
    const got = actualById.get(String(exp.id));
    expect(got, `task ${String(exp.id)} present after round-trip`).toBeDefined();
    if (!got) continue;

    // name
    expect(got.name, `name of ${String(exp.id)}`).toBe(exp.name);
    // summary / milestone flags
    expect(!!got.summary, `summary flag of ${String(exp.id)}`).toBe(!!exp.summary);
    expect(!!got.milestone, `milestone flag of ${String(exp.id)}`).toBe(!!exp.milestone);
    // parentId (WBS tree)
    expect(got.parentId ?? null, `parentId of ${String(exp.id)}`).toBe(exp.parentId ?? null);

    // start / finish dates (within tolerance)
    if (exp.start !== undefined) {
      expect(got.start, `start of ${String(exp.id)}`).toBeDefined();
      expect(Math.abs((got.start ?? 0) - exp.start)).toBeLessThanOrEqual(TIME_TOL);
    } else {
      expect(got.start, `start of ${String(exp.id)} (none authored)`).toBeUndefined();
    }
    if (exp.end !== undefined) {
      expect(got.end, `finish of ${String(exp.id)}`).toBeDefined();
      expect(Math.abs((got.end ?? 0) - exp.end)).toBeLessThanOrEqual(TIME_TOL);
    }

    // working duration (within tolerance). Summaries author no duration.
    if (exp.duration !== undefined) {
      expect(got.duration, `duration of ${String(exp.id)}`).toBeDefined();
      expect(Math.abs((got.duration ?? 0) - exp.duration)).toBeLessThanOrEqual(DUR_TOL);
    }

    // percentDone (within tolerance)
    if (exp.percentDone !== undefined) {
      expect(got.percentDone, `percentDone of ${String(exp.id)}`).toBeDefined();
      expect(Math.abs((got.percentDone ?? 0) - exp.percentDone)).toBeLessThanOrEqual(PCT_TOL);
    }
  }

  // ── dependency edges + types + lag ──
  expect(actual.dependencies.length).toBe(expected.dependencies.length);
  const actualEdges = new Set(actual.dependencies.map(edgeKey));
  for (const d of expected.dependencies) {
    expect(actualEdges.has(edgeKey(d)), `edge ${edgeKey(d)} survives round-trip`).toBe(true);
  }
  // every dependency type is represented (FS/SS/FF/SF coverage)
  const types = new Set(expected.dependencies.map((d) => d.type ?? 'FS'));
  expect([...types].sort()).toEqual(['FF', 'FS', 'SF', 'SS']);

  // ── baseline snapshots ──
  expect(actual.baselines.length).toBe(expected.baselines.length);
  for (const expBaseline of expected.baselines) {
    const gotBaseline = actual.baselines.find((b) => b.id === expBaseline.id);
    expect(gotBaseline, `baseline ${expBaseline.id} present`).toBeDefined();
    if (!gotBaseline) continue;
    expect(gotBaseline.tasks.size).toBe(expBaseline.tasks.size);
    for (const [tid, snap] of expBaseline.tasks) {
      const gotSnap = gotBaseline.tasks.get(tid);
      expect(gotSnap, `baseline snapshot for ${String(tid)}`).toBeDefined();
      if (!gotSnap) continue;
      expect(Math.abs(gotSnap.start - snap.start)).toBeLessThanOrEqual(TIME_TOL);
      expect(Math.abs(gotSnap.end - snap.end)).toBeLessThanOrEqual(TIME_TOL);
      expect(Math.abs(gotSnap.duration - snap.duration)).toBeLessThanOrEqual(DUR_TOL);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Fixture sanity — the authored project really is the shape we claim.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('round-trip fixture: authored source-of-truth project', () => {
  const project = authorProject();

  it('has the documented WBS shape: 8 summaries, 30 leaves', () => {
    const summaries = project.tasks.filter((t) => t.summary);
    const leaves = project.tasks.filter((t) => !t.summary);
    expect(summaries.length).toBe(8);
    expect(leaves.length).toBe(30);
    expect(project.tasks.length).toBe(38);
  });

  it('covers every dependency type and includes a lag + a lead', () => {
    const types = new Set(project.dependencies.map((d) => d.type));
    expect([...types].sort()).toEqual(['FF', 'FS', 'SF', 'SS']);
    expect(project.dependencies.some((d) => (d.lag ?? 0) > 0)).toBe(true); // lag
    expect(project.dependencies.some((d) => (d.lag ?? 0) < 0)).toBe(true); // lead
  });

  it('carries milestones, percent-complete, and a baseline', () => {
    expect(project.tasks.filter((t) => t.milestone).length).toBe(2);
    expect(project.tasks.some((t) => (t.percentDone ?? 0) > 0)).toBe(true);
    expect(project.baselines.length).toBe(1);
    expect(project.baselines[0]!.tasks.size).toBe(4);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   MSPDI XML round-trip (export → import).
   ═══════════════════════════════════════════════════════════════════════════ */
describe('MSPDI XML round-trip is structurally lossless', () => {
  it('export → import preserves the full structure within tolerance', () => {
    const project = authorProject();
    const xml = exportMsProject(project);
    const { bundle, warnings } = importMsProject(xml);
    expect(warnings).toEqual([]);
    assertBundleMatches(bundle, project);
  });

  it('emits a namespaced MSPDI <Project> with the project name', () => {
    const xml = exportMsProject(authorProject());
    expect(xml).toContain('<?xml');
    expect(xml).toContain('<Project');
    expect(xml).toContain('schemas.microsoft.com/project');
    expect(xml).toContain('<Name>Atlas Build — Round-Trip Fixture</Name>');
  });

  it('roundTripMsProject wrapper agrees with the manual export→import', () => {
    const project = authorProject();
    const { bundle, warnings, xml } = roundTripMsProject(project);
    expect(warnings).toEqual([]);
    expect(xml).toContain('<Project');
    assertBundleMatches(bundle, project);
  });

  it('a second round-trip is a fixed point (export∘import is stable)', () => {
    const project = authorProject();
    const once = importMsProject(exportMsProject(project)).bundle;
    const twice = importMsProject(exportMsProject(once)).bundle;
    assertBundleMatches(twice, project);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Native .mpp (OLE2/CFB) round-trip — the container wraps the same MSPDI XML.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('.mpp (OLE2) round-trip is structurally lossless', () => {
  it('exportMpp → importMpp preserves the full structure within tolerance', () => {
    const project = authorProject();
    const bytes = exportMpp(project);
    const { bundle, warnings, jectsAuthored } = importMpp(bytes);
    expect(warnings).toEqual([]);
    expect(jectsAuthored).toBe(true);
    assertBundleMatches(bundle, project);
  });

  it('isMpp detects the produced OLE2 container (and rejects raw XML)', () => {
    const project = authorProject();
    const bytes = exportMpp(project);
    expect(isMpp(bytes)).toBe(true);
    // The first 8 bytes are the OLE2/CFB magic (D0 CF 11 E0 A1 B1 1A E1).
    expect(bytes[0]).toBe(0xd0);
    expect(bytes[1]).toBe(0xcf);
    expect(bytes[2]).toBe(0x11);
    expect(bytes[3]).toBe(0xe0);
    // Raw MSPDI XML is NOT an .mpp container.
    expect(isMpp(exportMsProject(project))).toBe(false);
  });

  it('the container wraps the MSPDI XML payload stream (documented scope)', () => {
    const bytes = exportMpp(authorProject());
    const streams = listMppStreams(bytes);
    expect(streams).toContain(MPP_XML_STREAM);
    expect(streams).toContain(MPP_MARKER_STREAM);
  });

  it('roundTripMpp wrapper agrees with the manual export→import', () => {
    const project = authorProject();
    const { bundle, warnings, jectsAuthored } = roundTripMpp(project);
    expect(warnings).toEqual([]);
    expect(jectsAuthored).toBe(true);
    assertBundleMatches(bundle, project);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Cross-transport equivalence: XML and .mpp decode to the same project.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('XML and .mpp transports are equivalent', () => {
  it('the .mpp round-trip equals the XML round-trip (same MSPDI payload)', () => {
    const project = authorProject();
    const fromXml = importMsProject(exportMsProject(project)).bundle;
    const fromMpp = importMpp(exportMpp(project)).bundle;
    // Compare both decoded bundles against each other via the source-of-truth.
    assertBundleMatches(fromXml, project);
    assertBundleMatches(fromMpp, fromXml);
  });
});
