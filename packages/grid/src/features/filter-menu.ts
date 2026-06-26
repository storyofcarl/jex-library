/**
 * FilterMenuFeature — a per-column filter operator chooser for @jects/grid
 * (Bryntum/AG-Grid "filter menu" parity).
 *
 * Opens, from a column header's filter trigger (`[data-filter-menu]`) or
 * programmatically, a popup listing the operators applicable to that column's
 * type (text → contains/equals/startsWith…; number/date → comparisons + between;
 * etc.). Choosing an operator that needs an operand reveals an inline input (two
 * inputs for `between`); applying calls the existing {@link FilterFeature}'s
 * `setColumnFilter(columnId, operator, value)`. Nullary operators (`empty`/
 * `notEmpty`) and "Clear filter" apply immediately.
 *
 * This complements the existing `HeaderMenuFeature` (which only had a coarse
 * "Clear filter" item): it provides the actual operator UI. It reuses the same
 * popup conventions (fixed-position host appended to the grid root, outside-click /
 * Escape to close) and confines all interaction to {@link GridApi}. Everything it
 * creates is released on `destroy()`.
 */

import type { Model } from '@jects/core';
import { createEl } from '@jects/core';
import type { ColumnDef, ColumnType, GridApi, GridFeature } from '../contract.js';
import { Disposers } from './shared.js';
import type { FilterFeature, FilterOperator } from './filter.js';

/** Human labels for each operator. */
const OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: 'Equals',
  neq: 'Not equals',
  contains: 'Contains',
  notContains: 'Does not contain',
  startsWith: 'Starts with',
  endsWith: 'Ends with',
  gt: 'Greater than',
  gte: 'Greater than or equal',
  lt: 'Less than',
  lte: 'Less than or equal',
  between: 'Between',
  in: 'Is one of',
  empty: 'Is empty',
  notEmpty: 'Is not empty',
};

/** Operators needing no operand. */
const NULLARY: ReadonlySet<FilterOperator> = new Set(['empty', 'notEmpty']);
/** Operators taking two operands. */
const BINARY: ReadonlySet<FilterOperator> = new Set(['between']);

/** Default operator sets per column type. */
const TEXT_OPS: FilterOperator[] = [
  'contains', 'notContains', 'eq', 'neq', 'startsWith', 'endsWith', 'empty', 'notEmpty',
];
const NUMERIC_OPS: FilterOperator[] = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'notEmpty',
];
const BOOL_OPS: FilterOperator[] = ['eq', 'neq', 'empty', 'notEmpty'];

/** Operators applicable to a column, honoring `column.meta.filterOperators`. */
export function operatorsForColumn<Row extends Model>(column: ColumnDef<Row>): FilterOperator[] {
  const override = (column.meta as { filterOperators?: FilterOperator[] } | undefined)?.filterOperators;
  if (override && override.length) return override;
  const type: ColumnType = column.type ?? 'text';
  switch (type) {
    case 'number':
    case 'date':
    case 'rating':
      return NUMERIC_OPS;
    case 'check':
      return BOOL_OPS;
    default:
      return TEXT_OPS;
  }
}

export interface FilterMenuFeatureOptions {
  /** Open the menu on header contextmenu (right-click) too. Default `false`. */
  openOnContextMenu?: boolean;
}

export class FilterMenuFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'filterMenu';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();
  private readonly openOnContextMenu: boolean;
  private popup: HTMLElement | null = null;
  private outside: ((e: Event) => void) | null = null;

  constructor(options: FilterMenuFeatureOptions = {}) {
    this.openOnContextMenu = options.openOnContextMenu ?? false;
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());
    this.disposers.add(() => this.close());

    const onClick = (e: Event): void => this.handleTrigger(e as MouseEvent);
    grid.el.addEventListener('click', onClick);
    this.disposers.add(() => grid.el.removeEventListener('click', onClick));

    if (this.openOnContextMenu) {
      const onCtx = (e: Event): void => this.handleHeaderContext(e as MouseEvent);
      grid.el.addEventListener('contextmenu', onCtx);
      this.disposers.add(() => grid.el.removeEventListener('contextmenu', onCtx));
    }
  }

  /** The FilterFeature this menu drives (required to apply operators). */
  private filter(): FilterFeature<Row> | undefined {
    return this.api.features.get('filter') as FilterFeature<Row> | undefined;
  }

  /** The operators offered for a column (public for tests / custom triggers). */
  operatorsFor(columnId: string): FilterOperator[] {
    const column = this.api.getColumn(columnId);
    return column ? operatorsForColumn(column) : [];
  }

  /**
   * Apply an operator to a column through the FilterFeature. `between` expects a
   * two-element array value; nullary operators ignore `value`; `null` clears.
   */
  apply(columnId: string, operator: FilterOperator | null, value?: unknown): void {
    const filter = this.filter();
    if (!filter) return;
    if (operator == null) {
      filter.setColumnFilter(columnId, null);
      return;
    }
    if (NULLARY.has(operator)) {
      filter.setColumnFilter(columnId, operator);
      return;
    }
    filter.setColumnFilter(columnId, operator, value);
  }

  /** Open the operator menu for a column at a screen position. */
  openFor(columnId: string, x: number, y: number): void {
    const column = this.api.getColumn(columnId);
    if (!column || column.filterable === false) return;
    if (!this.filter()) return;
    this.close();

    const popup = createEl('div', { className: 'jects-grid-filter-menu' });
    popup.style.position = 'fixed';
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;
    popup.setAttribute('role', 'menu');
    popup.setAttribute('aria-label', `Filter ${column.header ?? columnId}`);

    for (const op of operatorsForColumn(column)) {
      popup.appendChild(this.buildOperatorRow(columnId, op));
    }

    // Clear-filter footer.
    const clear = createEl('button', { className: 'jects-grid-filter-menu__clear' });
    clear.type = 'button';
    clear.textContent = 'Clear filter';
    clear.dataset['filterMenuClear'] = 'true';
    clear.addEventListener('click', (e) => {
      e.stopPropagation();
      this.apply(columnId, null);
      this.close();
    });
    popup.appendChild(clear);

    this.api.el.appendChild(popup);
    this.popup = popup;

    const outside = (e: Event): void => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type !== 'keydown' && this.popup && this.popup.contains(e.target as Node)) return;
      this.close();
    };
    this.outside = outside;
    setTimeout(() => {
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', outside, true);
    }, 0);

    popup.querySelector<HTMLElement>('button, input')?.focus();
  }

  /** Build one operator row: a label button + (for operand operators) inputs. */
  private buildOperatorRow(columnId: string, op: FilterOperator): HTMLElement {
    const row = createEl('div', { className: 'jects-grid-filter-menu__row' });
    row.setAttribute('role', 'group');

    const btn = createEl('button', { className: 'jects-grid-filter-menu__op' });
    btn.type = 'button';
    btn.textContent = OPERATOR_LABELS[op];
    btn.dataset['filterOp'] = op;
    row.appendChild(btn);

    if (NULLARY.has(op)) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.apply(columnId, op);
        this.close();
      });
      return row;
    }

    // Operand input(s) for unary/binary operators.
    const inputs: HTMLInputElement[] = [];
    const mkInput = (placeholder: string): HTMLInputElement => {
      const input = createEl('input', { className: 'jects-grid-filter-menu__input' }) as HTMLInputElement;
      input.type = 'text';
      input.placeholder = placeholder;
      row.appendChild(input);
      inputs.push(input);
      return input;
    };
    if (BINARY.has(op)) {
      mkBindEnter(mkInput('From'), () => applyNow());
      mkBindEnter(mkInput('To'), () => applyNow());
    } else {
      mkBindEnter(mkInput('Value'), () => applyNow());
    }

    const applyNow = (): void => {
      const value = BINARY.has(op)
        ? [inputs[0]?.value ?? '', inputs[1]?.value ?? '']
        : (inputs[0]?.value ?? '');
      this.apply(columnId, op, value);
      this.close();
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      applyNow();
    });
    return row;
  }

  private handleTrigger(event: MouseEvent): void {
    const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-filter-menu]');
    if (!trigger) return;
    const columnId = trigger.dataset['filterMenu'];
    if (!columnId) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = trigger.getBoundingClientRect();
    this.openFor(columnId, rect.left, rect.bottom);
  }

  private handleHeaderContext(event: MouseEvent): void {
    const header = (event.target as HTMLElement).closest<HTMLElement>('[data-header-col]');
    if (!header) return;
    const columnId = header.dataset['headerCol'];
    if (!columnId) return;
    const column = this.api.getColumn(columnId);
    if (!column || column.filterable === false) return;
    event.preventDefault();
    this.openFor(columnId, event.clientX, event.clientY);
  }

  /** Whether the operator popup is currently open. */
  isOpen(): boolean {
    return this.popup != null;
  }

  close(): void {
    if (this.outside) {
      document.removeEventListener('pointerdown', this.outside, true);
      document.removeEventListener('keydown', this.outside, true);
      this.outside = null;
    }
    this.popup?.remove();
    this.popup = null;
  }

  destroy(): void {
    this.disposers.dispose();
  }
}

/** Bind Enter on an input to a callback (kept tiny + local). */
function mkBindEnter(input: HTMLInputElement, fn: () => void): void {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      fn();
    }
  });
}

/** Convenience factory. */
export function filterMenuFeature<Row extends Model = Model>(
  options?: FilterMenuFeatureOptions,
): FilterMenuFeature<Row> {
  return new FilterMenuFeature<Row>(options);
}

export { OPERATOR_LABELS };
