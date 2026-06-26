/**
 * Scheduler export — canvas rasterizer.
 *
 * Paints a {@link SchedulerExportModel} (or a single paginated page of it) onto
 * a `CanvasRenderingContext2D`. This is the shared rendering core for both PNG
 * (one canvas → one image) and PDF (one canvas per page → embedded raster).
 *
 * Colours are resolved from a {@link ExportPalette} — concrete CSS color strings
 * the PNG/PDF layer derives from the live theme via
 * `getComputedStyle(...).getPropertyValue('--jects-...')`, falling back to the
 * built-in default palette so the rasterizer is fully usable headless (jsdom /
 * node-canvas) where no theme is mounted. The model + palette together are pure
 * inputs; the only DOM dependency is the canvas context the caller supplies.
 *
 * The painter draws, in z-order: page background → non-working shading →
 * gridlines → resource panel (columns + rows) → header strip → event bars
 * (+ progress + label) → dependency connectors → now marker. The locked
 * resource panel + header strip are repeated on every page.
 */

import type {
  SchedulerExportModel,
  ExportPage,
  ExportBar,
} from './geometry.js';

/** A minimal 2D context surface — the subset the painter uses. Keeps the
 *  rasterizer testable with a recording stub and decoupled from lib.dom. */
export interface Canvas2DLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
}

/** Concrete colour palette the rasterizer paints with (resolved from tokens). */
export interface ExportPalette {
  background: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  card: string;
  muted: string;
  primary: string;
  primaryForeground: string;
  /** Non-working-time shading. */
  shade: string;
  /** Now-marker line. */
  now: string;
  /** Progress fill on a bar. */
  progress: string;
  /** Dependency connector + arrowhead. */
  dependency: string;
  /** Category colour ramp (resolved `--jects-data-1..8`), keyed cyclically. */
  ramp: string[];
}

/**
 * Built-in fallback palette — concrete sRGB approximations of the default
 * "Cool Zinc + Calm CMYK" theme tokens. Used only when no computed theme is
 * available (headless export); the PNG/PDF layer overrides these from the live
 * `--jects-*` custom properties when a theme is mounted.
 */
export const DEFAULT_EXPORT_PALETTE: ExportPalette = {
  background: '#ffffff',
  foreground: '#1c1c20',
  mutedForeground: '#6b6b75',
  border: '#e4e4ea',
  card: '#ffffff',
  muted: '#f3f3f6',
  primary: '#3a3a45',
  primaryForeground: '#fafafa',
  shade: '#f0f0f4',
  now: '#d04545',
  progress: '#5a8f6f',
  dependency: '#8a8a95',
  ramp: ['#3aa0a8', '#a8479a', '#c9a227', '#4a4a55', '#5a8f6f', '#8a6fb0', '#b06a4a', '#5a7fb0'],
};

const FONT = '12px sans-serif';
const HEADER_FONT = '11px sans-serif';
const BAR_FONT = '11px sans-serif';

export interface PaintOptions {
  /** The page to paint (clips content to this rect). When omitted, the whole
   *  model is painted (single-page PNG of the full schedule). */
  page?: ExportPage;
  /** Device-space width of the target canvas px. */
  canvasWidth: number;
  /** Device-space height of the target canvas px. */
  canvasHeight: number;
  /** Colour palette. */
  palette: ExportPalette;
  /** Outer margin px (PDF page margin). Default 0. */
  margin?: number;
}

/**
 * Paint the model (or one page) onto `ctx`. The canvas is laid out as:
 * `[margin][resource panel][content]` horizontally and
 * `[margin][header strip][content rows]` vertically. Content is translated so
 * the page's `contentX/contentY` maps to the content origin.
 */
export function paintModel(
  ctx: Canvas2DLike,
  model: SchedulerExportModel,
  opts: PaintOptions,
): void {
  const margin = opts.margin ?? 0;
  const palette = opts.palette;
  const page: ExportPage =
    opts.page ?? {
      col: 0,
      row: 0,
      contentX: 0,
      contentY: 0,
      width: model.contentWidth,
      height: model.contentHeight,
    };

  const panelW = model.resourceWidth;
  const headerH = model.headerHeight;

  // Page background.
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, opts.canvasWidth, opts.canvasHeight);

  // Origins (device space) for the four regions.
  const contentLeft = margin + panelW;
  const contentTop = margin + headerH;
  const panelLeft = margin;

  /* ── content region (clipped) ─────────────────────────────────────────── */
  ctx.save();
  ctx.beginPath();
  ctx.rect(contentLeft, contentTop, page.width, page.height);
  ctx.clip();
  // Translate so content-space (page.contentX, page.contentY) → region origin.
  ctx.translate(contentLeft - page.contentX, contentTop - page.contentY);

  // Non-working shading.
  ctx.fillStyle = palette.shade;
  for (const s of model.shades) {
    ctx.fillRect(s.x, page.contentY, s.width, page.height);
  }

  // Vertical gridlines.
  ctx.lineWidth = 1;
  for (const g of model.gridlines) {
    ctx.strokeStyle = g.major ? palette.border : palette.muted;
    ctx.beginPath();
    ctx.moveTo(g.x + 0.5, page.contentY);
    ctx.lineTo(g.x + 0.5, page.contentY + page.height);
    ctx.stroke();
  }

  // Horizontal row separators.
  ctx.strokeStyle = palette.border;
  for (const row of model.rows) {
    const yb = row.y + row.height;
    ctx.beginPath();
    ctx.moveTo(page.contentX, yb + 0.5);
    ctx.lineTo(page.contentX + page.width, yb + 0.5);
    ctx.stroke();
  }

  // Event bars.
  for (const bar of model.bars) {
    paintBar(ctx, bar, palette);
  }

  // Dependency connectors (orthogonal paths + arrowheads).
  ctx.strokeStyle = palette.dependency;
  ctx.fillStyle = palette.dependency;
  ctx.lineWidth = 1.5;
  for (const dep of model.dependencies) {
    strokeSvgPath(ctx, dep.path);
    fillSvgPath(ctx, dep.arrow);
  }

  // Now marker.
  if (model.nowX !== undefined) {
    ctx.strokeStyle = palette.now;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(model.nowX + 0.5, page.contentY);
    ctx.lineTo(model.nowX + 0.5, page.contentY + page.height);
    ctx.stroke();
  }
  ctx.restore();

  /* ── locked resource panel (repeated every page) ──────────────────────── */
  ctx.save();
  ctx.beginPath();
  ctx.rect(panelLeft, contentTop, panelW, page.height);
  ctx.clip();
  ctx.translate(panelLeft, contentTop - page.contentY);
  ctx.fillStyle = palette.card;
  ctx.fillRect(0, page.contentY, panelW, page.height);
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.strokeStyle = palette.border;
  for (const row of model.rows) {
    // Row separator.
    ctx.beginPath();
    ctx.moveTo(0, row.y + row.height + 0.5);
    ctx.lineTo(panelW, row.y + row.height + 0.5);
    ctx.stroke();
    // Cells.
    ctx.fillStyle = palette.foreground;
    for (let c = 0; c < model.resourceColumns.length; c++) {
      const col = model.resourceColumns[c]!;
      const text = row.cells[c] ?? '';
      ctx.fillText(clampText(ctx, text, col.width - 12), col.x + 6, row.y + row.height / 2);
    }
  }
  // Right edge of the panel.
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(panelW - 0.5, page.contentY);
  ctx.lineTo(panelW - 0.5, page.contentY + page.height);
  ctx.stroke();
  ctx.restore();

  /* ── time header strip (repeated every page) ──────────────────────────── */
  ctx.save();
  ctx.beginPath();
  ctx.rect(contentLeft, margin, page.width, headerH);
  ctx.clip();
  ctx.translate(contentLeft - page.contentX, margin);
  ctx.fillStyle = palette.muted;
  ctx.fillRect(page.contentX, 0, page.width, headerH);
  ctx.font = HEADER_FONT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const cell of model.headerCells) {
    ctx.strokeStyle = cell.major ? palette.border : palette.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cell.x + 0.5, cell.y);
    ctx.lineTo(cell.x + 0.5, cell.y + cell.height);
    ctx.stroke();
    ctx.fillStyle = palette.foreground;
    ctx.fillText(clampText(ctx, cell.text, cell.width - 6), cell.x + 4, cell.y + cell.height / 2);
  }
  // Header bottom border.
  ctx.strokeStyle = palette.border;
  ctx.beginPath();
  ctx.moveTo(page.contentX, headerH - 0.5);
  ctx.lineTo(page.contentX + page.width, headerH - 0.5);
  ctx.stroke();
  ctx.restore();

  /* ── corner (above panel, left of header) ─────────────────────────────── */
  ctx.fillStyle = palette.muted;
  ctx.fillRect(panelLeft, margin, panelW, headerH);
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(panelLeft + 0.5, margin + 0.5, panelW - 1, headerH - 1);
  ctx.font = HEADER_FONT;
  ctx.fillStyle = palette.mutedForeground;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (let c = 0; c < model.resourceColumns.length; c++) {
    const col = model.resourceColumns[c]!;
    ctx.fillText(
      clampText(ctx, col.text, col.width - 12),
      panelLeft + col.x + 6,
      margin + headerH / 2,
    );
  }
}

/** Paint one event bar (rounded rect approximated as a filled rect + border). */
function paintBar(ctx: Canvas2DLike, bar: ExportBar, palette: ExportPalette): void {
  const fill = barColor(bar, palette);
  ctx.fillStyle = fill;
  ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
  // Progress underlay.
  if (bar.progress !== undefined && bar.progress > 0) {
    ctx.fillStyle = palette.progress;
    ctx.fillRect(bar.x, bar.y + bar.height - 3, bar.width * bar.progress, 3);
  }
  // Border (dashed-ish look for locked is simplified to a lighter border).
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(bar.x + 0.5, bar.y + 0.5, Math.max(0, bar.width - 1), Math.max(0, bar.height - 1));
  // Label.
  if (bar.text && bar.width > 14) {
    ctx.font = BAR_FONT;
    ctx.fillStyle = labelColor(fill, palette);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(clampText(ctx, bar.text, bar.width - 10), bar.x + 5, bar.y + bar.height / 2);
  }
}

/** Resolve a bar's fill: ramp colour by category key, else primary. */
function barColor(bar: ExportBar, palette: ExportPalette): string {
  if (bar.colorKey && palette.ramp.length > 0) {
    return palette.ramp[hashKey(bar.colorKey) % palette.ramp.length]!;
  }
  return palette.primary;
}

/** Pick a readable label colour for a given bar fill. */
function labelColor(fill: string, palette: ExportPalette): string {
  return isDark(fill) ? palette.primaryForeground : palette.foreground;
}

/** Cheap luminance check on a `#rrggbb` (or named/other → assume dark). */
function isDark(color: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return true;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum < 0.55;
}

/** Stable non-negative hash for a category key. */
function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Truncate text with an ellipsis to fit `maxWidth` px (measured on ctx). */
function clampText(ctx: Canvas2DLike, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + '…' : '';
}

/* ─────────────────────────────────────────────────────────────────────────
   Tiny SVG path interpreter — supports the orthogonal connector subset the
   dependency router emits: `M x y`, `L x y`, `H x`, `V y`, `Z`. The router only
   produces absolute M/L paths (and the arrowhead is a closed M/L polygon), so
   this is sufficient and keeps us free of a full path parser.
   ───────────────────────────────────────────────────────────────────────── */

interface PathCursor {
  x: number;
  y: number;
}

function eachSegment(d: string, onMove: (x: number, y: number) => void, onLine: (x: number, y: number) => void): void {
  const tokens = d.match(/[MLHVZ]|-?\d*\.?\d+(?:e-?\d+)?/gi);
  if (!tokens) return;
  const cur: PathCursor = { x: 0, y: 0 };
  let i = 0;
  const num = (): number => parseFloat(tokens[i++]!);
  while (i < tokens.length) {
    const cmd = tokens[i++]!;
    switch (cmd) {
      case 'M':
        cur.x = num();
        cur.y = num();
        onMove(cur.x, cur.y);
        break;
      case 'L':
        cur.x = num();
        cur.y = num();
        onLine(cur.x, cur.y);
        break;
      case 'H':
        cur.x = num();
        onLine(cur.x, cur.y);
        break;
      case 'V':
        cur.y = num();
        onLine(cur.x, cur.y);
        break;
      case 'Z':
      case 'z':
        // closed in fill; for stroke we leave it (router paths are open).
        break;
      default:
        // Bare coordinate pairs after an implicit L (defensive).
        break;
    }
  }
}

function strokeSvgPath(ctx: Canvas2DLike, d: string): void {
  ctx.beginPath();
  eachSegment(
    d,
    (x, y) => ctx.moveTo(x, y),
    (x, y) => ctx.lineTo(x, y),
  );
  ctx.stroke();
}

function fillSvgPath(ctx: Canvas2DLike, d: string): void {
  ctx.beginPath();
  eachSegment(
    d,
    (x, y) => ctx.moveTo(x, y),
    (x, y) => ctx.lineTo(x, y),
  );
  ctx.fill();
}
