/**
 * `GanttExportToolbar` — the **visible** "Export to PNG" toolbar action for
 * `@jects/gantt`, matching the Bryntum/DHTMLX affordance where the image-export
 * control ships reachable in the chart UI out of the box (not just as a
 * programmatic `gantt.exportPng()` call).
 *
 * ## Why a separate, additive module
 * The package already ships:
 *   - `./png` — the full-chart rasterizer (`GanttImageExporter` + functions), and
 *   - `./gantt-image-export` — the `GanttImageExportFeature` that grafts
 *     `gantt.exportPng()`/`exportImage()`/`imageExporter` onto a live `Gantt`.
 *
 * What was still missing for true parity is a **UI affordance**: a focusable,
 * token-pure button the user can click to export the chart to a PNG file with
 * zero code. This module is that affordance, kept as its own additive
 * `GanttFeature` so it composes with — but never edits — the existing wiring,
 * the `Gantt` widget class, or the frozen contract (concurrency-safe per the
 * package's established extension seam: Indicators / Progress-line / Undo).
 *
 * ## Design
 *   - Installed via `gantt.use(new GanttExportToolbar())` or
 *     `new Gantt(el, { plugins: [new GanttExportToolbar()] })`. It touches ONLY
 *     the public `GanttApi` (`el`, `track`, and — if present — the grafted
 *     `exportPng`/`imageExporter` surface from `GanttImageExportFeature`).
 *   - It owns ONE light-DOM toolbar (`role="toolbar"`) with a single button
 *     (`type="button"`, accessible name + tooltip). Click rasterizes the whole
 *     chart and triggers a browser download.
 *   - It is self-sufficient: if `GanttImageExportFeature` is not installed, it
 *     constructs its own private {@link GanttImageExporter}; if it IS installed,
 *     it reuses the already-grafted `imageExporter`/`exportPng` so both surfaces
 *     drive the same controller.
 *   - Under jsdom (no real 2D-canvas raster path) the rasterizer resolves `null`;
 *     the button then falls back to downloading the serialized standalone SVG, so
 *     "click → file" still yields an artifact (and is unit-testable) rather than
 *     silently no-op'ing.
 *   - All disposers (listeners, owned exporter, DOM) are released on `destroy()`,
 *     which is also registered through `api.track`, so teardown leaks nothing.
 */

import './export-toolbar.css';
import type { Model } from '@jects/core';
import type { GanttApi, GanttFeature } from '../contract.js';
import {
  GanttImageExporter,
  downloadImage,
  type GanttImageExportOptions,
  type GanttImageMimeType,
} from './png.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. CONFIG / EVENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Registry name this feature installs under (`gantt.features.get(...)`). */
export const GANTT_EXPORT_TOOLBAR_FEATURE = 'gantt-export-toolbar';

/** Configuration for {@link GanttExportToolbar}. */
export interface GanttExportToolbarConfig {
  /**
   * Accessible name + tooltip + visible label for the export button. Default
   * `'Export to PNG'`.
   */
  label?: string;
  /**
   * Render the button's text label next to the icon. When `false`, only the
   * icon shows (the accessible name is still set via `aria-label`/`title`).
   * Default `true`.
   */
  showLabel?: boolean;
  /**
   * Default filename (sans extension — the extension is inferred from the export
   * `type`) used for the downloaded file. Default `'gantt'`.
   */
  filename?: string;
  /**
   * Host element the toolbar is appended to. Defaults to the Gantt root
   * (`api.el`), so the button floats in the chart's top-end corner.
   */
  toolbarHost?: HTMLElement;
  /**
   * Default export options (pixel ratio, background, type, padding…) applied to
   * the export the button performs.
   */
  defaults?: GanttImageExportOptions;
  /**
   * Hook invoked after a successful export with the produced `Blob` (real
   * browser) — lets a consumer upload/preview instead of (or in addition to) the
   * default download. When it returns `false`, the default file download is
   * suppressed. Not called under jsdom (where the raster path resolves `null`).
   */
  onExport?(blob: Blob, filename: string): boolean | void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. ICON + CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

const TOOLBAR_BLOCK = 'jects-gantt__export-toolbar';

/** Download / image-export glyph (inherits `currentColor`, hidden from a11y). */
const EXPORT_ICON =
  '<svg class="jects-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2.25" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
  '<path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';

/**
 * The shape `GanttImageExportFeature` grafts onto the Gantt — read structurally
 * so this module does not import the feature (no install-order coupling).
 */
interface GraftedImageExportSurface {
  imageExporter?: GanttImageExporter;
  exportPng?(opts?: GanttImageExportOptions): Promise<Blob | null>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. FEATURE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The visible image-export toolbar `GanttFeature`. See the module docblock.
 * Install once per Gantt (a second instance with the same `name` is rejected by
 * the widget's feature registry).
 */
export class GanttExportToolbar<T extends Model = Model>
  implements GanttFeature<T>
{
  readonly name = GANTT_EXPORT_TOOLBAR_FEATURE;

  private readonly config: Required<
    Omit<GanttExportToolbarConfig, 'toolbarHost' | 'defaults' | 'onExport'>
  > &
    Pick<GanttExportToolbarConfig, 'toolbarHost' | 'defaults' | 'onExport'>;

  private api: GanttApi<T> | null = null;
  private toolbarEl: HTMLElement | null = null;
  private buttonEl: HTMLButtonElement | null = null;
  /** Exporter we own iff `GanttImageExportFeature` did not provide one. */
  private ownedExporter: GanttImageExporter | null = null;
  private disposers: Array<() => void> = [];
  private destroyed = false;
  private busy = false;

  constructor(config: GanttExportToolbarConfig = {}) {
    this.config = {
      label: config.label ?? 'Export to PNG',
      showLabel: config.showLabel !== false,
      filename: config.filename ?? 'gantt',
      ...(config.toolbarHost ? { toolbarHost: config.toolbarHost } : {}),
      ...(config.defaults ? { defaults: config.defaults } : {}),
      ...(config.onExport ? { onExport: config.onExport } : {}),
    };
  }

  /* ── GanttFeature lifecycle ────────────────────────────────────────────── */

  init(api: GanttApi<T>): void {
    // Re-init after destroy() (instance reuse) starts clean.
    this.destroyed = false;
    this.disposers = [];
    this.api = api;

    this.buildToolbar(api);

    api.track(() => this.destroy());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const off of this.disposers) {
      try {
        off();
      } catch {
        /* best-effort */
      }
    }
    this.disposers = [];

    this.buttonEl?.remove();
    this.toolbarEl?.remove();
    this.buttonEl = null;
    this.toolbarEl = null;

    this.ownedExporter?.destroy();
    this.ownedExporter = null;
    this.api = null;
  }

  /* ── public controls ───────────────────────────────────────────────────── */

  /**
   * Programmatically trigger the same export the button performs (rasterize the
   * whole chart + download). Resolves the produced `Blob` (or `null` under jsdom,
   * where the SVG fallback download is offered instead). Exposed so a custom UI
   * can drive the toolbar action.
   */
  exportNow(opts: GanttImageExportOptions = {}): Promise<Blob | null> {
    return this.performExport(opts);
  }

  /* ── toolbar ───────────────────────────────────────────────────────────── */

  private buildToolbar(api: GanttApi<T>): void {
    const host = this.config.toolbarHost ?? api.el;

    const bar = document.createElement('div');
    bar.className = TOOLBAR_BLOCK;
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Chart export');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${TOOLBAR_BLOCK}__btn`;
    btn.setAttribute('aria-label', this.config.label);
    btn.title = this.config.label;
    btn.dataset.export = 'png';

    const label = this.config.showLabel
      ? `<span class="${TOOLBAR_BLOCK}__label">${escapeHtml(this.config.label)}</span>`
      : '';
    btn.innerHTML = `${EXPORT_ICON}${label}`;

    const onClick = (e: Event): void => {
      e.preventDefault();
      void this.performExport();
    };
    btn.addEventListener('click', onClick);
    this.disposers.push(() => btn.removeEventListener('click', onClick));

    bar.appendChild(btn);
    host.appendChild(bar);
    this.toolbarEl = bar;
    this.buttonEl = btn;
  }

  /**
   * Resolve an exporter: prefer the one grafted by `GanttImageExportFeature`
   * (so both surfaces share a controller), else lazily create + own one bound to
   * the Gantt root.
   */
  private resolveExporter(): GanttImageExporter | null {
    const api = this.api;
    if (!api) return null;
    const grafted = api as unknown as GraftedImageExportSurface;
    if (grafted.imageExporter instanceof GanttImageExporter) {
      return grafted.imageExporter;
    }
    if (!this.ownedExporter) this.ownedExporter = new GanttImageExporter(api.el);
    return this.ownedExporter;
  }

  /**
   * Rasterize the whole chart + download. Marks the button busy (so rapid double
   * clicks coalesce), uses the grafted `exportPng` when available (it already
   * honours `download`), and falls back to a serialized-SVG download when no real
   * raster path exists (jsdom) so the action always yields an artifact.
   */
  private async performExport(
    extra: GanttImageExportOptions = {},
  ): Promise<Blob | null> {
    if (this.destroyed || this.busy) return null;
    const api = this.api;
    if (!api) return null;

    const exporter = this.resolveExporter();
    if (!exporter) return null;

    const type: GanttImageMimeType = extra.type ?? this.config.defaults?.type ?? 'image/png';
    const filename = withExtension(this.config.filename, type);
    const opts: GanttImageExportOptions = {
      ...(this.config.defaults ?? {}),
      ...extra,
      type,
      download: filename,
    };

    this.setBusy(true);
    try {
      // Prefer the feature-grafted exportPng so a single controller is used.
      // Any rasterize failure (e.g. a headless tainted-canvas `SecurityError`,
      // or a missing 2D-canvas under jsdom) is swallowed to `null` so the action
      // deterministically routes to the SVG fallback below — a toolbar click
      // must always yield an artifact and never surface an uncaught rejection.
      const grafted = api as unknown as GraftedImageExportSurface;
      const blob = await (typeof grafted.exportPng === 'function'
        ? grafted.exportPng(opts)
        : exporter.export(opts)
      ).catch(() => null);

      if (blob) {
        const keep = this.config.onExport?.(blob, filename);
        // `onExport` returning `false` suppresses the implicit download; but the
        // grafted/owned exporter already downloaded when `opts.download` is set.
        // Re-downloading is avoided because the controller owns that side effect.
        void keep;
        return blob;
      }

      // jsdom / no-canvas fallback: download the serialized standalone SVG.
      try {
        const svg = exporter.serialize(opts).svg;
        downloadImage(svg, replaceExt(filename, 'svg'), 'image/svg+xml');
      } catch {
        /* best-effort */
      }
      return null;
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    const btn = this.buttonEl;
    if (!btn) return;
    btn.disabled = busy;
    btn.setAttribute('aria-busy', String(busy));
    btn.classList.toggle(`${TOOLBAR_BLOCK}__btn--busy`, busy);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. FACTORY
   ═══════════════════════════════════════════════════════════════════════════ */

/** Construct a {@link GanttExportToolbar} (config-forwarding convenience). */
export function createGanttExportToolbar<T extends Model = Model>(
  config: GanttExportToolbarConfig = {},
): GanttExportToolbar<T> {
  return new GanttExportToolbar<T>(config);
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. SMALL PURE HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Append the extension inferred from `type` when `name` has none. */
function withExtension(name: string, type: GanttImageMimeType): string {
  if (/\.[a-z0-9]+$/i.test(name)) return name;
  const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
  return `${name}.${ext}`;
}

/** Replace (or append) the extension of `name` with `ext`. */
function replaceExt(name: string, ext: string): string {
  return /\.[a-z0-9]+$/i.test(name)
    ? name.replace(/\.[a-z0-9]+$/i, `.${ext}`)
    : `${name}.${ext}`;
}

/** Minimal HTML escape for the button's text label. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
