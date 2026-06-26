/**
 * SelectionColumnFeature — a built-in row-selector column for @jects/grid
 * (Bryntum "CheckColumn"/"selectionColumn" / AG-Grid "checkbox selection"
 * parity).
 *
 * Auto-prepends a dedicated, non-sortable/non-filterable column hosting:
 *   - a header "select all" checkbox that toggles every (view) row's selection,
 *     reflecting an indeterminate state when only some rows are selected, and
 *   - a per-row checkbox bound to the grid's selection model: clicking a box
 *     toggles that row's membership in the selection (multi mode), or replaces
 *     the selection with that single row (single mode).
 *
 * The feature is modelled on {@link RowExpanderFeature}: it owns no row data, it
 * auto-prepends a column (idempotently, restoring the original columns on
 * teardown), and it activates via a single delegated click/change/keydown
 * listener on the grid root — no edit to the keystone `Grid` class required.
 *
 * It drives selection through `GridApi.selection` (the same model
 * `SelectionFeature` exposes), so header/per-row toggles, programmatic
 * `api.selection.*`, and pointer selection all stay in sync. A `selectionChange`
 * listener repaints the column so the checkboxes track external selection edits.
 *
 * Reachable two ways (true parity):
 *   - declaratively, via `column.type === 'select'` (resolved by the renderer
 *     registered in `columns/extra-renderers.ts`), and
 *   - as a feature, via `selectionColumnFeature()` (auto-prepends the column).
 *
 * All interaction is confined to {@link GridApi}; everything created is released
 * in `destroy()`.
 */

import { createEl, type Model, type RecordId } from '@jects/core';
import type {
  CellRenderContext,
  ColumnDef,
  GridApi,
  GridFeature,
  SelectionModel,
} from '../contract.js';
import { SELECT_CELL_CLASS, SELECT_INPUT_CLASS } from '../columns/extra-renderers.js';
import { Disposers } from './shared.js';

export { SELECT_CELL_CLASS, SELECT_INPUT_CLASS } from '../columns/extra-renderers.js';

export interface SelectionColumnFeatureOptions {
  /**
   * Auto-prepend the dedicated selector column. Default `true`. Set `false` to
   * host the checkbox yourself via a `type:'select'` column (the renderer is
   * registered globally) while still getting the header "select all" wiring.
   */
  column?: boolean;
  /** Id of the auto-prepended selector column. Default `'__select'`. */
  columnId?: string;
  /** Width (px) of the auto-prepended selector column. Default `44`. */
  columnWidth?: number;
  /**
   * Show the header "select all" checkbox. Default `true`. Ignored (forced off)
   * when the selection model is in `single` mode (select-all is meaningless).
   */
  headerCheckbox?: boolean;
}

const DEFAULT_COLUMN_ID = '__select';
const DEFAULT_COLUMN_WIDTH = 44;

/**
 * Paint a row-selector checkbox into a cell. Shared by the feature's
 * auto-prepended column and the global `type:'select'` renderer so both spell
 * the checkbox identically. The `data-select-row` attribute carries the row id
 * the delegated handler toggles.
 */
export function renderSelectCell(checked: boolean, id: RecordId): HTMLElement {
  const wrap = createEl('label', { className: SELECT_CELL_CLASS });
  const input = createEl('input', { className: SELECT_INPUT_CLASS }) as HTMLInputElement;
  input.type = 'checkbox';
  input.checked = checked;
  input.dataset['selectRow'] = String(id);
  input.setAttribute('aria-label', checked ? 'Deselect row' : 'Select row');
  wrap.appendChild(input);
  return wrap;
}

export class SelectionColumnFeature<Row extends Model = Model>
  implements GridFeature<Row>
{
  readonly name = 'selectionColumn';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();
  private readonly wantColumn: boolean;
  private readonly columnId: string;
  private readonly columnWidth: number;
  private readonly wantHeaderCheckbox: boolean;
  private installedColumn = false;

  constructor(options: SelectionColumnFeatureOptions = {}) {
    this.wantColumn = options.column !== false;
    this.columnId = options.columnId ?? DEFAULT_COLUMN_ID;
    this.columnWidth = options.columnWidth ?? DEFAULT_COLUMN_WIDTH;
    this.wantHeaderCheckbox = options.headerCheckbox !== false;
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());

    if (this.wantColumn) this.installColumn();

    // Delegated activation for per-row + header checkboxes (click handles both
    // mouse and the synthetic click a label/keyboard fires). `change` covers
    // assistive-tech / programmatic toggles that don't bubble a click.
    const onClick = (e: Event): void => this.handleToggleEvent(e);
    grid.el.addEventListener('click', onClick);
    this.disposers.add(() => grid.el.removeEventListener('click', onClick));

    // Repaint the column whenever the selection changes elsewhere (pointer
    // selection, programmatic `api.selection.*`, another feature) so the
    // checkboxes always reflect the live model. `refresh()` repaints the body;
    // the header checkbox lives outside the body, so sync it in place too.
    const offSel = grid.on('selectionChange', () => {
      this.syncHeaderCheckbox();
      this.api.refresh();
    });
    this.disposers.add(offSel);
  }

  /** Update the rendered header "select all" checkbox to the live state. */
  private syncHeaderCheckbox(): void {
    const input = this.api.el.querySelector<HTMLInputElement>(
      `.${SELECT_INPUT_CLASS}[data-select-all="true"]`,
    );
    if (!input) return;
    input.checked = this.isAllSelected();
    input.indeterminate = this.isIndeterminate();
  }

  /* ── public model API ─────────────────────────────────────────────────── */

  /** Select every row in the current (filtered) view. */
  selectAll(): void {
    const sel = this.selection();
    if (sel.mode === 'single' || sel.mode === 'none') return;
    sel.select(this.viewIds());
  }

  /** Clear the row selection. */
  deselectAll(): void {
    this.selection().clear();
  }

  /** Toggle one row's selection (replace in single mode, add/remove in multi). */
  toggleRow(id: RecordId): void {
    const sel = this.selection();
    if (sel.mode === 'none') return;
    if (sel.mode === 'single') {
      if (sel.isSelected(id)) sel.clear();
      else sel.select(id);
      return;
    }
    if (sel.isSelected(id)) sel.deselect(id);
    else sel.add(id);
  }

  /** Whether every view row is selected (drives the header checkbox `checked`). */
  isAllSelected(): boolean {
    const ids = this.viewIds();
    if (ids.length === 0) return false;
    const sel = this.selection();
    return ids.every((id) => sel.isSelected(id));
  }

  /** Whether some — but not all — view rows are selected (header indeterminate). */
  isIndeterminate(): boolean {
    const ids = this.viewIds();
    if (ids.length === 0) return false;
    const sel = this.selection();
    const some = ids.some((id) => sel.isSelected(id));
    return some && !this.isAllSelected();
  }

  /**
   * Build the header "select all" checkbox DOM for the current state. Consumers
   * hosting the selector column themselves (`column: false`) call this from their
   * own header renderer; the auto-prepended column uses it internally.
   */
  renderHeaderCheckbox(): HTMLElement {
    const all = this.isAllSelected();
    const wrap = createEl('label', { className: `${SELECT_CELL_CLASS} ${SELECT_CELL_CLASS}--header` });
    const input = createEl('input', { className: SELECT_INPUT_CLASS }) as HTMLInputElement;
    input.type = 'checkbox';
    input.checked = all;
    input.indeterminate = this.isIndeterminate();
    input.dataset['selectAll'] = 'true';
    input.setAttribute('aria-label', all ? 'Deselect all rows' : 'Select all rows');
    wrap.appendChild(input);
    return wrap;
  }

  /* ── selector column ──────────────────────────────────────────────────── */

  private installColumn(): void {
    if (this.installedColumn) return;
    const existing = this.api.columns.map((c) => ({ ...c }));
    if (existing.some((c) => (c.id ?? c.field) === this.columnId)) return;
    const headerRenderer = this.wantHeaderCheckbox && this.selection().mode !== 'single'
      ? (): HTMLElement => this.renderHeaderCheckbox()
      : undefined;
    const selectCol: ColumnDef<Row> = {
      id: this.columnId,
      header: '',
      width: this.columnWidth,
      type: 'select',
      sortable: false,
      filterable: false,
      resizable: false,
      reorderable: false,
      align: 'center',
      renderer: (ctx: CellRenderContext<Row>) => {
        const id = (ctx.row as Model)[this.api.store.idField] as RecordId;
        ctx.el.replaceChildren(renderSelectCell(this.selection().isSelected(id), id));
      },
      ...(headerRenderer ? { meta: { headerRenderer } } : {}),
    };
    this.api.setColumns([selectCol, ...existing]);
    this.installedColumn = true;
    this.disposers.add(() => {
      if (!this.installedColumn) return;
      const cur = this.api.columns
        .filter((c) => (c.id ?? c.field) !== this.columnId)
        .map((c) => ({ ...c }));
      this.api.setColumns(cur);
      this.installedColumn = false;
    });
  }

  /* ── wiring ───────────────────────────────────────────────────────────── */

  private selection(): SelectionModel<Row> {
    return this.api.selection;
  }

  /** Ids of every row in the current (filtered) view, in order. */
  private viewIds(): RecordId[] {
    const out: RecordId[] = [];
    const n = this.api.getRowCount();
    const idField = this.api.store.idField;
    for (let i = 0; i < n; i++) {
      const row = this.api.getRow(i);
      if (row) out.push((row as Record<string, unknown>)[idField] as RecordId);
    }
    return out;
  }

  private handleToggleEvent(e: Event): void {
    const target = e.target as HTMLElement | null;
    const input = target?.closest<HTMLInputElement>(`.${SELECT_INPUT_CLASS}`);
    if (!input) return;

    if (input.dataset['selectAll'] === 'true') {
      e.stopPropagation();
      if (this.isAllSelected()) this.deselectAll();
      else this.selectAll();
      this.api.refresh();
      return;
    }

    const raw = input.dataset['selectRow'];
    if (raw == null) return;
    e.stopPropagation();
    this.toggleRow(this.resolveId(raw));
    this.api.refresh();
  }

  /** data-* attributes are strings; recover the original id type from the store. */
  private resolveId(raw: string): RecordId {
    if (this.api.getRowById(raw) !== undefined) return raw;
    const asNum = Number(raw);
    if (!Number.isNaN(asNum) && this.api.getRowById(asNum) !== undefined) return asNum;
    return raw;
  }

  destroy(): void {
    this.disposers.dispose();
  }
}

/** Convenience factory. */
export function selectionColumnFeature<Row extends Model = Model>(
  options?: SelectionColumnFeatureOptions,
): SelectionColumnFeature<Row> {
  return new SelectionColumnFeature<Row>(options);
}
