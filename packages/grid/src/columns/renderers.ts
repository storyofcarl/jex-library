/**
 * Typed cell renderers — one per built-in `ColumnType` (text/number/date/check/
 * action/template). Each renderer is a pure `CellRenderer` per the frozen
 * contract: given a `CellRenderContext`, it mutates `ctx.el` (or returns
 * string/HTMLElement) to paint the cell.
 *
 * These are framework-free and produce token-pure DOM (classes only — colors come
 * from CSS). They are registered in a small typed registry the engine consults to
 * pick a renderer by column type, with a per-column `renderer` override always
 * winning.
 */

import { createEl, escape, safeHtml, setHtml, trustedHtml, type Model } from '@jects/core';
import type {
  CellRenderContext,
  CellRenderer,
  ColumnDef,
  ColumnType,
} from '../contract.js';
import { registerExtraRenderers } from './extra-renderers.js';

/**
 * Inline check glyph (SVG). We do NOT depend on @jects/icons here so this module
 * stays in @jects/grid's dependency set; callers wanting a different glyph can
 * supply a custom renderer or `iconHtml` on actions.
 */
const CHECK_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
  ' stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M20 6 9 17l-5-5"/></svg>';

/**
 * Escape untrusted text for safe HTML insertion — the shared `@jects/core`
 * `escape` helper, re-exported here as the one obvious tool for **custom
 * cell-renderer authors** (see docs/SECURITY.md surface #2).
 *
 * A `CellRenderer` that returns a *string* has that string set as the cell's
 * `textContent` (so it is escaped automatically). Authors who instead build an
 * HTML string and assign it to `ctx.el.innerHTML` themselves MUST escape every
 * interpolated row value with this helper, e.g.
 * `ctx.el.innerHTML = `<b>${escapeHtml(ctx.value)}</b>``, or route
 * caller-authored markup through `sanitizeHtml` from `@jects/core`.
 */
export const escapeHtml = escape;

/** Coerce any value to a display string (null/undefined → ''). */
export function toText(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

/* ── text ──────────────────────────────────────────────────────────────── */
export const textRenderer: CellRenderer = (ctx) => {
  ctx.el.textContent = toText(ctx.value);
};

/* ── number ────────────────────────────────────────────────────────────── */
/** Per-column numeric formatting hints (carried in `column.meta`). */
export interface NumberFormatMeta {
  /** Fixed decimal places. */
  precision?: number;
  /** Use locale grouping (thousands separators). Default true. */
  grouping?: boolean;
  /** Optional Intl locale. */
  locale?: string;
}

export function formatNumber(value: unknown, meta?: NumberFormatMeta): string {
  if (value == null || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return toText(value);
  const opts: Intl.NumberFormatOptions = {
    useGrouping: meta?.grouping ?? true,
  };
  if (meta?.precision != null) {
    opts.minimumFractionDigits = meta.precision;
    opts.maximumFractionDigits = meta.precision;
  }
  return new Intl.NumberFormat(meta?.locale, opts).format(n);
};

export const numberRenderer: CellRenderer = (ctx) => {
  const meta = (ctx.column.meta as { format?: NumberFormatMeta } | undefined)?.format;
  ctx.el.textContent = formatNumber(ctx.value, meta);
  ctx.el.classList.add('jects-grid-cell--number');
};

/* ── date ──────────────────────────────────────────────────────────────── */
export interface DateFormatMeta {
  /** Intl date style. Default `'medium'`. */
  dateStyle?: 'full' | 'long' | 'medium' | 'short';
  locale?: string;
}

export function toDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: unknown, meta?: DateFormatMeta): string {
  const d = toDate(value);
  if (!d) return '';
  return new Intl.DateTimeFormat(meta?.locale, { dateStyle: meta?.dateStyle ?? 'medium' }).format(d);
}

export const dateRenderer: CellRenderer = (ctx) => {
  const meta = (ctx.column.meta as { format?: DateFormatMeta } | undefined)?.format;
  ctx.el.textContent = formatDate(ctx.value, meta);
};

/* ── check (boolean) ───────────────────────────────────────────────────── */
export const checkRenderer: CellRenderer = (ctx) => {
  const checked = ctx.value === true || ctx.value === 'true' || ctx.value === 1;
  ctx.el.textContent = '';
  const mark = createEl('span', {
    className: `jects-grid-cell__check${checked ? ' jects-grid-cell__check--on' : ''}`,
    attrs: { role: 'img', 'aria-label': checked ? 'checked' : 'unchecked' },
  });
  if (checked) setHtml(mark, trustedHtml(CHECK_SVG));
  ctx.el.appendChild(mark);
};

/* ── action (buttons) ──────────────────────────────────────────────────── */
/** One action button descriptor (carried in `column.meta.actions`). */
export interface CellAction<Row extends Model = Model> {
  /** Stable key emitted on click. */
  key: string;
  /** Optional icon markup (e.g. an SVG string from a caller's icon set). */
  iconHtml?: string;
  /** Accessible label / tooltip. */
  label: string;
  /** Optional click handler (the engine may also listen via delegation). */
  onClick?: (ctx: CellRenderContext<Row>) => void;
}

export const actionRenderer: CellRenderer = (ctx) => {
  const actions =
    (ctx.column.meta as { actions?: CellAction[] } | undefined)?.actions ?? [];
  ctx.el.textContent = '';
  ctx.el.classList.add('jects-grid-cell--action');
  for (const action of actions) {
    const btn = createEl('button', {
      className: 'jects-grid-cell__action',
      attrs: {
        type: 'button',
        'data-action': action.key,
        'aria-label': action.label,
        title: action.label,
      },
    });
    if (action.iconHtml) setHtml(btn, safeHtml(action.iconHtml));
    else btn.textContent = action.label;
    if (action.onClick) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        action.onClick!(ctx);
      });
    }
    ctx.el.appendChild(btn);
  }
};

/* ── registry ──────────────────────────────────────────────────────────── */

/**
 * Built-in renderer map keyed by `ColumnType`. `tree`/`template` are handled in
 * `resolve()` below; `rating`/`widget`/`rownumber` are contributed additively by
 * `columns/extra-renderers.ts` via `registerExtraRenderers` (see the registry
 * constructor) so this core map stays focused on the primitive cell kinds.
 */
const BUILTIN: Record<
  Exclude<ColumnType, 'tree' | 'template' | 'rating' | 'widget' | 'rownumber' | 'select'>,
  CellRenderer
> = {
  text: textRenderer,
  number: numberRenderer,
  date: dateRenderer,
  check: checkRenderer,
  action: actionRenderer,
};

/**
 * A swappable registry of cell renderers by type. The engine constructs one of
 * these and `resolve()`s the active renderer per column, honoring a per-column
 * `renderer` override (and `type: 'template'`).
 */
export class CellRendererRegistry<Row extends Model = Model> {
  private map = new Map<ColumnType, CellRenderer<Row>>();

  constructor() {
    for (const [type, fn] of Object.entries(BUILTIN)) {
      this.map.set(type as ColumnType, fn as CellRenderer<Row>);
    }
    // Additive: pull in the rating/widget/rownumber renderers (parity columns).
    registerExtraRenderers<Row>(this);
  }

  /** Register/override a renderer for a column type. */
  register(type: ColumnType, renderer: CellRenderer<Row>): this {
    this.map.set(type, renderer);
    return this;
  }

  /** Get the built-in renderer for a type (ignores per-column overrides). */
  get(type: ColumnType): CellRenderer<Row> | undefined {
    return this.map.get(type);
  }

  /**
   * Resolve the effective renderer for a column:
   *   1. a per-column `renderer` (always wins — required for `template`)
   *   2. the registered renderer for the column's `type`
   *   3. the text renderer (fallback)
   */
  resolve(column: ColumnDef<Row>): CellRenderer<Row> {
    if (column.renderer) return column.renderer;
    const type = column.type ?? 'text';
    if (type === 'template') {
      // template with no renderer → empty cell (engine should warn upstream).
      return ((ctx: CellRenderContext<Row>) => {
        ctx.el.textContent = '';
      }) as CellRenderer<Row>;
    }
    return this.map.get(type) ?? (textRenderer as CellRenderer<Row>);
  }

  /** Paint a cell using the resolved renderer; applies the result form. */
  paint(ctx: CellRenderContext<Row>): void {
    const renderer = this.resolve(ctx.column);
    const out = renderer(ctx);
    if (typeof out === 'string') {
      ctx.el.textContent = out;
    } else if (out instanceof HTMLElement) {
      ctx.el.textContent = '';
      ctx.el.appendChild(out);
    }
    // `void` → renderer mutated ctx.el directly.
  }
}
