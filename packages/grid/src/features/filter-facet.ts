/**
 * FilterFacetFeature — an Excel-style faceted (set / checklist) filter popup.
 *
 * Bryntum/DHTMLX (and Excel, AG-Grid) ship a "set filter": a column dropdown
 * that lists the column's DISTINCT values, each with a checkbox, plus a search
 * box, "Select all" toggle, and Apply/Clear actions. Checking a subset produces
 * an `in` `FilterState`; unchecking everything shows no rows; checking all is
 * treated as "no filter".
 *
 * This feature renders that popup, reusing the @jects/widgets `Checkbox` control
 * for each value, and integrates with the column's {@link FilterFeature}:
 *   - distinct values come from `FilterFeature.getFacet(columnId)`, which is
 *     computed over the view filtered by every OTHER column (so the checklist
 *     reflects what is in scope), and
 *   - applying writes back through `FilterFeature.setFacetSelection(...)`, which
 *     emits the contract `filterChange` event and repaints the grid.
 *
 * When no `FilterFeature` is installed, the popup falls back to driving the
 * backing `Store` directly with an `in`-style predicate, so it still works
 * standalone.
 *
 * Design mirrors `ColumnPickerFeature`: a light-DOM `role="dialog"` popup
 * appended to the grid root, fully keyboard operable (Escape closes, outside
 * pointerdown closes, Tab focus trapped), opened from a header trigger carrying
 * `data-filter-facet="<columnId>"`. Everything it creates (popup DOM, Checkbox
 * widgets, document listeners) is released on `destroy()` via the shared
 * `Disposers` bag.
 */

import type { EventMap, Model } from '@jects/core';
import { createEl, EventEmitter } from '@jects/core';
import { Checkbox } from '@jects/widgets';
import type { ColumnDef, FilterState, GridApi, GridFeature } from '../contract.js';
import { Disposers, colId } from './shared.js';
import {
  type FacetValue,
  type FilterFeature,
  computeFacet,
  makeFilterPredicate,
} from './filter.js';

/** Resolve a column's user-facing header label (falls back to id/field). */
function columnLabel<Row extends Model>(col: ColumnDef<Row>): string {
  if (typeof col.header === 'string' && col.header.trim() !== '') return col.header;
  return colId(col);
}

/** A typed event surface for the facet popup (independent of the grid bus). */
export interface FilterFacetEvents extends EventMap {
  /** The popup opened for a column. */
  facetOpen: { columnId: string };
  /** The popup closed. */
  facetClose: { columnId: string };
  /**
   * Vetoable: a facet selection is about to be applied. Return `false` to keep
   * the current filter (the popup stays open).
   */
  beforeFacetApply: { columnId: string; selectedKeys: string[] };
  /** A facet selection was applied (after the filter was written). */
  facetApply: { columnId: string; selectedKeys: string[]; cleared: boolean };
}

export interface FilterFacetFeatureOptions {
  /** Sort order of the value list. Default `'value'` (type-aware ascending). */
  sort?: 'value' | 'count' | 'none';
  /** Show the per-value occurrence count badge. Default `true`. */
  showCounts?: boolean;
  /** Show the search box above the list. Default `true`. */
  searchable?: boolean;
  /** Show the "Select all" tri-state master checkbox. Default `true`. */
  selectAll?: boolean;
  /**
   * Apply mode:
   *  - `'apply'` (default): edits are staged; an Apply button commits them.
   *  - `'live'`: every toggle commits immediately (no Apply button).
   */
  applyMode?: 'apply' | 'live';
  /** Override the label shown for a value. Default `String(value)`. */
  label?: (value: unknown) => string;
}

export class FilterFacetFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'filterFacet';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();
  private readonly events = new EventEmitter<FilterFacetEvents>();

  private readonly sort: 'value' | 'count' | 'none';
  private readonly showCounts: boolean;
  private readonly searchable: boolean;
  private readonly showSelectAll: boolean;
  private readonly applyMode: 'apply' | 'live';
  private readonly labelFn?: (value: unknown) => string;

  private popup: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private columnId: string | null = null;
  private facet: FacetValue[] = [];
  /** Staged selection (value-keys). Mirrors the on-screen checkboxes. */
  private staged = new Set<string>();
  private search = '';
  private selectAllBox: Checkbox | null = null;
  private readonly rowBoxes = new Map<string, Checkbox>();
  private outside: ((e: Event) => void) | null = null;
  private trap: ((e: KeyboardEvent) => void) | null = null;

  constructor(options: FilterFacetFeatureOptions = {}) {
    this.sort = options.sort ?? 'value';
    this.showCounts = options.showCounts ?? true;
    this.searchable = options.searchable ?? true;
    this.showSelectAll = options.selectAll ?? true;
    this.applyMode = options.applyMode ?? 'apply';
    if (options.label) this.labelFn = options.label;
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());
    this.disposers.add(() => this.close());
    this.disposers.add(() => this.events.clear());

    // A header trigger carrying `data-filter-facet="<columnId>"` opens the popup.
    const onClick = (e: Event): void => this.handleTrigger(e as MouseEvent);
    grid.el.addEventListener('click', onClick);
    this.disposers.add(() => grid.el.removeEventListener('click', onClick));

    // If the columns change underneath an open popup, close it (its data is stale).
    const offReorder = grid.on('columnReorder', () => this.close());
    this.disposers.add(offReorder);
  }

  /* ── typed event surface ───────────────────────────────────────────────── */

  on<K extends keyof FilterFacetEvents>(
    event: K,
    fn: (payload: FilterFacetEvents[K]) => unknown,
  ): () => void {
    return this.events.on(event, fn);
  }

  off<K extends keyof FilterFacetEvents>(
    event: K,
    fn?: (payload: FilterFacetEvents[K]) => unknown,
  ): void {
    this.events.off(event, fn);
  }

  /* ── public API ────────────────────────────────────────────────────────── */

  /** Whether the facet popup is currently open. */
  isOpen(): boolean {
    return this.popup != null;
  }

  /** The column id the popup is currently open for, or `null`. */
  openColumn(): string | null {
    return this.columnId;
  }

  /** Toggle the popup for a column at a screen position. */
  toggle(columnId: string, x?: number, y?: number): void {
    if (this.popup && this.columnId === columnId) this.close();
    else this.open(columnId, x, y);
  }

  /** Open the facet popup for a column. */
  open(columnId: string, x = 0, y = 0): void {
    const column = this.api.getColumn(columnId);
    if (!column) return;
    this.close();
    this.columnId = columnId;

    // Compute distinct values + the current selection.
    this.facet = this.computeFacetFor(columnId);
    this.staged = new Set(this.facet.filter((f) => f.selected).map((f) => f.key));
    this.search = '';

    const popup = createEl('div', { className: 'jects-grid-facet' });
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', `Filter ${columnLabel(column)}`);
    popup.style.position = 'fixed';
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;

    const heading = createEl('div', { className: 'jects-grid-facet__title' });
    heading.id = `${this.name}-title-${Math.random().toString(36).slice(2, 8)}`;
    heading.textContent = columnLabel(column);
    popup.setAttribute('aria-labelledby', heading.id);
    popup.appendChild(heading);

    if (this.searchable) {
      const searchWrap = createEl('div', { className: 'jects-grid-facet__search' });
      const input = createEl('input', { className: 'jects-grid-facet__search-input' });
      input.type = 'search';
      input.setAttribute('aria-label', `Search ${columnLabel(column)} values`);
      input.placeholder = 'Search…';
      input.addEventListener('input', () => {
        this.search = input.value;
        this.rebuildList();
      });
      searchWrap.appendChild(input);
      popup.appendChild(searchWrap);
    }

    if (this.showSelectAll) {
      const allWrap = createEl('div', { className: 'jects-grid-facet__selectall' });
      const allBox = new Checkbox(allWrap, { label: 'Select all', checked: true });
      allBox.on('change', ({ checked }) => this.setAll(checked));
      this.selectAllBox = allBox;
      popup.appendChild(allWrap);
    }

    const list = createEl('div', { className: 'jects-grid-facet__list' });
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', `${columnLabel(column)} values`);
    popup.appendChild(list);
    this.listEl = list;

    const actions = createEl('div', { className: 'jects-grid-facet__actions' });
    if (this.applyMode === 'apply') {
      const apply = this.actionButton('Apply', 'jects-grid-facet__apply', () => this.apply());
      const cancel = this.actionButton('Cancel', 'jects-grid-facet__cancel', () => this.close());
      actions.append(cancel, apply);
    } else {
      const clear = this.actionButton('Clear', 'jects-grid-facet__cancel', () => {
        this.setAll(true);
        this.apply();
      });
      actions.append(clear);
    }
    popup.appendChild(actions);

    this.api.el.appendChild(popup);
    this.popup = popup;

    this.rebuildList();
    this.installDismissers(popup);

    const first = popup.querySelector<HTMLElement>('input, button');
    first?.focus();

    this.events.emit('facetOpen', { columnId });
  }

  /** Close the popup and dispose its widgets/listeners. */
  close(): void {
    if (this.outside) {
      document.removeEventListener('pointerdown', this.outside, true);
      document.removeEventListener('keydown', this.outside, true);
      this.outside = null;
    }
    if (this.trap && this.popup) {
      this.popup.removeEventListener('keydown', this.trap);
      this.trap = null;
    }
    for (const cb of this.rowBoxes.values()) cb.destroy();
    this.rowBoxes.clear();
    this.selectAllBox?.destroy();
    this.selectAllBox = null;
    const had = this.popup != null;
    const closedColumn = this.columnId;
    this.popup?.remove();
    this.popup = null;
    this.listEl = null;
    this.columnId = null;
    this.facet = [];
    this.staged = new Set();
    if (had && closedColumn) this.events.emit('facetClose', { columnId: closedColumn });
  }

  /** Toggle one value-key in the staged selection (live-applies in live mode). */
  toggleValue(key: string, checked: boolean): void {
    if (checked) this.staged.add(key);
    else this.staged.delete(key);
    this.syncSelectAll();
    if (this.applyMode === 'live') this.apply();
  }

  /** Check or uncheck every (currently filtered-in) value. */
  setAll(checked: boolean): void {
    // Operate over the search-filtered visible values, like Excel's "Select all".
    for (const f of this.visibleFacet()) {
      if (checked) this.staged.add(f.key);
      else this.staged.delete(f.key);
    }
    for (const f of this.visibleFacet()) {
      this.rowBoxes.get(f.key)?.update({ checked });
    }
    this.syncSelectAll();
    if (this.applyMode === 'live') this.apply();
  }

  /**
   * Commit the staged selection: writes an `in` filter (or clears it when all
   * values are selected). Honours the vetoable `beforeFacetApply` event.
   */
  apply(): boolean {
    const columnId = this.columnId;
    if (!columnId) return false;
    const selectedKeys = [...this.staged];
    if (this.events.emit('beforeFacetApply', { columnId, selectedKeys }) === false) {
      return false;
    }

    const allKeys = this.facet.map((f) => f.key);
    const allSelected = allKeys.length > 0 && allKeys.every((k) => this.staged.has(k));
    const cleared = allSelected;

    const filter = this.api.features.get('filter') as FilterFeature<Row> | undefined;
    if (filter) {
      filter.setFacetSelection(columnId, allSelected ? null : new Set(this.staged));
    } else {
      this.applyStandalone(columnId, allSelected);
    }

    this.events.emit('facetApply', { columnId, selectedKeys, cleared });
    if (this.applyMode === 'apply') this.close();
    return true;
  }

  /* ── internal: distinct-value computation ──────────────────────────────── */

  private computeFacetFor(columnId: string): FacetValue[] {
    const filter = this.api.features.get('filter') as FilterFeature<Row> | undefined;
    const opts = {
      sort: this.sort,
      ...(this.labelFn ? { label: this.labelFn } : {}),
    } as const;
    if (filter) return filter.getFacet(columnId, opts);

    // Standalone: facet over the FULL store dataset (`serialize`, not the live
    // filtered view), all-selected (no FilterFeature state to read).
    const column = this.api.getColumn(columnId);
    if (!column) return [];
    return computeFacet(this.api.store.serialize(), column, null, opts);
  }

  /** Standalone (no FilterFeature) — drive the store directly with an `in`. */
  private applyStandalone(columnId: string, allSelected: boolean): void {
    const column = this.api.getColumn(columnId);
    if (!column) return;
    if (allSelected) {
      this.api.store.clearFilters();
      this.api.refresh();
      this.api.emit('filterChange', { filter: [] });
      return;
    }
    const chosen = this.facet.filter((f) => this.staged.has(f.key)).map((f) => f.value);
    const predicate = makeFilterPredicate(column, 'in', chosen, false);
    this.api.store.filter((row: Row) => predicate(row));
    this.api.refresh();
    const state: FilterState = { columnId, operator: 'in', value: chosen };
    this.api.emit('filterChange', { filter: [state] });
  }

  /* ── internal: list rendering ──────────────────────────────────────────── */

  private visibleFacet(): FacetValue[] {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.facet;
    return this.facet.filter((f) => f.label.toLowerCase().includes(q));
  }

  private rebuildList(): void {
    const list = this.listEl;
    if (!list) return;
    for (const cb of this.rowBoxes.values()) cb.destroy();
    this.rowBoxes.clear();
    list.replaceChildren();

    const visible = this.visibleFacet();
    if (visible.length === 0) {
      const empty = createEl('div', { className: 'jects-grid-facet__empty' });
      empty.textContent = 'No matching values';
      list.appendChild(empty);
      this.syncSelectAll();
      return;
    }

    for (const f of visible) {
      const row = createEl('div', { className: 'jects-grid-facet__row' });
      row.dataset['facetKey'] = f.key;

      const cbHost = createEl('span', { className: 'jects-grid-facet__check' });
      const cb = new Checkbox(cbHost, {
        label: f.label,
        checked: this.staged.has(f.key),
      });
      cb.on('change', ({ checked }) => this.toggleValue(f.key, checked));
      this.rowBoxes.set(f.key, cb);
      row.appendChild(cbHost);

      if (this.showCounts) {
        const count = createEl('span', { className: 'jects-grid-facet__count' });
        count.textContent = String(f.count);
        count.setAttribute('aria-hidden', 'true');
        row.appendChild(count);
      }

      list.appendChild(row);
    }
    this.syncSelectAll();
  }

  /** Reflect the tri-state of the master "Select all" checkbox. */
  private syncSelectAll(): void {
    if (!this.selectAllBox) return;
    const visible = this.visibleFacet();
    const checkedCount = visible.filter((f) => this.staged.has(f.key)).length;
    if (checkedCount === 0) {
      this.selectAllBox.update({ checked: false, indeterminate: false });
    } else if (checkedCount === visible.length) {
      this.selectAllBox.update({ checked: true, indeterminate: false });
    } else {
      this.selectAllBox.update({ checked: false, indeterminate: true });
    }
  }

  /* ── internal: dismissers + helpers ────────────────────────────────────── */

  private actionButton(text: string, cls: string, onClick: () => void): HTMLButtonElement {
    const btn = createEl('button', { className: `jects-grid-facet__action ${cls}` });
    btn.type = 'button';
    btn.textContent = text;
    btn.addEventListener('click', () => onClick());
    return btn;
  }

  private installDismissers(popup: HTMLElement): void {
    const outside = (e: Event): void => {
      if (e.type === 'keydown') {
        if ((e as KeyboardEvent).key === 'Escape') this.close();
        return;
      }
      if (this.popup && this.popup.contains(e.target as Node)) return;
      const trigger = (e.target as HTMLElement | null)?.closest?.('[data-filter-facet]');
      if (trigger) return;
      this.close();
    };
    this.outside = outside;
    setTimeout(() => {
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', outside, true);
    }, 0);

    const trap = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const focusables = popup.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    this.trap = trap;
    popup.addEventListener('keydown', trap);
  }

  private handleTrigger(event: MouseEvent): void {
    const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-filter-facet]');
    if (!trigger) return;
    const columnId = trigger.dataset['filterFacet'];
    if (!columnId) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.popup && this.columnId === columnId) {
      this.close();
      return;
    }
    const rect = trigger.getBoundingClientRect();
    this.open(columnId, rect.left, rect.bottom);
  }

  destroy(): void {
    this.disposers.dispose();
  }
}

/** Convenience factory. */
export function filterFacetFeature<Row extends Model = Model>(
  options?: FilterFacetFeatureOptions,
): FilterFacetFeature<Row> {
  return new FilterFacetFeature<Row>(options);
}
