/**
 * @jects/kanban — kanban board (TaskBoard).
 *
 * A draggable TaskBoard with columns + optional swimlanes, template cards
 * (title/description/tags/avatar/progress + custom body items), cross-column /
 * swimlane drag-reorder with multiselect & auto-scroll, WIP/column limits,
 * column collapse/lock/reorder, a modal card editor (reuses @jects/widgets
 * Window) + inline quick-edit, and a search toolbar. Built on @jects/core.
 *
 * Importing this module registers the board with the factory (type
 * `"taskboard"`) and pulls in the package's side-effect CSS.
 * Side-effect CSS: `import '@jects/kanban/style.css'`.
 */

import './styles.css';

export { TaskBoard } from './board.js';
export { openCardEditor } from './editor.js';
export { renderCardBody, escapeHtml, cardAccessibleLabel } from './card.js';
export { AjaxDataProvider } from './data-provider.js';

export type {
  KanbanCard,
  CardTag,
  CardBodyItem,
  CardAttachment,
  CardComment,
  CardVotes,
  KanbanColumnDef,
  KanbanLaneDef,
  TaskBoardConfig,
  TaskBoardEvents,
  CardDropTarget,
  CardRenderer,
  TaskBoardDataProvider,
  CardSyncOp,
  SortField,
  BoardFilterDef,
  ExportFormat,
  ExportOptions,
} from './types.js';

export type { AjaxDataProviderConfig } from './data-provider.js';
