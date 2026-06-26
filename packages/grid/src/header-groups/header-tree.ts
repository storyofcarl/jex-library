/**
 * Header-group tree resolution — pure geometry for grouped / multi-level
 * (stacked) column headers. DOM-free and deterministic so it unit-tests without
 * a renderer (matches the `column-layout.ts` contract-first style).
 *
 * Two declaration styles are supported, mirroring Bryntum (nested column trees)
 * and DHTMLX (per-column header paths):
 *
 *   1. `headerGroups` — an explicit tree of {@link HeaderGroup} nodes whose
 *      leaves reference real columns by id/field. (Bryntum `children`.)
 *   2. `column.group` / `column.groupPath` — each leaf column carries the
 *      ordered ancestor-group labels it belongs to. Adjacent leaves that share a
 *      prefix collapse into one spanning header cell. (DHTMLX header rows.)
 *
 * Spanning rules (match Bryntum/DHTMLX):
 *   - A group header cell spans exactly the contiguous run of its descendant
 *     LEAF columns and advertises that run as `colSpan` (→ `aria-colspan`).
 *   - Spanning never crosses a frozen-band boundary (left / center / right): a
 *     group straddling two bands is split into one cell per band so the stacked
 *     header stays pixel-aligned over the frozen regions.
 *   - A leaf column shallower than the deepest group level gets a `rowSpan` so
 *     it fills the empty rows beneath its last group (no holes in the grid).
 *   - Leaf header cells always live on the bottom row (depth `levelCount-1`)
 *     unless promoted by `rowSpan`.
 */

import type { Model } from '@jects/core';
import type { ColumnAlign, ColumnDef, FrozenSide } from '../contract.js';

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC CONFIG TYPES (additive — leaf columns gain an optional group path)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A node in an explicit header-group tree. A node is either a GROUP (has
 * `children`) or a LEAF reference (`columnId`). Group nodes may nest arbitrarily.
 */
export interface HeaderGroup {
  /** Stable id for the group cell (used for state keys / events). */
  id?: string;
  /** Header text shown in the spanning cell. */
  header?: string;
  /** Content alignment for the group cell. Default `'center'`. */
  align?: ColumnAlign;
  /** Arbitrary per-group metadata for features. */
  meta?: Record<string, unknown>;
  /** Child groups (nested levels). Mutually exclusive with `columnId`. */
  children?: HeaderGroup[];
  /** Leaf reference: the id (or field) of a real column. */
  columnId?: string;
}

/**
 * Extra, optional fields a leaf {@link ColumnDef} may carry to declare its place
 * in the header tree without an explicit `headerGroups` spec. `groupPath` wins
 * over `group` when both are present.
 */
export interface GroupedColumnExtras {
  /** Single parent-group label (one extra header level). */
  group?: string;
  /** Ordered ancestor-group labels, outermost first (multi-level). */
  groupPath?: string[];
}

/** A {@link ColumnDef} that may also carry header-group placement. */
export type GroupedColumnDef<Row extends Model = Model> = ColumnDef<Row> & GroupedColumnExtras;

/* ═══════════════════════════════════════════════════════════════════════════
   RESOLVED OUTPUT
   ═══════════════════════════════════════════════════════════════════════════ */

/** A minimal laid-out leaf the tree resolver needs (id + band + geometry). */
export interface LeafColumnInput {
  /** Stable column id. */
  id: string;
  /** Index of this leaf in the visible, ordered column list. */
  index: number;
  /** Pin band (undefined = center/scrolling). */
  frozen?: FrozenSide;
  /** Resolved pixel width (for the renderer; optional for pure resolution). */
  width?: number;
  /** The source column definition (for header text / align fallback). */
  def: GroupedColumnDef;
}

/** A resolved header cell occupying a rectangle in the stacked header. */
export interface HeaderCell {
  /** Stable id (group id, or leaf column id for leaf cells). */
  id: string;
  /** Header text. */
  label: string;
  /** Row (level) index, 0 = topmost. */
  depth: number;
  /** Number of header rows this cell spans vertically (≥1). */
  rowSpan: number;
  /** Number of LEAF columns this cell spans horizontally (≥1) → aria-colspan. */
  colSpan: number;
  /** Index of the first descendant leaf (in the visible column order). */
  leafStart: number;
  /** Index of the last descendant leaf (inclusive). */
  leafEnd: number;
  /** Whether this cell is a real leaf column header (vs a spanning group). */
  isLeaf: boolean;
  /** Content alignment. */
  align: ColumnAlign;
  /** The band this cell belongs to. */
  band: HeaderBand;
  /** Leaf column ids covered (in order). */
  columnIds: string[];
  /** Source column def when `isLeaf` (else undefined). */
  def?: GroupedColumnDef;
}

/** Frozen band identifier. */
export type HeaderBand = 'left' | 'center' | 'right';

/** Fully resolved multi-level header. */
export interface HeaderTree {
  /** Number of stacked header rows (≥1). */
  levelCount: number;
  /** Cells per band, grouped by row (outer array = level, 0 = top). */
  bands: Record<HeaderBand, HeaderCell[][]>;
  /** All cells flat (any order) — convenience for tests/inspection. */
  cells: HeaderCell[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   RESOLUTION
   ═══════════════════════════════════════════════════════════════════════════ */

const DEFAULT_GROUP_ALIGN: ColumnAlign = 'center';

function bandOf(frozen: FrozenSide | undefined): HeaderBand {
  return frozen === 'left' ? 'left' : frozen === 'right' ? 'right' : 'center';
}

function leafHeader(def: GroupedColumnDef): string {
  return def.header ?? def.field ?? '';
}

/** Internal: a group path derived for one leaf, outermost first. */
function pathFor(def: GroupedColumnDef): string[] {
  if (Array.isArray(def.groupPath) && def.groupPath.length > 0) {
    return def.groupPath.filter((s) => s != null && s !== '');
  }
  if (def.group != null && def.group !== '') return [def.group];
  return [];
}

/**
 * Flatten an explicit {@link HeaderGroup} tree into a per-leaf path map keyed by
 * column id. Leaves not referenced anywhere get an empty path. Throws on a leaf
 * reference to an unknown column id (caller-visible config error).
 */
export function pathsFromGroups(
  groups: ReadonlyArray<HeaderGroup>,
  knownLeafIds: ReadonlySet<string>,
): Map<string, { path: string[]; aligns: ColumnAlign[]; ids: string[] }> {
  const out = new Map<string, { path: string[]; aligns: ColumnAlign[]; ids: string[] }>();
  const walk = (
    node: HeaderGroup,
    path: string[],
    aligns: ColumnAlign[],
    ids: string[],
  ): void => {
    if (node.children && node.children.length > 0) {
      const label = node.header ?? '';
      const align = node.align ?? DEFAULT_GROUP_ALIGN;
      const gid = node.id ?? label;
      for (const child of node.children) {
        walk(child, [...path, label], [...aligns, align], [...ids, gid]);
      }
      return;
    }
    // Leaf reference.
    const colId = node.columnId;
    if (colId == null) return;
    if (!knownLeafIds.has(colId)) {
      throw new Error(`[grid] headerGroups references unknown column "${colId}"`);
    }
    out.set(colId, { path, aligns, ids });
  };
  for (const g of groups) walk(g, [], [], []);
  return out;
}

/**
 * Resolve the full stacked-header geometry for an ordered list of visible leaf
 * columns. When `groups` is provided it takes precedence; otherwise each leaf's
 * own `groupPath` / `group` is used.
 */
export function resolveHeaderTree(
  leaves: ReadonlyArray<LeafColumnInput>,
  groups?: ReadonlyArray<HeaderGroup>,
): HeaderTree {
  // 1. Per-leaf ancestor path (labels) + per-level align + per-level group id.
  const knownIds = new Set(leaves.map((l) => l.id));
  const fromGroups = groups && groups.length > 0 ? pathsFromGroups(groups, knownIds) : null;

  interface LeafResolved {
    leaf: LeafColumnInput;
    path: string[];
    aligns: ColumnAlign[];
    groupIds: string[];
  }
  const resolved: LeafResolved[] = leaves.map((leaf) => {
    if (fromGroups) {
      const hit = fromGroups.get(leaf.id);
      if (hit) {
        return { leaf, path: hit.path, aligns: hit.aligns, groupIds: hit.ids };
      }
      // Ungrouped leaf in an otherwise-grouped header.
      return { leaf, path: [], aligns: [], groupIds: [] };
    }
    const path = pathFor(leaf.def);
    return {
      leaf,
      path,
      aligns: path.map(() => DEFAULT_GROUP_ALIGN),
      groupIds: path.map((label) => label),
    };
  });

  // 2. Depth of group levels (leaf row sits below them).
  const maxGroupDepth = resolved.reduce((m, r) => Math.max(m, r.path.length), 0);
  const levelCount = maxGroupDepth + 1; // +1 for the leaf row

  // 3. Build cells per band. Within a band, walk leaves left→right; for each
  //    group level emit a spanning cell that covers the contiguous run of leaves
  //    sharing the SAME group identity (label + groupId + same ancestor prefix).
  const bands: Record<HeaderBand, HeaderCell[][]> = {
    left: makeRows(levelCount),
    center: makeRows(levelCount),
    right: makeRows(levelCount),
  };
  const all: HeaderCell[] = [];

  // Partition resolved leaves by band, preserving order.
  const byBand: Record<HeaderBand, LeafResolved[]> = { left: [], center: [], right: [] };
  for (const r of resolved) byBand[bandOf(r.leaf.frozen)].push(r);

  (['left', 'center', 'right'] as HeaderBand[]).forEach((band) => {
    const items = byBand[band];
    if (items.length === 0) return;

    // Group-level spanning cells (one pass per level).
    for (let level = 0; level < maxGroupDepth; level++) {
      let i = 0;
      while (i < items.length) {
        const cur = items[i]!;
        const label = cur.path[level];
        // No group at this level for this leaf → the leaf header is promoted up
        // (rowSpan handles it); skip emitting a group cell here.
        if (label == null) {
          i++;
          continue;
        }
        // Extend the run while the ancestor prefix (0..level) is identical.
        let j = i + 1;
        while (j < items.length && samePrefix(cur, items[j]!, level)) j++;
        const run = items.slice(i, j);
        const start = run[0]!.leaf.index;
        const end = run[run.length - 1]!.leaf.index;
        const cell: HeaderCell = {
          id: cur.groupIds[level] ?? label,
          label,
          depth: level,
          rowSpan: 1,
          colSpan: run.length,
          leafStart: start,
          leafEnd: end,
          isLeaf: false,
          align: cur.aligns[level] ?? DEFAULT_GROUP_ALIGN,
          band,
          columnIds: run.map((r) => r.leaf.id),
        };
        bands[band][level]!.push(cell);
        all.push(cell);
        i = j;
      }
    }

    // Leaf cells: each on its own column. A leaf with a shorter path than the
    // deepest level gets a rowSpan so it fills the empty rows beneath its last
    // group (no holes). Its top depth = path length.
    for (const r of items) {
      const topDepth = r.path.length;
      const rowSpan = levelCount - topDepth;
      const cell: HeaderCell = {
        id: r.leaf.id,
        label: leafHeader(r.leaf.def),
        depth: topDepth,
        rowSpan,
        colSpan: 1,
        leafStart: r.leaf.index,
        leafEnd: r.leaf.index,
        isLeaf: true,
        align: r.leaf.def.align ?? 'start',
        band,
        columnIds: [r.leaf.id],
        def: r.leaf.def,
      };
      bands[band][topDepth]!.push(cell);
      all.push(cell);
    }
  });

  return { levelCount, bands, cells: all };
}

/** Two leaves share the same group identity through `level` (inclusive). */
function samePrefix(
  a: { path: string[]; groupIds: string[] },
  b: { path: string[]; groupIds: string[] },
  level: number,
): boolean {
  for (let k = 0; k <= level; k++) {
    if (a.path[k] !== b.path[k]) return false;
    if (a.groupIds[k] !== b.groupIds[k]) return false;
  }
  return true;
}

function makeRows(n: number): HeaderCell[][] {
  return Array.from({ length: n }, () => []);
}

/** True when any leaf in the set declares grouping (so the feature is needed). */
export function hasHeaderGroups(
  leaves: ReadonlyArray<{ def: GroupedColumnDef }>,
  groups?: ReadonlyArray<HeaderGroup>,
): boolean {
  if (groups && groups.length > 0) return true;
  return leaves.some(({ def }) => pathFor(def).length > 0);
}
