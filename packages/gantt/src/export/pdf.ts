/**
 * `@jects/gantt` — paginated **PDF export**.
 *
 * Produces a real, multi-page PDF of the **full** export-rendered Gantt — the
 * task-tree grid, the timeline header band, the bar/milestone layer, and the
 * dependency SVG — matching the Bryntum/DHTMLX "Export to PDF" behavior:
 *
 *   - The whole chart is captured at its natural content size (the same
 *     full-chart serialize path the PNG exporter uses — {@link serializeGanttToSvg}
 *     / {@link rasterizeGanttSvg} in `./png`), then **tiled across pages** so a
 *     wide/tall project that does not fit one sheet is split into a grid of pages
 *     read left-to-right, top-to-bottom.
 *   - Page geometry is configurable: named **page sizes** (A4 / A3 / Letter /
 *     Legal / Tabloid) or a custom point size, **orientation** (portrait /
 *     landscape), and **margins**.
 *   - **Fit-to-width** (default) scales the chart down so its full width lands on
 *     a single column of pages (the common "one project, N stacked pages" layout);
 *     turning it off tiles at 1:1 (or an explicit `scale`) across as many columns
 *     as needed.
 *   - Each page carries a **header** and **footer** band (title / date / page
 *     "N of M"), drawn with the standard Helvetica PDF font.
 *
 * ## Why a hand-rolled writer
 * `@jects/gantt` is zero-runtime-dependency (D5). Rather than pull a PDF library,
 * this module contains a tiny, self-contained, spec-correct PDF/1.4 writer that
 * emits exactly what we need: a Catalog → Pages → N Page objects, each with a
 * content stream that paints an embedded JPEG image (the rasterized chart tile,
 * via `Do`) plus header/footer text (`BT … Tj … ET`), and one shared Helvetica
 * font. The bytes are assembled with a correct `xref` table + trailer so the
 * result opens in any conformant viewer.
 *
 * ## jsdom-safe, additive, leak-free
 *   - The **layout/pagination math** ({@link planPdfPages}) and the **PDF byte
 *     assembly** ({@link buildPdf}) are pure and fully unit-tested under jsdom —
 *     they take plain numbers / data-URLs, not a canvas.
 *   - The **capture** step needs a real 2D canvas/`Image` to rasterize the chart,
 *     so it degrades to `null` under jsdom (exactly like the PNG path) and is
 *     covered by the Chromium a11y/visual browser test.
 *   - Nothing here touches the `Gantt` widget, the contract, or the timeline. The
 *     {@link GanttPdfExporter} controller mirrors `GanttImageExporter` /
 *     `GanttPrintController`; the companion `gantt-pdf-export.ts` wires it onto a
 *     live `Gantt` as an additive `GanttFeature`.
 *
 * All linear units inside the PDF are **points** (1pt = 1/72 inch).
 */

import {
  serializeGanttToSvg,
  rasterizeGanttSvg,
  type GanttPngOptions,
} from './png.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. PAGE SIZES + PUBLIC TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

/** A named, well-known page size (points, portrait orientation: `[w, h]`). */
export type PdfPageSizeName = 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | 'Tabloid';

/** Page orientation. */
export type PdfOrientation = 'portrait' | 'landscape';

/**
 * Standard page sizes in PDF points (1/72"), portrait `[width, height]`.
 * Landscape swaps the pair.
 */
export const PDF_PAGE_SIZES: Readonly<Record<PdfPageSizeName, readonly [number, number]>> = {
  A5: [419.53, 595.28],
  A4: [595.28, 841.89],
  A3: [841.89, 1190.55],
  Letter: [612, 792],
  Legal: [612, 1008],
  Tabloid: [792, 1224],
};

/** Margins around the page content box, in points. */
export interface PdfMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The default 36pt (0.5") margin on every side. */
export const DEFAULT_PDF_MARGINS: Readonly<PdfMargins> = {
  top: 36,
  right: 36,
  bottom: 36,
  left: 36,
};

/** Header/footer band content. Each part is optional; absent parts are skipped. */
export interface PdfBand {
  /** Left-aligned text (e.g. project title). */
  left?: string;
  /** Centered text. */
  center?: string;
  /**
   * Right-aligned text. The token `{page}` is replaced with the 1-based page
   * number and `{pages}` with the total page count, so `'Page {page} of {pages}'`
   * renders per page.
   */
  right?: string;
}

/** Options controlling the paginated PDF export. */
export interface GanttPdfOptions extends GanttPngOptions {
  /** Named page size. Default `'A4'`. Ignored when {@link pageSize} is set. */
  page?: PdfPageSizeName;
  /**
   * Explicit page size in points `[width, height]` (portrait sense). Overrides
   * {@link page}. Useful for custom sheets.
   */
  pageSize?: readonly [number, number];
  /** Page orientation. Default `'landscape'` (the natural Gantt aspect). */
  orientation?: PdfOrientation;
  /** Page margins in points. Default {@link DEFAULT_PDF_MARGINS} (36pt). */
  margins?: Partial<PdfMargins>;
  /**
   * Scale the chart so its **full width** fits one column of pages. Default
   * `true` (the parity "fit to page width" behavior). When `false`, the chart is
   * tiled at {@link scale} (default 1) across as many columns as needed.
   */
  fitToWidth?: boolean;
  /**
   * Explicit chart→page scale used when {@link fitToWidth} is `false`. `1` = the
   * chart's CSS pixels map 1:1 to points. Clamped to `(0, 8]`. Default `1`.
   */
  scale?: number;
  /** Header band (drawn in the top margin of every page). */
  header?: PdfBand;
  /**
   * Footer band (drawn in the bottom margin of every page). Defaults to a
   * centered `'Page {page} of {pages}'` when omitted; pass `null` to suppress.
   */
  footer?: PdfBand | null;
  /** Document title written into the PDF Info dictionary + default header. */
  title?: string;
  /** PDF Info `Author`. */
  author?: string;
  /**
   * JPEG quality `[0,1]` for the embedded chart tiles. Default `0.92`. (PDF tiles
   * are always JPEG/DCTDecode so the file stays small for large charts.)
   */
  imageQuality?: number;
}

/** The CSS-pixel rectangle of a single tile cut out of the full chart bitmap. */
export interface PdfTile {
  /** 0-based column / row in the page grid. */
  col: number;
  row: number;
  /** Source rectangle in **device pixels** of the rasterized chart bitmap. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Destination box on the page in **points** (inside the margins). */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** The resolved, geometry-only plan for a paginated export (pure; no pixels). */
export interface PdfPlan {
  /** Final page size in points `[width, height]` (orientation applied). */
  pageWidth: number;
  pageHeight: number;
  /** Resolved margins. */
  margins: PdfMargins;
  /** Printable content box per page (points). */
  contentWidth: number;
  contentHeight: number;
  /** Columns / rows of pages. */
  cols: number;
  rows: number;
  /** Total page count (`cols * rows`). */
  pageCount: number;
  /** Effective chart→points scale actually used. */
  scale: number;
  /** The per-page tiles, in page order (row-major). */
  tiles: PdfTile[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. PAGINATION (pure, jsdom-safe)
   ═══════════════════════════════════════════════════════════════════════════ */

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function resolveMargins(m?: Partial<PdfMargins>): PdfMargins {
  return {
    top: Math.max(0, m?.top ?? DEFAULT_PDF_MARGINS.top),
    right: Math.max(0, m?.right ?? DEFAULT_PDF_MARGINS.right),
    bottom: Math.max(0, m?.bottom ?? DEFAULT_PDF_MARGINS.bottom),
    left: Math.max(0, m?.left ?? DEFAULT_PDF_MARGINS.left),
  };
}

/** Resolve the final page size (points), applying the named size + orientation. */
export function resolvePageSize(opts: GanttPdfOptions = {}): [number, number] {
  const base = opts.pageSize ?? PDF_PAGE_SIZES[opts.page ?? 'A4'];
  let [w, h] = [base[0], base[1]];
  const orientation = opts.orientation ?? 'landscape';
  const isLandscape = w > h;
  if (orientation === 'landscape' && !isLandscape) [w, h] = [h, w];
  if (orientation === 'portrait' && isLandscape) [w, h] = [h, w];
  return [w, h];
}

/**
 * Plan how a chart of `chartWidth × chartHeight` **CSS pixels** (rasterized at
 * `pixelRatio` device px) tiles across pages. Pure: this is the heart of the
 * paginated export and is fully unit-tested without any canvas.
 *
 * Layout rules (mirroring Bryntum/DHTMLX "Export to PDF"):
 *   - With `fitToWidth` (default) the chart is scaled so its full width fits the
 *     printable content width of one page → a single **column**, tiled into as
 *     many **rows** as the scaled height needs.
 *   - Without `fitToWidth` the chart is drawn at `scale` (default 1, i.e. 1 CSS
 *     px = 1 pt) and tiled across both columns and rows.
 *   - The last column/row tile is clipped to the remaining chart, and its
 *     destination box is shrunk to the same aspect so partial tiles are not
 *     stretched to fill the page.
 *
 * @param chartWidth  Full chart width in CSS px.
 * @param chartHeight Full chart height in CSS px.
 * @param opts        Page / margin / fit options.
 */
export function planPdfPages(
  chartWidth: number,
  chartHeight: number,
  opts: GanttPdfOptions = {},
): PdfPlan {
  const [pageWidth, pageHeight] = resolvePageSize(opts);
  const margins = resolveMargins(opts.margins);
  const contentWidth = Math.max(1, pageWidth - margins.left - margins.right);
  const contentHeight = Math.max(1, pageHeight - margins.top - margins.bottom);

  const pixelRatio = clamp(opts.pixelRatio ?? 2, 1, 4);
  const cssW = Math.max(1, chartWidth);
  const cssH = Math.max(1, chartHeight);

  // The chart→points scale: how many points one CSS px of chart occupies.
  const fitToWidth = opts.fitToWidth !== false;
  let scale: number;
  if (fitToWidth) {
    // Fit the whole width to one content column (never upscale past 1pt/px so a
    // tiny chart is not blown up; downscale a wide chart to fit).
    scale = Math.min(1, contentWidth / cssW);
  } else {
    scale = clamp(opts.scale ?? 1, 0.001, 8);
  }

  // Scaled chart size in points.
  const scaledW = cssW * scale;
  const scaledH = cssH * scale;

  const cols = Math.max(1, Math.ceil(scaledW / contentWidth - 1e-6));
  const rows = Math.max(1, Math.ceil(scaledH / contentHeight - 1e-6));

  // CSS px of chart that map onto one full content page (before clipping the
  // final partial tile).
  const tileCssW = contentWidth / scale;
  const tileCssH = contentHeight / scale;

  const tiles: PdfTile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Source slice in CSS px, clipped to the chart bounds.
      const cssX = col * tileCssW;
      const cssY = row * tileCssH;
      const sliceCssW = Math.min(tileCssW, cssW - cssX);
      const sliceCssH = Math.min(tileCssH, cssH - cssY);

      // Source rectangle in device pixels of the rasterized bitmap.
      const sx = Math.round(cssX * pixelRatio);
      const sy = Math.round(cssY * pixelRatio);
      const sw = Math.max(1, Math.round(sliceCssW * pixelRatio));
      const sh = Math.max(1, Math.round(sliceCssH * pixelRatio));

      // Destination box in points (top-left origin; PDF flips later).
      const dw = sliceCssW * scale;
      const dh = sliceCssH * scale;

      tiles.push({
        col,
        row,
        sx,
        sy,
        sw,
        sh,
        dx: margins.left,
        dy: margins.top,
        dw,
        dh,
      });
    }
  }

  return {
    pageWidth,
    pageHeight,
    margins,
    contentWidth,
    contentHeight,
    cols,
    rows,
    pageCount: cols * rows,
    scale,
    tiles,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. MINIMAL PDF WRITER (pure; bytes assembled from data-URLs)
   ═══════════════════════════════════════════════════════════════════════════ */

/** One page's drawable content for {@link buildPdf}. */
export interface PdfPageContent {
  /**
   * The page's chart tile as a base64 **JPEG** `data:` URL (`data:image/jpeg;
   * base64,…`). When `null`/omitted the page carries only its header/footer
   * (used by the jsdom unit path where no raster image exists).
   */
  imageDataUrl?: string | null;
  /** Destination box for the image, in points (PDF top-left sense). */
  imageBox?: { x: number; y: number; w: number; h: number };
  /** Resolved header text lines (already token-expanded). */
  header?: PdfBand;
  /** Resolved footer text lines (already token-expanded). */
  footer?: PdfBand;
}

/** Document-level metadata + geometry for {@link buildPdf}. */
export interface PdfDocInfo {
  pageWidth: number;
  pageHeight: number;
  margins: PdfMargins;
  title?: string;
  author?: string;
  /** Header/footer font size in points. Default 9. */
  bandFontSize?: number;
}

const PDF_HEADER = '%PDF-1.4\n';

/** Escape a string for a PDF literal `( … )` string object. */
function pdfEscapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n]+/g, ' ');
}

/** Decode a base64 `data:` URL's payload to raw bytes. */
function decodeDataUrlBytes(dataUrl: string): Uint8Array | null {
  const m = /^data:[^;]*;base64,(.*)$/.exec(dataUrl);
  if (!m) return null;
  const bin = typeof atob === 'function' ? atob(m[1]!) : fromBase64Node(m[1]!);
  if (bin == null) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Node fallback for environments without `atob` (defensive; tests run in jsdom). */
function fromBase64Node(b64: string): string | null {
  const B: unknown = (globalThis as { Buffer?: unknown }).Buffer;
  if (B && typeof (B as { from?: unknown }).from === 'function') {
    const buf = (B as { from(s: string, enc: string): { toString(enc: string): string } }).from(
      b64,
      'base64',
    );
    return buf.toString('binary');
  }
  return null;
}

/** Parse the pixel dimensions out of a baseline/progressive JPEG byte stream. */
function readJpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  // SOI marker.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1]!;
    // SOF markers carrying frame dimensions (skip SOF restart/other non-frame).
    const isSof =
      (marker >= 0xc0 && marker <= 0xcf) &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
      const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
      return { width, height };
    }
    // Skip to the next marker using the segment length.
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (len < 2) break;
    i += 2 + len;
  }
  return null;
}

/** Build a content-stream fragment that draws one band of text in a margin. */
function bandStream(
  band: PdfBand | undefined,
  y: number,
  info: PdfDocInfo,
  fontKey: string,
): string {
  if (!band) return '';
  const size = info.bandFontSize ?? 9;
  const left = info.margins.left;
  const right = info.pageWidth - info.margins.right;
  const mid = (left + right) / 2;
  const parts: string[] = [];
  const draw = (text: string | undefined, anchor: 'left' | 'center' | 'right'): void => {
    if (!text) return;
    const w = approxTextWidth(text, size);
    let x = left;
    if (anchor === 'center') x = mid - w / 2;
    else if (anchor === 'right') x = right - w;
    parts.push(
      `BT /${fontKey} ${size} Tf ${fmt(x)} ${fmt(y)} Td (${pdfEscapeText(text)}) Tj ET`,
    );
  };
  draw(band.left, 'left');
  draw(band.center, 'center');
  draw(band.right, 'right');
  return parts.join('\n');
}

/** Approximate Helvetica text width in points (avg advance ≈ 0.5em). */
function approxTextWidth(text: string, size: number): number {
  return text.length * size * 0.5;
}

function fmt(n: number): string {
  // Compact fixed precision; PDF accepts up to ~5 decimals.
  return (Math.round(n * 1000) / 1000).toString();
}

/**
 * Assemble a complete, conformant PDF/1.4 byte string from per-page content.
 * Pure + jsdom-safe: it consumes data-URL JPEGs (or none) and produces the exact
 * bytes — Catalog → Pages → Page[i] (+ image XObject) → content stream → shared
 * font, with a correct `xref` table + trailer. Returns a binary string (one byte
 * per char) suitable for `new Blob([…])` via {@link pdfStringToBytes}.
 *
 * @param pages Per-page content (image tile + header/footer).
 * @param info  Document geometry + metadata.
 */
export function buildPdf(pages: PdfPageContent[], info: PdfDocInfo): string {
  const objects: string[] = []; // body of each object (without "N 0 obj")
  // Reserve fixed object ids:
  //   1 Catalog · 2 Pages · 3 Helvetica font · then per-page (Page + optional Image + Content).
  const FONT_ID = 3;
  let nextId = 4;

  const pageIds: number[] = [];
  const pageObjects: { id: number; body: string }[] = [];
  const aux: { id: number; body: string }[] = [];

  const fontKey = 'F1';

  for (let p = 0; p < pages.length; p++) {
    const page = pages[p]!;
    const pageId = nextId++;
    pageIds.push(pageId);

    // Content stream: image (if any) + bands.
    let content = '';
    let imageResource = '';
    if (page.imageDataUrl && page.imageBox) {
      const bytes = decodeDataUrlBytes(page.imageDataUrl);
      const dims = bytes ? readJpegSize(bytes) : null;
      if (bytes && dims) {
        const imgId = nextId++;
        const imgKey = `Im${p}`;
        // PDF origin is bottom-left; flip the destination box vertically.
        const { x, y, w, h } = page.imageBox;
        const pdfY = info.pageHeight - y - h;
        content +=
          `q ${fmt(w)} 0 0 ${fmt(h)} ${fmt(x)} ${fmt(pdfY)} cm /${imgKey} Do Q\n`;
        imageResource = `/XObject << /${imgKey} ${imgId} 0 R >> `;
        aux.push({
          id: imgId,
          body:
            `<< /Type /XObject /Subtype /Image /Width ${dims.width} /Height ${dims.height} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\n` +
            `stream\n` +
            binaryString(bytes) +
            `\nendstream`,
        });
      }
    }

    // Header sits a little below the top edge; footer a little above the bottom.
    const headerY = info.pageHeight - info.margins.top + 6;
    const footerY = Math.max(6, info.margins.bottom - 12);
    content += bandStream(page.header, headerY, info, fontKey) + '\n';
    content += bandStream(page.footer, footerY, info, fontKey) + '\n';

    const contentId = nextId++;
    aux.push({
      id: contentId,
      body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    });

    pageObjects.push({
      id: pageId,
      body:
        `<< /Type /Page /Parent 2 0 R ` +
        `/MediaBox [0 0 ${fmt(info.pageWidth)} ${fmt(info.pageHeight)}] ` +
        `/Resources << /Font << /${fontKey} ${FONT_ID} 0 R >> ${imageResource}>> ` +
        `/Contents ${contentId} 0 R >>`,
    });
  }

  // Fixed objects.
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objects[FONT_ID] =
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;

  for (const o of [...pageObjects, ...aux]) objects[o.id] = o.body;

  // Info dictionary (optional).
  let infoId = 0;
  if (info.title || info.author) {
    infoId = nextId++;
    const title = info.title ? `/Title (${pdfEscapeText(info.title)}) ` : '';
    const author = info.author ? `/Author (${pdfEscapeText(info.author)}) ` : '';
    objects[infoId] = `<< ${title}${author}/Producer (Jects UI Gantt) >>`;
  }

  // Serialize with byte offsets for the xref table.
  const maxId = objects.length - 1;
  let body = PDF_HEADER;
  const offsets: number[] = new Array(maxId + 1).fill(0);
  for (let id = 1; id <= maxId; id++) {
    const o = objects[id];
    if (o == null) continue;
    offsets[id] = body.length;
    body += `${id} 0 obj\n${o}\nendobj\n`;
  }

  // Cross-reference table.
  const xrefStart = body.length;
  const count = maxId + 1;
  let xref = `xref\n0 ${count}\n`;
  xref += `0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id++) {
    if (objects[id] == null) {
      // Free entry for the unused slot (object 0 chain is fine; mark free).
      xref += `0000000000 00000 f \n`;
    } else {
      xref += `${pad10(offsets[id]!)} 00000 n \n`;
    }
  }

  const trailerInfo = infoId ? `/Info ${infoId} 0 R ` : '';
  const trailer =
    `trailer\n<< /Size ${count} /Root 1 0 R ${trailerInfo}>>\n` +
    `startxref\n${xrefStart}\n%%EOF`;

  return body + xref + trailer;
}

function pad10(n: number): string {
  return n.toString().padStart(10, '0');
}

/** A Uint8Array → binary string (one char per byte) for embedding into the PDF. */
function binaryString(bytes: Uint8Array): string {
  let s = '';
  // Chunk to avoid call-stack limits on large images.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return s;
}

/** Convert the binary PDF string from {@link buildPdf} into a `Uint8Array`. */
export function pdfStringToBytes(pdf: string): Uint8Array {
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. BAND TOKEN EXPANSION
   ═══════════════════════════════════════════════════════════════════════════ */

/** Expand `{page}` / `{pages}` tokens in a band for a given page index. */
export function expandBand(
  band: PdfBand | undefined,
  pageNumber: number,
  pageCount: number,
): PdfBand | undefined {
  if (!band) return undefined;
  const sub = (s: string | undefined): string | undefined =>
    s == null
      ? undefined
      : s.replace(/\{page\}/g, String(pageNumber)).replace(/\{pages\}/g, String(pageCount));
  const out: PdfBand = {};
  const l = sub(band.left);
  const c = sub(band.center);
  const r = sub(band.right);
  if (l !== undefined) out.left = l;
  if (c !== undefined) out.center = c;
  if (r !== undefined) out.right = r;
  return out;
}

/** Resolve the effective footer band (default "Page {page} of {pages}"). */
export function resolveFooter(opts: GanttPdfOptions): PdfBand | null {
  if (opts.footer === null) return null;
  if (opts.footer) return opts.footer;
  return { center: 'Page {page} of {pages}' };
}

/** Resolve the effective header band (default = the document title, if any). */
export function resolveHeader(opts: GanttPdfOptions): PdfBand | undefined {
  if (opts.header) return opts.header;
  if (opts.title) return { left: opts.title };
  return undefined;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. CAPTURE → PAGINATE → PDF (browser; degrades to a header/footer-only PDF
      under jsdom so the structure is still produced + testable)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Crop one tile out of the full-chart canvas into a JPEG data-URL. */
function tileToJpeg(
  source: HTMLCanvasElement,
  tile: PdfTile,
  quality: number,
): string | null {
  try {
    const c = document.createElement('canvas');
    c.width = Math.max(1, tile.sw);
    c.height = Math.max(1, tile.sh);
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    // White matte so JPEG (no alpha) does not render transparent areas black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(source, tile.sx, tile.sy, tile.sw, tile.sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  }
}

/**
 * Capture the full export-rendered Gantt under `root`, paginate it, and assemble
 * a multi-page PDF as a `Uint8Array`. In a real browser each page carries a
 * rasterized chart tile + header/footer; under jsdom (no canvas) it still
 * produces a valid, correctly-paginated PDF with header/footer bands only
 * (`imageDataUrl` resolves `null`), so the structure is never `null` — callers
 * always get bytes.
 *
 * @param root The live Gantt root (`.jects-gantt`) or an export-render subtree.
 * @param opts Page / fit / band options.
 * @param host Element to resolve `--jects-*` tokens from (defaults to `root`).
 */
export async function ganttToPdfBytes(
  root: HTMLElement,
  opts: GanttPdfOptions = {},
  host: HTMLElement | null = root,
): Promise<Uint8Array> {
  // 1. Serialize + rasterize the full chart (same path as PNG export).
  const exported = serializeGanttToSvg(root, opts, host);
  const canvas = await rasterizeGanttSvg(exported, opts);

  // 2. Plan pagination from the CSS-pixel chart size.
  const plan = planPdfPages(exported.width, exported.height, opts);

  // 3. Resolve bands + doc info.
  const header = resolveHeader(opts);
  const footer = resolveFooter(opts);
  const info: PdfDocInfo = {
    pageWidth: plan.pageWidth,
    pageHeight: plan.pageHeight,
    margins: plan.margins,
  };
  if (opts.title) info.title = opts.title;
  if (opts.author) info.author = opts.author;

  const quality = clamp(opts.imageQuality ?? 0.92, 0, 1);

  // 4. Build per-page content (one tile per page, row-major).
  const pages: PdfPageContent[] = plan.tiles.map((tile, i) => {
    const pageNumber = i + 1;
    const content: PdfPageContent = {};
    if (canvas) {
      const jpeg = tileToJpeg(canvas, tile, quality);
      if (jpeg) {
        content.imageDataUrl = jpeg;
        content.imageBox = { x: tile.dx, y: tile.dy, w: tile.dw, h: tile.dh };
      }
    }
    const h = expandBand(header, pageNumber, plan.pageCount);
    const f = footer ? expandBand(footer, pageNumber, plan.pageCount) : undefined;
    if (h) content.header = h;
    if (f) content.footer = f;
    return content;
  });

  return pdfStringToBytes(buildPdf(pages, info));
}

/** Assemble the paginated Gantt PDF as a `Blob` (`application/pdf`). */
export async function ganttToPdfBlob(
  root: HTMLElement,
  opts: GanttPdfOptions = {},
  host: HTMLElement | null = root,
): Promise<Blob> {
  const bytes = await ganttToPdfBytes(root, opts, host);
  // Copy into a fresh ArrayBuffer-backed view so the Blob part type is concrete
  // (`Uint8Array<ArrayBuffer>`) under strict lib typings.
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}

/**
 * Trigger a browser download of the paginated Gantt PDF. No-op (still returns the
 * Blob) in hosts without the object-URL API (jsdom).
 */
export async function downloadGanttPdf(
  root: HTMLElement,
  filename: string,
  opts: GanttPdfOptions = {},
  host: HTMLElement | null = root,
): Promise<Blob> {
  const blob = await ganttToPdfBlob(root, opts, host);
  const name = /\.pdf$/i.test(filename) ? filename : `${filename}.pdf`;
  if (
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function' &&
    typeof document !== 'undefined'
  ) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return blob;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. DISPOSABLE CONTROLLER (feature/mixin shape — like GanttImageExporter)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Options for {@link GanttPdfExporter.export}. */
export interface GanttPdfExportOptions extends GanttPdfOptions {
  /** Element to capture (defaults to the controller's root). */
  target?: HTMLElement;
  /** When set, the produced PDF is offered as a browser download under this name. */
  download?: string;
}

/**
 * Wraps the PDF-export functions as a small disposable controller, mirroring
 * `GanttImageExporter` / `GanttPrintController`: construct it with the Gantt root,
 * call `export()` for a `Blob`, `bytes()` for the raw `Uint8Array`, or `plan()`
 * for the geometry-only pagination plan (no capture). It owns no listeners;
 * `destroy()` marks it inert so a feature teardown is uniform + idempotent.
 *
 * Intentionally decoupled from the `Gantt` widget — it takes a root element so it
 * installs as a feature/mixin without touching the widget class.
 */
export class GanttPdfExporter {
  private readonly root: HTMLElement;
  private readonly host: HTMLElement;
  private destroyed = false;

  constructor(root: HTMLElement, host: HTMLElement = root) {
    this.root = root;
    this.host = host;
  }

  /**
   * Compute the pagination plan for the current chart WITHOUT capturing/rasterizing
   * — pure geometry over the export-rendered size. Useful to show a page count or
   * preview the tiling before producing bytes.
   */
  plan(opts: GanttPdfExportOptions = {}): PdfPlan {
    const exported = serializeGanttToSvg(this.target(opts), opts, this.host);
    return planPdfPages(exported.width, exported.height, opts);
  }

  /** Produce the paginated PDF as raw bytes (`Uint8Array`). Never `null`. */
  async bytes(opts: GanttPdfExportOptions = {}): Promise<Uint8Array | null> {
    if (this.destroyed) return null;
    return ganttToPdfBytes(this.target(opts), opts, this.host);
  }

  /**
   * Produce the paginated PDF as a `Blob` (`application/pdf`). When `opts.download`
   * is set, the Blob is also offered as a file download.
   */
  async export(opts: GanttPdfExportOptions = {}): Promise<Blob | null> {
    if (this.destroyed) return null;
    if (opts.download) {
      return downloadGanttPdf(this.target(opts), opts.download, opts, this.host);
    }
    return ganttToPdfBlob(this.target(opts), opts, this.host);
  }

  /** Idempotent teardown. The controller owns no resources; this marks it inert. */
  destroy(): void {
    this.destroyed = true;
  }

  /** Whether `destroy()` has been called. */
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  private target(opts: { target?: HTMLElement }): HTMLElement {
    return opts.target ?? this.root;
  }
}
