/**
 * Scheduler export — painted-geometry serialization (pure, DOM-free math).
 *
 * The PDF / PNG exporters never re-implement the scheduler's layout; they
 * serialize the *already painted* geometry (header bands, locked resource
 * columns, lanes, event bars, dependency connectors) into a typed, framework-
 * free {@link SchedulerExportModel}. That model is the single source of truth
 * that both the canvas rasterizer (PNG / PDF page images) and the print
 * stylesheet consume — matching Bryntum/DHTMLX "export the rendered schedule"
 * behavior (header bands + lanes + bars + dependencies), paginated.
 *
 * This module is pure data: it takes a {@link ExportGeometrySource} (the slice
 * of the live Scheduler the exporter needs — its axis, stores, resolved bars,
 * row offsets, dependency router output) and produces the model + the
 * pagination plan. No canvas, no document, so it is fully jsdom/node testable.
 *
 * All coordinates are in *content space* (the same px space the Scheduler paints
 * bars in): x grows right with time, y grows down with resource rows. The header
 * band height sits ABOVE content (negative-free: header occupies the top
 * `headerHeight` px of every page, content is offset below it).
 *
 * Time is epoch ms (UTC) throughout, matching timeline-core.
 */

import type { RecordId } from '@jects/core';
import type { TimeAxis, TimeSpan, EventBar } from '@jects/timeline-core';
import type { EventModel, ResourceModel, DependencyModel } from '../contract.js';
import { toLinks } from '../model/dependencies.js';
import { OrthogonalDependencyRouter } from '@jects/timeline-core';
import { formatTime } from '../view/format.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. EXPORT MODEL (the serialized painted schedule)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A single header band cell (one row of the multi-band time header). */
export interface ExportHeaderCell {
  /** Left px in content space. */
  x: number;
  /** Cell width px. */
  width: number;
  /** Band index, 0 = coarsest (top). */
  band: number;
  /** Top px of the cell within the header strip. */
  y: number;
  /** Cell height px. */
  height: number;
  /** Rendered label. */
  text: string;
  /** Whether this cell sits on a major boundary (heavier gridline). */
  major: boolean;
}

/** A locked resource column header label. */
export interface ExportResourceColumn {
  /** Left px within the locked panel. */
  x: number;
  /** Column width px. */
  width: number;
  /** Header text. */
  text: string;
}

/** One painted resource row (left panel + lane backdrop). */
export interface ExportRow {
  id: RecordId;
  /** Top px in content space. */
  y: number;
  /** Row height px. */
  height: number;
  /** Per-column cell text (aligns with {@link ExportResourceColumn}). */
  cells: string[];
}

/** One painted event bar. */
export interface ExportBar {
  id: RecordId;
  /** Left px in content space. */
  x: number;
  /** Top px in content space (already includes the row top + lane offset). */
  y: number;
  width: number;
  height: number;
  /** Bar label. */
  text: string;
  /** 0..1 progress fill (or undefined). */
  progress?: number;
  /** Category/colour key (`eventColor`). */
  colorKey?: string;
  /** Whether this bar is a read-only recurrence occurrence. */
  locked: boolean;
}

/** A vertical gridline (tick boundary) in content space. */
export interface ExportGridline {
  x: number;
  major: boolean;
}

/** A non-working-time shaded box in content space. */
export interface ExportShade {
  x: number;
  width: number;
}

/** A dependency connector path (SVG `d` string) + its arrowhead. */
export interface ExportDependency {
  id: RecordId;
  /** SVG path data in content space. */
  path: string;
  /** Arrowhead path data. */
  arrow: string;
  colorKey?: string;
}

/** The fully serialized painted schedule (content space, px). */
export interface SchedulerExportModel {
  /** Total content width px (whole time range, current zoom). */
  contentWidth: number;
  /** Total content height px (all rows). */
  contentHeight: number;
  /** Height of the time-header strip px. */
  headerHeight: number;
  /** Width of the locked resource panel px. */
  resourceWidth: number;
  /** The time range covered. */
  range: TimeSpan;
  headerCells: ExportHeaderCell[];
  resourceColumns: ExportResourceColumn[];
  rows: ExportRow[];
  bars: ExportBar[];
  gridlines: ExportGridline[];
  shades: ExportShade[];
  dependencies: ExportDependency[];
  /** Now-marker x in content space, or undefined when out of range. */
  nowX?: number;
  /** Document title (for the PDF info dict / header banner). */
  title?: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. GEOMETRY SOURCE (the slice of the live Scheduler the exporter reads)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A resolved column descriptor (field + width + header). */
export interface ExportColumnDescriptor {
  field: keyof ResourceModel & string;
  text: string;
  width: number;
  renderer?: ((resource: ResourceModel) => string) | undefined;
}

/**
 * The read-only seam the exporter operates through. The live `Scheduler`
 * implements this (see {@link SchedulerExporter}); a test can supply a plain
 * object. Everything is content-space geometry the widget already computed.
 */
export interface ExportGeometrySource {
  /** Active time⇄pixel projection. */
  readonly axis: TimeAxis;
  /** All resource records, top to bottom. */
  readonly resources: ReadonlyArray<ResourceModel>;
  /** All event records (recurrence expanded lazily by `barsFor`). */
  readonly events: ReadonlyArray<EventModel>;
  /** Declared dependencies. */
  readonly dependencies: ReadonlyArray<DependencyModel>;
  /** Locked resource columns. */
  readonly columns: ReadonlyArray<ExportColumnDescriptor>;
  /** Default row height px. */
  readonly rowHeight: number;
  /** Working-calendar non-working shading boxes in content space. */
  readonly shades: ReadonlyArray<ExportShade>;
  /** Whether to draw the now marker. */
  readonly showNowMarker: boolean;
  /** Optional document title. */
  readonly title?: string | undefined;
  /**
   * Lay out one resource row's bars. Returns bars with LANE-RELATIVE `y`
   * (matching the widget's own layout) — the serializer adds the row top to get
   * absolute content-space positions, and feeds the lane-relative bars to the
   * dependency router with a `rowOffsets` map so connectors land correctly.
   */
  barsFor(resourceId: RecordId): EventBar<EventModel>[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. PAGINATION
   ═══════════════════════════════════════════════════════════════════════════ */

/** A single output page — a content-space rectangle to raster/print. */
export interface ExportPage {
  /** Zero-based column index in the page grid. */
  col: number;
  /** Zero-based row index in the page grid. */
  row: number;
  /** Content-space x of the page's left edge (excludes the locked panel). */
  contentX: number;
  /** Content-space y of the page's top edge. */
  contentY: number;
  /** Visible content width on this page px. */
  width: number;
  /** Visible content height on this page px. */
  height: number;
}

export interface PaginationInput {
  model: SchedulerExportModel;
  /** Usable page width px (after margins) for *content* (excl. locked panel). */
  pageContentWidth: number;
  /** Usable page height px (after margins + header strip). */
  pageContentHeight: number;
}

/**
 * Split the content area into a row-major grid of pages. The locked resource
 * panel + the header strip are repeated on every page (Bryntum/DHTMLX
 * convention) so each page is self-describing; pagination therefore only tiles
 * the scrollable content region.
 */
export function paginate(input: PaginationInput): ExportPage[] {
  const { model, pageContentWidth, pageContentHeight } = input;
  const w = Math.max(1, pageContentWidth);
  const h = Math.max(1, pageContentHeight);
  const cols = Math.max(1, Math.ceil(model.contentWidth / w));
  const rows = Math.max(1, Math.ceil(model.contentHeight / h));
  const pages: ExportPage[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const contentX = c * w;
      const contentY = r * h;
      pages.push({
        col: c,
        row: r,
        contentX,
        contentY,
        width: Math.min(w, model.contentWidth - contentX),
        height: Math.min(h, model.contentHeight - contentY),
      });
    }
  }
  return pages;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. SERIALIZATION
   ═══════════════════════════════════════════════════════════════════════════ */

const HEADER_BAND_HEIGHT = 22;

/**
 * Serialize the live scheduler geometry into a {@link SchedulerExportModel}.
 * This walks every resource row (not just the virtualized window) so the export
 * captures the WHOLE schedule, then re-routes dependencies across the full bar
 * set — exactly what "export the rendered schedule" requires.
 */
export function serializeGeometry(source: ExportGeometrySource): SchedulerExportModel {
  const { axis, resources, columns, rowHeight } = source;
  const contentWidth = axis.contentWidth;

  /* Resource columns + their total width. */
  let resourceWidth = 0;
  const resourceColumns: ExportResourceColumn[] = columns.map((col) => {
    const x = resourceWidth;
    resourceWidth += col.width;
    return { x, width: col.width, text: col.text };
  });
  if (resourceColumns.length === 0) {
    resourceColumns.push({ x: 0, width: 160, text: 'Resource' });
    resourceWidth = 160;
  }

  /* Header bands. The finest band is the tick lane; coarser bands group ticks
     under their major boundaries (mirrors the widget's `paintHeader`). */
  const bands = axis.preset.headers;
  const bandCount = Math.max(1, bands.length);
  const headerHeight = bandCount * HEADER_BAND_HEIGHT;
  const ticks = axis.ticksInRange(0, contentWidth);
  const headerCells: ExportHeaderCell[] = [];
  for (let b = 0; b < bandCount; b++) {
    const y = b * HEADER_BAND_HEIGHT;
    const format = bands[b]?.format;
    const isFinest = b === bandCount - 1;
    if (isFinest || bands.length === 0) {
      for (const tick of ticks) {
        headerCells.push({
          x: tick.x,
          width: tick.width,
          band: b,
          y,
          height: HEADER_BAND_HEIGHT,
          text: formatTime(tick.span.start, format),
          major: tick.major,
        });
      }
    } else {
      const majors = ticks.filter((t) => t.major);
      const bounds = majors.length > 0 ? majors : ticks.length > 0 ? [ticks[0]!] : [];
      for (let i = 0; i < bounds.length; i++) {
        const startTick = bounds[i]!;
        const next = bounds[i + 1];
        const lastTick = ticks[ticks.length - 1];
        const width = next
          ? next.x - startTick.x
          : (lastTick ? lastTick.x + lastTick.width : startTick.x) - startTick.x;
        headerCells.push({
          x: startTick.x,
          width: Math.max(0, width),
          band: b,
          y,
          height: HEADER_BAND_HEIGHT,
          text: formatTime(startTick.span.start, format),
          major: true,
        });
      }
    }
  }

  /* Gridlines (one per tick) + shading passthrough. */
  const gridlines: ExportGridline[] = ticks.map((t) => ({ x: t.x, major: t.major }));
  const shades: ExportShade[] = source.shades.map((s) => ({ x: s.x, width: s.width }));

  /* Rows + bars. Walk every resource, lay out its lane, place bars absolutely. */
  const rows: ExportRow[] = [];
  const bars: ExportBar[] = [];
  const barIndex = new Map<RecordId, EventBar<EventModel>>();
  let contentHeight = 0;
  for (let i = 0; i < resources.length; i++) {
    const resource = resources[i]!;
    const height = resource.rowHeight ?? rowHeight;
    const y = contentHeight;
    contentHeight += height;

    const cells = columns.length
      ? columns.map((col) => {
          if (col.renderer) return stripHtml(col.renderer(resource));
          const v = resource[col.field];
          return v == null ? '' : String(v);
        })
      : [resource.name];
    rows.push({ id: resource.id, y, height, cells });

    for (const bar of source.barsFor(resource.id)) {
      barIndex.set(bar.event.id, bar);
      const rec = bar.event.record;
      const exportBar: ExportBar = {
        id: bar.event.id,
        x: bar.x,
        y: y + bar.y,
        width: Math.max(1, bar.width),
        height: bar.height,
        text: rec.name ?? '',
        locked: bar.event.editable === false,
      };
      if (typeof rec.percentDone === 'number' && rec.percentDone > 0) {
        exportBar.progress = Math.min(1, rec.percentDone);
      }
      // Prefer the bar's resolved styleKey (set by the live exporter), falling
      // back to the record's own `eventColor` so the serializer is correct even
      // when a caller hands it bars that didn't carry the styleKey through.
      const colorKey = bar.event.styleKey ?? rec.eventColor;
      if (colorKey) exportBar.colorKey = colorKey;
      bars.push(exportBar);
    }
  }
  if (contentHeight === 0) contentHeight = rowHeight;

  /* Dependencies — re-route across the full (non-virtualized) bar set. */
  const dependencies: ExportDependency[] = [];
  if (source.dependencies.length > 0 && barIndex.size > 0) {
    const rowTops = new Map<RecordId, number>();
    for (const row of rows) rowTops.set(row.id, row.y);
    const router = new OrthogonalDependencyRouter<EventModel>({ rowOffsets: rowTops });
    const links = toLinks(source.dependencies as DependencyModel[]);
    const lines = router.route({ links, bars: barIndex, axis });
    for (const line of lines) {
      const dep: ExportDependency = {
        id: line.link.id,
        path: line.path,
        arrow: router.arrowFor(line),
      };
      if (line.link.styleKey) dep.colorKey = line.link.styleKey;
      dependencies.push(dep);
    }
  }

  /* Now marker. */
  let nowX: number | undefined;
  if (source.showNowMarker) {
    const now = Date.now();
    if (now >= axis.range.start && now <= axis.range.end) nowX = axis.toX(now);
  }

  const model: SchedulerExportModel = {
    contentWidth,
    contentHeight,
    headerHeight,
    resourceWidth,
    range: { start: axis.range.start, end: axis.range.end },
    headerCells,
    resourceColumns,
    rows,
    bars,
    gridlines,
    shades,
    dependencies,
  };
  if (nowX !== undefined) model.nowX = nowX;
  if (source.title !== undefined) model.title = source.title;
  return model;
}

/** Strip HTML tags from a renderer's output for the flat export text. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
