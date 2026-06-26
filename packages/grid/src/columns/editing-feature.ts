/**
 * EditingFeature — a `GridFeature` plugin implementing cell + row editing over the
 * `EditController`/`WidgetCellEditor` modules. It reuses @jects/widgets controls
 * (via the factory) and confines all engine interaction to `GridApi`:
 *
 *   - listens for `cellDblClick` (or `cellClick`) to start an edit
 *   - fires the contract's vetoable `beforeCellEdit` before opening
 *   - validates + commits via the EditController, writing through `api.store.update`
 *   - emits the contract's `cellEdit` after a successful commit
 *   - supports row editing (all editable cells in a row at once) with a single
 *     commit/cancel boundary
 *
 * Trigger/keyboard nav is configurable; the engine may also call `start/commit/
 * cancel` directly (e.g. from its own keydown handling) — those paths share the
 * same lifecycle so events fire exactly once.
 */

import type { Model, RecordId } from '@jects/core';
import type {
  CellAddress,
  CellEditContext,
  ColumnDef,
  EditingOptions,
  GridApi,
  GridFeature,
} from '../contract.js';
import { EditController, resolveEditor } from './editors.js';

export interface EditingFeatureConfig extends EditingOptions {
  /** Edit the whole row at once (every editable column) instead of one cell. */
  rowEdit?: boolean;
}

export class EditingFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'editing';
  private api!: GridApi<Row>;
  private controller!: EditController<Row>;
  private cfg: Required<Omit<EditingFeatureConfig, 'trigger'>> & { trigger: EditingOptions['trigger'] };
  private disposers: Array<() => void> = [];
  /** When row-editing, the controllers for each cell in the active row. */
  private rowControllers: EditController<Row>[] = [];
  private activeRowId: RecordId | null = null;

  constructor(config: EditingFeatureConfig = {}) {
    this.cfg = {
      enabled: config.enabled ?? true,
      trigger: config.trigger ?? 'dblclick',
      commitOnBlur: config.commitOnBlur ?? true,
      keyboardNav: config.keyboardNav ?? true,
      rowEdit: config.rowEdit ?? false,
    };
  }

  init(api: GridApi<Row>): void {
    this.api = api;
    this.controller = new EditController<Row>(this.makeHooks());

    if (!this.cfg.enabled) return;

    const trigger = this.cfg.trigger;
    if (trigger === 'dblclick') {
      this.disposers.push(api.on('cellDblClick', (p) => this.start(p.address)));
    } else if (trigger === 'click') {
      this.disposers.push(api.on('cellClick', (p) => this.start(p.address)));
    }
  }

  /** Whether an edit is active. */
  isEditing(): boolean {
    return this.cfg.rowEdit ? this.rowControllers.length > 0 : this.controller.isEditing();
  }

  /** The id of the row currently being row-edited, or null. */
  getActiveRowId(): RecordId | null {
    return this.activeRowId;
  }

  /** The cell currently being edited (single-cell mode), or null. */
  getActive(): CellAddress | null {
    return this.controller.getContext()
      ? { rowIndex: this.controller.getContext()!.rowIndex, colIndex: this.controller.getContext()!.colIndex }
      : null;
  }

  /** Begin editing a cell (or the whole row, in rowEdit mode). */
  start(address: CellAddress): boolean {
    if (!this.cfg.enabled) return false;
    return this.cfg.rowEdit ? this.startRow(address) : this.startCell(address);
  }

  /** Commit the active edit(s). */
  commit(): boolean {
    if (this.cfg.rowEdit) return this.commitRow();
    return this.controller.commit();
  }

  /** Cancel the active edit(s). */
  cancel(): void {
    if (this.cfg.rowEdit) {
      for (const c of this.rowControllers) c.cancel();
      this.rowControllers = [];
      this.activeRowId = null;
      return;
    }
    this.controller.cancel();
  }

  destroy(): void {
    this.cancel();
    this.controller?.destroy();
    for (const off of this.disposers) off();
    this.disposers = [];
  }

  /* ── single-cell ─────────────────────────────────────────────────────── */

  private startCell(address: CellAddress): boolean {
    const ctx = this.contextFor(address);
    if (!ctx) return false;
    if (!this.isColumnEditable(ctx.column)) return false;

    // Contract veto: beforeCellEdit.
    const ok = this.api.emit('beforeCellEdit', {
      row: ctx.row,
      column: ctx.column,
      address,
      value: ctx.value,
    });
    if (ok === false) return false;

    return this.controller.start(ctx);
  }

  private makeHooks() {
    return {
      write: ({ ctx, value }: { ctx: CellEditContext<Row>; value: unknown }) => {
        this.writeCell(ctx, value);
      },
      committed: ({
        ctx,
        oldValue,
        value,
      }: {
        ctx: CellEditContext<Row>;
        oldValue: unknown;
        value: unknown;
      }) => {
        this.api.emit('cellEdit', {
          row: ctx.row,
          column: ctx.column,
          address: { rowIndex: ctx.rowIndex, colIndex: ctx.colIndex },
          oldValue,
          value,
        });
        this.api.refreshCell(ctx.rowIndex, ctx.colIndex);
      },
    };
  }

  /* ── row editing ─────────────────────────────────────────────────────── */

  private startRow(address: CellAddress): boolean {
    const row = this.api.getRow(address.rowIndex);
    if (!row) return false;
    const id = (row as Record<string, unknown>)[this.api.store.idField] as RecordId;

    // Veto once for the row (use the clicked cell's column for the payload).
    const clickedCol = this.api.columns[address.colIndex];
    if (clickedCol) {
      const ok = this.api.emit('beforeCellEdit', {
        row,
        column: clickedCol,
        address,
        value: this.valueAt(row, clickedCol),
      });
      if (ok === false) return false;
    }

    this.cancel(); // close any prior row
    this.activeRowId = id;
    this.api.columns.forEach((column, colIndex) => {
      if (!this.isColumnEditable(column)) return;
      const ctx: CellEditContext<Row> = {
        row,
        value: this.valueAt(row, column),
        column,
        rowIndex: address.rowIndex,
        colIndex,
        el: this.cellElFor(address.rowIndex, colIndex),
        api: this.api,
      };
      const controller = new EditController<Row>({
        write: ({ value }) => this.writeCell(ctx, value),
      });
      controller.start(ctx, resolveEditor(column));
      this.rowControllers.push(controller);
    });
    return this.rowControllers.length > 0;
  }

  private commitRow(): boolean {
    // Validate all first; commit only if every cell is valid (atomic row commit).
    for (const c of this.rowControllers) {
      const editor = c.getEditor();
      if (editor?.validate && editor.validate() !== true) return false;
    }
    const committedCells: { ctx: CellEditContext<Row>; oldValue: unknown; value: unknown }[] = [];
    for (const c of this.rowControllers) {
      const ctx = c.getContext();
      const editor = c.getEditor();
      if (ctx && editor) {
        committedCells.push({ ctx, oldValue: ctx.value, value: editor.getValue() });
      }
      c.commit();
    }
    this.rowControllers = [];
    this.activeRowId = null;
    for (const { ctx, oldValue, value } of committedCells) {
      this.api.emit('cellEdit', {
        row: ctx.row,
        column: ctx.column,
        address: { rowIndex: ctx.rowIndex, colIndex: ctx.colIndex },
        oldValue,
        value,
      });
    }
    this.api.refresh();
    return true;
  }

  /* ── helpers ─────────────────────────────────────────────────────────── */

  private isColumnEditable(column: ColumnDef<Row>): boolean {
    // action/template columns aren't directly editable unless they carry an editor.
    if (column.editor) return true;
    const type = column.type ?? 'text';
    if (type === 'action') return false;
    if (type === 'template') return false;
    return true;
  }

  private valueAt(row: Row, column: ColumnDef<Row>): unknown {
    return column.field ? (row as Record<string, unknown>)[column.field] : undefined;
  }

  private contextFor(address: CellAddress): CellEditContext<Row> | null {
    const row = this.api.getRow(address.rowIndex);
    const column = this.api.columns[address.colIndex];
    if (!row || !column) return null;
    return {
      row,
      value: this.valueAt(row, column),
      column,
      rowIndex: address.rowIndex,
      colIndex: address.colIndex,
      el: this.cellElFor(address.rowIndex, address.colIndex),
      api: this.api,
    };
  }

  private writeCell(ctx: CellEditContext<Row>, value: unknown): void {
    if (!ctx.column.field) return;
    const id = (ctx.row as Record<string, unknown>)[this.api.store.idField] as RecordId;
    this.api.store.update(id, { [ctx.column.field]: value } as Partial<Row>);
  }

  /**
   * Resolve the DOM cell the editor mounts into. The engine's DomRenderer paints
   * rows with `data-row-index` and cells with `data-col-index` (see
   * `DomRenderer.paintRow`/`paintCell` and `Grid.resolveCell`, which uses the same
   * selector). When not found (e.g. virtualized off-screen or jsdom tests with no
   * layout), a detached element is used so the lifecycle still runs.
   */
  private cellElFor(rowIndex: number, colIndex: number): HTMLElement {
    const found = this.api.el.querySelector<HTMLElement>(
      `.jects-grid__row[data-row-index="${rowIndex}"] .jects-grid__cell[data-col-index="${colIndex}"]`,
    );
    return found ?? document.createElement('div');
  }
}

/** Factory helper. */
export function editingFeature<Row extends Model = Model>(
  config?: EditingFeatureConfig,
): EditingFeature<Row> {
  return new EditingFeature<Row>(config);
}
