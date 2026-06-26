/**
 * Shared helpers for @jects/grid feature plugins.
 *
 * Every feature in this folder is a `GridFeature` (see ../contract.js): it
 * receives the `GridApi` in `init`, confines all interaction to that surface,
 * and releases everything it created in `destroy`. These helpers keep the
 * individual feature files small and consistent:
 *
 *  - `colId(column)` — the stable identity a feature keys state by.
 *  - `getValue(row, column)` — dotted-path-aware value extraction.
 *  - `compareValues` — a stable, type-aware comparator (numbers, dates,
 *    strings, booleans, null/undefined ordering).
 *  - `Disposers` — a tiny disposer bag so each feature's `destroy()` is a
 *    one-liner that can never leak.
 */

import { escape, type Model } from '@jects/core';
import type { ColumnDef, GridApi } from '../contract.js';

/** Stable identity of a column: explicit `id`, else `field`, else `''`. */
export function colId<Row extends Model>(column: ColumnDef<Row>): string {
  return column.id ?? column.field ?? '';
}

/** Read a (possibly dotted) field path out of a row. */
export function getValue<Row extends Model>(row: Row, column: ColumnDef<Row>): unknown {
  const field = column.field;
  if (!field) return undefined;
  return readPath(row, field);
}

/** Read a dotted path (e.g. `a.b.c`) out of an object, tolerating gaps. */
export function readPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  if (!path.includes('.')) return (obj as Record<string, unknown>)[path];
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Type-aware, null-safe comparator. Returns <0 / 0 / >0. `null`/`undefined`
 * always sort last (regardless of direction the caller applies afterwards).
 */
export function compareValues(a: unknown, b: unknown): number {
  const aNil = a == null;
  const bNil = b == null;
  if (aNil && bNil) return 0;
  if (aNil) return 1;
  if (bNil) return -1;

  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return 0;
    if (Number.isNaN(a)) return 1;
    if (Number.isNaN(b)) return -1;
    return a - b;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b ? 0 : a ? 1 : -1;
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime();
  }
  // Date-ish strings/numbers vs Date.
  const an = toComparableNumber(a);
  const bn = toComparableNumber(b);
  if (an != null && bn != null) return an - bn;

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function toComparableNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isNaN(v) ? null : v;
  if (v instanceof Date) return v.getTime();
  return null;
}

/** Coerce any value to a number for math aggregations (NaN-safe). */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isNaN(v) ? null : v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/**
 * Read every row of the current (filtered) view of a grid's store into a plain
 * array. Uses only public `GridApi` data access so features never reach into
 * engine internals.
 */
export function readRows<Row extends Model>(api: GridApi<Row>): Row[] {
  const out: Row[] = [];
  const n = api.getRowCount();
  for (let i = 0; i < n; i++) {
    const row = api.getRow(i);
    if (row !== undefined) out.push(row);
  }
  return out;
}

/** Read all rows directly from the backing store (ignores the grid view). */
export function readStoreRows<Row extends Model>(api: GridApi<Row>): Row[] {
  return api.store.toArray();
}

/** A leak-proof disposer bag. Each feature owns one and empties it in destroy. */
export class Disposers {
  private fns: Array<() => void> = [];
  private done = false;

  add(fn: () => void): void {
    if (this.done) {
      fn();
      return;
    }
    this.fns.push(fn);
  }

  /** Run every disposer (in reverse registration order) exactly once. */
  dispose(): void {
    if (this.done) return;
    this.done = true;
    for (let i = this.fns.length - 1; i >= 0; i--) {
      try {
        this.fns[i]!();
      } catch {
        /* a disposer must never break teardown of the rest */
      }
    }
    this.fns = [];
  }

  get size(): number {
    return this.fns.length;
  }
}

/**
 * Escape HTML text for safe innerHTML insertion. Re-exported from `@jects/core`
 * so every feature (summary/filter-bar/quick-search/tooltip/tree/export) shares
 * the single canonical escaper rather than a per-package copy (docs/SECURITY.md).
 */
export const escapeHtml = escape;
