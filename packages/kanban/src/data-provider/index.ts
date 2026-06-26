/**
 * `@jects/kanban/data-provider` — the AJAX data provider, as a standalone subpath.
 *
 * Additive ES-only subpath barrel. It re-exports the existing flat
 * `../data-provider.ts` module, which implements `TaskBoardDataProvider` over a
 * REST-ish endpoint. That module imports only the type-only `../types.ts` (plus
 * `@jects/core`, an externalized peer) — it does NOT touch `../board.ts`,
 * `../editor.ts`, or `../card.ts` — so this chunk is fully self-contained and
 * never re-bundles the package hub.
 *
 * The main `.` entry (`./index.ts`) is left byte-intact; this barrel is purely
 * additive.
 */

export { AjaxDataProvider } from '../data-provider.js';
export type { AjaxDataProviderConfig } from '../data-provider.js';

export type {
  KanbanCard,
  CardSyncOp,
  TaskBoardDataProvider,
} from '../types.js';
