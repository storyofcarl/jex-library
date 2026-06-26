/**
 * @jects/kanban — public type contract (types only; no runtime).
 *
 * The TaskBoard is a Widget built on @jects/core. It manages a flat
 * `Store<KanbanCard>` of cards keyed by `id`, grouping them into columns
 * (by `column` field) and optional swimlanes (by `lane` field). Drag-and-drop,
 * WIP limits, collapse/lock/reorder, search/filter and a card editor are all
 * layered on top of that store.
 */

import type { Model, RecordId, WidgetConfig, WidgetEvents } from '@jects/core';

/* ═══════════════════════════════════════════════════════════════════════════
   CARDS
   ═══════════════════════════════════════════════════════════════════════════ */

/** A single tag/label rendered as a chip on a card. */
export interface CardTag {
  /** Display text. */
  text: string;
  /** Optional categorical color index 1..8 mapped to `--jects-data-N`. */
  color?: number;
}

/** A custom body item appended below the template fields of a card. */
export interface CardBodyItem {
  /** Stable key (used for diffing / keyed render). */
  key?: string;
  /** Plain text content. */
  text?: string;
  /** Rich HTML content. Passed through the shared allow-list sanitizer
   * (`sanitizeHtml` from `@jects/core`) before insertion — scripts, event
   * handlers and unsafe URLs are stripped (docs/SECURITY.md §2). */
  html?: string;
  /** Optional extra class on the wrapper element. */
  cls?: string;
}

/** A file attached to a card. */
export interface CardAttachment {
  /** Display name (e.g. `spec.pdf`). */
  name: string;
  /** Link/href for the attachment. */
  url?: string;
  /** Size in bytes (rendered as a human-readable label when present). */
  size?: number;
}

/** A comment thread entry on a card. */
export interface CardComment {
  /** Author display name. */
  author: string;
  /** Comment text. */
  text: string;
  /** ISO timestamp (or any displayable time string). */
  time?: string;
}

/** Vote tally for a card. */
export interface CardVotes {
  /** Vote count. */
  count: number;
  /** Whether the current user has voted (drives the toggled vote button). */
  voted?: boolean;
}

/**
 * A kanban card record. Stored in the board's `Store`. Extra fields are allowed
 * (it extends `Model`) and are preserved across edits.
 */
export interface KanbanCard extends Model {
  /** Stable identity. Required. */
  id: RecordId;
  /** Id of the owning column. */
  column: RecordId;
  /** Id of the owning swimlane (when swimlanes are enabled). */
  lane?: RecordId | undefined;
  /** Manual sort order within (column, lane). Lower sorts first. */
  order?: number;
  /** Card title (template field). */
  title?: string;
  /** Card description (template field). */
  description?: string;
  /** Tag chips (template field). */
  tags?: CardTag[];
  /** Avatar — image URL or initials text (template field). */
  avatar?: string | undefined;
  /** Progress 0..100 (template field; omit to hide the bar). */
  progress?: number | undefined;
  /** Cover image URL shown as a banner at the top of the card. */
  cover?: string | undefined;
  /** Assignee (used by the toolbar assignee filter; distinct from `avatar`). */
  assignee?: string | undefined;
  /** Due date (ISO/displayable string; sortable via `sortField: 'due'`). */
  due?: string | undefined;
  /** File attachments (rendered as a count badge on the card). */
  attachments?: CardAttachment[];
  /** Comment thread (rendered as a count badge on the card). */
  comments?: CardComment[];
  /** Vote tally (rendered as a toggleable vote badge). */
  votes?: CardVotes | undefined;
  /** Related-card ids (rendered as link chips). */
  links?: RecordId[];
  /** Extra custom body items rendered below template fields. */
  bodyItems?: CardBodyItem[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   COLUMNS & SWIMLANES
   ═══════════════════════════════════════════════════════════════════════════ */

/** Declarative description of a board column. */
export interface KanbanColumnDef {
  /** Stable identity. Required. */
  id: RecordId;
  /** Header label. */
  title?: string;
  /** Optional categorical color index 1..8 mapped to `--jects-data-N`. */
  color?: number;
  /**
   * WIP / column card limit. When set, the header shows `count/limit` and turns
   * a warning state once exceeded.
   */
  limit?: number;
  /**
   * Hard-enforce `limit`: drops/cross-column moves that would exceed the limit
   * are vetoed (rejected) instead of merely flagged. Default `false`.
   */
  strictLimit?: boolean;
  /** Start collapsed. Default `false`. */
  collapsed?: boolean;
  /** Locked: cards cannot be dropped into / dragged out of / reordered. */
  locked?: boolean;
  /** Fixed column width in px (default from board config). */
  width?: number;
}

/** Declarative description of a swimlane (horizontal band across columns). */
export interface KanbanLaneDef {
  /** Stable identity. Required. */
  id: RecordId;
  /** Lane label. */
  title?: string;
  /** Start collapsed. Default `false`. */
  collapsed?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   BOARD CONFIG & EVENTS
   ═══════════════════════════════════════════════════════════════════════════ */

import type { Store } from '@jects/core';

/** Custom per-card body renderer (full override of the default template). */
export type CardRenderer = (card: KanbanCard) => string;

/* ═══════════════════════════════════════════════════════════════════════════
   REMOTE DATA PROVIDER (REST + WebSocket)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A remote mutation pushed to a {@link TaskBoardDataProvider}. */
export interface CardSyncOp {
  /** `update` covers moves/edits; `add`/`remove` cover lifecycle. */
  action: 'add' | 'update' | 'remove';
  /** Affected card id. */
  id: RecordId;
  /** The full card (for add) or the changed fields (for update). */
  card?: Partial<KanbanCard>;
}

/**
 * A remote data source for the board (AjaxStore-class). Loads cards over the
 * network and receives optimistic mutations to persist server-side. Implementors
 * may also push remote changes back into the board via {@link subscribe}.
 */
export interface TaskBoardDataProvider {
  /** Load the full card set (e.g. `GET syncUrl`). */
  load(): Promise<KanbanCard[]>;
  /** Persist a single optimistic mutation (move/edit/add/remove). */
  sync(op: CardSyncOp): Promise<void>;
  /**
   * Subscribe to remote changes (e.g. a WebSocket). The callback applies the
   * op to the live board. Returns an unsubscribe function. Optional.
   */
  subscribe?(onRemote: (op: CardSyncOp) => void): () => void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOOLBAR SORT / FILTER
   ═══════════════════════════════════════════════════════════════════════════ */

/** A card field the toolbar sort control can order columns by. */
export type SortField = 'order' | 'priority' | 'title' | 'votes' | 'due';

/** A toolbar filter predicate keyed by a stable id and shown as a control. */
export interface BoardFilterDef {
  /** Stable id (used as the toolbar control value). */
  id: string;
  /** Human label for the control. */
  label: string;
  /** Predicate: return `true` to KEEP the card. */
  test: (card: KanbanCard) => boolean;
}

/** Format accepted by {@link TaskBoard.export}. */
export type ExportFormat = 'json' | 'csv' | 'png';

/** Options for {@link TaskBoard.export}. */
export interface ExportOptions {
  /** Output format. Default `json`. */
  format?: ExportFormat;
}

export interface TaskBoardConfig extends WidgetConfig {
  /** Columns, left-to-right. */
  columns?: KanbanColumnDef[];
  /** Swimlanes, top-to-bottom. When empty/omitted, swimlanes are disabled. */
  lanes?: KanbanLaneDef[];
  /** Initial cards (used to build the internal Store when `store` is omitted). */
  cards?: KanbanCard[];
  /** Provide an existing Store instead of building one from `cards`. */
  store?: Store<KanbanCard>;
  /** Default column width in px. Default `280`. */
  columnWidth?: number;
  /** Enable drag-and-drop of cards. Default `true`. */
  draggable?: boolean;
  /** Allow selecting multiple cards (ctrl/meta/shift click) for group drag. Default `true`. */
  multiSelect?: boolean;
  /** Auto-scroll the board horizontally when dragging near an edge. Default `true`. */
  autoScroll?: boolean;
  /** Allow reordering columns by dragging their headers. Default `true`. */
  columnReorder?: boolean;
  /** Show the built-in toolbar (search). Default `true`. */
  toolbar?: boolean;
  /** Placeholder for the search box. */
  searchPlaceholder?: string;
  /** Render the card editor in a modal Window on double-click / `editCard()`. Default `true`. */
  editable?: boolean;
  /** Full card body renderer override. */
  cardRenderer?: CardRenderer;
  /** Accessible label for the board region. Default `Task board`. */
  label?: string;

  // ── remote data provider (REST / WebSocket) ──
  /**
   * Remote data source. When set, the board loads its cards from the provider
   * and pushes optimistic moves/edits back. The in-memory store remains the
   * live view. Mutually exclusive with `store` (provider feeds an owned store).
   */
  dataProvider?: TaskBoardDataProvider;
  /**
   * Convenience: a REST endpoint. When provided without `dataProvider`, the
   * board builds an `AjaxDataProvider` (GET to load, POST per mutation, and —
   * if `wsUrl` is set — a WebSocket subscription).
   */
  syncUrl?: string;
  /** Optional WebSocket URL for live remote changes (used with `syncUrl`). */
  wsUrl?: string;

  // ── undo / redo ──
  /** Enable the undo/redo history stack + Ctrl+Z / Ctrl+Y shortcuts. Default `false`. */
  undoRedo?: boolean;

  // ── toolbar sort ──
  /** Show a toolbar sort control. Default `false`. */
  sortable?: boolean;
  /** Initial sort field (active when not `order`). Default `order`. */
  sortField?: SortField;

  // ── toolbar filter ──
  /**
   * Toolbar filter definitions (tag / assignee / column predicates). When set
   * (and non-empty), the toolbar renders a filter control.
   */
  filters?: BoardFilterDef[];
  /**
   * Ad-hoc card predicate applied alongside search + active filters. Return
   * `true` to KEEP the card.
   */
  filterFn?: (card: KanbanCard) => boolean;
}

/** Where a drag is currently targeting (used in beforeMove/move payloads). */
export interface CardDropTarget {
  column: RecordId;
  lane?: RecordId | undefined;
  /** Insertion index within the target (column, lane). */
  index: number;
}

export interface TaskBoardEvents extends WidgetEvents {
  /** Selection set changed. */
  selectionChange: { board: TaskBoard; ids: RecordId[] };
  /** Vetoable: return `false` to reject a card move (e.g. strict WIP limit). */
  beforeCardMove: {
    board: TaskBoard;
    cards: KanbanCard[];
    from: { column: RecordId; lane?: RecordId | undefined };
    to: CardDropTarget;
  };
  /** A card (or multi-selection) was moved/reordered. */
  cardMove: {
    board: TaskBoard;
    cards: KanbanCard[];
    from: { column: RecordId; lane?: RecordId | undefined };
    to: CardDropTarget;
  };
  /** Vetoable: return `false` to cancel opening the editor. */
  beforeCardEdit: { board: TaskBoard; card: KanbanCard };
  /** A card was edited and committed (via editor or inline quick-edit). */
  cardEdit: { board: TaskBoard; card: KanbanCard; changes: Partial<KanbanCard> };
  /** A card was activated (double-click / Enter). */
  cardActivate: { board: TaskBoard; card: KanbanCard };
  /** A column was collapsed/expanded. */
  columnToggle: { board: TaskBoard; column: RecordId; collapsed: boolean };
  /** Columns were reordered. New left-to-right order of ids. */
  columnReorder: { board: TaskBoard; order: RecordId[] };
  /** A move was rejected by a strict WIP limit. */
  limitReject: { board: TaskBoard; column: RecordId; limit: number };
  /** A remote change (from the data provider's subscription) was applied. */
  remoteChange: { board: TaskBoard; op: CardSyncOp };
  /** The undo/redo history changed (depth/availability). */
  historyChange: { board: TaskBoard; canUndo: boolean; canRedo: boolean };
}

// Forward declaration for payload typing; the class lives in board.ts.
export interface TaskBoard {
  readonly id: string;
  readonly el: HTMLElement;
}
