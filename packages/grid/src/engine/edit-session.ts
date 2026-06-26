/**
 * Default edit session implementation.
 *
 * Owns the lifecycle of a single in-progress inline edit: which cell is active,
 * mounting the column's editor (or a default editor picked by column type),
 * validating + committing the value back to the store, and tearing the editor
 * down. The engine wires DOM/keyboard triggers; this class is the state machine.
 */

import type { Model, RecordId } from '@jects/core';
import type {
  CellAddress,
  CellEditor,
  ColumnDef,
  EditSession,
  GridApi,
} from '../contract.js';

/** Host surface the edit session needs from the engine. */
export interface EditHost<Row extends Model = Model> {
  api: GridApi<Row>;
  /** Resolve the active row + column for an address; undefined if out of range. */
  resolve(address: CellAddress):
    | { row: Row; id: RecordId; column: ColumnDef<Row>; value: unknown; el: HTMLElement }
    | undefined;
  /** Write a committed value back to the store. */
  write(id: RecordId, column: ColumnDef<Row>, value: unknown): void;
  /** Repaint the edited cell after commit/cancel. */
  repaintCell(address: CellAddress): void;
}

/** Pick a default editor for a column type. Keeps engine dependency-light. */
function defaultEditor<Row extends Model>(column: ColumnDef<Row>): CellEditor<Row> {
  let input: HTMLInputElement | null = null;
  const type = column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text';
  return {
    mount(ctx): void {
      const el = ctx.el.ownerDocument.createElement('input');
      el.className = 'jects-grid__editor-input';
      el.type = type;
      el.value = ctx.value == null ? '' : String(ctx.value);
      ctx.el.appendChild(el);
      input = el;
    },
    getValue(): unknown {
      if (!input) return undefined;
      if (type === 'number') {
        const n = Number(input.value);
        return input.value === '' ? null : Number.isNaN(n) ? input.value : n;
      }
      return input.value;
    },
    focus(): void {
      input?.focus();
      input?.select();
    },
    destroy(): void {
      input?.remove();
      input = null;
    },
  };
}

export class DefaultEditSession<Row extends Model = Model> implements EditSession<Row> {
  private _active: CellAddress | null = null;
  private _activeRow: Row | null = null;
  private editor: CellEditor<Row> | null = null;
  private container: HTMLElement | null = null;
  private editingId: RecordId | null = null;
  private editingColumn: ColumnDef<Row> | null = null;
  private originalValue: unknown;

  constructor(private readonly host: EditHost<Row>) {}

  get active(): CellAddress | null {
    return this._active ? { ...this._active } : null;
  }

  get activeRow(): Row | null {
    return this._activeRow;
  }

  isEditing(): boolean {
    return this._active !== null;
  }

  start(address: CellAddress): void {
    // Commit any in-flight edit before starting a new one. If the commit is
    // blocked (validation failed → commit() returns false WITHOUT teardown), the
    // previous editor is still mounted; bail so we never orphan it (leaking the
    // CellEditor + its DOM, and leaving the old cell in the editing state).
    if (this._active) {
      if (!this.commit()) return;
    }
    const ctx = this.host.resolve(address);
    if (!ctx) return;

    const { row, id, column, value, el } = ctx;
    // Vetoable beforeCellEdit.
    const ok = this.host.api.emit('beforeCellEdit', {
      row,
      column,
      address: { ...address },
      value,
    });
    if (ok === false) return;

    this._active = { ...address };
    this._activeRow = row;
    this.editingId = id;
    this.editingColumn = column;
    this.originalValue = value;

    const editor = column.editor ?? defaultEditor(column);
    this.editor = editor;
    this.container = el;
    el.classList.add('jects-grid__cell--editing');
    el.replaceChildren();
    editor.mount({
      row,
      value,
      column,
      rowIndex: address.rowIndex,
      colIndex: address.colIndex,
      el,
      api: this.host.api,
    });
    editor.focus?.();
  }

  commit(): boolean {
    if (!this._active || !this.editor || !this.editingColumn || this.editingId == null) {
      return false;
    }
    if (this.editor.validate) {
      const res = this.editor.validate();
      if (res !== true) return false;
    }
    const value = this.editor.getValue();
    const address = { ...this._active };
    const column = this.editingColumn;
    const row = this._activeRow as Row;
    const id = this.editingId;
    const oldValue = this.originalValue;

    this.teardown();

    if (value !== oldValue) {
      this.host.write(id, column, value);
      this.host.api.emit('cellEdit', { row, column, address, oldValue, value });
    }
    this.host.repaintCell(address);
    return true;
  }

  cancel(): void {
    if (!this._active) return;
    const address = { ...this._active };
    this.teardown();
    this.host.repaintCell(address);
  }

  /** Release editor + clear state without writing. */
  private teardown(): void {
    this.container?.classList.remove('jects-grid__cell--editing');
    this.editor?.destroy();
    this.editor = null;
    this.container = null;
    this._active = null;
    this._activeRow = null;
    this.editingId = null;
    this.editingColumn = null;
    this.originalValue = undefined;
  }

  /** Force-dispose (engine teardown). */
  dispose(): void {
    this.teardown();
  }
}
