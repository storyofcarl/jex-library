/**
 * @jects/gantt — Gantt chart.
 *
 * Importing this module pulls in the package's side-effect CSS.
 * Side-effect CSS: `import '@jects/gantt/style.css'`.
 */

import './styles.css';

/* ── Frozen public contract (types only) ─────────────────────────────────
   The engine ⇄ UI seam the Gantt build agent codes against. See contract.ts. */
export type {
  // Task / dependency / calendar models
  TaskModel,
  ConstraintType,
  DependencyModel,
  DependencyType,
  DependencyTerminals,
  CalendarModel,
  WeekdayRule,
  WorkingInterval,
  CalendarException,
  WorkingTimeCalculator,
  // Baseline
  Baseline,
  BaselineTask,
  // Scheduling results
  ScheduleDirection,
  ScheduleOptions,
  TaskSchedule,
  ScheduleResult,
  SchedulingConflict,
  ScheduleChange,
  // Engine
  SchedulingEngine,
  // Options / events / features
  GanttOptions,
  GanttExportsConfig,
  GanttColumnConfig,
  GanttEvents,
  GanttFeature,
  GanttFeatureCtor,
  // Public surfaces
  GanttApi,
  GanttCtor,
} from './contract.js';

/* ── Gantt Widget + UI runtime ───────────────────────────────────────────
   The `Gantt` Widget (implements the frozen `GanttApi`/`Gantt` contract),
   its composable panes, the task editor, and the default fallback engine.
   Importing the UI barrel registers `gantt` with the factory and pulls in
   the component CSS so `new Gantt(el, { tasks, dependencies })` is live with
   rescheduling + critical path. */
export {
  Gantt,
  DefaultGanttEngine,
  GanttTimelineView,
  terminalsFor,
  GanttTaskTree,
  DEFAULT_GANTT_COLUMNS,
  GanttTaskEditor,
  // Read-only Successors task-tree column (mirrors Predecessors).
  successorsLabel,
  predecessorsLabel,
  makeSuccessorsResolver,
  withSuccessorsColumn,
  isSuccessorsField,
  SUCCESSORS_COLUMN,
  SUCCESSORS_COLUMN_WIDTH,
  DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
  // Task-tree 'rollup' DATA column (flag/summary) — distinct from bar overlay.
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
} from './ui/index.js';
export type {
  TimelineRowInput,
  TimelineViewOptions,
  DragMode,
  TaskTreeOptions,
  VisibleTaskRow,
  TaskEditorOptions,
  TaskEditPatch,
  DependencyLabelOptions,
  SuccessorsColumnConfig,
  RollupColumnConfig,
  RollupColumnKind,
  RollupAggregation,
  RollupValue,
  RollupTreeSource,
  RollupCellHandle,
} from './ui/index.js';

/* ── Parity features (additive GanttFeature plugins) ──────────────────────
   Install via `gantt.use(...)` or `GanttOptions.plugins`. All are
   non-destructive: zero edits to the Gantt class / timeline-view / contract.
   - Indicators: focusable edge glyphs on bars (constraints/deadlines/late/
     conflicts + custom via getIndicators).
   - Multi-baseline compare: overlay many named baselines with variant styles
     and a keyboard-operable picker.
   - ProjectLines + print: full-height named vertical marker lines + a scoped
     print path for the export-rendered Gantt.
   - Progress line / status line: a jagged "line of balance" drawn at a
     configurable status date that bows left for tasks behind schedule and
     right for tasks ahead, connecting each bar's actual-progress point to the
     status date so schedule health reads at a glance. */
export {
  GanttIndicatorsFeature,
  renderIndicatorIcon,
  resolveDeadline,
  MultiBaselineCompare,
  createMultiBaselineCompare,
  MULTI_BASELINE_VARIANTS,
  ProjectLines,
  resolveProjectLines,
  projectProjectLines,
  GanttPrintController,
  GanttProgressLineFeature,
  createProgressLine,
  computeProgressVertices,
  progressPolylinePoints,
  ResourceHistogram,
  createResourceHistogram,
  computeHistogram,
  ResourceUtilizationView,
  GanttUndoRedo,
  GanttResourceLabelsFeature,
} from './ui/index.js';
export type {
  GanttIndicatorsConfig,
  GanttIndicator,
  IndicatorKind,
  IndicatorSide,
  IndicatorIconName,
  IndicatorContext,
  IndicatorClickPayload,
  MultiBaselineOptions,
  ManagedBaseline,
  ProjectLinesOptions,
  ProjectLine,
  ResolvedProjectLine,
  ProjectLineBox,
  ProjectLineKind,
  ProjectLineAnchor,
  ProjectLineLabelSide,
  GanttPrintOptions,
  GanttProgressLineConfig,
  ProgressVertex,
  ProgressStatus,
  ProgressBarGeometry,
  ProgressLineAnchor,
  ProgressLineChangePayload,
  ResourceHistogramConfig,
  ResourceHistogramEvents,
  HistogramModel,
  HistogramLane,
  HistogramBucket,
  HistogramResourceInput,
  HistogramBucketing,
  ResourceUtilizationViewConfig,
  ResourceUtilizationViewEvents,
  GanttResourceLabelsConfig,
  // PERT / network-diagram view.
  PertViewConfig,
  PertViewEvents,
  PertTaskInput,
  PertDependencyInput,
  PertNode,
  PertEdge,
  PertLayout,
  PertLayoutOptions,
  PertDateFormatter,
  // Visual child-task rollup markers.
  GanttRollupConfig,
  RollupMode,
  RollupMarker,
  RollupChildGeometry,
  RollupBarGeometry,
  // Split / segmented tasks.
  GanttSegmentedTasksConfig,
  SegmentBox,
  SegmentConnector,
  SegmentLayout,
  // Predecessors/successors editing columns + inline dependency editor.
  GanttDependencyColumnsConfig,
  DependencyCellEditorOptions,
  DependencySide,
  OrientedLink,
  ApplyResult,
  ParsedDependencyTerm,
  DependencyParseError,
  DependencyParseResult,
  DependencyParseOptions,
  DependencySerializeOptions,
  // Unified export menu / format dispatcher UI.
  GanttExportFormat,
  GanttExportFormatSpec,
  GanttExportMenuConfig,
  GanttExportResult,
  GanttExportMenuEvents,
} from './ui/index.js';

/* ── PERT view + rollups + split tasks + dependency-edit columns + export menu ──
   Additive parity features surfaced from the UI barrel. PERT view registers
   `register('pertview', PertView)`; the rollup/segment/dependency-column features
   install via `gantt.use(...)`; the export menu is the single user-facing Export
   affordance. */
export {
  PertView,
  createPertView,
  computePertLayout,
  GanttRollupFeature,
  createRollupFeature,
  computeRollupMarkers,
  MIN_MARKER_WIDTH,
  MILESTONE_MARKER_SIZE,
  GanttSegmentedTasksFeature,
  createSegmentedTasksFeature,
  computeSegmentBoxes,
  MIN_SEGMENT_WIDTH,
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
  parseDependencyNotation,
  parseLag,
  serializeDependencyTerm,
  serializeDependencyTerms,
  formatLag,
  diffDependencyTerms,
  GanttExportMenu,
  createGanttExportMenu,
  GANTT_EXPORT_MENU_FEATURE,
  DEFAULT_EXPORT_FORMATS,
  downloadText,
  downloadBlob,
} from './ui/index.js';

/* ── Scheduling engine (headless, framework-free) ─────────────────────────
   The calendar-aware CPM `SchedulingEngine` implementation and its
   working-time calendar arithmetic. Drop-in for `GanttOptions.engine`;
   usable standalone. */
export {
  CpmEngine,
  createSchedulingEngine,
  buildCalculator,
  calculatorFor,
  resolveCalendar,
  type CalendarCalculator,
} from './engine/index.js';

/* ── Split / segmented task span math (headless) ──────────────────────────
   The pure working-time arithmetic backing the split-task UI feature. */
export {
  readSegments,
  isSplit,
  normalizeSegments,
  segmentsSpan,
  segmentsWorkingDuration,
  segmentGaps,
  splitTask,
  joinSegments,
  joinAll,
  moveSegment,
  rescheduleSegments,
  ONE_WORKING_DAY,
  MIN_SEGMENT_WORK,
} from './engine/index.js';
export type {
  TaskSegment,
  SegmentedTask,
  SegmentEditResult,
  SegmentDragMode,
} from './engine/index.js';

/* ── Resource management (people / equipment / cost + assignments) ─────────
   The Bryntum/DHTMLX resource layer: the flat `ResourceStore`, the
   many-to-many `AssignmentStore`, and the `ResourceManager` `GanttFeature`
   (implements `ResourceApi`). Auto-installed when `GanttOptions` carries
   `resources`/`assignments`; reachable via `gantt.resources`. Also exports the
   presentational `ResourceAssignmentView` (registers `resourceAssignmentView`).
   Resource-side types (`ResourceModel`/`AssignmentModel`/`ResourceOptions`/
   `ResourceApi`/…) come from the frozen resource contract. */
export {
  ResourceStore,
  normalizeResource,
  DEFAULT_RESOURCE_CAPACITY,
  DEFAULT_RESOURCE_TYPE,
  AssignmentStore,
  normalizeUnits,
  DEFAULT_ASSIGNMENT_UNITS,
  ResourceManager,
  createResourceManager,
  ResourceAssignmentView,
  initials,
  ResourceView,
  typeLabel,
  defaultFormatCost,
  RESOURCE_DND_MIME,
} from './resource/index.js';
export type {
  ResourceType,
  ResourceModel,
  AssignmentModel,
  ResolvedAssignment,
  AssignmentStoreEvents,
  ResourceOptions,
  ResourceApi,
  ResourceEvents,
  ResourceStoreConfig,
  AssignmentStoreConfig,
  ResourceManagerConfig,
  ResourceAssignmentViewConfig,
  ResourceAssignmentViewEvents,
  ResourceViewConfig,
  ResourceViewEvents,
  ResourceDropTargetOptions,
} from './resource/index.js';

/* ── Resource-layer auto-install seam (used by the Gantt widget) ──────────── */
export { installResourceLayer, RESOURCE_MANAGER_FEATURE } from './resource/install.js';

/* ── Task-grid CSV export (Bryntum/DHTMLX "export to CSV" parity) ──────────────
   The pure, framework-free task-grid serializer (`serializeTasks` → a
   writer-neutral `ExportTable`), the RFC-4180 CSV writer (`tasksToCsv` /
   `tableToCsv`, with a CSV/formula-injection guard), and the additive
   `GanttExportCsv` GanttFeature that wires `gantt.exportCsv()` onto the live
   widget by supplying the `predecessorsOf`/`resourcesOf` resolvers from the
   engine + resource layer. Install via `gantt.use(new GanttExportCsv())` or
   `{ plugins: [new GanttExportCsv()] }`. Re-exported from source modules (not the
   image-export area barrel) so the CSV surface stands on its own. */
export {
  serializeTasks,
  resolveColumns,
  cellToText,
  isoDate,
  DEFAULT_EXPORT_COLUMNS,
  tasksToCsv,
  tableToCsv,
  escapeCsvField,
  sanitizeCsvField,
  GanttExportCsv,
  createGanttExportCsv,
} from './export/index.js';
export type {
  ExportColumn,
  ExportColumnType,
  ExportCell,
  ExportRow,
  ExportTable,
  TaskTreeSource,
  ExportResolvers,
  SerializeOptions,
  CsvExportOptions,
  GanttExportCsvConfig,
} from './export/index.js';

/* ── PNG / image export (Bryntum/DHTMLX "export to PNG/image" parity) ──────────
   The full-chart raster export — task tree + timeline header + bars + dependency
   SVG serialized into a standalone `<foreignObject>` SVG, rasterized to a
   PNG/JPEG/WebP Blob/data-URL at a configurable pixel ratio on a themed (or
   transparent) background — plus the additive `GanttImageExportFeature` that
   wires `gantt.exportPng()`/`exportImage()`/`imageExporter` onto the live widget
   (install via `gantt.use(new GanttImageExportFeature())`,
   `{ plugins: [...] }`, or `installImageExport(gantt)`). Re-exported from the
   export barrel so the image-export surface is reachable from the package root. */
export {
  measureGanttExport,
  inlineExportTokens,
  serializeGanttToSvg,
  rasterizeGanttSvg,
  ganttToImageBlob,
  ganttToPngBlob,
  ganttToImageDataUrl,
  downloadImage,
  GanttImageExporter,
  GANTT_EXPORT_TOKENS,
  GanttImageExportFeature,
  createGanttImageExport,
  installImageExport,
  GANTT_IMAGE_EXPORT_FEATURE,
  // The visible "Export to PNG" toolbar action (reachable out of the box).
  GanttExportToolbar,
  createGanttExportToolbar,
  GANTT_EXPORT_TOOLBAR_FEATURE,
} from './export/index.js';
export type {
  GanttImageMimeType,
  GanttPngOptions,
  GanttExportSize,
  GanttSvgExport,
  GanttImageExportOptions,
  GanttImageExportFeatureConfig,
  GanttImageExportApi,
  GanttWithImageExport,
  GanttExportToolbarConfig,
} from './export/index.js';

/* ── Excel (XLSX / OOXML) export (Bryntum/DHTMLX "export to Excel" parity) ─────
   The dependency-free SpreadsheetML writer over the shared `ExportTable` (typed
   cells, number-format masks, native Excel row grouping from outline depth,
   frozen header, column widths, shared-string interning, formula-injection
   guard) + the additive `GanttExportXlsx` feature that wires `gantt.exportXlsx()`
   onto the live widget (same `predecessorsOf`/`resourcesOf` resolver supply as
   the CSV path) + the standalone `GanttXlsxExporter` controller + preview panel.
   The minimal ZIP writer (`zipSync`/`crc32`) is exported for advanced callers. */
export {
  tasksToXlsx,
  tableToXlsx,
  tasksToXlsxBlob,
  tableToXlsxBlob,
  bytesToXlsxBlob,
  downloadXlsx,
  buildXlsxPreview,
  toExcelSerial,
  columnLetter,
  cellRef,
  sanitizeSheetName,
  escapeXml,
  GanttXlsxExporter,
  createGanttXlsxExporter,
  XLSX_MIME,
  GanttExportXlsx,
  createGanttExportXlsx,
  GANTT_EXPORT_XLSX_FEATURE,
  zipSync,
  crc32,
} from './export/index.js';
export type {
  XlsxExportOptions,
  XlsxPreviewOptions,
  XlsxExporterResolvers,
  GanttXlsxExporterConfig,
  GanttXlsxExportOptions,
  GanttExportXlsxConfig,
  ZipEntry,
} from './export/index.js';

/* ── ICS (iCalendar / RFC-5545) export (Bryntum/DHTMLX "export to ICS" parity) ──
   The pure VCALENDAR/VEVENT serializer + accessible preview table + the additive
   `GanttIcsExportFeature` that wires `gantt.exportIcs()` onto the live widget. */
export {
  tasksToIcs,
  exportIcs,
  taskToVevent,
  flattenTasks,
  isMilestoneTask,
  formatIcsDateTime,
  formatIcsDate,
  isUtcMidnight,
  escapeIcsText,
  foldIcsLine,
  downloadIcs,
  ICS_MIME,
  renderIcsPreview,
  parseIcsEvents,
  unfoldIcs,
  GanttIcsExportFeature,
  createGanttIcsExport,
  installIcsExport,
  GANTT_ICS_EXPORT_FEATURE,
} from './export/index.js';
export type {
  IcsExportOptions,
  IcsResolvers,
  IcsTaskRow,
  IcsPreviewEvent,
  IcsPreviewOptions,
  GanttIcsExportFeatureConfig,
  GanttIcsExportApi,
  GanttWithIcsExport,
} from './export/index.js';

/* ── PDF export (Bryntum/DHTMLX "export to PDF" parity) ─────────────────────────
   The dependency-free PDF document writer over the rasterized chart (multi-page
   tiling, page size/orientation/margins, header/footer bands) + the additive
   `GanttPdfExportFeature` that wires `gantt.exportPdf()` onto the live widget. */
export {
  PDF_PAGE_SIZES,
  DEFAULT_PDF_MARGINS,
  resolvePageSize,
  planPdfPages,
  buildPdf,
  pdfStringToBytes,
  ganttToPdfBytes,
  ganttToPdfBlob,
  downloadGanttPdf,
  GanttPdfExporter,
  GanttPdfExportFeature,
  createGanttPdfExport,
  installPdfExport,
  GANTT_PDF_EXPORT_FEATURE,
} from './export/index.js';
export type {
  PdfPageSizeName,
  PdfOrientation,
  PdfMargins,
  PdfBand,
  GanttPdfOptions,
  PdfTile,
  PdfPlan,
  GanttPdfExportOptions,
  GanttPdfExportFeatureConfig,
  GanttPdfExportApi,
  GanttWithPdfExport,
} from './export/index.js';

/* ── MS Project (MSPDI XML) import/export + `.mpp` (OLE2) round-trip ───────────
   A tolerant MSPDI XML reader/writer + value codecs, plus the bundle⇄Gantt glue
   so an MS Project XML file round-trips through the public API
   (`importMsProjectAsOptions` → `new Gantt(...)` → `ganttToMsProjectXml(gantt)`).

   SCOPE (be precise): we fully support **MSPDI XML** import/export, and a
   Jects-authored `.mpp` round-trip via an **OLE2/CFB container with an embedded
   MSPDI XML payload**. We do NOT parse proprietary native Microsoft Project
   binary record streams — native `.mpp` import works only for files that carry a
   recognizable MSPDI XML payload (see `isBinaryMpp` / `isMpp` detection). */
export {
  importMsProject,
  importMsProjectFile,
  exportMsProject,
  isBinaryMpp,
  parseMsDate,
  formatMsDate,
  parseMsDuration,
  formatMsDuration,
  parseXml,
  decodeXmlText,
  escapeXml as escapeMsProjectXml,
  child,
  children,
  childText,
  fromMsProject,
  toMsProject,
  importMsProjectAsOptions,
  ganttToMsProjectXml,
  roundTripMsProject,
  // `.mpp` codec — OLE2/CFB container wrapping an MSPDI XML payload (not native
  // binary record-stream parsing); same epoch-ms/working-ms contract.
  exportMpp,
  importMpp,
  isMpp,
  roundTripMpp,
  listMppStreams,
  readCfb,
  writeCfb,
  isCfb,
  MPP_XML_STREAM,
  MPP_MARKER_STREAM,
  MPP_CODEC_VERSION,
  importMppAsOptions,
  ganttToMpp,
  roundTripGanttMpp,
} from './io/index.js';
export type {
  MsProjectBundle,
  MsProjectImportResult,
  MsProjectImportWarning,
  MsProjectImportOptions,
  MsProjectExportOptions,
  XmlNode,
  FromMsProjectOptions,
  ToMsProjectOptions,
  LiveGantt,
  MppExportOptions,
  MppImportOptions,
  MppImportResult,
  CfbStream,
  CfbContainer,
  ImportMppAsOptionsResult,
} from './io/index.js';
