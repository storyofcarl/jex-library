/**
 * SelectionFeature — a `GridFeature` that installs the `GridSelectionModel` and
 * wires clipboard copy/paste over the current selection. It talks to the engine
 * only through `GridApi`:
 *
 *   - builds a `SelectionHost` from `api` (row count, id↔index, row lookup)
 *   - on `cellClick` updates the cell/range/row selection (shift extends, ctrl
 *     toggles), emitting the contract `selectionChange` event
 *   - registers `copy`/`paste` keyboard handling on the grid root, serializing the
 *     selected range to TSV and writing pasted TSV back through `store.update`
 *
 * The engine may also drive selection directly via `api.selection`; this feature
 * provides the default cell/range model + clipboard glue.
 */

import type { Model, RecordId } from '@jects/core';
import type {
  CellAddress,
  GridApi,
  GridFeature,
  SelectionMode,
} from '../contract.js';
import { GridSelectionModel, type SelectionHost, type CellRect } from './selection.js';
import {
  applyPaste,
  buildCopyText,
  type ClipboardHost,
} from './clipboard.js';

export interface SelectionFeatureConfig {
  /** Selection mode. Default `'cell'`. */
  mode?: SelectionMode;
  /** Enable clipboard copy/paste. Default true. */
  clipboard?: boolean;
}

export class SelectionFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'selection';
  private api!: GridApi<Row>;
  private model!: GridSelectionModel<Row>;
  private cfg: Required<SelectionFeatureConfig>;
  private disposers: Array<() => void> = [];
  private keyHandler?: (e: KeyboardEvent) => void;

  constructor(config: SelectionFeatureConfig = {}) {
    this.cfg = {
      mode: config.mode ?? 'cell',
      clipboard: config.clipboard ?? true,
    };
  }

  init(api: GridApi<Row>): void {
    this.api = api;
    this.model = new GridSelectionModel<Row>(this.makeHost());

    this.disposers.push(
      api.on('cellClick', (p) => this.onCellClick(p.address, p.event)),
    );

    if (this.cfg.clipboard) this.installClipboard();
  }

  /** The selection model (engine exposes this as `GridApi.selection`). */
  getModel(): GridSelectionModel<Row> {
    return this.model;
  }

  destroy(): void {
    for (const off of this.disposers) off();
    this.disposers = [];
    if (this.keyHandler) {
      this.api.el.removeEventListener('keydown', this.keyHandler);
      delete this.keyHandler;
    }
  }

  /* ── selection host adapter ──────────────────────────────────────────── */

  private makeHost(): SelectionHost<Row> {
    const api = this.api;
    const cfg = this.cfg;
    return {
      get mode() {
        return cfg.mode;
      },
      rowCount: () => api.getRowCount(),
      colCount: () => api.columns.length,
      idAt: (rowIndex) => {
        const row = api.getRow(rowIndex);
        return row ? ((row as Record<string, unknown>)[api.store.idField] as RecordId) : undefined;
      },
      indexOf: (id) => api.getRowIndex(id),
      rowById: (id) => api.getRowById(id),
      onChange: (state) => {
        api.emit('selectionChange', state);
      },
    };
  }

  /* ── pointer selection ───────────────────────────────────────────────── */

  private onCellClick(address: CellAddress, event: MouseEvent): void {
    if (this.cfg.mode === 'none') return;
    if (event.shiftKey) {
      this.model.extendTo(address);
    } else if ((event.ctrlKey || event.metaKey) && this.cfg.mode === 'multi') {
      const id = this.api.getRow(address.rowIndex);
      if (id) {
        const rid = (id as Record<string, unknown>)[this.api.store.idField] as RecordId;
        this.model.toggle(rid);
      }
    } else {
      this.model.selectCell(address);
    }
  }

  /* ── clipboard ───────────────────────────────────────────────────────── */

  private clipboardHost(): ClipboardHost {
    const api = this.api;
    const model = this.model;
    return {
      getRange: () => model.getRect(),
      getCellValue: (cell) => this.cellValue(cell),
      setCellValue: (cell, value) => this.writeCell(cell, value),
      rowCount: () => api.getRowCount(),
      colCount: () => api.columns.length,
    };
  }

  private installClipboard(): void {
    const handler = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'c' || e.key === 'C') {
        const text = buildCopyText(this.clipboardHost());
        if (text) {
          this.writeToClipboard(e, text);
        }
      } else if (e.key === 'v' || e.key === 'V') {
        const text = this.readFromClipboard(e);
        if (text != null) this.paste(text);
      }
    };
    this.keyHandler = handler;
    this.api.el.addEventListener('keydown', handler);
  }

  /** Programmatic copy → returns the TSV (also writes to clipboardData when present). */
  copy(): string {
    return buildCopyText(this.clipboardHost());
  }

  /** Programmatic paste of a TSV string anchored at the selection's top-left. */
  paste(text: string): CellAddress[] {
    const rect = this.model.getRect();
    const anchor: CellAddress = rect
      ? { rowIndex: rect.top, colIndex: rect.left }
      : (this.model.getFocused() ?? { rowIndex: 0, colIndex: 0 });
    const selectionLargerThanCell =
      rect != null && (rect.bottom > rect.top || rect.right > rect.left);
    // Coalesce every pasted cell's `store.update` into ONE undo step when the
    // UndoRedoFeature is installed (so a multi-cell paste is a single undo, per
    // the parity contract). Falls back to direct writes otherwise.
    let written: CellAddress[] = [];
    this.withUndoBatch('Paste', () => {
      written = applyPaste(this.clipboardHost(), text, anchor, {
        tile: selectionLargerThanCell,
        selection: rect,
      });
    });
    if (written.length) this.api.refresh();
    return written;
  }

  /**
   * Run a batch of cell writes inside the UndoRedoFeature's `transact()` when
   * that feature is installed, so the whole paste is one reversible step. Without
   * an undo feature, `fn` runs directly.
   */
  private withUndoBatch(label: string, fn: () => void): void {
    const undo = this.api.features.get('undoRedo') as
      | { transact?(label: string, fn: () => void): void }
      | undefined;
    if (undo && typeof undo.transact === 'function') undo.transact(label, fn);
    else fn();
  }

  private cellValue(cell: CellAddress): unknown {
    const row = this.api.getRow(cell.rowIndex);
    const column = this.api.columns[cell.colIndex];
    if (!row || !column || !column.field) return '';
    return (row as Record<string, unknown>)[column.field];
  }

  private writeCell(cell: CellAddress, value: string): void {
    const row = this.api.getRow(cell.rowIndex);
    const column = this.api.columns[cell.colIndex];
    if (!row || !column || !column.field) return;
    const id = (row as Record<string, unknown>)[this.api.store.idField] as RecordId;
    this.api.store.update(id, { [column.field]: coerce(value, column.type) } as Partial<Row>);
  }

  private writeToClipboard(e: KeyboardEvent, text: string): void {
    const cd = (e as unknown as { clipboardData?: DataTransfer }).clipboardData;
    if (cd) {
      cd.setData('text/plain', text);
      e.preventDefault();
    } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
    }
  }

  private readFromClipboard(e: KeyboardEvent): string | null {
    const cd = (e as unknown as { clipboardData?: DataTransfer }).clipboardData;
    if (cd) return cd.getData('text/plain');
    return null;
  }
}

/** Coerce a pasted string to a typed value per column type. */
function coerce(value: string, type?: string): unknown {
  if (type === 'number') {
    const n = Number(value);
    return value === '' ? null : Number.isNaN(n) ? value : n;
  }
  if (type === 'check') {
    return value === 'true' || value === '1' || value.toLowerCase() === 'yes';
  }
  if (type === 'date') {
    const d = new Date(value);
    return value === '' ? null : Number.isNaN(d.getTime()) ? value : d;
  }
  return value;
}

/** Factory helper. */
export function selectionFeature<Row extends Model = Model>(
  config?: SelectionFeatureConfig,
): SelectionFeature<Row> {
  return new SelectionFeature<Row>(config);
}

/** Re-export for engine wiring. */
export type { CellRect };
