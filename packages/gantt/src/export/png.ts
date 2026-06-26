/**
 * @jects/gantt — PNG / image (raster) export.
 *
 * Rasterizes the **full** export-rendered Gantt — the task-tree grid, the
 * timeline header band, the bar/milestone layer, and the dependency SVG — into a
 * single PNG (Blob, data-URL, or a 2D `<canvas>`), matching the Bryntum/DHTMLX
 * "Export to PNG/image" behavior: the whole chart is captured at its natural
 * content size (not just the on-screen viewport), at a configurable pixel ratio,
 * on a themed (or transparent) background.
 *
 * ## Why this is a "render" not a screenshot
 * The Gantt is light-DOM (HTML `<div>`s for bars + an inline `<svg>` for
 * dependency arrows), so there is no single canvas/SVG to serialize the way the
 * Diagram exporter does. The browser-native way to rasterize an arbitrary HTML
 * subtree is to (1) clone it, (2) expand its inner scrollers so the *whole* chart
 * is laid out (the same isolation the print path performs), (3) inline the
 * computed styles + `--jects-*` token cascade so it renders identically in a
 * standalone context, (4) wrap the clone in an SVG `<foreignObject>`, and
 * (5) draw that SVG into a 2D canvas via an `Image`. The canvas then yields a PNG
 * Blob / data-URL.
 *
 * ## Contract-first, additive, leak-safe
 * Everything here is a **pure function over a DOM root** — it never touches the
 * `Gantt` widget class, the contract, or the timeline. The optional
 * {@link GanttImageExporter} wraps the functions as a disposable controller (the
 * same shape as `GanttPrintController`) so it can be installed as a feature/mixin
 * without editing the widget. It degrades gracefully under jsdom (no real canvas
 * / `Image`), resolving `null` so the jsdom unit suite can still exercise the
 * deterministic serialize/measure paths; the real raster path is covered by the
 * Chromium a11y/visual browser test.
 *
 * All sizes are CSS pixels; the emitted bitmap is `size * pixelRatio`.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   1. TOKENS INLINED INTO THE EXPORT (self-contained theming)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The `--jects-*` custom properties resolved from the live host and re-declared
 * on the cloned root, so `oklch(var(--jects-…))` references in the component CSS
 * keep resolving once the clone is detached into the standalone SVG document.
 * Kept intentionally broad (chrome + data ramp + radius/space) so bars, the
 * critical-path accent, baselines, dependency strokes, and the grid chrome all
 * paint with the active theme.
 */
export const GANTT_EXPORT_TOKENS: readonly string[] = [
  '--jects-background',
  '--jects-foreground',
  '--jects-card',
  '--jects-card-foreground',
  '--jects-popover',
  '--jects-popover-foreground',
  '--jects-primary',
  '--jects-primary-foreground',
  '--jects-secondary',
  '--jects-secondary-foreground',
  '--jects-muted',
  '--jects-muted-foreground',
  '--jects-accent',
  '--jects-accent-foreground',
  '--jects-destructive',
  '--jects-destructive-foreground',
  '--jects-success',
  '--jects-success-foreground',
  '--jects-warning',
  '--jects-warning-foreground',
  '--jects-border',
  '--jects-input',
  '--jects-ring',
  '--jects-data-1',
  '--jects-data-2',
  '--jects-data-3',
  '--jects-data-4',
  '--jects-data-5',
  '--jects-data-6',
  '--jects-data-7',
  '--jects-data-8',
  '--jects-radius',
  '--jects-radius-sm',
  '--jects-radius-md',
  '--jects-radius-lg',
  '--jects-radius-xl',
  '--jects-font-family',
  '--jects-font-family-mono',
];

/** Inner scroller selectors expanded to their full content size before capture. */
const SCROLLER_SELECTORS: readonly string[] = [
  '.jects-gantt__timeline-scroller',
  '.jects-gantt__tree-scroller',
];

/* ═══════════════════════════════════════════════════════════════════════════
   2. PUBLIC TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

/** Output bitmap format. `'image/jpeg'` honors {@link GanttPngOptions.quality}. */
export type GanttImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

/** Options shared by the serialize / rasterize / export functions. */
export interface GanttPngOptions {
  /**
   * Device-pixel scaling. The emitted bitmap is `cssSize * pixelRatio`. Default
   * `2` (crisp on HiDPI). Clamped to `[1, 4]`.
   */
  pixelRatio?: number;
  /**
   * Background fill behind the chart. `'theme'` (default) paints the resolved
   * `--jects-background`; `'transparent'` leaves alpha; any other string is used
   * verbatim as a CSS color (escape hatch — prefer a token).
   */
  background?: 'theme' | 'transparent' | string;
  /** Output bitmap MIME type. Default `'image/png'`. */
  type?: GanttImageMimeType;
  /** Encoder quality `[0,1]` for lossy `type`s (jpeg/webp). Default `0.92`. */
  quality?: number;
  /**
   * Whether to expand the inner timeline/tree scrollers so the **whole** chart is
   * captured (not just the viewport). Default `true` (the parity behavior).
   */
  fullChart?: boolean;
  /** Extra padding (CSS px) added around the captured chart. Default `0`. */
  padding?: number;
}

/** The CSS-pixel dimensions of the export-rendered (fully expanded) chart. */
export interface GanttExportSize {
  /** Content width in CSS px (includes padding). */
  width: number;
  /** Content height in CSS px (includes padding). */
  height: number;
}

/** A serialized, standalone SVG carrying the cloned, inlined Gantt subtree. */
export interface GanttSvgExport extends GanttExportSize {
  /** The `<svg>…<foreignObject>…</foreignObject></svg>` document string. */
  svg: string;
  /** Pixel ratio the bitmap should be scaled by when rasterized. */
  pixelRatio: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. MEASURE + SERIALIZE (pure, jsdom-safe)
   ═══════════════════════════════════════════════════════════════════════════ */

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Measure the export-rendered size of a Gantt root: the **content** size of the
 * fully-expanded chart (scroll size of the inner scrollers, not the clipped
 * viewport), so the export captures everything the user could scroll to.
 *
 * Falls back to the root's own client/scroll box when no scrollers are present
 * (e.g. a bare bars-only fragment in a unit test).
 */
export function measureGanttExport(
  root: HTMLElement,
  opts: Pick<GanttPngOptions, 'fullChart' | 'padding'> = {},
): GanttExportSize {
  const pad = Math.max(0, opts.padding ?? 0);
  const fullChart = opts.fullChart ?? true;

  // Base box from the root itself.
  let width = Math.max(root.scrollWidth, root.clientWidth, root.offsetWidth || 0);
  let height = Math.max(root.scrollHeight, root.clientHeight, root.offsetHeight || 0);

  if (fullChart) {
    // The tree + timeline panes sit side by side; their combined full width is
    // the sum of the two scrollers' scroll widths, and the full height is the
    // tallest scroller. This mirrors how the print path expands the scrollers.
    const tree = root.querySelector<HTMLElement>('.jects-gantt__tree-scroller');
    const timeline = root.querySelector<HTMLElement>('.jects-gantt__timeline-scroller');
    if (tree || timeline) {
      const treeW = tree ? tree.scrollWidth : 0;
      const timelineW = timeline ? timeline.scrollWidth : 0;
      const fullW = treeW + timelineW;
      if (fullW > 0) width = Math.max(width, fullW);
      const fullH = Math.max(
        tree ? tree.scrollHeight : 0,
        timeline ? timeline.scrollHeight : 0,
      );
      if (fullH > 0) height = Math.max(height, fullH);
    }
  }

  // Clamp the *content* box to a 1px floor BEFORE adding padding, so padding is
  // always purely additive (padded == base + 2·pad) regardless of how small the
  // measured content is — otherwise a zero-sized content box (e.g. an unlaid-out
  // root under jsdom) would clamp the unpadded result up to 1 and break the
  // additive invariant.
  const baseW = Math.max(1, Math.round(width));
  const baseH = Math.max(1, Math.round(height));
  return {
    width: baseW + pad * 2,
    height: baseH + pad * 2,
  };
}

/**
 * Read the live `--jects-*` token values from `host` (or `document.documentElement`
 * when no host given) into a `prop:value;` declaration string. Resilient to jsdom,
 * where `getComputedStyle` may return empty values — missing tokens are skipped.
 */
export function inlineExportTokens(host: HTMLElement | null): string {
  let decl = '';
  const target = host ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target || typeof getComputedStyle !== 'function') return decl;
  try {
    const cs = getComputedStyle(target);
    for (const t of GANTT_EXPORT_TOKENS) {
      const v = cs.getPropertyValue(t).trim();
      if (v) decl += `${t}:${v};`;
    }
  } catch {
    /* jsdom partial getComputedStyle — emit whatever resolved (possibly none). */
  }
  return decl;
}

/**
 * Expand the inner scrollers of a (cloned) Gantt subtree so the whole chart is
 * laid out for capture: remove the scroll clip and let each scroller grow to its
 * content box. Mutates the passed subtree in place (operate on a clone).
 */
function expandScrollers(clone: HTMLElement): void {
  for (const sel of SCROLLER_SELECTORS) {
    for (const el of clone.querySelectorAll<HTMLElement>(sel)) {
      el.style.overflow = 'visible';
      el.style.height = 'auto';
      el.style.maxHeight = 'none';
    }
  }
}

/**
 * Serialize a Gantt root into a **standalone** SVG document string: the root is
 * deep-cloned, its scrollers expanded (full-chart), its theme tokens inlined onto
 * the clone, and the clone embedded in an `<svg><foreignObject>` of the measured
 * size. The returned string renders identically outside the app and is the input
 * to {@link rasterizeGanttSvg}.
 *
 * Pure + jsdom-safe: no canvas/Image needed, so unit tests can assert the SVG
 * carries the bars/header/deps and the inlined tokens.
 *
 * @param root The live Gantt root (`.jects-gantt`) or any export-render subtree.
 * @param host Element whose computed `--jects-*` cascade is inlined (defaults to
 *             `root` itself — tokens cascade from the document either way).
 */
export function serializeGanttToSvg(
  root: HTMLElement,
  opts: GanttPngOptions = {},
  host: HTMLElement | null = root,
): GanttSvgExport {
  const pixelRatio = clamp(opts.pixelRatio ?? 2, 1, 4);
  const pad = Math.max(0, opts.padding ?? 0);
  const { width, height } = measureGanttExport(root, opts);

  const clone = root.cloneNode(true) as HTMLElement;
  if (opts.fullChart ?? true) expandScrollers(clone);

  // The clone must be a self-sufficient block: fixed size, no scroll clip, and a
  // resolved background so the foreignObject paints a real surface.
  const bgRaw = opts.background ?? 'theme';
  const background =
    bgRaw === 'transparent'
      ? 'transparent'
      : bgRaw === 'theme'
        ? 'oklch(var(--jects-background))'
        : bgRaw;

  const tokenDecl = inlineExportTokens(host);
  // Strip transforms that would offset the clone within the foreignObject.
  clone.style.transform = 'none';
  clone.style.margin = '0';

  const serialized = new XMLSerializer().serializeToString(clone);

  // xmlns is required on both the svg and the foreignObject body so the HTML
  // namespace is honored by the SVG image loader.
  const inner = width - pad * 2;
  const innerH = height - pad * 2;
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="${pad}" y="${pad}" width="${inner}" height="${innerH}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" ` +
    `style="${tokenDecl}width:${inner}px;height:${innerH}px;` +
    `background:${background};box-sizing:border-box;">` +
    serialized +
    `</div>` +
    `</foreignObject>` +
    `</svg>`;

  return { svg, width, height, pixelRatio };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. RASTERIZE (browser; degrades to null under jsdom)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Encode a serialized SVG document as a same-origin `data:` URL. Uses UTF-8-safe
 * base64 (via `encodeURIComponent` → `unescape` → `btoa`) so multibyte glyphs in
 * task names survive the encode; falls back to percent-encoding if `btoa` is
 * unavailable. Unlike a `blob:` object URL, a `data:` URL keeps the rasterizing
 * canvas origin-clean (see {@link rasterizeGanttSvg}).
 */
function svgToDataUrl(svg: string): string {
  try {
    // `unescape` is the standard UTF-8→latin1 bridge for `btoa` (which only
    // accepts latin1); there is no modern drop-in here, and the input is our own
    // serialized SVG, not untrusted data.
    const b64 = btoa(unescape(encodeURIComponent(svg)));
    return `data:image/svg+xml;base64,${b64}`;
  } catch {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
}

function browserCapable(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function' &&
    typeof Image !== 'undefined'
  );
}

/**
 * Draw a serialized Gantt SVG onto an offscreen `<canvas>` at `pixelRatio`,
 * optionally filling a solid background first (so non-transparent exports are not
 * left with a black/garbage backdrop on lossy formats). Resolves `null` in hosts
 * without a working 2D canvas / `Image` (jsdom).
 *
 * @returns The painted canvas, or `null` if rasterization is unavailable.
 */
export function rasterizeGanttSvg(
  exported: GanttSvgExport,
  opts: Pick<GanttPngOptions, 'background'> = {},
): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    try {
      if (!browserCapable()) return resolve(null);

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(exported.width * exported.pixelRatio));
      canvas.height = Math.max(1, Math.round(exported.height * exported.pixelRatio));
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);

      // Opaque-format safety: pre-fill a background when the caller did not ask
      // for a transparent export. 'theme' is already baked into the SVG body, so
      // only an explicit CSS color needs an extra fill here; 'transparent' skips.
      const bg = opts.background ?? 'theme';
      if (bg !== 'transparent' && bg !== 'theme') {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // Encode the SVG as a same-origin `data:` URL rather than a blob: object
      // URL. A blob-URL SVG that carries a `<foreignObject>` is treated as a
      // cross-origin/dirty image source by Chromium and TAINTS the canvas, so
      // `toBlob`/`toDataURL` throw a SecurityError. A `data:` URL is inline and
      // same-origin, keeping the canvas clean and exportable. (Same trick used
      // by html-to-image et al.)
      const svgDataUrl = svgToDataUrl(exported.svg);
      const img = new Image();
      img.decoding = 'async';
      // Explicitly request an anonymous (CORS-clean) fetch so the decoded image
      // is origin-clean and does not taint the canvas it is drawn onto.
      img.crossOrigin = 'anonymous';
      const done = (result: HTMLCanvasElement | null): void => resolve(result);
      img.onload = () => {
        try {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          done(canvas);
        } catch {
          done(null);
        }
      };
      img.onerror = () => done(null);
      img.src = svgDataUrl;
    } catch {
      resolve(null);
    }
  });
}

/** Convert a painted canvas to a Blob (jsdom-safe — resolves `null` if absent). */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: GanttImageMimeType,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((b) => resolve(b), type, quality);
      return;
    }
    // Fallback: derive a Blob from the data-URL where toBlob is unavailable.
    try {
      const dataUrl = canvas.toDataURL(type, quality);
      resolve(dataUrlToBlob(dataUrl));
    } catch {
      resolve(null);
    }
  });
}

/** Decode a base64 `data:` URL into a typed `Blob`. */
function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1]!;
  const bin = atob(m[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. ONE-CALL EXPORTS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Rasterize the full export-rendered Gantt under `root` to a PNG (or jpeg/webp)
 * `Blob`. Returns `null` in non-browser hosts (jsdom) so callers can fall back
 * to the SVG path. The whole chart — task-tree grid, header band, bars, and the
 * dependency SVG — is captured at `pixelRatio` on the chosen background.
 */
export async function ganttToImageBlob(
  root: HTMLElement,
  opts: GanttPngOptions = {},
  host: HTMLElement | null = root,
): Promise<Blob | null> {
  const exported = serializeGanttToSvg(root, opts, host);
  const canvas = await rasterizeGanttSvg(exported, opts);
  if (!canvas) return null;
  return canvasToBlob(canvas, opts.type ?? 'image/png', clamp(opts.quality ?? 0.92, 0, 1));
}

/** Convenience alias: rasterize the Gantt to a PNG `Blob`. */
export function ganttToPngBlob(
  root: HTMLElement,
  opts: Omit<GanttPngOptions, 'type'> = {},
  host: HTMLElement | null = root,
): Promise<Blob | null> {
  return ganttToImageBlob(root, { ...opts, type: 'image/png' }, host);
}

/**
 * Rasterize the full export-rendered Gantt to a `data:` URL. Returns `null` in
 * non-browser hosts (jsdom).
 */
export async function ganttToImageDataUrl(
  root: HTMLElement,
  opts: GanttPngOptions = {},
  host: HTMLElement | null = root,
): Promise<string | null> {
  const exported = serializeGanttToSvg(root, opts, host);
  const canvas = await rasterizeGanttSvg(exported, opts);
  if (!canvas) return null;
  try {
    return canvas.toDataURL(opts.type ?? 'image/png', clamp(opts.quality ?? 0.92, 0, 1));
  } catch {
    return null;
  }
}

/**
 * Trigger a browser download of `data` (Blob or string) as `filename`. No-op in
 * hosts without the object-URL API (jsdom), so callers can still produce + return
 * the payload without a DOM side effect.
 */
export function downloadImage(data: Blob | string, filename: string, mime: string): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  if (
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof document === 'undefined'
  ) {
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. DISPOSABLE CONTROLLER (feature/mixin shape — like GanttPrintController)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Options for {@link GanttImageExporter.export}. */
export interface GanttImageExportOptions extends GanttPngOptions {
  /**
   * The element to capture (defaults to the controller's root). Lets a caller
   * export a sub-region (e.g. only the bars layer).
   */
  target?: HTMLElement;
  /**
   * When set, the produced Blob is offered as a browser download under this
   * filename (extension inferred from `type` if missing).
   */
  download?: string;
}

/**
 * Wraps the PNG-export functions as a small disposable controller, mirroring
 * `GanttPrintController`: construct it with the Gantt root, call `export()` to get
 * a Blob (optionally auto-downloading), `exportDataUrl()` for a data-URL, or
 * `serialize()` for the standalone SVG. It owns no listeners; `destroy()` simply
 * marks it inert so a feature teardown is uniform and idempotent.
 *
 * It is intentionally decoupled from the `Gantt` widget — it takes a root element
 * so it can be installed as a feature/mixin without touching the widget class.
 */
export class GanttImageExporter {
  private readonly root: HTMLElement;
  private readonly host: HTMLElement;
  private destroyed = false;

  /**
   * @param root The Gantt root to capture (`.jects-gantt`).
   * @param host Optional element to resolve theme tokens from (defaults to root).
   */
  constructor(root: HTMLElement, host: HTMLElement = root) {
    this.root = root;
    this.host = host;
  }

  /** Serialize the (full-chart) Gantt to a standalone SVG export descriptor. */
  serialize(opts: GanttImageExportOptions = {}): GanttSvgExport {
    return serializeGanttToSvg(this.target(opts), opts, this.host);
  }

  /** The export-rendered (fully expanded) size in CSS px. */
  measure(opts: Pick<GanttPngOptions, 'fullChart' | 'padding'> = {}): GanttExportSize {
    return measureGanttExport(this.root, opts);
  }

  /**
   * Rasterize the Gantt to a Blob (PNG by default). Resolves `null` under jsdom.
   * When `opts.download` is set and a Blob is produced, also offers it as a file.
   */
  async export(opts: GanttImageExportOptions = {}): Promise<Blob | null> {
    if (this.destroyed) return null;
    const blob = await ganttToImageBlob(this.target(opts), opts, this.host);
    if (blob && opts.download) {
      downloadImage(blob, this.withExt(opts.download, opts.type), blob.type);
    }
    return blob;
  }

  /** Rasterize the Gantt to a data-URL (PNG by default). Resolves `null` under jsdom. */
  exportDataUrl(opts: GanttImageExportOptions = {}): Promise<string | null> {
    if (this.destroyed) return Promise.resolve(null);
    return ganttToImageDataUrl(this.target(opts), opts, this.host);
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

  private withExt(name: string, type: GanttImageMimeType | undefined): string {
    if (/\.[a-z0-9]+$/i.test(name)) return name;
    const ext =
      type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
    return `${name}.${ext}`;
  }
}
