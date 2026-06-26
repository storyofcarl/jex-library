/**
 * `@jects/gantt` — UI area barrel.
 *
 * The Gantt chart Widget and its composable parts: the `Gantt` widget (which
 * implements the frozen `GanttApi`/`Gantt` contract), the default fallback
 * `SchedulingEngine`, the task-tree pane (reusing `@jects/grid`), the timeline
 * pane (built on `@jects/timeline-core`), and the task editor (reusing
 * `@jects/widgets` Window + Form).
 *
 * Importing this module pulls in the area's side-effect CSS, registers the
 * Gantt with the factory (`register('gantt', Gantt)`), and exposes the runtime
 * values that implement the type-only contract in `../contract.ts`.
 */

import './gantt.css';

export { Gantt } from './gantt.js';
export { DefaultGanttEngine } from './default-engine.js';

export { GanttTimelineView, terminalsFor } from './timeline-view.js';
export type {
  TimelineRowInput,
  TimelineViewOptions,
  DragMode,
} from './timeline-view.js';

export {
  GanttTaskTree,
  DEFAULT_GANTT_COLUMNS,
} from './task-tree.js';
export type { TaskTreeOptions, VisibleTaskRow } from './task-tree.js';

export { GanttTaskEditor } from './task-editor.js';
export type { TaskEditorOptions, TaskEditPatch } from './task-editor.js';

/* ── Indicators feature (Bryntum-parity) ─────────────────────────────────
   Additive GanttFeature plugin: focusable edge glyphs on task bars for
   constraints/deadlines/late-finishes/conflicts + custom indicators. CSS
   ships via this module's side-effect import. */
export {
  GanttIndicatorsFeature,
  renderIndicatorIcon,
  resolveDeadline,
} from './indicators.js';
export type {
  GanttIndicatorsConfig,
  GanttIndicator,
  IndicatorKind,
  IndicatorSide,
  IndicatorIconName,
  IndicatorContext,
  IndicatorClickPayload,
} from './indicators.js';

/* ── Multi-baseline compare feature ──────────────────────────────────────
   Non-destructive GanttFeature plugin: capture/overlay many named baselines
   with distinct per-baseline variant styles and a keyboard-operable picker. */
export {
  MultiBaselineCompare,
  createMultiBaselineCompare,
  MULTI_BASELINE_VARIANTS,
} from './multi-baseline.js';
export type {
  MultiBaselineOptions,
  ManagedBaseline,
} from './multi-baseline.js';

/* ── ProjectLines + print ────────────────────────────────────────────────
   Configurable named vertical marker lines drawn full-height across the
   timeline, plus a scoped @media-print path for the export-rendered Gantt. */
export {
  ProjectLines,
  resolveProjectLines,
  projectProjectLines,
  GanttPrintController,
} from './project-lines.js';
export type {
  ProjectLinesOptions,
  ProjectLine,
  ResolvedProjectLine,
  ProjectLineBox,
  ProjectLineKind,
  ProjectLineAnchor,
  ProjectLineLabelSide,
  GanttPrintOptions,
} from './project-lines.js';

/* ── Resource assignment (Bryntum/DHTMLX-parity) ─────────────────────────
   The AssignmentStore (single source of truth for who is assigned to what at
   what units %), the pure avatar/label renderers + the task-tree "Resources"
   column renderer, the per-bar resource-label GanttFeature, and the
   keyboard-operable assignment editor field (add/remove + units % +
   over-allocation styling). The task-tree and task-editor accept an optional
   `assignmentStore` to surface these live; see wire notes. */
export {
  AssignmentStore,
  clampUnits,
  resourceName,
  resourceInitials,
  resourceColorToken,
  assignmentLabelText,
  renderAssignmentAvatars,
  AssignmentColumnRenderer,
  GanttResourceLabelsFeature,
  RESOURCE_AVATAR_TOKENS,
  ASSIGNMENT_COLUMN_FIELD,
  ASSIGNMENT_COLUMN_HEADER,
} from './resource-assignment.js';
export type {
  ResourceModel,
  AssignmentModel,
  AssignmentStoreEvents,
  AssignmentStoreOptions,
  TaskAssignmentInput,
  AssignmentAvatarsOptions,
  GanttResourceLabelsConfig,
} from './resource-assignment.js';

export { ResourceAssignmentField } from './resource-assignment-field.js';
export type {
  ResourceAssignmentFieldOptions,
  AssignmentDraftRow,
} from './resource-assignment-field.js';

/* ── Resource Utilization grid (Bryntum/DHTMLX parity) ───────────────────
   The tabular, drill-down companion to the resource histogram: a spreadsheet-
   style grid of resources (rows) × time-bucketed periods (columns) showing
   percent/effort allocation against capacity, a trailing TOTAL column, a
   summary TOTAL row, and over-allocation flags. Resource rows expand into a
   per-task breakdown. Period bucketing math (`computeUtilization`) is a pure,
   DOM-free function; the view is an ARIA `treegrid`. CSS ships via the
   side-effect import in resource-utilization.ts. */
export {
  ResourceUtilizationView,
  computeUtilization,
  buildPeriods,
  formatPeriodLabel,
  formatEffortHours,
  formatPercent,
} from './resource-utilization.js';
export type {
  ResourceUtilizationViewConfig,
  ResourceUtilizationViewEvents,
  UtilizationPeriod,
  UtilizationCell,
  UtilizationTaskRow,
  UtilizationResourceRow,
  UtilizationData,
  TaskSpanSource,
  ComputeUtilizationInput,
} from './resource-utilization.js';

/* ── Progress line / status line feature (Bryntum/DHTMLX parity) ──────────
   Additive GanttFeature plugin: a jagged "line of balance" drawn at a
   configurable status date that bows left for tasks behind schedule and
   right for tasks ahead. Pure geometry (computeProgressVertices /
   progressPolylinePoints) is unit-testable without a DOM. CSS ships via the
   side-effect import in progress-line.ts. */
export {
  GanttProgressLineFeature,
  createProgressLine,
  computeProgressVertices,
  progressPolylinePoints,
} from './progress-line.js';
export type {
  GanttProgressLineConfig,
  ProgressVertex,
  ProgressStatus,
  ProgressBarGeometry,
  ProgressLineAnchor,
  ProgressLineChangePayload,
} from './progress-line.js';

/* ── Resource Histogram view (Bryntum/DHTMLX parity) ─────────────────────
   Standalone time-phased histogram pane: one lane per resource, with bucket
   columns (overlap-weighted allocation), a capacity line, and an
   over-allocation accent — kept in horizontal lockstep with the Gantt by
   sharing its `TimeAxis` (`gantt.timeline.axis`). Reads the resource surface
   (`ResourceApi`) + a task-span resolver; never mutates the model. The pure
   time-phasing (`computeHistogram` / `buildBuckets`) is DOM-free + unit-
   testable. CSS ships via the side-effect import in resource-histogram.ts.
   Integrator wires `refresh()` to scheduleChange/assign/axis setView; see
   wire notes. */
export {
  ResourceHistogram,
  createResourceHistogram,
  computeHistogram,
  buildBuckets,
} from './resource-histogram.js';
export type {
  ResourceHistogramConfig,
  ResourceHistogramEvents,
  HistogramModel,
  HistogramLane,
  HistogramBucket,
  HistogramResourceInput,
  HistogramBucketing,
  AllocationSegment,
  TaskSpanResolver,
} from './resource-histogram.js';

/* ── Undo/redo — State Tracking Manager (Bryntum/DHTMLX "STM" parity) ─────
   Additive GanttFeature plugin: a transaction-based undo/redo manager that
   captures every model mutation (task span/edit, constraint, dependency
   add/remove, assignment) as a reversible action, with transaction batching,
   drag coalescing, `undo()`/`redo()`/`canUndo`/`canRedo`, a token-pure floating
   toolbar, and Ctrl/Cmd+Z / Ctrl+Y shortcuts. It wraps the public GanttApi
   mutation seam so undo/redo reschedule through the SAME CPM pipeline as a live
   edit. Headless `GanttStm` core is re-exported for programmatic drivers. CSS
   ships via the side-effect import in undo.ts. Install via
   `gantt.use(new GanttUndoRedo())` or `{ plugins: [new GanttUndoRedo()] }`. */
export { GanttUndoRedo, createUndoRedo } from './undo.js';
export type {
  GanttUndoRedoConfig,
  StmChangePayload,
} from './undo.js';
export {
  GanttStm,
  canCoalesce,
  coalesce,
  defaultTitle,
} from '../engine/stm.js';
export type {
  StmAction,
  StmActionKind,
  StmTransaction,
  StmApplier,
  StmConfig,
  StmEvents,
  TaskSpanAction,
  TaskUpdateAction,
  ConstraintAction,
  DependencyAddAction,
  DependencyRemoveAction,
  AssignmentAddAction,
  AssignmentRemoveAction,
} from '../engine/stm.js';

/* ── PERT / network-diagram view (Bryntum/DHTMLX "PERT chart" parity) ─────
   Standalone SVG pane: an activity-on-node network diagram of the same tasks
   the bars render — node boxes (id/name/dates/slack) connected by dependency
   edges, auto-laid-out by topological rank (longest-path layering), with the
   critical path emphasised on both nodes and edges, plus basic pan/zoom. Reads
   the SAME engine results the bars do (per-task `TaskSchedule` + critical path)
   via an injected `schedule` resolver; `PertView.fromGantt(host, api, …)` wires
   the live schedule + `scheduleChange`/`taskChange` refresh. The (rank) layout
   is a PURE function (`computePertLayout`) so geometry is unit-testable without
   a DOM. CSS ships via the side-effect import in pert-view.ts. Registered with
   the factory as `register('pertview', PertView)`. */
export { PertView, createPertView, computePertLayout } from './pert-view.js';
export type {
  PertViewConfig,
  PertViewEvents,
  PertTaskInput,
  PertDependencyInput,
  PertNode,
  PertEdge,
  PertLayout,
  PertLayoutOptions,
  PertDateFormatter,
} from './pert-view.js';

/* ── Visual child-task ROLLUP markers (Bryntum/DHTMLX "Rollups" parity) ───
   Additive GanttFeature plugin: projects each hidden child task/milestone of a
   collapsed summary as a thin marker overlaid on the parent summary bar, so a
   collapsed summary still shows its children's positions in time. Pure geometry
   projector (`computeRollupMarkers`) + DOM-decorating feature mirroring the
   Indicators/Progress-line pattern. CSS ships via styles.css. */
export {
  GanttRollupFeature,
  createRollupFeature,
  computeRollupMarkers,
  MIN_MARKER_WIDTH,
  MILESTONE_MARKER_SIZE,
} from './rollup-markers.js';
export type {
  GanttRollupConfig,
  RollupMode,
  RollupMarker,
  RollupChildGeometry,
  RollupBarGeometry,
} from './rollup-markers.js';

/* ── Task-tree 'rollup' DATA column (Bryntum/DHTMLX column-type parity) ────
   The grid column that surfaces the rollup data inside the LEFT task-tree pane
   (distinct from the visual bar-rollup overlay above): a `'flag'`-mode checkbox
   toggling `task.rollup` (the same flag the overlay reads — one source of truth),
   or a `'summary'`-mode aggregate (sum/avg/min/max/count/any/all) rolled up from
   descendant leaves of a source field. Pure resolvers (`resolveRollupCell`,
   `aggregateRollup`, `formatRollupCell`) + a token-pure cell builder
   (`buildRollupCell`) + a column factory (`rollupColumn`). The task-tree pane
   delegates its `'rollup'` field case here. CSS ships via styles.css. */
export {
  rollupColumn,
  ROLLUP_COLUMN,
  ROLLUP_COLUMN_FIELD,
  ROLLUP_COLUMN_HEADER,
  resolveRollupCell,
  aggregateRollup,
  formatRollupCell,
  buildRollupCell,
  readRollupFlag,
  rollupFlagPatch,
  registerRollupColumnConfig,
  getRollupColumnConfig,
} from './rollup-column.js';
export type {
  RollupColumnConfig,
  RollupColumnKind,
  RollupAggregation,
  RollupValue,
  RollupTreeSource,
  RollupCellHandle,
} from './rollup-column.js';

/* ── Split / segmented tasks (Bryntum/DHTMLX "split tasks" parity) ────────
   Additive GanttFeature plugin: renders a single task as multiple working
   segments separated by non-working gaps, with drag/resize segment editing.
   Install via `gantt.use(new GanttSegmentedTasksFeature())`. The pure span math
   lives in engine/segments.ts (re-exported from the engine barrel). CSS ships
   via styles.css. */
export {
  GanttSegmentedTasksFeature,
  createSegmentedTasksFeature,
  computeSegmentBoxes,
  MIN_SEGMENT_WIDTH,
} from './segmented-tasks.js';
export type {
  GanttSegmentedTasksConfig,
  SegmentBox,
  SegmentConnector,
  SegmentLayout,
} from './segmented-tasks.js';

/* ── Predecessors/Successors editing columns + inline dependency editor ───
   Additive GanttFeature: editable Predecessors AND Successors task-tree columns
   accepting Bryntum/DHTMLX notation (e.g. "2FS+1d, 3SS"), parsed + routed
   through GanttApi.addDependency/removeDependency with validation +
   cycle-rejection feedback. CSS self-imports from dependency-editor.ts and ships
   via styles.css. */
export {
  GanttDependencyColumns,
  createDependencyColumns,
  DEPENDENCY_COLUMNS_FEATURE,
  DependencyCellEditor,
  applyNotation,
  notationFor,
  orientedLinksFor,
  sideForField,
  buildRefResolver,
  PREDECESSORS_COLUMN_FIELD,
  SUCCESSORS_COLUMN_FIELD,
} from './dependency-editor.js';
export type {
  GanttDependencyColumnsConfig,
  DependencyCellEditorOptions,
  DependencySide,
  OrientedLink,
  ApplyResult,
} from './dependency-editor.js';
export {
  parseDependencyNotation,
  parseLag,
  serializeDependencyTerm,
  serializeDependencyTerms,
  formatLag,
  diffDependencyTerms,
} from './dependency-notation.js';
export type {
  ParsedDependencyTerm,
  DependencyParseError,
  DependencyParseResult,
  ParseOptions as DependencyParseOptions,
  SerializeOptions as DependencySerializeOptions,
} from './dependency-notation.js';

/* ── Read-only Successors task-tree column (Bryntum/DHTMLX column parity) ──
   A symmetric, display-only Successors column mirroring the Predecessors
   column: renders each task's outgoing dependency links in "b, cSS+2d"
   notation (FS-default omitted, ±lag in days) via a self-contained resolver.
   The task-tree pane resolves the 'successors' field through
   TaskTreeOptions.successorsOf. For INLINE editing of successors, install the
   GanttDependencyColumns feature (dependency-editor.ts) on the same field.
   NOTE: SUCCESSORS_COLUMN_FIELD is re-exported from dependency-editor.js above
   (identical value 'successors') — not re-exported here to avoid a duplicate. */
export {
  successorsLabel,
  predecessorsLabel,
  makeSuccessorsResolver,
  withSuccessorsColumn,
  isSuccessorsField,
  SUCCESSORS_COLUMN,
  SUCCESSORS_COLUMN_WIDTH,
} from './successors-column.js';
export type { DependencyLabelOptions, SuccessorsColumnConfig } from './successors-column.js';
export { DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS } from './task-tree.js';

/* ── Unified export menu / format dispatcher UI (Bryntum/DHTMLX parity) ───
   Additive GanttFeature: a single Export button that opens a popup Menu listing
   every available export format (CSV / Excel / PNG / PDF / iCalendar / MS
   Project) plus Print, dispatching the chosen format to its exporter. Install
   via `gantt.use(new GanttExportMenu())`. CSS self-imports from export-feature.ts
   and ships via styles.css. */
export {
  GanttExportMenu,
  createGanttExportMenu,
  GANTT_EXPORT_MENU_FEATURE,
  DEFAULT_EXPORT_FORMATS,
  downloadText,
  downloadBlob,
} from './export-feature.js';
export type {
  GanttExportFormat,
  GanttExportFormatSpec,
  GanttExportMenuConfig,
  GanttExportResult,
  GanttExportMenuEvents,
} from './export-feature.js';
