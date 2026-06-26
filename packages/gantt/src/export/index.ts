/**
 * `@jects/gantt` — export barrel for the **file/image export** surface.
 *
 * Aggregates the package's serialize-and-rasterize export modules so they reach
 * the public package entry through a single, additive re-export point (the root
 * `src/index.ts` re-exports this barrel). Nothing here touches the `Gantt`
 * widget, the contract, or any other shared module — it is pure re-export.
 *
 *   - `./png`   — full-chart PNG/JPEG/WebP raster export (the
 *                 `GanttImageExporter` controller + `ganttToPngBlob`/`…DataUrl`
 *                 functions + a download helper). Matches the Bryntum/DHTMLX
 *                 "Export to PNG/image" behavior: the whole chart (task tree,
 *                 timeline header, bars, dependency SVG) is rasterized at its
 *                 natural content size on a themed (or transparent) background.
 *   - `./gantt-image-export` — the additive `GanttImageExportFeature`
 *                 (`GanttFeature` plugin) + `installImageExport()` installer that
 *                 wire `exportPng()`/`exportImage()`/`imageExporter` onto a live
 *                 `Gantt` without editing the widget class.
 *
 * The CSV export module (`./export-csv`) is intentionally NOT re-aggregated here;
 * it is surfaced from the package root directly so this barrel stays focused on
 * the image-export feature added in this pass.
 */

export {
  // Pure functions over a DOM root (jsdom-safe serialize/measure paths).
  measureGanttExport,
  inlineExportTokens,
  serializeGanttToSvg,
  rasterizeGanttSvg,
  // One-call exports (resolve `null` outside a real browser).
  ganttToImageBlob,
  ganttToPngBlob,
  ganttToImageDataUrl,
  downloadImage,
  // Disposable controller (feature/mixin shape, like GanttPrintController).
  GanttImageExporter,
  // Token list inlined into the standalone SVG export.
  GANTT_EXPORT_TOKENS,
} from './png.js';

export type {
  GanttImageMimeType,
  GanttPngOptions,
  GanttExportSize,
  GanttSvgExport,
  GanttImageExportOptions,
} from './png.js';

export {
  GanttImageExportFeature,
  createGanttImageExport,
  installImageExport,
  GANTT_IMAGE_EXPORT_FEATURE,
} from './gantt-image-export.js';

export type {
  GanttImageExportFeatureConfig,
  GanttImageExportApi,
  GanttWithImageExport,
} from './gantt-image-export.js';

/* ── "Export to PNG" toolbar action (Bryntum/DHTMLX parity) ─────────────────────
   The visible UI affordance: a focusable, token-pure button pinned to the chart
   that rasterizes + downloads the whole chart on click, so image export is
   reachable out of the box (not only via the programmatic `gantt.exportPng()`).
   Additive `GanttFeature`; install via `gantt.use(new GanttExportToolbar())` or
   `{ plugins: [...] }`. Composes with `GanttImageExportFeature` (reuses its
   grafted `imageExporter`/`exportPng`) but never edits it. CSS ships via the
   side-effect import in export-toolbar.ts. */
export {
  GanttExportToolbar,
  createGanttExportToolbar,
  GANTT_EXPORT_TOOLBAR_FEATURE,
} from './export-toolbar.js';
export type { GanttExportToolbarConfig } from './export-toolbar.js';

/* ── Task-grid CSV export (RFC-4180 + CSV-injection guard) ──────────────────────
   The previously-orphaned task-grid serializer + CSV writer + the `GanttExportCsv`
   feature that wires `gantt.exportCsv()` onto the live widget (supplying the
   `predecessorsOf`/`resourcesOf` resolvers from the engine + resource layer).
   Re-aggregated here (additive) so the CSV surface is reachable from the package
   root barrel — matching the Bryntum/DHTMLX "export to CSV" parity behaviour. */
export {
  serializeTasks,
  resolveColumns,
  cellToText,
  isoDate,
  DEFAULT_EXPORT_COLUMNS,
} from './serialize.js';
export type {
  ExportColumn,
  ExportColumnType,
  ExportCell,
  ExportRow,
  ExportTable,
  TaskTreeSource,
  ExportResolvers,
  SerializeOptions,
} from './serialize.js';

export {
  tasksToCsv,
  tableToCsv,
  escapeCsvField,
  sanitizeCsvField,
} from './export-csv.js';
export type { CsvExportOptions } from './export-csv.js';

export {
  GanttExportCsv,
  createGanttExportCsv,
} from './gantt-export-csv.js';
export type { GanttExportCsvConfig } from './gantt-export-csv.js';

/* ── Task-grid Excel (XLSX / OOXML) export (zero-dependency) ─────────────────────
   The dependency-free SpreadsheetML writer over the shared `ExportTable` (typed
   cells, date/percent/duration number-format masks, native Excel row grouping
   from outline depth, column widths) + the `GanttExportXlsx` feature that wires
   `gantt.exportXlsx()` onto the live widget (same `predecessorsOf`/`resourcesOf`
   resolver supply as the CSV path), plus the standalone `GanttXlsxExporter`
   controller + accessible preview panel. Re-aggregated here (additive) so the
   Excel surface is reachable from the package root barrel — matching the
   Bryntum/DHTMLX "export to Excel" parity behaviour. The minimal ZIP writer
   (`./zip`) is exported for advanced callers. */
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
} from './export-xlsx.js';
export type {
  XlsxExportOptions,
  XlsxPreviewOptions,
  XlsxExporterResolvers,
  GanttXlsxExporterConfig,
  GanttXlsxExportOptions,
} from './export-xlsx.js';

export {
  GanttExportXlsx,
  createGanttExportXlsx,
  GANTT_EXPORT_XLSX_FEATURE,
} from './gantt-export-xlsx.js';
export type { GanttExportXlsxConfig } from './gantt-export-xlsx.js';

export { zipSync, crc32 } from './zip.js';
export type { ZipEntry } from './zip.js';

/* ── ICS (iCalendar / RFC-5545) export (Bryntum/DHTMLX "export to ICS" parity) ──
   The pure, DOM-free VCALENDAR/VEVENT serializer (one VEVENT per task or leaf
   task) with milestone handling, all-day/timed auto-detection, stable UID +
   SEQUENCE + DTSTAMP, %-complete/STATUS, TEXT escaping + 75-octet line folding;
   plus an accessible token-pure preview table and the additive
   `GanttIcsExportFeature` that wires `gantt.exportIcs()` onto the live widget.
   `downloadIcs` is taken from the pure module (the feature reuses it). */
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
} from './export-ics.js';
export type {
  IcsExportOptions,
  IcsResolvers,
  IcsTaskRow,
} from './export-ics.js';
export {
  renderIcsPreview,
  parseIcsEvents,
  unfoldIcs,
} from './ics-preview.js';
export type {
  IcsPreviewEvent,
  IcsPreviewOptions,
} from './ics-preview.js';
export {
  GanttIcsExportFeature,
  createGanttIcsExport,
  installIcsExport,
  GANTT_ICS_EXPORT_FEATURE,
} from './gantt-ics-export.js';
export type {
  GanttIcsExportFeatureConfig,
  GanttIcsExportApi,
  GanttWithIcsExport,
} from './gantt-ics-export.js';

/* ── PDF export (Bryntum/DHTMLX "export to PDF" parity) ─────────────────────────
   The dependency-free PDF document writer over the rasterized chart (multi-page
   tiling, page size/orientation/margins, header/footer bands) + the additive
   `GanttPdfExportFeature` that wires `gantt.exportPdf()`/`exportPdfDownload()`
   onto the live widget. */
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
} from './pdf.js';
export type {
  PdfPageSizeName,
  PdfOrientation,
  PdfMargins,
  PdfBand,
  GanttPdfOptions,
  PdfTile,
  PdfPlan,
  GanttPdfExportOptions,
} from './pdf.js';
export {
  GanttPdfExportFeature,
  createGanttPdfExport,
  installPdfExport,
  GANTT_PDF_EXPORT_FEATURE,
} from './gantt-pdf-export.js';
export type {
  GanttPdfExportFeatureConfig,
  GanttPdfExportApi,
  GanttWithPdfExport,
} from './gantt-pdf-export.js';
