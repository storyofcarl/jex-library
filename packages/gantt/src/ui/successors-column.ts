/**
 * `successors-column` — the read-only **Successors** task-tree column for
 * `@jects/gantt`, bringing the left grid pane to Bryntum/DHTMLX parity.
 *
 * Background
 * ----------
 * Bryntum/DHTMLX Gantt both ship a SYMMETRIC pair of dependency columns in the
 * task grid:
 *   - **Predecessors** — the links INTO a task (`other → task`), rendered as a
 *     comma-joined notation string (`"2", "3FS+1d", "4SS"` …), and
 *   - **Successors** — the mirror set: the links OUT of a task (`task → other`).
 *
 * The Jects task-tree (`task-tree.ts`) already renders the **predecessors**
 * column via an injected `predecessorsOf(taskId)` resolver, but there was no
 * symmetric **successors** column — successor editing only lived inside the task
 * editor's dependency tab. This module supplies the missing read side:
 *
 *   1. {@link successorsLabel} — the pure, DOM-free resolver that formats a
 *      task's outgoing links into the same Bryntum-style notation the
 *      predecessors column uses (`"<toId><TYPE?><±lag d?>"`, comma-joined),
 *      mirroring the predecessor formatting exactly but oriented the other way.
 *   2. {@link SUCCESSORS_COLUMN} — the column descriptor (field/header/width) the
 *      tree adds to its renderable set.
 *   3. {@link withSuccessorsColumn} — a small, pure helper that appends the
 *      successors column to a column list (idempotent — never duplicates an
 *      already-declared `successors` column), used to opt a Gantt's grid into the
 *      column.
 *
 * Design (concurrency-safe, contract-pure)
 * ----------------------------------------
 *   - This is a NEW, additive module. The read logic lives HERE; `task-tree.ts`
 *     and `gantt.ts` only take small ADDITIVE hooks (an optional `successorsOf`
 *     resolver option + a `'successors'` field case) that delegate to
 *     {@link successorsLabel}. Nothing destructive is done to the main class.
 *   - It is framework-free and DOM-free: it works against the frozen
 *     {@link DependencyModel} contract type, so it is fully unit-testable in
 *     jsdom (and node) without the grid build.
 *   - The notation format is kept byte-for-byte consistent with the
 *     predecessors column (`gantt.ts#predecessorsLabel`) so the two columns read
 *     as a matched pair.
 */

import type { RecordId } from '@jects/core';
import type { DependencyModel } from '../contract.js';

const MS_PER_DAY = 86_400_000;

/** Field id of the read-only successors task-tree column. */
export const SUCCESSORS_COLUMN_FIELD = 'successors';

/** Default header label for the successors column. */
export const SUCCESSORS_COLUMN_HEADER = 'Successors';

/** Default pixel width of the successors column (matches the predecessors column). */
export const SUCCESSORS_COLUMN_WIDTH = 120;

/** A task-tree column descriptor (structurally a `GanttColumnConfig`). */
export interface SuccessorsColumnConfig {
  field: string;
  header?: string;
  width?: number;
}

/**
 * The successors column descriptor the task-tree renders. A frozen, reusable
 * constant so consumers and the Gantt widget share one definition.
 */
export const SUCCESSORS_COLUMN: Readonly<Required<SuccessorsColumnConfig>> = Object.freeze({
  field: SUCCESSORS_COLUMN_FIELD,
  header: SUCCESSORS_COLUMN_HEADER,
  width: SUCCESSORS_COLUMN_WIDTH,
});

/** Options for {@link successorsLabel} (and its predecessor twin). */
export interface DependencyLabelOptions {
  /**
   * Working ms per day used to render a link's lag as days (`"+2d"`/`"-1d"`).
   * Default `86_400_000` (one calendar day), matching the predecessors column.
   */
  msPerDay?: number;
  /**
   * Map a task id to the token shown in the cell (e.g. its WBS/outline number or
   * a row index). When omitted the raw task id is shown — exactly as the
   * predecessors column does today.
   */
  refToToken?(id: RecordId): string;
}

/**
 * Format ONE oriented link term: `"<ref><TYPE?><±lag d?>"`.
 *
 * The dependency type is omitted for the default `FS` (so a plain finish-to-start
 * link reads as just the task ref, e.g. `"3"`), and the lag is rendered in whole
 * days with an explicit sign for a lead/lag — identical to the predecessors
 * column's formatting.
 */
function formatTerm(
  ref: RecordId,
  type: DependencyModel['type'],
  lag: number | undefined,
  options: DependencyLabelOptions,
): string {
  const msPerDay = options.msPerDay ?? MS_PER_DAY;
  const token = options.refToToken ? options.refToToken(ref) : String(ref);
  const typePart = type && type !== 'FS' ? type : '';
  const lagPart = lag
    ? `${lag >= 0 ? '+' : ''}${Math.round(lag / msPerDay)}d`
    : '';
  return `${token}${typePart}${lagPart}`;
}

/**
 * The **successors** notation string for a task: every ACTIVE link whose
 * `fromId` is `taskId` (i.e. the task is the predecessor), oriented to show the
 * downstream `toId`. Inactive links (`active === false`) are skipped, matching
 * the predecessors column.
 *
 * Pure + DOM-free. This is the symmetric mirror of the predecessors resolver:
 * predecessors filter `toId === taskId` and label `fromId`; successors filter
 * `fromId === taskId` and label `toId`.
 *
 * @param deps    The dependency links to scan (e.g. `[...gantt.deps.values()]`).
 * @param taskId  The task whose successors to format.
 * @param options Optional msPerDay + id→token mapping.
 * @returns A comma-joined notation string (empty when the task has no successors).
 */
export function successorsLabel(
  deps: Iterable<DependencyModel>,
  taskId: RecordId,
  options: DependencyLabelOptions = {},
): string {
  const labels: string[] = [];
  for (const d of deps) {
    if (d.active === false) continue;
    if (String(d.fromId) !== String(taskId)) continue;
    labels.push(formatTerm(d.toId, d.type, d.lag, options));
  }
  return labels.join(', ');
}

/**
 * The **predecessors** notation string for a task — the mirror of
 * {@link successorsLabel}. Provided here so both columns can share ONE formatter
 * (and so a consumer wiring up the columns directly need not reimplement it). It
 * is byte-for-byte equivalent to the predecessors formatting that already ships
 * in `gantt.ts#predecessorsLabel`.
 *
 * @param deps    The dependency links to scan.
 * @param taskId  The task whose predecessors to format.
 * @param options Optional msPerDay + id→token mapping.
 */
export function predecessorsLabel(
  deps: Iterable<DependencyModel>,
  taskId: RecordId,
  options: DependencyLabelOptions = {},
): string {
  const labels: string[] = [];
  for (const d of deps) {
    if (d.active === false) continue;
    if (String(d.toId) !== String(taskId)) continue;
    labels.push(formatTerm(d.fromId, d.type, d.lag, options));
  }
  return labels.join(', ');
}

/**
 * Build a resolver function `(taskId) => notation` for a task's successors, bound
 * to a live dependency source. The source is read LAZILY on each call (a getter
 * or iterable), so the resolver always reflects the current link set — handy when
 * the Gantt's dependency map mutates over the widget's lifetime.
 *
 * @param source  Either an iterable of links, or a getter returning one.
 * @param options Optional formatting options.
 */
export function makeSuccessorsResolver(
  source: Iterable<DependencyModel> | (() => Iterable<DependencyModel>),
  options: DependencyLabelOptions = {},
): (taskId: RecordId) => string {
  const read = typeof source === 'function' ? source : (): Iterable<DependencyModel> => source;
  return (taskId: RecordId) => successorsLabel(read(), taskId, options);
}

/**
 * Append the {@link SUCCESSORS_COLUMN} to a column list, returning a NEW array.
 * Idempotent: if a column with `field === 'successors'` is already present the
 * input is returned unchanged (so a consumer who already declared the column —
 * e.g. the editable {@link import('./dependency-editor.js')} feature — is not
 * given a duplicate).
 *
 * Pure: never mutates the input array.
 *
 * @param columns Existing column descriptors.
 * @param config  Optional header/width overrides for the appended column.
 */
export function withSuccessorsColumn<C extends SuccessorsColumnConfig>(
  columns: ReadonlyArray<C>,
  config: Partial<Pick<SuccessorsColumnConfig, 'header' | 'width'>> = {},
): C[] {
  if (columns.some((c) => c.field === SUCCESSORS_COLUMN_FIELD)) {
    return [...columns];
  }
  const col = {
    field: SUCCESSORS_COLUMN_FIELD,
    header: config.header ?? SUCCESSORS_COLUMN_HEADER,
    width: config.width ?? SUCCESSORS_COLUMN_WIDTH,
  } as unknown as C;
  return [...columns, col];
}

/**
 * Whether `field` is the successors column field id. A tiny guard the tree's
 * renderer/field-switch uses to route the cell through {@link successorsLabel}.
 */
export function isSuccessorsField(field: string): boolean {
  return field === SUCCESSORS_COLUMN_FIELD;
}
