/**
 * @jects/scheduler — resource scheduler.
 *
 * A framework-free, light-DOM resource scheduler built ENTIRELY on
 * `@jects/timeline-core` (time axis / zoom / bars / drag) and `@jects/grid`
 * (locked resource columns), reusing `@jects/core` Store/virtualization and
 * `@jects/widgets` (Window / ContextMenu) for editors. Horizontal + vertical
 * modes, pack/stack/overlap event layout, drag / resize / drag-create, an event
 * edit popup + context menu, visual dependencies (FS/SS/FF/SF), recurring events
 * (RRULE), view presets + zoom, plus a PRO tier (scheduling engine, Resource
 * Histogram + Utilization views) under `./pro`.
 *
 * Importing this module pulls in the package's side-effect CSS.
 * Side-effect CSS: `import '@jects/scheduler/style.css'`.
 */

import './styles.css';

/* ── Public contract (types) ─────────────────────────────────────────────── */
export type {
  ResourceModel,
  EventModel,
  AssignmentModel,
  DependencyModel,
  DependencyType,
  ConstraintType,
  SchedulerOrientation,
  ResourceColumnConfig,
  SchedulerConfig,
  SchedulerEvents,
  DependencyTerminal,
  TimeRangeConfig,
  ResourceTimeRangeConfig,
} from './contract.js';

/* ── Stores ──────────────────────────────────────────────────────────────── */
export {
  createResourceStore,
  createEventStore,
  createAssignmentStore,
  coerceResourceStore,
  coerceEventStore,
  coerceAssignmentStore,
  normalizeEvent,
  type ResourceStore,
  type EventStore,
  type AssignmentStore,
} from './stores/stores.js';

/* ── Model layer ─────────────────────────────────────────────────────────── */
export {
  layoutLane,
  type LaneLayoutInput,
  type LaneLayoutResult,
} from './model/event-layout.js';
export {
  parseRRule,
  expandOccurrences,
  type RecurrenceRule,
} from './model/recurrence.js';
export { toLink, toLinks, terminalsFor } from './model/dependencies.js';
export {
  projectTimeRangeConfigs,
  projectResourceTimeRangeConfigs,
  type TimeRangeBox,
  type ResourceTimeRangeBox,
} from './model/time-ranges.js';
export {
  planInfiniteScroll,
  type InfiniteScrollInput,
  type InfiniteScrollPlan,
} from './model/infinite-scroll.js';

/* ── The Scheduler widget (registers `scheduler` with the factory) ───────── */
export { Scheduler } from './view/scheduler.js';
export { openEventEditor, type EventEditChanges } from './view/event-editor.js';
export { formatTime } from './view/format.js';

/* ── Undo / redo (STM transactions + view controller) ────────────────────── */
export {
  SchedulerStm,
  type TrackableEvents,
  type TrackableStore,
  type TrackedStoreEntry,
  type StmActionType,
  type StmAction,
  type StmTransaction,
  type SchedulerStmConfig,
  type StmState,
  type SchedulerStmEvents,
} from './model/undo.js';
export {
  UndoRedoController,
  installUndoRedo,
  type UndoRedoHost,
  type UndoRedoConfig,
  type UndoableId,
  type UndoableRecord,
} from './view/undo-redo.js';

/* ── Export (PDF / PNG / Excel / ICS) ────────────────────────────────────── */
export * from './export/index.js';

/* ── PRO tier ────────────────────────────────────────────────────────────── */
export * from './pro/index.js';
