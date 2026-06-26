/**
 * GroupRowSource — adapts {@link GroupFeature.getViewRows} into the engine's
 * {@link RowSource} seam so grouping actually changes what the body renders.
 *
 * The {@link GroupFeature} owns the grouping *model* (tree, collapse state, per
 * group aggregates) and emits a flat, expansion-aware list of `GroupViewRow`s.
 * This adapter converts that list into the {@link RowEntry}[] shape the engine's
 * {@link RowModel} consumes: group-header bands become `kind: 'group'` entries
 * (carrying the {@link GroupRowData} the renderer paints), and leaf rows become
 * ordinary `kind: 'row'` entries keyed by the store id field.
 *
 * Installing this via `GridEngine.setRowSource(...)` is what makes collapsible
 * group headers, per-group `GroupSummary` rows, and group captions/counts
 * actually appear — without it, grouping is a pure view-model that paints
 * nothing (the bug this feature closes).
 */

import type { Model, RecordId } from '@jects/core';
import type { RowEntry, RowSource } from '../engine/row-model.js';
import type { GroupViewRow } from './group.js';

/** A minimal provider of the current grouped view + the row id field. */
export interface GroupViewProvider<Row extends Model = Model> {
  /** Whether grouping is currently active (≥1 group-by column). */
  isActive(): boolean;
  /** The flattened, expansion-aware grouped view rows. */
  getViewRows(): GroupViewRow<Row>[];
}

/**
 * Maps a {@link GroupViewProvider}'s view rows to engine row entries on demand.
 * Pulled lazily by the {@link RowModel} on (re)materialize.
 */
export class GroupRowSource<Row extends Model = Model> implements RowSource<Row> {
  constructor(
    private readonly provider: GroupViewProvider<Row>,
    private readonly idField: string,
  ) {}

  getRowEntries(): RowEntry<Row>[] {
    const out: RowEntry<Row>[] = [];
    for (const vr of this.provider.getViewRows()) {
      if (vr.kind === 'group') {
        out.push({
          // The group band is not a store record; give it a sentinel row + id so
          // the entry shape is uniform. `idToIndex` skips group entries, so this
          // id is never used for lookups.
          row: undefined as unknown as Row,
          id: `group:${vr.key}` as RecordId,
          depth: vr.depth,
          hasChildren: true,
          expanded: !vr.collapsed,
          kind: 'group',
          group: {
            key: vr.key,
            columnId: vr.columnId,
            value: vr.value,
            depth: vr.depth,
            count: vr.count,
            collapsed: vr.collapsed,
            summary: vr.summary,
          },
        });
      } else {
        const id = (vr.row as Model)[this.idField] as RecordId;
        out.push({
          row: vr.row,
          id,
          depth: vr.depth,
          hasChildren: false,
          expanded: false,
          kind: 'row',
        });
      }
    }
    return out;
  }
}
