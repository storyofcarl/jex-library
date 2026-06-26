/**
 * QuickSearch render hook — wires the active {@link QuickSearchFeature} into the
 * renderer's default text-cell painting so matched substrings are visually
 * highlighted in painted cells (parity with Bryntum/DHTMLX QuickFind, where the
 * matched text is marked inline as you type).
 *
 * The default {@link DomRenderer.paintCell} writes plain `textContent` for
 * text/tree/check cells, which means {@link QuickSearchFeature.highlight} was
 * only ever reachable from a *custom* `renderer`. This module closes that gap:
 * the renderer calls {@link applyQuickSearchHighlight} for its default text
 * branches, which consults `api.features.get('quickSearch')` and, when a search
 * is active and the cell value matches, replaces the cell's plain text with the
 * feature's escaped `<mark>` markup and tags the cell so CSS + AT can perceive
 * the match.
 *
 * Design constraints honoured:
 *  - **Duck-typed surface** (`QuickSearchHighlighter`) — the hook never imports
 *    the concrete feature class, so the renderer stays decoupled from the
 *    feature module and there is no import cycle (renderer ⇄ features).
 *  - **HTML-safe** — the feature's `highlight()` escapes every non-matched span
 *    before wrapping matches, so assigning the result to `innerHTML` is safe.
 *  - **Idempotent / recycling-safe** — when no search is active (or the cell
 *    does not match) the hook *clears* any stale highlight a recycled pooled
 *    cell carried, restoring plain text. Calling it twice yields the same DOM.
 *  - **Token-pure CSS** — visual styling lives in `features.css`
 *    (`.jects-grid-search__hl`, `.jects-grid__cell--search-match`); this module
 *    only toggles classes / attributes.
 */

import type { Model } from '@jects/core';
import type { GridApi } from '../contract.js';

/** CSS class applied to a cell whose value matches the active quick-search. */
export const SEARCH_MATCH_CELL_CLASS = 'jects-grid__cell--search-match';

/**
 * Minimal surface the highlight hook needs from a quick-search feature. The
 * concrete {@link QuickSearchFeature} satisfies this structurally, so the
 * renderer can consume it without a static dependency on the feature module.
 */
export interface QuickSearchHighlighter {
  /** Whether a (non-whitespace) query is currently active. */
  isActive(): boolean;
  /** Does this cell value contain the active query? */
  matchesCell(value: unknown): boolean;
  /**
   * Wrap each occurrence of the query within `text` in a highlight `<mark>`.
   * MUST return HTML-safe markup (non-matched spans escaped).
   */
  highlight(text: string): string;
}

/** Structural type guard for the quick-search highlighter surface. */
export function isQuickSearchHighlighter(value: unknown): value is QuickSearchHighlighter {
  if (value == null || typeof value !== 'object') return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f['isActive'] === 'function' &&
    typeof f['matchesCell'] === 'function' &&
    typeof f['highlight'] === 'function'
  );
}

/**
 * Resolve the active quick-search highlighter from a grid api, or `null` when
 * no quick-search feature is installed / it is not active.
 *
 * Returns `null` (not the feature) when inactive so callers can take the cheap
 * "plain text" path without a second `isActive()` call.
 */
export function getActiveQuickSearch<Row extends Model>(
  api: Partial<Pick<GridApi<Row>, 'features'>>,
): QuickSearchHighlighter | null {
  // Tolerate a partial api (e.g. a renderer test stub) that omits `features`:
  // a missing/incompatible registry simply means "no quick-search active".
  const features = api.features;
  if (features == null || typeof features.get !== 'function') return null;
  const feature = features.get('quickSearch');
  if (!isQuickSearchHighlighter(feature)) return null;
  return feature.isActive() ? feature : null;
}

/**
 * Apply (or clear) quick-search highlighting on a default-rendered text cell.
 *
 * Call this from the renderer immediately after it has written the cell's plain
 * `textContent` for a text/tree-label/check value. It is a no-op fast path when
 * no search is active.
 *
 * @param cellEl  The cell (text branch) or inner label element being painted.
 * @param text    The plain string the cell currently displays.
 * @param search  The active highlighter, or `null` (resolve via
 *                {@link getActiveQuickSearch}). Passing `null` clears any stale
 *                highlight a recycled cell carried and leaves `text` as-is.
 * @returns `true` if a highlight was applied (cell value matched), else `false`.
 */
export function applyQuickSearchHighlight(
  cellEl: HTMLElement,
  text: string,
  search: QuickSearchHighlighter | null,
): boolean {
  // Clear any stale highlight from a recycled pooled cell first. We only touch
  // the DOM when the cell actually carried a previous match (className check is
  // cheap; `replaceChildren`/innerHTML writes are not), keeping the hot path
  // allocation-free for the overwhelming majority of non-matching cells.
  const hadMatch = cellEl.classList.contains(SEARCH_MATCH_CELL_CLASS);

  if (!search || !text || !search.matchesCell(text)) {
    if (hadMatch) {
      cellEl.classList.remove(SEARCH_MATCH_CELL_CLASS);
      cellEl.removeAttribute('data-search-match');
      // Restore plain text: the highlighted markup must be torn down so the
      // recycled cell shows its (possibly new) value verbatim.
      cellEl.textContent = text;
    }
    return false;
  }

  // Active match: replace the plain text node with the feature's escaped
  // `<mark>` markup. `highlight()` HTML-escapes every non-matched span, so this
  // is XSS-safe even for values containing `<`, `>`, `&`, or quotes.
  cellEl.innerHTML = search.highlight(text);
  cellEl.classList.add(SEARCH_MATCH_CELL_CLASS);
  // A non-visual hook for AT / tests / custom styling to detect a match without
  // re-running the matcher.
  cellEl.dataset['searchMatch'] = '';
  return true;
}
