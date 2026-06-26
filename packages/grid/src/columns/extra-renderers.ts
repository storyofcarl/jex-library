/**
 * Additional typed cell renderers — `rating`, `widget`, and `rownumber` — that
 * extend the built-in renderer set (text/number/date/check/action) to reach
 * Bryntum/DHTMLX column-type parity.
 *
 *   - `rating`     ★ star rating, optionally editable (click / keyboard) — writes
 *                  the new value back through `ctx.api.store.update`, mirroring
 *                  Bryntum's `RatingColumn`.
 *   - `widget`     mounts an arbitrary @jects/widgets control per cell (built via
 *                  the @jects/core factory) — the analogue of Bryntum's
 *                  `WidgetColumn`. Per-row config can be derived from the row.
 *   - `rownumber`  an auto sequential 1-based index that follows the current
 *                  (sorted/filtered) view order, frozen-friendly because it reads
 *                  the renderer's `rowIndex` (Bryntum's `RowNumberColumn`).
 *
 * These are framework-free and produce token-pure DOM (classes only — colors come
 * from CSS in `columns.css`). `registerExtraRenderers(registry)` wires them into a
 * `CellRendererRegistry`; the core registry calls it so the engine resolves them
 * by `column.type` automatically. A per-column `renderer` override still wins.
 */

import { create, createEl, type Model, type RecordId, type Widget } from '@jects/core';
import type {
  CellRenderContext,
  CellRenderer,
  ColumnDef,
  ColumnType,
  GridApi,
} from '../contract.js';

/* ═══════════════════════════════════════════════════════════════════════════
   RATING
   ═══════════════════════════════════════════════════════════════════════════ */

/** Per-column rating config (carried in `column.meta.rating`). */
export interface RatingMeta {
  /** Number of stars. Default `5`. */
  max?: number;
  /** Allow the user to change the rating by click/keyboard. Default `true`. */
  editable?: boolean;
  /** Glyph for a filled star. Default `'★'`. */
  filledChar?: string;
  /** Glyph for an empty star. Default `'☆'`. */
  emptyChar?: string;
  /** Accessible label prefix; the value/max is appended. Default `'Rating'`. */
  label?: string;
  /**
   * Called when the user changes the rating. When omitted and the column has a
   * `field`, the new value is written back via `api.store.update(id, {field})`.
   * Return `false` to veto the write.
   */
  onChange?: (payload: {
    value: number;
    row: Model;
    rowIndex: number;
    api: GridApi;
  }) => boolean | void;
}

const DEFAULT_RATING: Required<Pick<RatingMeta, 'max' | 'editable' | 'filledChar' | 'emptyChar' | 'label'>> = {
  max: 5,
  editable: true,
  filledChar: '★',
  emptyChar: '☆',
  label: 'Rating',
};

/** Coerce a cell value to a clamped integer rating in `[0, max]`. */
export function coerceRating(value: unknown, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.round(n)));
}

function ratingMetaOf(ctx: CellRenderContext): RatingMeta {
  return (ctx.column.meta as { rating?: RatingMeta } | undefined)?.rating ?? {};
}

/**
 * Persist a new rating: prefer the column's `onChange` (vetoable), otherwise
 * write `field = value` to the backing store. Returns the value actually applied
 * (unchanged on veto).
 */
function commitRating(ctx: CellRenderContext, next: number): number {
  const meta = ratingMetaOf(ctx);
  if (meta.onChange) {
    const res = meta.onChange({ value: next, row: ctx.row, rowIndex: ctx.rowIndex, api: ctx.api });
    if (res === false) return coerceRating(ctx.value, meta.max ?? DEFAULT_RATING.max);
  } else if (ctx.column.field && ctx.api?.store) {
    const idField = ctx.api.store.idField;
    const id = (ctx.row as Record<string, unknown>)[idField] as RecordId;
    ctx.api.store.update(id, { [ctx.column.field]: next } as Partial<Model>);
  }
  return next;
}

/**
 * Rating renderer. Paints a row of star buttons inside a `radiogroup`. When
 * editable, clicking a star (or arrow-key navigation on a focused star) sets the
 * rating and writes it back; a click on the currently-selected single star clears
 * to zero (matching Bryntum's toggle-off behavior).
 */
export const ratingRenderer: CellRenderer = (ctx) => {
  const meta = ratingMetaOf(ctx);
  const max = meta.max ?? DEFAULT_RATING.max;
  const editable = meta.editable ?? DEFAULT_RATING.editable;
  const filled = meta.filledChar ?? DEFAULT_RATING.filledChar;
  const empty = meta.emptyChar ?? DEFAULT_RATING.emptyChar;
  const labelPrefix = meta.label ?? DEFAULT_RATING.label;

  let value = coerceRating(ctx.value, max);

  ctx.el.textContent = '';
  ctx.el.classList.add('jects-grid-cell--rating');

  const group = createEl('span', {
    className: `jects-grid-rating${editable ? ' jects-grid-rating--editable' : ''}`,
    attrs: {
      role: 'radiogroup',
      'aria-label': `${labelPrefix}: ${value} of ${max}`,
    },
  });

  const stars: HTMLElement[] = [];

  const paint = (v: number): void => {
    value = v;
    group.setAttribute('aria-label', `${labelPrefix}: ${v} of ${max}`);
    stars.forEach((star, i) => {
      const on = i < v;
      star.textContent = on ? filled : empty;
      star.classList.toggle('jects-grid-rating__star--on', on);
      star.setAttribute('aria-checked', String(i + 1 === v));
      // Roving tabindex: the selected star (or the first when none) is tabbable.
      const tabbable = editable && (v === 0 ? i === 0 : i + 1 === v);
      star.setAttribute('tabindex', tabbable ? '0' : '-1');
    });
  };

  const setValue = (next: number): void => {
    const clamped = Math.max(0, Math.min(max, next));
    if (clamped === value) return;
    paint(commitRating(ctx, clamped));
  };

  for (let i = 0; i < max; i++) {
    const starValue = i + 1;
    const star = createEl(editable ? 'button' : 'span', {
      className: 'jects-grid-rating__star',
      attrs: {
        role: 'radio',
        'aria-label': `${starValue} ${starValue === 1 ? 'star' : 'stars'}`,
        ...(editable ? { type: 'button' } : { 'aria-hidden': 'false' }),
      },
    });
    if (editable) {
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        // Clicking the only filled star toggles the rating off (→ 0).
        setValue(value === starValue && starValue === 1 ? 0 : starValue);
      });
      star.addEventListener('keydown', (e) => {
        const key = (e as KeyboardEvent).key;
        if (key === 'ArrowRight' || key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          setValue(Math.min(max, value + 1));
          stars[Math.min(max, value) - 1]?.focus();
        } else if (key === 'ArrowLeft' || key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          setValue(Math.max(0, value - 1));
          stars[Math.max(0, value - 1)]?.focus();
        } else if (key === ' ' || key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          setValue(starValue);
        }
      });
    }
    stars.push(star);
    group.appendChild(star);
  }

  paint(value);
  ctx.el.appendChild(group);
};

/* ═══════════════════════════════════════════════════════════════════════════
   WIDGET COLUMN
   ═══════════════════════════════════════════════════════════════════════════ */

/** A `{ type, ...config }` config for an @jects/widgets control. */
export interface WidgetCellConfig {
  type: string;
  [key: string]: unknown;
}

/** Per-column widget config (carried in `column.meta.widget`). */
export interface WidgetCellMeta<Row extends Model = Model> {
  /**
   * The control config to mount in every cell of this column. Either a static
   * `{ type, ...config }` object, or a factory that derives it from the row.
   */
  widget?: WidgetCellConfig | ((ctx: CellRenderContext<Row>) => WidgetCellConfig);
  /**
   * Called after the control is constructed (and before it is appended), e.g. to
   * wire events. The returned disposers (if any) are tracked and run on teardown.
   */
  onMount?: (widget: Widget, ctx: CellRenderContext<Row>) => void | (() => void) | Array<() => void>;
}

/**
 * Registry of live per-cell widgets keyed by the cell element, so a recycled or
 * repainted cell tears its previous control down (no leaks). Module-scoped and
 * keyed by a WeakMap → entries vanish with their host element automatically; we
 * also destroy eagerly on repaint.
 */
const cellWidgets = new WeakMap<HTMLElement, { widget: Widget; disposers: Array<() => void> }>();

/** Destroy and forget the widget previously mounted in `el` (if any). */
export function destroyCellWidget(el: HTMLElement): void {
  const entry = cellWidgets.get(el);
  if (!entry) return;
  for (const off of entry.disposers) {
    try {
      off();
    } catch {
      /* a disposer must not block teardown */
    }
  }
  try {
    entry.widget.destroy();
  } catch {
    entry.widget.el.remove();
  }
  cellWidgets.delete(el);
}

/**
 * Widget-column renderer. Mounts an @jects/widgets control (via the @jects/core
 * factory) into the cell, destroying any control previously mounted in the same
 * cell first (recycling-safe). The control config is either static or derived
 * per-row, enabling master-detail / per-row buttons / progress bars / etc.
 */
export const widgetCellRenderer: CellRenderer = (ctx) => {
  // Tear down a prior control in this recycled cell before mounting a new one.
  destroyCellWidget(ctx.el);

  const meta = (ctx.column.meta as { widget?: WidgetCellMeta } | undefined)?.widget;
  const source = meta?.widget;
  if (!source) {
    ctx.el.textContent = '';
    return;
  }
  const config = typeof source === 'function' ? source(ctx) : source;
  if (!config || !config.type) {
    ctx.el.textContent = '';
    return;
  }

  ctx.el.textContent = '';
  ctx.el.classList.add('jects-grid-cell--widget');

  let widget: Widget;
  try {
    widget = create(config);
  } catch {
    // Unknown/unregistered type → fail soft to empty cell (engine warns upstream).
    return;
  }

  const disposers: Array<() => void> = [];
  if (meta?.onMount) {
    const res = meta.onMount(widget, ctx);
    if (Array.isArray(res)) disposers.push(...res);
    else if (typeof res === 'function') disposers.push(res);
  }

  widget.el.classList.add('jects-grid-widget');
  cellWidgets.set(ctx.el, { widget, disposers });
  ctx.el.appendChild(widget.el);
};

/* ═══════════════════════════════════════════════════════════════════════════
   SELECT (row-selector checkbox)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Class on the wrapper of a row-selector checkbox cell. */
export const SELECT_CELL_CLASS = 'jects-grid-select';
/** Class on the row-selector `<input type="checkbox">`. */
export const SELECT_INPUT_CLASS = 'jects-grid-select__input';

/**
 * Select-column renderer. Paints a checkbox bound to the grid's selection model
 * (`ctx.api.selection`), so a `type:'select'` column shows per-row selection even
 * without {@link SelectionColumnFeature} installed. The checkbox carries
 * `data-select-row` so the feature's delegated handler (when present) toggles the
 * row; standalone, the engine's own row-selection click path drives it.
 *
 * The markup is intentionally identical to `SelectionColumnFeature.renderSelectCell`
 * (same classes + `data-select-row` attribute) so both spellings interoperate.
 */
export const selectRenderer: CellRenderer = (ctx) => {
  const idField = ctx.api?.store?.idField ?? 'id';
  const id = (ctx.row as Record<string, unknown>)[idField] as RecordId;
  const checked = ctx.api?.selection?.isSelected ? ctx.api.selection.isSelected(id) : false;

  ctx.el.textContent = '';
  ctx.el.classList.add('jects-grid-cell--select');

  const wrap = createEl('label', { className: SELECT_CELL_CLASS });
  const input = createEl('input', { className: SELECT_INPUT_CLASS }) as HTMLInputElement;
  input.type = 'checkbox';
  input.checked = checked;
  input.dataset['selectRow'] = String(id);
  input.setAttribute('aria-label', checked ? 'Deselect row' : 'Select row');
  wrap.appendChild(input);
  ctx.el.appendChild(wrap);
};

/* ═══════════════════════════════════════════════════════════════════════════
   ROW NUMBER
   ═══════════════════════════════════════════════════════════════════════════ */

/** Per-column row-number config (carried in `column.meta.rownumber`). */
export interface RowNumberMeta {
  /** First index value. Default `1` (1-based, like Bryntum/DHTMLX). */
  start?: number;
  /**
   * Map a view row index to its displayed number. Default `i => start + i`.
   * Useful for paged grids (e.g. `i => start + pageOffset + i`).
   */
  format?: (rowIndex: number, start: number) => string | number;
}

/**
 * Row-number renderer. Emits the 1-based sequential index of the row in the
 * current (sorted/filtered) view. Reads `ctx.rowIndex` so the number stays
 * correct under virtualization and is frozen-friendly: a rownumber column is
 * typically pinned (`frozen: 'left'`) and needs no field.
 */
export const rownumberRenderer: CellRenderer = (ctx) => {
  const meta = (ctx.column.meta as { rownumber?: RowNumberMeta } | undefined)?.rownumber ?? {};
  const start = meta.start ?? 1;
  const out = meta.format ? meta.format(ctx.rowIndex, start) : start + ctx.rowIndex;
  ctx.el.textContent = String(out);
  ctx.el.classList.add('jects-grid-cell--rownumber');
};

/* ═══════════════════════════════════════════════════════════════════════════
   REGISTRATION
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Decorate column defs of type `rating`/`widget`/`rownumber` with the matching
 * renderer (unless they already carry a per-column `renderer`).
 *
 * WHY: the production `DomRenderer` paints typed cells by honoring a per-column
 * `def.renderer` (its `tree`/`check` paths are special-cased; everything else
 * falls back to text). So to make the new column TYPES paint in a live Grid
 * without a destructive edit to the renderer, attach their renderer at the
 * column level. Pass your columns through this helper before handing them to the
 * Grid:
 *
 *   new Grid(host, { data, columns: withExtraColumnRenderers(columns) });
 *
 * Non-mutating: returns a new array of (possibly) patched column defs; defs
 * whose type isn't one of the extra kinds (or that already set a `renderer`) are
 * passed through unchanged.
 */
export function withExtraColumnRenderers<Row extends Model = Model>(
  columns: ReadonlyArray<ColumnDef<Row>>,
): ColumnDef<Row>[] {
  return columns.map((col) => {
    if (col.renderer) return col;
    const type = col.type;
    if (type === 'rating' || type === 'widget' || type === 'rownumber' || type === 'select') {
      return { ...col, renderer: EXTRA_RENDERERS[type] as CellRenderer<Row> };
    }
    return col;
  });
}

/** The column types this module adds to the built-in set. */
export const EXTRA_COLUMN_TYPES = ['rating', 'widget', 'rownumber', 'select'] as const;
export type ExtraColumnType = (typeof EXTRA_COLUMN_TYPES)[number];

/** The extra renderers keyed by column type, for direct registration. */
export const EXTRA_RENDERERS: Record<ExtraColumnType, CellRenderer> = {
  rating: ratingRenderer,
  widget: widgetCellRenderer,
  rownumber: rownumberRenderer,
  select: selectRenderer,
};

/**
 * Register the `rating`/`widget`/`rownumber` renderers on a registry-like target
 * that exposes `register(type, renderer)`. Used by `CellRendererRegistry` so the
 * engine resolves the new types automatically; can also be called by consumers
 * who build their own registry.
 */
export function registerExtraRenderers<Row extends Model = Model>(target: {
  register(type: ColumnType, renderer: CellRenderer<Row>): unknown;
}): void {
  for (const [type, fn] of Object.entries(EXTRA_RENDERERS)) {
    target.register(type as ColumnType, fn as CellRenderer<Row>);
  }
}
