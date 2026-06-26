/**
 * `@jects/kanban/editor` — the modal card editor, as a standalone subpath.
 *
 * Additive ES-only subpath barrel. It re-exports the existing flat
 * `../editor.ts` module (the modal card editor that reuses the `@jects/widgets`
 * `Window`) plus the card-shape types its API references. The editor pulls in
 * only its own area — `../card.ts` (for `escapeHtml`) and the type-only
 * `../types.ts` — and does NOT import `../board.ts` or `../data-provider.ts`, so
 * this chunk stays scoped to the editor and never re-bundles the package hub.
 *
 * The main `.` entry (`./index.ts`) is left byte-intact; this barrel is purely
 * additive.
 */

export { openCardEditor } from '../editor.js';

export type {
  KanbanCard,
  CardTag,
  CardAttachment,
  CardComment,
  CardVotes,
} from '../types.js';
