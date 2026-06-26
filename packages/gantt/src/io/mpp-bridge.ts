/**
 * `@jects/gantt` — native `.mpp` (binary OLE2) ⇄ Gantt glue.
 *
 * `mpp-codec.ts` is the pure binary codec: {@link MsProjectBundle} ⇄ native
 * `.mpp` bytes (a real OLE2/CFB compound file). This module is the thin seam
 * between that codec and the live `Gantt`, exactly mirroring `gantt-bridge.ts`'s
 * role for the MSPDI XML codec:
 *
 *   - {@link importMppAsOptions} — parse native `.mpp` binary bytes → ready-to-use
 *     {@link GanttOptions}, so `new Gantt(el, importMppAsOptions(bytes).options)`
 *     reconstructs the project from a binary `.mpp` file (drag-dropped, fetched,
 *     or read off disk).
 *   - {@link ganttToMpp} — gather a *live* `Gantt` (via its public API + the
 *     shared `toMsProject` gatherer) and serialise it straight to native `.mpp`
 *     binary bytes — a downloadable, MS-Project-shaped compound file.
 *
 * Discipline (matches `gantt-bridge.ts`): reaches the `Gantt` ONLY through the
 * frozen `GanttApi` contract via the existing `toMsProject` gatherer; imports no
 * concrete widget, builds no DOM, registers nothing. Additive + side-effect-free.
 */

import type { Model } from '@jects/core';
import type { GanttApi, GanttOptions } from '../contract.js';
import {
  fromMsProject,
  toMsProject,
  type FromMsProjectOptions,
  type ToMsProjectOptions,
  type LiveGantt,
} from './gantt-bridge.js';
import {
  importMpp,
  exportMpp,
  type MppImportOptions,
  type MppExportOptions,
  type MppImportResult,
} from './mpp-codec.js';
import type { MsProjectBundle, MsProjectImportWarning } from './msproject.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. native .mpp bytes → GanttOptions
   ═══════════════════════════════════════════════════════════════════════════ */

/** Result of {@link importMppAsOptions}. */
export interface ImportMppAsOptionsResult<
  T extends Model = Model,
  R extends Model = Model,
> {
  /** Ready-to-use options — `new Gantt(el, options)`. */
  options: GanttOptions<T, R>;
  /** Non-fatal import warnings (from the embedded MSPDI payload). */
  warnings: MsProjectImportWarning[];
  /** The full imported bundle (tasks/deps/calendars/resources/baselines). */
  bundle: MsProjectBundle<T, R>;
  /** True if the file was authored by this codec (carried the Jects marker). */
  jectsAuthored: boolean;
  /** Full CFB path of the stream the MSPDI payload was read from. */
  sourceStream?: string;
}

/**
 * Parse a native `.mpp` (OLE2/CFB) binary into ready-to-use {@link GanttOptions}.
 *
 * Reads the compound-file container, extracts its embedded MSPDI XML payload,
 * and maps it onto Gantt construction options (tasks + WBS tree + dependencies +
 * lag + calendars + constraints + resources + assignments). Tolerant by default;
 * pass `import.strict` to throw on a payload-less container.
 */
export function importMppAsOptions<T extends Model = Model, R extends Model = Model>(
  bytes: Uint8Array,
  options: FromMsProjectOptions<T, R> & { import?: MppImportOptions } = {},
): ImportMppAsOptionsResult<T, R> {
  const result: MppImportResult<T, R> = importMpp<T, R>(bytes, options.import);
  const ganttOptions = fromMsProject<T, R>(result.bundle, options);
  const out: ImportMppAsOptionsResult<T, R> = {
    options: ganttOptions,
    warnings: result.warnings,
    bundle: result.bundle,
    jectsAuthored: result.jectsAuthored,
  };
  if (result.sourceStream !== undefined) out.sourceStream = result.sourceStream;
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. live Gantt → native .mpp bytes
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Gather a live `Gantt` and serialise it to native `.mpp` (OLE2/CFB) binary
 * bytes — a downloadable compound file that opens as a valid OLE2 container and
 * re-imports losslessly here.
 */
export function ganttToMpp<T extends Model = Model, R extends Model = Model>(
  gantt: LiveGantt<T, R>,
  options: ToMsProjectOptions & MppExportOptions = {},
): Uint8Array {
  const bundle = toMsProject<T, R>(gantt, options);
  return exportMpp<T, R>(bundle, options);
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. one-shot round-trip (live Gantt → .mpp → bundle), for tests + tooling
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Export a live `Gantt` to native `.mpp` bytes and immediately re-import them,
 * returning the re-read bundle + warnings. A fidelity check for tooling/tests.
 */
export function roundTripGanttMpp<T extends Model = Model, R extends Model = Model>(
  gantt: LiveGantt<T, R>,
  options: ToMsProjectOptions & MppExportOptions & MppImportOptions = {},
): MppImportResult<T, R> {
  const bytes = ganttToMpp<T, R>(gantt, options);
  return importMpp<T, R>(bytes, options);
}

export type { LiveGantt, GanttApi };
