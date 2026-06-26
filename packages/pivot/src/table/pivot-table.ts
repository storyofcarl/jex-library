/**
 * PivotTable — the Jects pivot widget.
 *
 * Composes a {@link PivotEngine} with a drag-and-drop configuration panel
 * (Fields source list + Rows/Columns/Values/Filters drop zones) and renders the
 * pivoted result by REUSING the @jects/grid `Grid` (the pivot matrix is
 * projected into Grid columns/rows).
 *
 * Extends the core `Widget`: `defaults()/buildEl()/render()`, vetoable
 * `beforePivot` → `pivot` events, fully disposed on `destroy()` (the Grid and
 * all listeners are tracked).
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  createEl,
  register,
} from '@jects/core';
import type { Model } from '@jects/core';
import { Grid } from '@jects/grid';
import {
  PivotEngine,
  makeNumberFormat,
  toCsv,
  toExcelXml,
  toXlsx,
  downloadCsv,
  downloadXlsx,
  downloadXls,
  type AggregatorRegistry,
  type PivotConfig,
  type PivotResult,
  type PivotField,
  type PivotValue,
  type PivotFilter,
  type PivotFilterOperator,
  type AggregatorName,
  type Aggregator,
  type NumberFormatOptions,
} from '../engine/index.js';
import type { ConditionalFormat } from '../engine/index.js';
import {
  projectColumns,
  projectRows,
  type PivotGridRow,
  type PivotCellTemplate,
  type ProjectOptions,
} from './project.js';
import './pivot-table.css';

/** Axis a field is assigned to in the config panel. */
export type PivotAxis = 'rows' | 'columns' | 'values' | 'filters';

/** A field the user can drag onto the pivot axes. */
export interface PivotFieldSpec {
  /** Path into the row model. */
  field: string;
  /** Display label. Defaults to `field`. */
  label?: string;
  /** Default aggregator when placed on the values axis. */
  aggregator?: AggregatorName | string;
}

export interface PivotTableConfig<Row extends Model = Model> extends WidgetConfig {
  /** Source flat dataset. */
  data?: Row[];
  /** Available fields for the config panel. Inferred from data when omitted. */
  fields?: PivotFieldSpec[];
  /** Initial field assignment. */
  rows?: string[];
  /** Initial column-axis fields. */
  columns?: string[];
  /** Initial value fields (field or `{field, aggregator}`). */
  values?: Array<string | { field: string; aggregator?: AggregatorName | string; label?: string }>;
  /** Initial filters. */
  filters?: PivotFilter<Row>[];
  /** Tree (hierarchical) or flat output. Default `'tree'`. */
  mode?: 'tree' | 'flat';
  /** Totals config. Default all on. */
  totals?: PivotConfig<Row>['totals'];
  /** Show the drag-and-drop config panel. Default `true`. */
  showPanel?: boolean;
  /** Locale-aware number format for value cells. */
  numberFormat?: NumberFormatOptions;
  /** Custom value-cell template. */
  cellTemplate?: PivotCellTemplate;
  /**
   * Conditional value-cell formatting — a callback or declarative rules
   * (cell-value thresholds, color scales, data bars). See
   * {@link ConditionalFormat}.
   */
  conditionalFormat?: ConditionalFormat;
  /**
   * Initial collapse state. `rows`/`columns` are node identity keys; the
   * `*ExpandLevel` fields auto-collapse everything deeper than the given depth.
   */
  collapsedRows?: string[];
  /** Initial collapsed column-node identity keys. */
  collapsedColumns?: string[];
  /** Auto-collapse every row node deeper than this depth (0-based). */
  rowExpandLevel?: number;
  /** Auto-collapse every column node deeper than this depth (0-based). */
  columnExpandLevel?: number;
  /** Default operator applied when a field is first dropped on the Filters axis. */
  defaultFilterOperator?: PivotFilterOperator;
  /** Freeze row-header columns. Default `true`. */
  freezeRowHeaders?: boolean;
  /** Grid row height in px. */
  rowHeight?: number;
  /** Custom aggregator registry. */
  aggregators?: AggregatorRegistry;
}

export interface PivotTableEvents<Row extends Model = Model> extends WidgetEvents {
  /** Vetoable: a recompute is about to run. Return `false` to cancel. */
  beforePivot: { config: PivotConfig<Row>; pivot: PivotTable<Row> };
  /** The pivot recomputed; the grid was repainted. */
  pivot: { result: PivotResult; pivot: PivotTable<Row> };
  /** The user changed the field assignment via the panel. */
  configChange: { axis: PivotAxis; pivot: PivotTable<Row> };
  /** A row/column header node was collapsed or expanded. */
  toggle: { axis: 'rows' | 'columns'; nodeKey: string; collapsed: boolean; pivot: PivotTable<Row> };
}

interface ValueAssignment {
  field: string;
  aggregator: AggregatorName | string;
  label?: string;
}

const VALUE_AGGS: AggregatorName[] = [
  'sum',
  'count',
  'counta',
  'countunique',
  'min',
  'max',
  'average',
  'median',
  'product',
  'stddev',
  'variance',
];

export class PivotTable<Row extends Model = Model> extends Widget<
  PivotTableConfig<Row>,
  PivotTableEvents<Row>
> {
  private declare engine: PivotEngine<Row>;
  private declare grid: Grid<PivotGridRow> | null;
  private declare panelEl: HTMLElement;
  private declare gridEl: HTMLElement;
  private declare result: PivotResult | null;
  // Live axis assignments.
  private declare assignRows: string[];
  private declare assignCols: string[];
  private declare assignValues: ValueAssignment[];
  private declare assignFilters: PivotFilter<Row>[];
  private declare fieldSpecs: PivotFieldSpec[];
  /** Live collapse state for row/column header nodes (by identity key). */
  private declare collapsedRows: Set<string>;
  private declare collapsedCols: Set<string>;
  /** Polite live region announcing keyboard pick-up / move / drop actions. */
  private declare liveEl: HTMLElement;
  /** The chip currently "picked up" for keyboard reassignment, if any. */
  private declare picked: { field: string; from: PivotAxis | 'source' } | null;
  /** The zone a picked-up chip will move to when the keyboard move is confirmed. */
  private declare pendingTarget: PivotAxis | 'source' | null;

  protected override defaults(): Partial<PivotTableConfig<Row>> {
    return {
      mode: 'tree',
      showPanel: true,
      totals: true,
      freezeRowHeaders: true,
      rowHeight: 32,
    } as Partial<PivotTableConfig<Row>>;
  }

  protected buildEl(): HTMLElement {
    return createEl('div', { className: 'jects-pivot' });
  }

  protected override render(): void {
    // Re-render only rebuilds on first call; later updates flow through methods.
    if (this.grid !== undefined && this.grid !== null) {
      this.applyConfigState();
      this.recompute();
      this.rebuildPanel();
      return;
    }
    this.grid = null;
    this.result = null;
    this.picked = null;
    this.pendingTarget = null;

    const cfg = this.config;
    this.engine = new PivotEngine<Row>(cfg.data ?? [], cfg.aggregators);
    this.fieldSpecs = cfg.fields ?? inferFields(cfg.data ?? []);
    this.applyConfigState();

    const el = this.el;
    el.classList.add('jects-pivot');
    el.innerHTML = '';

    this.panelEl = createEl('div', { className: 'jects-pivot__panel' });
    this.panelEl.setAttribute('role', 'group');
    this.panelEl.setAttribute('aria-label', 'Pivot field configuration');
    this.gridEl = createEl('div', { className: 'jects-pivot__grid' });

    // Visually-hidden polite live region for keyboard reassignment announcements.
    this.liveEl = createEl('div', { className: 'jects-pivot__live' });
    this.liveEl.setAttribute('role', 'status');
    this.liveEl.setAttribute('aria-live', 'polite');

    if (cfg.showPanel !== false) el.appendChild(this.panelEl);
    el.appendChild(this.gridEl);
    el.appendChild(this.liveEl);

    this.rebuildPanel();
    this.recompute();
  }

  /** Announce a message via the polite live region (keyboard a11y feedback). */
  private announce(message: string): void {
    if (this.liveEl) this.liveEl.textContent = message;
  }

  /** The type-aware filter operators exposed by the per-chip operator editor. */
  private static readonly FILTER_OPERATORS: PivotFilterOperator[] = [
    'eq',
    'ne',
    'lt',
    'lte',
    'gt',
    'gte',
    'in',
    'notin',
    'contains',
    'empty',
    'notempty',
  ];

  /** Ordered axes a picked-up chip can be dropped onto via the keyboard. */
  private static readonly KEYBOARD_AXES: Array<PivotAxis | 'source'> = [
    'rows',
    'columns',
    'values',
    'filters',
    'source',
  ];

  private axisLabel(axis: PivotAxis | 'source'): string {
    switch (axis) {
      case 'rows':
        return 'Rows';
      case 'columns':
        return 'Columns';
      case 'values':
        return 'Values';
      case 'filters':
        return 'Filters';
      default:
        return 'Fields';
    }
  }

  /** Sync the live assignment state from config. */
  private applyConfigState(): void {
    const cfg = this.config;
    this.assignRows = [...(cfg.rows ?? [])];
    this.assignCols = [...(cfg.columns ?? [])];
    this.assignValues = (cfg.values ?? []).map((v) =>
      typeof v === 'string'
        ? { field: v, aggregator: 'sum' as const }
        : { field: v.field, aggregator: v.aggregator ?? 'sum', ...(v.label ? { label: v.label } : {}) },
    );
    this.assignFilters = [...(cfg.filters ?? [])];
    this.collapsedRows = new Set(cfg.collapsedRows ?? []);
    this.collapsedCols = new Set(cfg.collapsedColumns ?? []);
  }

  /* ── public API ─────────────────────────────────────────────────────── */

  /** Replace the source dataset and recompute. */
  setData(data: Row[]): this {
    this.engine.setData(data);
    if (!this.config.fields) this.fieldSpecs = inferFields(data);
    this.rebuildPanel();
    this.recompute();
    return this;
  }

  /** Register a custom aggregator (proxies the engine's `addMathMethod`). */
  addMathMethod(name: string, fn: Aggregator): this {
    this.engine.addMathMethod(name, fn);
    return this;
  }

  /** Assign fields to an axis programmatically and recompute. */
  setAxis(axis: PivotAxis, fields: string[]): this {
    if (axis === 'rows') this.assignRows = [...fields];
    else if (axis === 'columns') this.assignCols = [...fields];
    else if (axis === 'values')
      this.assignValues = fields.map((f) => ({ field: f, aggregator: 'sum' as const }));
    this.rebuildPanel();
    this.emit('configChange', { axis, pivot: this });
    this.recompute();
    return this;
  }

  /** The current pivot configuration. */
  getPivotConfig(): PivotConfig<Row> {
    const cfg = this.config;
    const fmt = cfg.numberFormat ? makeNumberFormat(cfg.numberFormat) : undefined;
    return {
      rows: this.assignRows.map((f) => this.fieldOf(f)) as PivotField<Row>[],
      columns: this.assignCols.map((f) => this.fieldOf(f)) as PivotField<Row>[],
      values: this.assignValues.map((v) => {
        const out: PivotValue<Row> = {
          field: v.field as keyof Row & string,
          aggregator: v.aggregator,
          ...(v.label ? { label: v.label } : {}),
        };
        if (fmt) out.format = fmt;
        return out;
      }),
      filters: this.assignFilters,
      mode: cfg.mode ?? 'tree',
      ...(cfg.totals !== undefined ? { totals: cfg.totals } : {}),
      ...(cfg.aggregators ? { aggregators: cfg.aggregators } : {}),
      collapse: {
        rows: this.collapsedRows,
        columns: this.collapsedCols,
        ...(cfg.rowExpandLevel !== undefined ? { rowExpandLevel: cfg.rowExpandLevel } : {}),
        ...(cfg.columnExpandLevel !== undefined ? { columnExpandLevel: cfg.columnExpandLevel } : {}),
      },
    };
  }

  private fieldOf(field: string): PivotField<Row> {
    const spec = this.fieldSpecs.find((f) => f.field === field);
    return {
      field: field as keyof Row & string,
      ...(spec?.label ? { label: spec.label } : {}),
    };
  }

  /** The last computed result. */
  getResult(): PivotResult | null {
    return this.result;
  }

  /** The underlying engine. */
  getEngine(): PivotEngine<Row> {
    return this.engine;
  }

  /** Force a recompute + repaint. */
  refresh(): this {
    this.recompute();
    return this;
  }

  /**
   * Collapse or expand a row/column header node by its identity `key`. Emits
   * `toggle` and recomputes (the engine prunes the collapsed node's children).
   */
  toggleNode(axis: 'rows' | 'columns', nodeKey: string, collapsed?: boolean): this {
    const set = axis === 'rows' ? this.collapsedRows : this.collapsedCols;
    const next = collapsed ?? !set.has(nodeKey);
    if (next) set.add(nodeKey);
    else set.delete(nodeKey);
    this.emit('toggle', { axis, nodeKey, collapsed: next, pivot: this });
    this.recompute();
    return this;
  }

  /** The current collapsed node keys for an axis (read-only snapshot). */
  getCollapsed(axis: 'rows' | 'columns'): string[] {
    return [...(axis === 'rows' ? this.collapsedRows : this.collapsedCols)];
  }

  /* ── export ─────────────────────────────────────────────────────────── */

  /** Serialize the current result to CSV. */
  toCsv(): string {
    return toCsv(this.ensureResult(), this.exportOptions());
  }

  /** Serialize the current result to legacy Excel SpreadsheetML XML (`.xls`). */
  toExcelXml(): string {
    return toExcelXml(this.ensureResult(), this.exportOptions());
  }

  /** Serialize the current result to real `.xlsx` (OOXML, zipped) bytes. */
  toXlsx(): Uint8Array {
    return toXlsx(this.ensureResult(), this.exportOptions());
  }

  /** Trigger a CSV download (browser). */
  exportCsv(fileName?: string): void {
    downloadCsv(this.ensureResult(), { ...this.exportOptions(), ...(fileName ? { fileName } : {}) });
  }

  /** Trigger a real `.xlsx` (OOXML) download (browser). */
  exportXlsx(fileName?: string): void {
    downloadXlsx(this.ensureResult(), { ...this.exportOptions(), ...(fileName ? { fileName } : {}) });
  }

  /** Trigger a legacy `.xls` (SpreadsheetML) download (browser, back-compat). */
  exportXls(fileName?: string): void {
    downloadXls(this.ensureResult(), { ...this.exportOptions(), ...(fileName ? { fileName } : {}) });
  }

  private ensureResult(): PivotResult {
    if (!this.result) this.recompute();
    return this.result!;
  }

  private exportOptions() {
    const fmt = this.config.numberFormat ? makeNumberFormat(this.config.numberFormat) : undefined;
    return {
      rowFieldLabels: this.assignRows.map((f) => this.labelOf(f)),
      ...(fmt ? { formatValue: (v: number | null) => fmt(v) } : {}),
    };
  }

  /* ── computation + grid ─────────────────────────────────────────────── */

  private recompute(): void {
    const pivotConfig = this.getPivotConfig();
    if (this.emit('beforePivot', { config: pivotConfig, pivot: this }) === false) return;
    this.result = this.engine.compute(pivotConfig);
    this.renderGrid(this.result);
    this.emit('pivot', { result: this.result, pivot: this });
  }

  private renderGrid(result: PivotResult): void {
    const projectOpts: ProjectOptions = {
      rowFieldLabels: this.assignRows.map((f) => this.labelOf(f)),
      freezeRowHeaders: this.config.freezeRowHeaders ?? true,
      ...(this.config.numberFormat
        ? { formatValue: (v: number | null) => makeNumberFormat(this.config.numberFormat)(v) }
        : {}),
      ...(this.config.cellTemplate ? { cellTemplate: this.config.cellTemplate } : {}),
      ...(this.config.conditionalFormat ? { conditionalFormat: this.config.conditionalFormat } : {}),
      onToggle: (nodeKey: string, collapsed: boolean) => this.toggleNode('rows', nodeKey, collapsed),
    };
    const columns = projectColumns(result, projectOpts);
    const rows = projectRows(result);

    if (this.grid) {
      this.grid.update({ data: rows, columns });
      return;
    }
    this.grid = new Grid<PivotGridRow>(this.gridEl, {
      data: rows,
      columns,
      rowHeight: this.config.rowHeight ?? 32,
      cls: 'jects-pivot__table',
    });
    this.track(() => {
      this.grid?.destroy();
      this.grid = null;
    });
  }

  /* ── config panel (drag & drop) ─────────────────────────────────────── */

  private rebuildPanel(): void {
    if (!this.panelEl || this.config.showPanel === false) return;
    this.panelEl.innerHTML = '';

    // Source field list.
    const source = createEl('div', { className: 'jects-pivot__zone jects-pivot__zone--source' });
    source.setAttribute('aria-label', 'Available fields');
    const sourceTitle = createEl('div', { className: 'jects-pivot__zone-title' });
    // Neutral (presentation) child so the title is not treated as a list item.
    sourceTitle.setAttribute('role', 'presentation');
    sourceTitle.textContent = 'Fields';
    source.appendChild(sourceTitle);
    const assigned = new Set([
      ...this.assignRows,
      ...this.assignCols,
      ...this.assignValues.map((v) => v.field),
    ]);
    let sourceCount = 0;
    for (const spec of this.fieldSpecs) {
      if (assigned.has(spec.field)) continue;
      source.appendChild(this.makeChip(spec.field, spec.label ?? spec.field, 'source'));
      sourceCount++;
    }
    this.applyZoneRole(source, sourceCount);
    this.makeDropTarget(source, 'source');
    this.panelEl.appendChild(source);

    // Axis drop zones.
    this.panelEl.appendChild(this.makeFiltersZone());
    this.panelEl.appendChild(this.makeZone('columns', 'Columns', this.assignCols));
    this.panelEl.appendChild(this.makeZone('rows', 'Rows', this.assignRows));
    this.panelEl.appendChild(this.makeValuesZone());
  }

  /**
   * A drop zone is a `role="list"` only when it actually contains field chips
   * (listitems). An empty zone uses `role="group"` instead — an empty list with
   * no `listitem` children violates axe's aria-required-children rule. Either
   * way the zone keeps its accessible name via aria-label.
   */
  private applyZoneRole(zone: HTMLElement, chipCount: number): void {
    zone.setAttribute('role', chipCount > 0 ? 'list' : 'group');
  }

  private makeZone(axis: PivotAxis, title: string, fields: string[]): HTMLElement {
    const zone = createEl('div', {
      className: `jects-pivot__zone jects-pivot__zone--${axis}`,
    });
    zone.setAttribute('aria-label', `${title} fields`);
    zone.dataset['axis'] = axis;
    const titleEl = createEl('div', { className: 'jects-pivot__zone-title' });
    titleEl.setAttribute('role', 'presentation');
    titleEl.textContent = title;
    zone.appendChild(titleEl);
    for (const field of fields) {
      zone.appendChild(this.makeChip(field, this.labelOf(field), axis));
    }
    this.applyZoneRole(zone, fields.length);
    this.makeDropTarget(zone, axis);
    return zone;
  }

  private makeValuesZone(): HTMLElement {
    const zone = createEl('div', { className: 'jects-pivot__zone jects-pivot__zone--values' });
    zone.setAttribute('aria-label', 'Values fields');
    zone.dataset['axis'] = 'values';
    const titleEl = createEl('div', { className: 'jects-pivot__zone-title' });
    titleEl.setAttribute('role', 'presentation');
    titleEl.textContent = 'Values';
    zone.appendChild(titleEl);
    for (const v of this.assignValues) {
      zone.appendChild(this.makeValueChip(v));
    }
    this.applyZoneRole(zone, this.assignValues.length);
    this.makeDropTarget(zone, 'values');
    return zone;
  }

  /** The Filters drop zone — each chip carries a live operator + value editor. */
  private makeFiltersZone(): HTMLElement {
    const zone = createEl('div', { className: 'jects-pivot__zone jects-pivot__zone--filters' });
    zone.setAttribute('aria-label', 'Filters fields');
    zone.dataset['axis'] = 'filters';
    const titleEl = createEl('div', { className: 'jects-pivot__zone-title' });
    titleEl.setAttribute('role', 'presentation');
    titleEl.textContent = 'Filters';
    zone.appendChild(titleEl);
    for (const filter of this.assignFilters) {
      zone.appendChild(this.makeFilterChip(filter));
    }
    this.applyZoneRole(zone, this.assignFilters.length);
    this.makeDropTarget(zone, 'filters');
    return zone;
  }

  /**
   * A filter chip: the base draggable chip plus an operator `<select>` (the
   * type-aware operators the engine supports) and a value input — a comma-list
   * for the multi-value `in`/`notin` operators, a single value otherwise, and
   * no input for the value-less `empty`/`notempty`. Editing either control
   * mutates the live filter and recomputes.
   */
  private makeFilterChip(filter: PivotFilter<Row>): HTMLElement {
    const field = filter.field as string;
    const chip = this.makeChip(field, this.labelOf(field), 'filters');
    chip.classList.add('jects-pivot__chip--filter');
    const op: PivotFilterOperator =
      filter.operator ?? (filter.values !== undefined ? 'in' : 'eq');
    filter.operator = op;

    // Operator selector.
    const sel = createEl('select', { className: 'jects-pivot__chip-op' });
    sel.setAttribute('aria-label', `Filter operator for ${this.labelOf(field)}`);
    for (const o of PivotTable.FILTER_OPERATORS) {
      const opt = createEl('option');
      opt.value = o;
      opt.textContent = o;
      if (o === op) opt.selected = true;
      sel.appendChild(opt);
    }

    // Value input (kind depends on the operator).
    const value = createEl('input', { className: 'jects-pivot__chip-value' });
    value.type = 'text';
    value.setAttribute('aria-label', `Filter value for ${this.labelOf(field)}`);
    const isMulti = op === 'in' || op === 'notin';
    const needsValue = op !== 'empty' && op !== 'notempty';
    value.placeholder = isMulti ? 'a, b, c' : 'value';
    value.value = isMulti
      ? (filter.values ?? []).map((v) => String(v)).join(', ')
      : filter.value != null
        ? String(filter.value)
        : '';
    value.hidden = !needsValue;

    const apply = (): void => {
      const nextOp = sel.value as PivotFilterOperator;
      filter.operator = nextOp;
      const nextMulti = nextOp === 'in' || nextOp === 'notin';
      const nextNeedsValue = nextOp !== 'empty' && nextOp !== 'notempty';
      if (!nextNeedsValue) {
        delete filter.value;
        delete filter.values;
      } else if (nextMulti) {
        filter.values = value.value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        delete filter.value;
      } else {
        filter.value = coerceFilterValue(value.value);
        delete filter.values;
      }
    };

    sel.addEventListener('change', () => {
      apply();
      this.rebuildPanel(); // re-render so the value input reflects the new kind
      this.recompute();
    });
    value.addEventListener('change', () => {
      apply();
      this.recompute();
    });

    const remove = chip.querySelector('.jects-pivot__chip-remove');
    chip.insertBefore(sel, remove);
    chip.insertBefore(value, remove);
    return chip;
  }

  private makeChip(field: string, label: string, axis: PivotAxis | 'source'): HTMLElement {
    const chip = createEl('div', { className: 'jects-pivot__chip' });
    chip.setAttribute('role', 'listitem');
    chip.draggable = true;
    chip.dataset['field'] = field;
    chip.dataset['axis'] = axis;
    chip.tabIndex = 0;
    // Keyboard equivalent of drag-and-drop (drag/drop has no keyboard events):
    // Enter/Space picks the chip up, Arrow keys choose a target zone, Enter/Space
    // drops, Escape cancels. Documented to AT via aria-roledescription + keyshortcuts.
    chip.setAttribute('aria-roledescription', 'Draggable field');
    chip.setAttribute('aria-keyshortcuts', 'Enter Space ArrowUp ArrowDown Escape');
    const picked = this.picked?.field === field && this.picked?.from === axis;
    chip.setAttribute('aria-grabbed', picked ? 'true' : 'false');
    if (picked) chip.classList.add('jects-pivot__chip--picked');

    const labelEl = createEl('span', { className: 'jects-pivot__chip-label' });
    labelEl.textContent = label;
    chip.appendChild(labelEl);

    if (axis !== 'source') {
      const remove = createEl('button', { className: 'jects-pivot__chip-remove' });
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${label}`);
      remove.textContent = '×';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeField(field, axis as PivotAxis);
      });
      chip.appendChild(remove);
    }

    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', JSON.stringify({ field, from: axis }));
      chip.classList.add('jects-pivot__chip--dragging');
    });
    chip.addEventListener('dragend', () => chip.classList.remove('jects-pivot__chip--dragging'));
    chip.addEventListener('keydown', (e) => this.onChipKeyDown(e, field, label, axis));
    return chip;
  }

  /**
   * Keyboard reassignment for a chip — the accessible equivalent of dragging.
   * Enter/Space picks the chip up; while picked up, Arrow keys cycle the target
   * zone (announced live) and Enter/Space confirms the move (or releases in place
   * if no target was chosen); Escape cancels. All transitions are announced
   * through the polite live region.
   */
  private onChipKeyDown(e: KeyboardEvent, field: string, label: string, axis: PivotAxis | 'source'): void {
    const axes = PivotTable.KEYBOARD_AXES;
    const isPicked = this.picked?.field === field && this.picked?.from === axis;
    const isActivate = e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar';

    if (isActivate && !isPicked) {
      // Pick up.
      e.preventDefault();
      this.picked = { field, from: axis };
      this.pendingTarget = null;
      this.announce(
        `${label} grabbed from ${this.axisLabel(axis)}. Use Arrow keys to choose a zone, Enter to confirm, Escape to cancel.`,
      );
      this.markPicked(field, axis, true);
      return;
    }

    if (!isPicked) return; // all remaining keys only act on the picked chip

    if (isActivate) {
      // Confirm: commit to the pending target if one was chosen, else release.
      e.preventDefault();
      if (this.pendingTarget && this.pendingTarget !== axis) {
        this.commitKeyboardMove(field, label, axis, this.pendingTarget);
      } else {
        this.picked = null;
        this.pendingTarget = null;
        this.announce(`${label} stays on ${this.axisLabel(axis)}.`);
        this.markPicked(field, axis, false);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      this.picked = null;
      this.pendingTarget = null;
      this.announce(`Cancelled. ${label} remains on ${this.axisLabel(axis)}.`);
      this.markPicked(field, axis, false);
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
      const step = forward ? 1 : -1;
      // Cycle the destination across the zones, skipping the chip's current zone.
      let idx = axes.indexOf(this.pendingTarget ?? axis);
      do {
        idx = (idx + step + axes.length) % axes.length;
      } while (axes[idx] === axis);
      this.pendingTarget = axes[idx]!;
      this.announce(`Move ${label} to ${this.axisLabel(this.pendingTarget)}? Press Enter to confirm.`);
    }
  }

  /** Commit a keyboard-driven field move and restore focus to the moved chip. */
  private commitKeyboardMove(
    field: string,
    label: string,
    from: PivotAxis | 'source',
    to: PivotAxis | 'source',
  ): void {
    this.picked = null;
    this.pendingTarget = null;
    this.moveField(field, from, to); // rebuilds the panel
    this.announce(`${label} moved to ${this.axisLabel(to)}.`);
    // Return focus to the chip in its new zone so keyboard flow continues.
    const moved = this.panelEl.querySelector<HTMLElement>(
      `.jects-pivot__chip[data-field="${cssEscape(field)}"][data-axis="${to}"]`,
    );
    moved?.focus();
  }

  /** Toggle the picked-up visual + aria state on a chip without a full rebuild. */
  private markPicked(field: string, axis: PivotAxis | 'source', on: boolean): void {
    const chip = this.panelEl.querySelector<HTMLElement>(
      `.jects-pivot__chip[data-field="${cssEscape(field)}"][data-axis="${axis}"]`,
    );
    if (!chip) return;
    chip.setAttribute('aria-grabbed', on ? 'true' : 'false');
    chip.classList.toggle('jects-pivot__chip--picked', on);
  }

  private makeValueChip(v: ValueAssignment): HTMLElement {
    const chip = this.makeChip(v.field, this.labelOf(v.field), 'values');
    // Aggregator selector.
    const sel = createEl('select', { className: 'jects-pivot__chip-agg' });
    sel.setAttribute('aria-label', `Aggregation for ${this.labelOf(v.field)}`);
    for (const agg of VALUE_AGGS) {
      const opt = createEl('option');
      opt.value = agg;
      opt.textContent = agg;
      if (agg === v.aggregator) opt.selected = true;
      sel.appendChild(opt);
    }
    // Include any custom (non-built-in) aggregator already chosen.
    if (!VALUE_AGGS.includes(v.aggregator as AggregatorName)) {
      const opt = createEl('option');
      opt.value = String(v.aggregator);
      opt.textContent = String(v.aggregator);
      opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      v.aggregator = sel.value;
      this.recompute();
    });
    chip.insertBefore(sel, chip.querySelector('.jects-pivot__chip-remove'));
    return chip;
  }

  private makeDropTarget(zone: HTMLElement, axis: PivotAxis | 'source'): void {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('jects-pivot__zone--over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('jects-pivot__zone--over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('jects-pivot__zone--over');
      const raw = e.dataTransfer?.getData('text/plain');
      if (!raw) return;
      let parsed: { field: string; from: PivotAxis | 'source' };
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      this.moveField(parsed.field, parsed.from, axis);
    });
  }

  /** Move a field from one axis to another (drag drop or programmatic). */
  moveField(field: string, from: PivotAxis | 'source', to: PivotAxis | 'source'): void {
    if (from === to) return;
    // Remove from source axis state.
    if (from !== 'source') this.detach(field, from);
    // Add to target.
    if (to === 'rows' && !this.assignRows.includes(field)) this.assignRows.push(field);
    else if (to === 'columns' && !this.assignCols.includes(field)) this.assignCols.push(field);
    else if (to === 'values' && !this.assignValues.some((v) => v.field === field)) {
      const spec = this.fieldSpecs.find((f) => f.field === field);
      this.assignValues.push({ field, aggregator: spec?.aggregator ?? 'sum' });
    } else if (to === 'filters' && !this.assignFilters.some((f) => f.field === field)) {
      this.assignFilters.push({
        field: field as keyof Row & string,
        operator: this.config.defaultFilterOperator ?? 'notempty',
      });
    }
    this.rebuildPanel();
    if (to !== 'source') this.emit('configChange', { axis: to, pivot: this });
    this.recompute();
  }

  private removeField(field: string, axis: PivotAxis): void {
    this.detach(field, axis);
    this.rebuildPanel();
    this.recompute();
  }

  private detach(field: string, axis: PivotAxis): void {
    if (axis === 'rows') this.assignRows = this.assignRows.filter((f) => f !== field);
    else if (axis === 'columns') this.assignCols = this.assignCols.filter((f) => f !== field);
    else if (axis === 'values') this.assignValues = this.assignValues.filter((v) => v.field !== field);
    else if (axis === 'filters') this.assignFilters = this.assignFilters.filter((f) => f.field !== field);
  }

  private labelOf(field: string): string {
    return this.fieldSpecs.find((f) => f.field === field)?.label ?? field;
  }

  /** The composed Grid instance (for advanced consumers). */
  getGrid(): Grid<PivotGridRow> | null {
    return this.grid;
  }
}

/**
 * Coerce a text filter input to a number when it parses cleanly (so numeric
 * comparisons like `gt`/`lt` work against numeric fields), else keep the string.
 */
function coerceFilterValue(raw: string): string | number {
  const trimmed = raw.trim();
  if (trimmed === '') return trimmed;
  const n = Number(trimmed);
  return Number.isFinite(n) && String(n) === trimmed ? n : trimmed;
}

/** Escape a string for safe use inside a CSS attribute selector. */
function cssEscape(value: string): string {
  const css = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS;
  if (css?.escape) return css.escape(value);
  return value.replace(/["\\\]]/g, '\\$&');
}

/** Infer field specs from the keys of the first data row. */
function inferFields(data: Model[]): PivotFieldSpec[] {
  const first = data[0];
  if (!first) return [];
  return Object.keys(first)
    .filter((k) => !k.startsWith('__'))
    .map((field) => ({ field }));
}

register(
  'pivottable',
  PivotTable as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => PivotTable,
);
