/**
 * `GanttExportMenu` — the **unified export menu / format dispatcher UI** for
 * `@jects/gantt`, matching the Bryntum/DHTMLX *"Export … + print"* parity
 * affordance: a single toolbar entry point (a `@jects/widgets` {@link Button})
 * that opens a popup {@link Menu} (via {@link ContextMenu}) listing every
 * **available** export format plus **Print**, and dispatches the chosen format
 * to its corresponding exporter — triggering the download — with one click.
 *
 * ## Why this exists (and how it differs from `export/export-toolbar.ts`)
 * The package already ships the per-format export *engines* and their wiring
 * features that graft methods onto a live `Gantt`:
 *   - `exportCsv()` / `exportCsvDownload()`  (CSV)            — `GanttExportCsv`
 *   - `exportXlsx*()` / `exportXlsxDownload()` (Excel/XLSX)   — `GanttExportXlsx`
 *   - `exportPng()` / `exportImage()` (PNG/image)            — `GanttImageExportFeature`
 *   - `exportPdf()` (PDF)                                     — `GanttPdfExportFeature`
 *   - `exportIcs()` (iCalendar)                              — `GanttIcsExportFeature`
 *   - MSPDI (MS Project XML) via `ganttToMsProjectXml(gantt)` — the `io` codec
 *
 * `export/export-toolbar.ts` adds a *single, PNG-only* button. What was still
 * missing for true parity is **one user-facing entry point that lets the user
 * pick a format** (CSV / Excel / PNG / PDF / ICS / MS Project) **or print**, and
 * routes to the right exporter. This module is that **format dispatcher**.
 *
 * ## Design
 *   - Additive {@link GanttFeature}: install via
 *     `gantt.use(new GanttExportMenu())` or
 *     `new Gantt(el, { plugins: [new GanttExportMenu()] })`. It touches ONLY the
 *     public `GanttApi` (`el`, `track`, and — structurally — the grafted
 *     `exportCsv*`/`exportXlsx*`/`exportPng`/`exportPdf`/`exportIcs` methods).
 *     It NEVER edits the `Gantt` widget class, the frozen contract, or any other
 *     feature — mirroring the package's established extension seam.
 *   - Reuses `@jects/widgets`: the trigger is a {@link Button} (`aria-haspopup`,
 *     `aria-expanded`), the popup is a {@link ContextMenu} wrapping {@link Menu}
 *     (full ARIA `menu`/`menuitem`, roving tabindex, type-ahead, Escape/
 *     click-outside dismissal, focus trap + focus return — all inherited).
 *   - **Availability detection:** at open time the menu lists only formats whose
 *     exporter is actually reachable (the corresponding grafted method exists, or
 *     — for MSPDI / Print — the always-available path). Consumers may override the
 *     visible set / order via `config.formats`, force-enable via `config.include`,
 *     or hide via `config.exclude`.
 *   - **Dispatch:** selecting a format fires a vetoable `beforeExport`, then runs
 *     the exporter (download side effect owned by the exporter / this feature),
 *     then fires `export`. Selecting **Print** fires `beforePrint` → `print`
 *     (default `window.print()`, overridable via `config.onPrint`).
 *   - Token-pure CSS (side-effect import). All disposers (the Button, the
 *     ContextMenu, listeners, owned DOM) are released on `destroy()`, registered
 *     through `api.track`, so teardown leaks nothing and is idempotent.
 */

import './export-feature.css';
import type { Model } from '@jects/core';
import { Button } from '@jects/widgets';
import { ContextMenu, type MenuItem } from '@jects/widgets';
import type { GanttApi, GanttFeature } from '../contract.js';
import { ganttToMsProjectXml } from '../io/gantt-bridge.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. TYPES — formats, config, events
   ═══════════════════════════════════════════════════════════════════════════ */

/** Registry name this feature installs under (`gantt.features.get(...)`). */
export const GANTT_EXPORT_MENU_FEATURE = 'gantt-export-menu';

/**
 * The export formats the dispatcher can offer. `print` is the print action (not a
 * file format); the rest map to a concrete exporter.
 */
export type GanttExportFormat =
  | 'csv'
  | 'xlsx'
  | 'png'
  | 'pdf'
  | 'ics'
  | 'mspdi'
  | 'print';

/** A descriptor for one entry in the export menu. */
export interface GanttExportFormatSpec {
  /** Format key (also the menu item id + `data-format`). */
  format: GanttExportFormat;
  /** Visible menu label. */
  label: string;
  /** File extension (sans dot) used for the default download filename. */
  ext?: string;
}

/**
 * The default catalogue of formats the dispatcher knows how to drive, in menu
 * order. The visible subset is intersected with the formats actually reachable on
 * the live Gantt (unless overridden via {@link GanttExportMenuConfig.formats}).
 */
export const DEFAULT_EXPORT_FORMATS: readonly GanttExportFormatSpec[] = [
  { format: 'csv', label: 'CSV (.csv)', ext: 'csv' },
  { format: 'xlsx', label: 'Excel (.xlsx)', ext: 'xlsx' },
  { format: 'png', label: 'Image (.png)', ext: 'png' },
  { format: 'pdf', label: 'PDF (.pdf)', ext: 'pdf' },
  { format: 'ics', label: 'iCalendar (.ics)', ext: 'ics' },
  { format: 'mspdi', label: 'MS Project (.xml)', ext: 'xml' },
  { format: 'print', label: 'Print…' },
] as const;

/** Configuration for {@link GanttExportMenu}. */
export interface GanttExportMenuConfig {
  /**
   * Accessible name + visible label for the trigger button. Default `'Export'`.
   */
  label?: string;
  /** Accessible name for the popup menu. Default `'Export options'`. */
  menuLabel?: string;
  /**
   * Base filename (sans extension) used for downloads — the extension is added
   * per format. Default `'gantt'`.
   */
  filename?: string;
  /**
   * Explicit, ordered set of formats to show. When provided, ONLY these are
   * considered (still gated by availability unless listed in {@link include}).
   * Each entry may be a bare {@link GanttExportFormat} (default label/ext used)
   * or a full {@link GanttExportFormatSpec}.
   */
  formats?: Array<GanttExportFormat | GanttExportFormatSpec>;
  /**
   * Formats to force-show even if availability detection says the exporter is
   * not reachable (e.g. you know it will be grafted by open time, or you handle
   * it in `onExport`).
   */
  include?: GanttExportFormat[];
  /** Formats to always hide, regardless of availability. */
  exclude?: GanttExportFormat[];
  /**
   * Host the trigger button is appended to. Defaults to the Gantt root (`api.el`)
   * so the button floats in the chart's top-end corner.
   */
  host?: HTMLElement;
  /** Render the button's text label. Default `true` (icon + label). */
  showLabel?: boolean;
  /**
   * Custom print handler. Default calls `window.print()`. Return `false` from
   * `beforePrint` (event) to cancel before this runs.
   */
  onPrint?(api: GanttApi): void;
  /**
   * Hook invoked after a format is dispatched, with the produced artifact when
   * one is available synchronously (CSV/ICS/MSPDI return a string; XLSX/PNG/PDF
   * resolve a Blob via the grafted method which also performs the download).
   * Returning `false` suppresses the default download for the string formats
   * (CSV/ICS/MSPDI) so the consumer can handle persistence itself.
   */
  onExport?(detail: GanttExportResult): boolean | void;
}

/** Detail echoed on the `export` event + passed to `onExport`. */
export interface GanttExportResult {
  /** The format that was exported. */
  format: Exclude<GanttExportFormat, 'print'>;
  /** Resolved download filename (with extension). */
  filename: string;
  /** The serialized text for string-based formats (CSV/ICS/MSPDI), else null. */
  text: string | null;
  /** The produced Blob for binary/async formats (XLSX/PNG/PDF), else null. */
  blob: Blob | null;
}

/** Typed event map for {@link GanttExportMenu}. Follows the veto convention. */
export interface GanttExportMenuEvents<T extends Model = Model> {
  /** The popup menu opened. */
  menuShow: { feature: GanttExportMenu<T> };
  /** The popup menu closed. */
  menuHide: { feature: GanttExportMenu<T> };
  /** Vetoable: a format is about to be exported. Return `false` to cancel. */
  beforeExport: { feature: GanttExportMenu<T>; format: Exclude<GanttExportFormat, 'print'> };
  /** A format finished exporting. */
  export: GanttExportResult & { feature: GanttExportMenu<T> };
  /** Vetoable: about to print. Return `false` to cancel. */
  beforePrint: { feature: GanttExportMenu<T> };
  /** Print was invoked. */
  print: { feature: GanttExportMenu<T> };
}

type Listener<P> = (payload: P) => unknown;

/* ═══════════════════════════════════════════════════════════════════════════
   2. STRUCTURAL VIEW OF GRAFTED EXPORTERS (read, never import the features)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The methods the per-format export features graft onto the live Gantt. Read
 * structurally so this module does not import those features (no install-order
 * coupling) and only lists a format when its method is genuinely present.
 */
interface GraftedExporters {
  exportCsv?: (options?: unknown) => string;
  exportCsvDownload?: (fileName?: string, options?: unknown) => void;
  exportXlsxBlob?: (options?: unknown) => Blob;
  exportXlsxDownload?: (fileName?: string, options?: unknown) => void;
  exportPng?: (opts?: { download?: string }) => Promise<Blob | null>;
  exportPdf?: (opts?: { download?: string }) => Promise<Blob | null>;
  exportIcs?: (options?: { download?: boolean | string }) => string;
}

const BLOCK = 'jects-gantt__export-menu';

/* ═══════════════════════════════════════════════════════════════════════════
   3. FEATURE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The unified export menu `GanttFeature`. See the module docblock. Install once
 * per Gantt (a second instance with the same `name` is rejected by the widget's
 * feature registry).
 */
export class GanttExportMenu<T extends Model = Model> implements GanttFeature<T> {
  readonly name = GANTT_EXPORT_MENU_FEATURE;

  private readonly cfg: GanttExportMenuConfig;
  private api: GanttApi<T> | null = null;

  private wrapEl: HTMLElement | null = null;
  private trigger: Button | null = null;
  private menu: ContextMenu | null = null;

  private disposers: Array<() => void> = [];
  private listeners = new Map<keyof GanttExportMenuEvents<T>, Set<Listener<unknown>>>();
  private destroyed = false;
  private busy = false;

  constructor(config: GanttExportMenuConfig = {}) {
    this.cfg = { ...config };
  }

  /* ── GanttFeature lifecycle ───────────────────────────────────────────── */

  init(api: GanttApi<T>): void {
    // Re-init after destroy() (instance reuse) starts clean.
    this.destroyed = false;
    this.disposers = [];
    this.api = api;

    this.build(api);
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

    this.menu?.destroy();
    this.menu = null;
    this.trigger?.destroy();
    this.trigger = null;
    this.wrapEl?.remove();
    this.wrapEl = null;

    this.listeners.clear();
    this.api = null;
  }

  /* ── typed event surface ──────────────────────────────────────────────── */

  /** Subscribe to a feature event; returns an unsubscribe disposer. */
  on<K extends keyof GanttExportMenuEvents<T>>(
    event: K,
    fn: Listener<GanttExportMenuEvents<T>[K]>,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<unknown>);
    return () => {
      this.listeners.get(event)?.delete(fn as Listener<unknown>);
    };
  }

  /** Emit a feature event; returns `false` iff a handler vetoed (`beforeX`). */
  private emit<K extends keyof GanttExportMenuEvents<T>>(
    event: K,
    payload: GanttExportMenuEvents<T>[K],
  ): boolean {
    let ok = true;
    const set = this.listeners.get(event);
    if (set) {
      for (const fn of [...set]) {
        if (fn(payload) === false) ok = false;
      }
    }
    return ok;
  }

  /* ── public controls ──────────────────────────────────────────────────── */

  /** Open the export menu programmatically (anchored to the trigger button). */
  open(): this {
    this.openMenu();
    return this;
  }

  /** Close the export menu programmatically. */
  close(): this {
    this.menu?.close('api');
    return this;
  }

  /** Is the popup menu currently open? */
  get opened(): boolean {
    return !!this.menu?.opened;
  }

  /**
   * The formats currently offered (available ∩ requested). Useful for tests /
   * conditional UI.
   */
  availableFormats(): GanttExportFormat[] {
    return this.resolveSpecs().map((s) => s.format);
  }

  /**
   * Programmatically dispatch a format (the same code path a menu selection
   * runs). Resolves the {@link GanttExportResult} (or `null` if vetoed / no
   * exporter / `print`). Exposed so a custom UI can drive the dispatcher.
   */
  exportFormat(format: GanttExportFormat): Promise<GanttExportResult | null> {
    return this.dispatch(format);
  }

  /* ── build ────────────────────────────────────────────────────────────── */

  private build(api: GanttApi<T>): void {
    const host = this.cfg.host ?? api.el;

    const wrap = document.createElement('div');
    wrap.className = BLOCK;
    wrap.setAttribute('role', 'toolbar');
    wrap.setAttribute('aria-label', 'Export');

    // Trigger button (reuse @jects/widgets Button).
    const triggerHost = document.createElement('div');
    triggerHost.className = `${BLOCK}__trigger`;
    wrap.appendChild(triggerHost);

    const label = this.cfg.label ?? 'Export';
    const showLabel = this.cfg.showLabel !== false;
    this.trigger = new Button(triggerHost, {
      ...(showLabel ? { text: label } : {}),
      icon: 'arrow-down',
      variant: 'secondary',
      size: 'sm',
      onClick: () => this.toggleMenu(),
    });

    // The Button widget owns `triggerHost`'s child; tag the actual <button> with
    // the popup ARIA semantics. Button.render() does not touch these attributes,
    // so they survive the busy/loading re-render.
    const btnEl = triggerHost.querySelector('button');
    if (btnEl) {
      btnEl.setAttribute('aria-haspopup', 'menu');
      btnEl.setAttribute('aria-expanded', 'false');
      btnEl.setAttribute('aria-label', label);
      btnEl.title = label;
      btnEl.dataset['exportMenuTrigger'] = '';
    }

    // Popup menu host (the ContextMenu builds its own floating container).
    const menuHost = document.createElement('div');
    menuHost.className = `${BLOCK}__popup-host`;
    wrap.appendChild(menuHost);

    this.menu = new ContextMenu(menuHost, {
      items: [],
      label: this.cfg.menuLabel ?? 'Export options',
      closeOnSelect: true,
    });
    this.menu.on('select', ({ item }) => {
      const format = (item.data as { format?: GanttExportFormat } | undefined)?.format;
      if (format) void this.dispatch(format);
    });
    this.menu.on('open', () => {
      btnEl?.setAttribute('aria-expanded', 'true');
      this.emit('menuShow', { feature: this });
    });
    this.menu.on('close', () => {
      btnEl?.setAttribute('aria-expanded', 'false');
      this.emit('menuHide', { feature: this });
    });

    host.appendChild(wrap);
    this.wrapEl = wrap;
  }

  /* ── menu open / availability ─────────────────────────────────────────── */

  private toggleMenu(): void {
    if (this.opened) this.close();
    else this.openMenu();
  }

  private openMenu(): void {
    if (this.destroyed || !this.menu) return;
    const specs = this.resolveSpecs();
    if (specs.length === 0) return;
    this.menu.update({ items: specs.map((s) => this.itemFor(s)) });

    // Anchor the popup just below the trigger button's bottom-start corner.
    const btnEl = this.wrapEl?.querySelector('button');
    const rect = btnEl?.getBoundingClientRect();
    const x = rect ? rect.left : 0;
    const y = rect ? rect.bottom + 2 : 0;
    this.menu.openAt(x, y);
  }

  private itemFor(spec: GanttExportFormatSpec): MenuItem {
    return {
      id: `export-${spec.format}`,
      text: spec.label,
      data: { format: spec.format },
    };
  }

  /**
   * Resolve the visible, ordered format specs: the requested set (config.formats
   * or the default catalogue) intersected with availability, with `include`
   * forcing entries on and `exclude` forcing them off.
   */
  private resolveSpecs(): GanttExportFormatSpec[] {
    const exclude = new Set(this.cfg.exclude ?? []);
    const include = new Set(this.cfg.include ?? []);

    const requested: GanttExportFormatSpec[] = (this.cfg.formats
      ? this.cfg.formats.map((f) => (typeof f === 'string' ? this.specFor(f) : f))
      : [...DEFAULT_EXPORT_FORMATS]
    ).filter((s): s is GanttExportFormatSpec => !!s);

    return requested.filter((s) => {
      if (exclude.has(s.format)) return false;
      if (include.has(s.format)) return true;
      return this.isAvailable(s.format);
    });
  }

  private specFor(format: GanttExportFormat): GanttExportFormatSpec {
    return (
      DEFAULT_EXPORT_FORMATS.find((s) => s.format === format) ?? {
        format,
        label: format.toUpperCase(),
      }
    );
  }

  /** Is the exporter for `format` reachable on the live Gantt right now? */
  private isAvailable(format: GanttExportFormat): boolean {
    const g = this.grafted();
    switch (format) {
      case 'csv':
        return typeof g.exportCsvDownload === 'function' || typeof g.exportCsv === 'function';
      case 'xlsx':
        return typeof g.exportXlsxDownload === 'function' || typeof g.exportXlsxBlob === 'function';
      case 'png':
        return typeof g.exportPng === 'function';
      case 'pdf':
        return typeof g.exportPdf === 'function';
      case 'ics':
        return typeof g.exportIcs === 'function';
      case 'mspdi':
        // Always available — driven by the `io` codec over the public API.
        return true;
      case 'print':
        // Always available — `window.print()` (or `onPrint`).
        return true;
      default:
        return false;
    }
  }

  private grafted(): GraftedExporters {
    return (this.api ?? {}) as unknown as GraftedExporters;
  }

  /* ── dispatch ─────────────────────────────────────────────────────────── */

  private async dispatch(
    format: GanttExportFormat,
  ): Promise<GanttExportResult | null> {
    if (this.destroyed || this.busy) return null;
    const api = this.api;
    if (!api) return null;

    if (format === 'print') {
      if (this.emit('beforePrint', { feature: this }) === false) return null;
      this.doPrint(api);
      this.emit('print', { feature: this });
      return null;
    }

    if (this.emit('beforeExport', { feature: this, format }) === false) return null;

    const ext = this.specFor(format).ext ?? format;
    const filename = `${this.cfg.filename ?? 'gantt'}.${ext}`;

    this.setBusy(true);
    try {
      const plan = await this.runExporter(format, filename, api);
      if (!plan) return null;
      // `onExport` is invoked exactly once. For the string formats (CSV/ICS/MSPDI)
      // a `false` return suppresses the implicit download this feature owns; the
      // binary/async formats (XLSX/PNG/PDF) already downloaded inside the grafted
      // exporter, so the hook is notify-only for those.
      const keep = this.cfg.onExport?.(plan.result);
      if (plan.download && keep !== false) plan.download();
      this.emit('export', { ...plan.result, feature: this });
      return plan.result;
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Run the format's exporter and return its {@link GanttExportResult} plus an
   * optional `download` thunk that performs the implicit file download (present
   * only for the string formats this feature downloads itself; the grafted
   * binary/async exporters download internally via `{ download: filename }`).
   * Returns `null` when no exporter for `format` is reachable.
   */
  private async runExporter(
    format: Exclude<GanttExportFormat, 'print'>,
    filename: string,
    api: GanttApi<T>,
  ): Promise<{ result: GanttExportResult; download?: () => void } | null> {
    const g = this.grafted();
    switch (format) {
      case 'csv': {
        if (typeof g.exportCsv === 'function') {
          const text = g.exportCsv();
          const download =
            typeof g.exportCsvDownload === 'function'
              ? () => g.exportCsvDownload!(filename)
              : () => downloadText(text, filename, 'text/csv');
          return { result: { format, filename, text, blob: null }, download };
        }
        if (typeof g.exportCsvDownload === 'function') {
          return {
            result: { format, filename, text: null, blob: null },
            download: () => g.exportCsvDownload!(filename),
          };
        }
        return null;
      }
      case 'xlsx': {
        if (typeof g.exportXlsxBlob === 'function') {
          const blob = safe(() => g.exportXlsxBlob!());
          const download =
            typeof g.exportXlsxDownload === 'function'
              ? () => g.exportXlsxDownload!(filename)
              : blob
                ? () => downloadBlob(blob, filename)
                : undefined;
          return { result: { format, filename, text: null, blob }, ...(download ? { download } : {}) };
        }
        if (typeof g.exportXlsxDownload === 'function') {
          return {
            result: { format, filename, text: null, blob: null },
            download: () => g.exportXlsxDownload!(filename),
          };
        }
        return null;
      }
      case 'png': {
        if (typeof g.exportPng !== 'function') return null;
        // The grafted exporter downloads internally (honors `download`).
        const blob = await g.exportPng({ download: filename }).catch(() => null);
        return { result: { format, filename, text: null, blob } };
      }
      case 'pdf': {
        if (typeof g.exportPdf !== 'function') return null;
        const blob = await g.exportPdf({ download: filename }).catch(() => null);
        return { result: { format, filename, text: null, blob } };
      }
      case 'ics': {
        if (typeof g.exportIcs !== 'function') return null;
        const text = g.exportIcs();
        return {
          result: { format, filename, text, blob: null },
          download: () => downloadText(text, filename, 'text/calendar'),
        };
      }
      case 'mspdi': {
        const text = ganttToMsProjectXml(api as never);
        return {
          result: { format, filename, text, blob: null },
          download: () => downloadText(text, filename, 'application/xml'),
        };
      }
      default:
        return null;
    }
  }

  private doPrint(api: GanttApi<T>): void {
    if (this.cfg.onPrint) {
      this.cfg.onPrint(api as unknown as GanttApi);
      return;
    }
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print();
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.trigger?.update({ loading: busy } as never);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. FACTORY
   ═══════════════════════════════════════════════════════════════════════════ */

/** Construct a {@link GanttExportMenu} (config-forwarding convenience). */
export function createGanttExportMenu<T extends Model = Model>(
  config: GanttExportMenuConfig = {},
): GanttExportMenu<T> {
  return new GanttExportMenu<T>(config);
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. DOWNLOAD HELPERS (jsdom-safe — guarded against missing URL APIs)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Trigger a browser download of `text` as a file. No-op outside a DOM. */
export function downloadText(text: string, filename: string, mime: string): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

/** Trigger a browser download of `blob` via a transient anchor. */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = createObjectUrl(blob);
  if (url == null) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  revokeObjectUrl(url);
}

function createObjectUrl(blob: Blob): string | null {
  const u = (typeof URL !== 'undefined' ? URL : undefined) as
    | { createObjectURL?: (b: Blob) => string }
    | undefined;
  if (u && typeof u.createObjectURL === 'function') {
    try {
      return u.createObjectURL(blob);
    } catch {
      return null;
    }
  }
  return null;
}

function revokeObjectUrl(url: string): void {
  const u = (typeof URL !== 'undefined' ? URL : undefined) as
    | { revokeObjectURL?: (u: string) => void }
    | undefined;
  if (u && typeof u.revokeObjectURL === 'function') {
    // Defer so the click's navigation/blob fetch can complete first.
    setTimeout(() => {
      try {
        u.revokeObjectURL!(url);
      } catch {
        /* best-effort */
      }
    }, 0);
  }
}

function safe<R>(fn: () => R): R | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
