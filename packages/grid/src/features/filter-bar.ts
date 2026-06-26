/**
 * FilterBarFeature — an inline filter row rendered above the grid body.
 *
 * One cell per visible column; each hosts a text/number input (or a select for
 * a chosen operator). As the user types, the bar debounces and pushes a
 * `FilterState` into the shared `FilterFeature` if one is installed, otherwise
 * it applies directly to the store. Either way the grid repaints and a
 * `filterChange` event fires.
 *
 * The bar owns a single DOM element it appends to the grid root and removes on
 * `destroy()`. All listeners go through the disposer bag.
 */

import type { Model } from '@jects/core';
import { createEl } from '@jects/core';
import type { ColumnDef, FilterState, GridApi, GridFeature } from '../contract.js';
import { Disposers, colId, escapeHtml, toNumber } from './shared.js';
import { type FilterFeature, makeFilterPredicate } from './filter.js';

export interface FilterBarFeatureOptions {
  /** Debounce (ms) before a typed value is applied. Default `200`. */
  debounce?: number;
  /** Default operator per column type. */
  defaultOperator?: (column: ColumnDef) => string;
  /** Placeholder text generator. */
  placeholder?: (column: ColumnDef) => string;
}

const operatorForType = (column: ColumnDef): string => {
  switch (column.type) {
    case 'number':
    case 'date':
      return 'eq';
    default:
      return 'contains';
  }
};

export class FilterBarFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'filterBar';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();
  private root: HTMLElement | null = null;
  private readonly inputs = new Map<string, HTMLInputElement>();
  private readonly values = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly debounceMs: number;
  private readonly defaultOperator: (column: ColumnDef) => string;
  private readonly placeholder: (column: ColumnDef) => string;

  constructor(options: FilterBarFeatureOptions = {}) {
    this.debounceMs = options.debounce ?? 200;
    this.defaultOperator = options.defaultOperator ?? operatorForType;
    this.placeholder = options.placeholder ?? ((c) => `Filter ${c.header ?? colId(c)}…`);
  }

  /** Widen a typed column to the Model-shaped option-callback parameter type. */
  private opOf(column: ColumnDef<Row>): string {
    return this.defaultOperator(column as ColumnDef);
  }
  private placeholderOf(column: ColumnDef<Row>): string {
    return this.placeholder(column as ColumnDef);
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());

    this.root = createEl('div', { className: 'jects-grid-filterbar' });
    this.root.setAttribute('role', 'row');
    this.root.setAttribute('aria-label', 'Column filters');
    grid.el.appendChild(this.root);
    this.disposers.add(() => {
      this.root?.remove();
      this.root = null;
    });

    const onInput = (e: Event): void => this.handleInput(e);
    this.root.addEventListener('input', onInput);
    this.disposers.add(() => this.root?.removeEventListener('input', onInput));

    // Rebuild cells whenever columns change.
    const off = grid.on('viewportChange', () => this.syncColumns());
    this.disposers.add(off);
    this.disposers.add(() => {
      if (this.timer != null) clearTimeout(this.timer);
    });

    this.render();
  }

  /** Build the filter cells for the current columns. */
  private render(): void {
    if (!this.root) return;
    this.inputs.clear();
    const cells = this.api.columns
      .filter((c) => !c.hidden)
      .map((c) => this.renderCell(c))
      .join('');
    this.root.innerHTML = cells;
    for (const c of this.api.columns) {
      if (c.hidden) continue;
      const id = colId(c);
      const input = this.root.querySelector<HTMLInputElement>(
        `[data-filter-input="${cssAttr(id)}"]`,
      );
      if (input) {
        this.inputs.set(id, input);
        const v = this.values.get(id);
        if (v != null) input.value = v;
      }
    }
  }

  private renderCell(column: ColumnDef<Row>): string {
    const id = colId(column);
    const filterable = column.filterable !== false && !!column.field;
    const width = column.width != null ? `style="flex:0 0 ${column.width}px"` : 'style="flex:1 1 0"';
    if (!filterable) {
      return `<div class="jects-grid-filterbar__cell jects-grid-filterbar__cell--empty" ${width}></div>`;
    }
    const type = column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text';
    return [
      `<div class="jects-grid-filterbar__cell" ${width}>`,
      `<input class="jects-grid-filterbar__input" type="${type}" `,
      `data-filter-input="${escapeHtml(id)}" `,
      `aria-label="${escapeHtml(`Filter ${column.header ?? id}`)}" `,
      `placeholder="${escapeHtml(this.placeholderOf(column))}" />`,
      `</div>`,
    ].join('');
  }

  private syncColumns(): void {
    // Only rebuild when the visible column set changed.
    const present = new Set(this.inputs.keys());
    const want = this.api.columns.filter((c) => !c.hidden).map((c) => colId(c));
    const changed =
      want.length !== present.size || want.some((id) => !present.has(id));
    if (changed) this.render();
  }

  private handleInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    const id = input.dataset['filterInput'];
    if (!id) return;
    this.values.set(id, input.value);
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.applyColumn(id, input.value);
    }, this.debounceMs);
  }

  /** Apply a single column's bar value immediately (bypasses debounce). */
  applyColumn(columnId: string, rawValue: string): void {
    this.values.set(columnId, rawValue);
    const column = this.api.getColumn(columnId);
    if (!column) return;
    const op = this.opOf(column);
    const value =
      column.type === 'number' ? (rawValue === '' ? null : toNumber(rawValue)) : rawValue;

    const filter = this.api.features.get('filter') as FilterFeature<Row> | undefined;
    if (filter) {
      if (rawValue === '') filter.clear(columnId);
      else filter.setColumnFilter(columnId, op, value);
      return;
    }
    // Standalone: apply directly to the store using all current bar values.
    this.applyStandalone();
  }

  /** Apply every non-empty bar value as a composite predicate (no FilterFeature). */
  private applyStandalone(): void {
    const predicates: Array<(row: Row) => boolean> = [];
    for (const [id, raw] of this.values) {
      if (raw === '') continue;
      const column = this.api.getColumn(id);
      if (!column) continue;
      const op = this.opOf(column);
      const value = column.type === 'number' ? toNumber(raw) : raw;
      if (value == null && column.type === 'number') continue;
      predicates.push(makeFilterPredicate<Row>(column, op, value));
    }
    if (predicates.length === 0) this.api.store.clearFilters();
    else this.api.store.filter((row: Row) => predicates.every((p) => p(row)));
    this.api.refresh();
    this.api.emit('filterChange', {
      filter: this.currentStates(),
    });
  }

  private currentStates(): FilterState[] {
    const out: FilterState[] = [];
    for (const [id, raw] of this.values) {
      if (raw === '') continue;
      const column = this.api.getColumn(id);
      if (!column) continue;
      out.push({
        columnId: id,
        operator: this.opOf(column),
        value: column.type === 'number' ? toNumber(raw) : raw,
      });
    }
    return out;
  }

  /** Programmatically set a bar input's value and apply it. */
  setValue(columnId: string, value: string): void {
    const input = this.inputs.get(columnId);
    if (input) input.value = value;
    this.applyColumn(columnId, value);
  }

  /** Clear all bar inputs and remove the filters they produced. */
  clearAll(): void {
    this.values.clear();
    for (const input of this.inputs.values()) input.value = '';
    const filter = this.api.features.get('filter') as FilterFeature<Row> | undefined;
    if (filter) filter.clear();
    else {
      this.api.store.clearFilters();
      this.api.refresh();
      this.api.emit('filterChange', { filter: [] });
    }
  }

  /** The bar's root element (for engines that want to relocate it). */
  get element(): HTMLElement | null {
    return this.root;
  }

  destroy(): void {
    this.disposers.dispose();
    this.inputs.clear();
    this.values.clear();
  }
}

function cssAttr(s: string): string {
  return s.replace(/(["\\])/g, '\\$1');
}

/** Convenience factory. */
export function filterBarFeature<Row extends Model = Model>(
  options?: FilterBarFeatureOptions,
): FilterBarFeature<Row> {
  return new FilterBarFeature<Row>(options);
}
