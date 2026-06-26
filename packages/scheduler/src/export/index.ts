/**
 * @jects/scheduler — Export (PDF / PNG) public surface.
 *
 * Renders the painted schedule (header bands + locked columns + lanes + bars +
 * dependencies) to a multi-page PDF or a single PNG, matching Bryntum/DHTMLX
 * "Export PDF/PNG". The geometry serialization is pure (jsdom/node testable);
 * rasterization uses a canvas (overridable for headless use). Wire it into a
 * live Scheduler via {@link SchedulerExporter} / {@link installExport} — see the
 * module docs for the integration seam (no edits to the main class required).
 */

export {
  serializeGeometry,
  paginate,
  type SchedulerExportModel,
  type ExportGeometrySource,
  type ExportColumnDescriptor,
  type ExportHeaderCell,
  type ExportResourceColumn,
  type ExportRow,
  type ExportBar,
  type ExportGridline,
  type ExportShade,
  type ExportDependency,
  type ExportPage,
} from './geometry.js';

export {
  paintModel,
  DEFAULT_EXPORT_PALETTE,
  type ExportPalette,
  type Canvas2DLike,
  type PaintOptions,
} from './paint-canvas.js';

export { resolvePalette } from './palette.js';

export {
  PAPER_SIZES,
  type PaperSize,
  type PageOrientation,
  type ExportCommonConfig,
  type PngExportConfig,
  type PdfExportConfig,
  type ExportResult,
  type SchedulerExportEvents,
} from './config.js';

export {
  exportSchedulePng,
  makeResult,
  type PngExportContext,
} from './png.js';

export {
  exportSchedulePdf,
  planPdfPages,
  type PdfExportContext,
} from './pdf.js';

export { buildPdf, type PdfImagePage, type PdfDocOptions } from './pdf-writer.js';

export {
  domCanvasFactory,
  rgbaToRgb,
  toBase64,
  type CanvasFactory,
  type RasterSurface,
} from './canvas-factory.js';

export {
  SchedulerExporter,
  installExport,
  triggerDownload,
  type ExportableScheduler,
  type ExportApi,
} from './exporter.js';

export {
  mountRasterExportToolbar,
  type RasterToolbarOptions,
  type RasterExportToolbar,
} from './raster-toolbar.js';

/* ── Excel (.xlsx) export ────────────────────────────────────────────────── */
export {
  SchedulerExcelExporter,
  schedulerExportSource,
  type SchedulerExportSource,
  type ExcelExportLayout,
  type ResourceGridCellMode,
  type ExcelEventColumn,
  type ExportEventRow,
  type ExcelExportConfig,
  type ExportCell,
  type SchedulerExportHost,
} from './excel.js';

/* ── ICS (iCalendar) import / export ─────────────────────────────────────── */
export {
  escapeIcsText,
  unescapeIcsText,
  foldLine,
  formatIcsUtc,
  parseIcsDate,
  normalizeRRuleLine,
  eventToVEvent,
  toIcs,
  unfoldLines,
  parseIcs,
  parseIcsDuration,
  IcsExporter,
  IcsImporter,
  triggerIcsDownload,
  icsExporter,
  icsImporter,
  mountIcsToolbar,
  type IcsExportOptions,
  type IcsImportOptions,
  type ParsedIcsEvent,
  type ParsedIcs,
} from './ics.js';
