/**
 * Scheduler export — multi-page PDF.
 *
 * Serializes the painted schedule, paginates the content into a grid of pages
 * sized to the chosen paper (landscape A4 by default — schedules are wide), then
 * rasterizes each page (header strip + locked columns repeated, content tiled)
 * to a canvas and embeds it in a real PDF via {@link buildPdf}. Returns a
 * {@link ExportResult} (`application/pdf`).
 *
 * The locked resource panel + the multi-band time header are repeated on every
 * page so each page is self-describing — matching Bryntum/DHTMLX PDF export.
 */

import type { ExportGeometrySource } from './geometry.js';
import { serializeGeometry, paginate, type ExportPage } from './geometry.js';
import { paintModel, type ExportPalette } from './paint-canvas.js';
import { resolvePalette } from './palette.js';
import {
  domCanvasFactory,
  rgbaToRgb,
  type CanvasFactory,
} from './canvas-factory.js';
import { buildPdf, type PdfImagePage } from './pdf-writer.js';
import { PAPER_SIZES, type PdfExportConfig, type ExportResult } from './config.js';
import { makeResult } from './png.js';

export interface PdfExportContext extends PdfExportConfig {
  themeEl?: Element | null;
  canvasFactory?: CanvasFactory;
}

/** Render the schedule to a paginated PDF. */
export function exportSchedulePdf(
  source: ExportGeometrySource,
  ctx: PdfExportContext = {},
): ExportResult {
  const model = serializeGeometry(source);
  const palette = mergePalette(resolvePalette(ctx.themeEl), ctx.palette);
  const scale = ctx.scale ?? 2;
  const factory = ctx.canvasFactory ?? domCanvasFactory;

  const paper = PAPER_SIZES[ctx.paper ?? 'a4'];
  const orientation = ctx.orientation ?? 'landscape';
  const pageWidth = orientation === 'landscape' ? paper.height : paper.width;
  const pageHeight = orientation === 'landscape' ? paper.width : paper.height;
  const margin = ctx.margin ?? 24;

  // Printable area (points) reserved for the *content* region: subtract margins,
  // the repeated locked-panel width, and the header strip height.
  const usableW = pageWidth - margin * 2;
  const usableH = pageHeight - margin * 2;
  // Page content area is the canvas minus the repeated panel/header (in CSS px;
  // 1 PDF point ≈ 1 CSS px at scale 1, which is the convention we adopt so the
  // export reads at a comfortable on-screen size).
  const pageContentWidth = Math.max(1, usableW - model.resourceWidth);
  const pageContentHeight = Math.max(1, usableH - model.headerHeight);

  const pages = paginate({ model, pageContentWidth, pageContentHeight });

  const imagePages: PdfImagePage[] = [];
  for (const page of pages) {
    const cssW = model.resourceWidth + page.width;
    const cssH = model.headerHeight + page.height;
    const surface = factory(cssW * scale, cssH * scale);
    const c2d = surface.ctx as unknown as { scale?: (x: number, y: number) => void };
    if (typeof c2d.scale === 'function') c2d.scale(scale, scale);

    paintModel(surface.ctx, model, {
      page,
      canvasWidth: cssW,
      canvasHeight: cssH,
      palette,
    });

    const rgba = surface.getRgba();
    imagePages.push({
      width: surface.width,
      height: surface.height,
      rgb: rgbaToRgb(rgba, true),
    });
  }

  const title = ctx.title ?? model.title;
  const pdfOpts = {
    pageWidth,
    pageHeight,
    margin,
    ...(title !== undefined ? { title } : {}),
  };
  const bytes = buildPdf(imagePages, pdfOpts);

  return makeResult({
    type: 'application/pdf',
    fileName: `${ctx.fileName ?? 'schedule'}.pdf`,
    bytes,
    pageCount: imagePages.length,
  });
}

/** Re-export so callers can compute page counts without rendering. */
export function planPdfPages(
  source: ExportGeometrySource,
  ctx: PdfExportContext = {},
): ExportPage[] {
  const model = serializeGeometry(source);
  const paper = PAPER_SIZES[ctx.paper ?? 'a4'];
  const orientation = ctx.orientation ?? 'landscape';
  const pageWidth = orientation === 'landscape' ? paper.height : paper.width;
  const pageHeight = orientation === 'landscape' ? paper.width : paper.height;
  const margin = ctx.margin ?? 24;
  const pageContentWidth = Math.max(1, pageWidth - margin * 2 - model.resourceWidth);
  const pageContentHeight = Math.max(1, pageHeight - margin * 2 - model.headerHeight);
  return paginate({ model, pageContentWidth, pageContentHeight });
}

function mergePalette(
  base: ExportPalette,
  override: Partial<ExportPalette> | undefined,
): ExportPalette {
  if (!override) return base;
  return { ...base, ...override, ramp: override.ramp ?? base.ramp };
}
