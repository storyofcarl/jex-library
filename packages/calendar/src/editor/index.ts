/**
 * `@jects/calendar/editor` — the standalone modal event editor, as an ESM subpath.
 *
 * This barrel re-exports the package's `../editor.ts` module. That module's
 * runtime imports are the externalized peers `@jects/core` (`createEl`) and
 * `@jects/widgets` (`Window`) plus the pure `date-utils` helpers and the
 * type-only public `contract` — it does NOT import the `Calendar` widget
 * (`calendar.ts`) or the package hub. With the `@jects/*` scope kept external,
 * importing this subpath pulls ONLY the editor area, not the whole bundle.
 */
export { openEventEditor, type EditorOptions, type EditorResult } from '../editor.js';
