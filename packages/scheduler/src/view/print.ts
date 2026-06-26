/**
 * Scheduler — Print (export to printer / print-optimized paginated flow).
 *
 * Parity target: Bryntum Scheduler `Print` feature + DHTMLX `export`/print. The
 * timeline is a single wide, virtualized, scrollable surface — it does NOT print
 * usefully as-is (the browser would clip everything past the first page width and
 * height, and the virtualized body only contains the few rows currently in the
 * viewport). This feature produces a **print-optimized, paginated** rendering:
 *
 *   - The full time range is sliced into **horizontal pages** (column breaks), so
 *     a multi-week timeline flows across several sheets left→right instead of
 *     being clipped at the first sheet's width.
 *   - The full resource set is sliced into **vertical pages** (lane / row breaks)
 *     so a tall resource list flows across several sheets top→bottom, and a lane
 *     is never split across a page boundary.
 *   - The **time header band is repeated on every page** (every horizontal page
 *     re-draws the header for its own time slice; every vertical page re-draws the
 *     header at its top), and the **locked resource column is repeated** at the
 *     left of every page so each sheet is self-describing.
 *
 * Design (concurrency-safe, additive):
 *   - This is a standalone **controller** (`installPrint(scheduler)` /
 *     `new PrintController(scheduler)`), wired only through the Scheduler's PUBLIC
 *     surface (`getAxis()`, `getResourceStore()`, `getEventStore()`, `getConfig()`,
 *     `el`, `on()`, `emit()`). It never edits the `Scheduler` class.
 *   - The pure pagination math (`paginate()`) is split out so it is unit-testable
 *     in jsdom without any DOM, a real Scheduler, or a print dialog.
 *   - The rendered print document is built as a self-contained, static, light-DOM
 *     fragment (`buildPrintDocument()`) using only `--jects-*`-token CSS classes,
 *     so the existing `@media print` rules style it. It can be injected into a
 *     hidden same-document iframe (`print()`), returned for tests, or handed to a
 *     caller for a custom export pipeline.
 *
 * Disposable: `destroy()` removes any iframe/listeners it created and is
 * idempotent; it is also auto-disposed when the host scheduler is destroyed.
 */

import { EventEmitter, type RecordId, type EventMap } from '@jects/core';
import type { TimeAxis, TimeSpan, ViewPreset } from '@jects/timeline-core';
import type {
  EventModel,
  ResourceModel,
  ResourceColumnConfig,
  SchedulerConfig,
} from '../contract.js';
import { formatTime } from './format.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Structural host view (decouples the controller from the concrete Scheduler).
   ═══════════════════════════════════════════════════════════════════════════ */

/** The slice of `@jects/core` Store the printer reads (resources/events). */
export interface PrintStore<T> {
  readonly count: number;
  getAt(i: number): T | undefined;
  forEach(fn: (record: T) => void): void;
}

/** The slice of the host `Scheduler` the print controller needs (PUBLIC API). */
export interface PrintHost {
  getAxis(): TimeAxis;
  getResourceStore(): PrintStore<ResourceModel>;
  getEventStore(): PrintStore<EventModel>;
  getConfig(): Readonly<SchedulerConfig>;
  on<E extends string>(event: E, fn: (payload: never) => unknown): () => void;
  emit<E extends string>(event: E, payload: unknown): boolean;
  readonly el?: HTMLElement;
  readonly isDestroyed?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Config + events + result types
   ═══════════════════════════════════════════════════════════════════════════ */

/** Paper orientation for the printed sheets. */
export type PrintOrientation = 'portrait' | 'landscape';

/** Named paper sizes (printable area, CSS px @96dpi, after default margins). */
export type PaperSize = 'a4' | 'letter';

/** Print configuration. */
export interface PrintConfig {
  /** Document title (becomes the print document `<title>` + page header). */
  title?: string;
  /** Paper orientation. Default `'landscape'` (timelines are wide). Default `'landscape'`. */
  orientation?: PrintOrientation;
  /** Paper size. Default `'a4'`. */
  paperSize?: PaperSize;
  /**
   * Printable area per sheet in CSS px `{ width, height }`. Overrides `paperSize`/
   * `orientation` when given (mainly for deterministic tests).
   */
  pageSize?: { width: number; height: number };
  /**
   * Time range to print. Defaults to the axis' full range, so the whole schedule
   * is paginated (not just the on-screen window).
   */
  range?: TimeSpan;
  /** Repeat the time header at the top of every page. Default `true`. */
  repeatHeader?: boolean;
  /** Repeat the locked resource column at the left of every page. Default `true`. */
  repeatResourceColumn?: boolean;
  /** Row height (px) used for the printed lanes. Defaults to the scheduler `rowHeight`. */
  rowHeight?: number;
  /** Print the now-marker line. Default `false` (a print is a static snapshot). */
  showNowMarker?: boolean;
}

/** A horizontal page slice of the time axis (a column break). */
export interface TimePage {
  /** Page index along the time axis (0-based). */
  index: number;
  /** Content-space pixel x where this page starts. */
  x: number;
  /** Pixel width of this page's time slice. */
  width: number;
  /** The time span covered by this page. */
  span: TimeSpan;
}

/** A vertical page slice of the resource lanes (a row / lane break). */
export interface RowPage {
  /** Page index down the resource list (0-based). */
  index: number;
  /** First resource row index (inclusive). */
  startRow: number;
  /** Last resource row index (exclusive). */
  endRow: number;
  /** Content-space pixel y where this page starts. */
  y: number;
  /** Pixel height of this page's lane slice. */
  height: number;
}

/** A single printed sheet = one time page × one row page. */
export interface PrintPage {
  /** Sheet index in document order (row-major: all time pages of row page 0 first). */
  index: number;
  /** Total sheet count. */
  total: number;
  time: TimePage;
  rows: RowPage;
}

/** The full pagination plan. */
export interface PrintPlan {
  /** Horizontal (time) pages, left→right. */
  timePages: TimePage[];
  /** Vertical (lane) pages, top→bottom. Never split a lane across a boundary. */
  rowPages: RowPage[];
  /** The flattened sheet list in print order. */
  pages: PrintPage[];
  /** Resolved row height used for the lanes. */
  rowHeight: number;
  /** Printable width reserved for the timeline body per sheet (page minus column). */
  bodyWidth: number;
  /** Printable height reserved for the lanes per sheet (page minus header). */
  bodyHeight: number;
}

/** Result of a print run (also the `print` event payload). */
export interface PrintResult {
  /** The pagination plan that was rendered. */
  plan: PrintPlan;
  /** The built print document root (a detached `.jects-scheduler-print` element). */
  root: HTMLElement;
}

/** Typed event map for the controller's own emitter. */
export interface PrintEvents extends EventMap {
  /** Vetoable: a print is about to run. Return `false` to cancel. */
  beforePrint: { plan: PrintPlan };
  /** A print document was built + sent to the printer. */
  print: PrintResult;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Geometry constants
   ═══════════════════════════════════════════════════════════════════════════ */

/** Printable area (CSS px @96dpi) for the supported paper sizes, portrait, after
 *  a ~12mm margin all round. Landscape swaps the two. */
const PAPER: Record<PaperSize, { width: number; height: number }> = {
  // A4 = 210×297mm; Letter = 8.5×11in. Minus ~12mm margins → printable area.
  a4: { width: 703, height: 1029 },
  letter: { width: 726, height: 942 },
};

/** Height (px) reserved at the top of each sheet for the title + time header. */
const HEADER_BLOCK = 64;

/** Width (px) reserved at the left of each sheet for the repeated resource column. */
const DEFAULT_COLUMN_WIDTH = 160;

/* ═══════════════════════════════════════════════════════════════════════════
   Pure pagination math — unit-testable, no DOM required.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Resolve the printable page size (px) from config. */
export function resolvePageSize(config: PrintConfig = {}): { width: number; height: number } {
  if (config.pageSize) return config.pageSize;
  const base = PAPER[config.paperSize ?? 'a4'];
  const orientation = config.orientation ?? 'landscape';
  return orientation === 'landscape'
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };
}

/** `PrintConfig` + the resolved resource columns the host injects for layout. */
export interface PrintConfigWithColumns extends PrintConfig {
  columns?: ResourceColumnConfig[];
}

/** Total width of the locked resource columns (sum of column widths). */
export function resourceColumnsWidth(columns: ResourceColumnConfig[] | undefined): number {
  if (!columns || columns.length === 0) return DEFAULT_COLUMN_WIDTH;
  return columns.reduce((sum, c) => sum + (c.width ?? 140), 0);
}

/**
 * Compute the full pagination plan: slice the time axis into horizontal pages and
 * the resource lanes into vertical pages.
 *
 * Time pages: start at the (clamped) range start and walk forward `bodyWidth` px
 * at a time, so each page carries a contiguous, non-overlapping time slice. The
 * last page is trimmed to the range end (never wider than the remaining content).
 *
 * Row pages: pack as many whole lanes as fit in `bodyHeight` without ever
 * splitting a lane across a page boundary; a lane taller than a full page still
 * occupies its own page (it cannot be shrunk to fit). At least one lane per page.
 */
export function paginate(input: {
  axis: TimeAxis;
  resourceCount: number;
  rowHeights?: (i: number) => number;
  config?: PrintConfigWithColumns;
}): PrintPlan {
  const config = input.config ?? {};
  const page = resolvePageSize(config);
  const columns = config.repeatResourceColumn === false ? undefined : config.columns;
  const columnWidth =
    config.repeatResourceColumn === false ? 0 : resourceColumnsWidth(columns);
  const headerBlock = config.repeatHeader === false ? 0 : HEADER_BLOCK;

  const bodyWidth = Math.max(1, page.width - columnWidth);
  const bodyHeight = Math.max(1, page.height - headerBlock);

  const axis = input.axis;
  const range = clampRange(config.range ?? axis.range, axis.range);
  const xStart = axis.toX(range.start);
  const xEnd = axis.toX(range.end);
  const totalW = Math.max(1, xEnd - xStart);

  /* ── horizontal (time) pages ── */
  const timePages: TimePage[] = [];
  let x = xStart;
  let ti = 0;
  // Guard against a degenerate zero-width body causing an infinite loop.
  const step = Math.max(1, bodyWidth);
  while (x < xEnd - 0.5) {
    const w = Math.min(step, xEnd - x);
    timePages.push({
      index: ti,
      x,
      width: w,
      span: { start: axis.toTime(x), end: axis.toTime(x + w) },
    });
    x += w;
    ti++;
    if (ti > 100_000) break; // hard safety cap
  }
  if (timePages.length === 0) {
    timePages.push({ index: 0, x: xStart, width: totalW, span: { ...range } });
  }

  /* ── vertical (lane) pages ── */
  const rowHeightFn =
    input.rowHeights ?? (() => config.rowHeight ?? 48);
  const rowPages: RowPage[] = [];
  let row = 0;
  let pageY = 0;
  let pi = 0;
  const count = Math.max(0, input.resourceCount);
  while (row < count) {
    let h = 0;
    const startRow = row;
    // Pack whole lanes until the next one would overflow the page body.
    while (row < count) {
      const rh = Math.max(1, rowHeightFn(row));
      if (h > 0 && h + rh > bodyHeight) break;
      h += rh;
      row++;
    }
    // Always advance at least one lane (a too-tall lane gets its own page).
    if (row === startRow) {
      h = Math.max(1, rowHeightFn(startRow));
      row = startRow + 1;
    }
    rowPages.push({ index: pi, startRow, endRow: row, y: pageY, height: h });
    pageY += h;
    pi++;
  }
  if (rowPages.length === 0) {
    rowPages.push({ index: 0, startRow: 0, endRow: 0, y: 0, height: 0 });
  }

  /* ── flatten into sheets (row-major: each row page × every time page) ── */
  const pages: PrintPage[] = [];
  const total = rowPages.length * timePages.length;
  let idx = 0;
  for (const rows of rowPages) {
    for (const time of timePages) {
      pages.push({ index: idx, total, time, rows });
      idx++;
    }
  }

  return {
    timePages,
    rowPages,
    pages,
    rowHeight: config.rowHeight ?? 48,
    bodyWidth,
    bodyHeight,
  };
}

/** Clamp a desired range to the axis' available range (no out-of-range slices). */
function clampRange(want: TimeSpan, bounds: TimeSpan): TimeSpan {
  const start = Math.max(bounds.start, Math.min(want.start, bounds.end));
  const end = Math.min(bounds.end, Math.max(want.end, start));
  return { start, end };
}

/* ═══════════════════════════════════════════════════════════════════════════
   The controller
   ═══════════════════════════════════════════════════════════════════════════ */

export class PrintController {
  private readonly host: PrintHost;
  private readonly emitter = new EventEmitter<PrintEvents>();
  private readonly disposers: Array<() => void> = [];
  private destroyed = false;
  /** The hidden iframe used for the most recent `print()` (torn down on destroy). */
  private frame: HTMLIFrameElement | null = null;
  /** Deferred print timer, cleared on teardown so it cannot fire post-destroy. */
  private printTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: PrintHost) {
    this.host = host;
    // Auto-dispose when the host scheduler is destroyed.
    this.disposers.push(this.host.on('destroy', () => this.destroy()));
  }

  /* ── public API ─────────────────────────────────────────────────────────── */

  /** Subscribe to a controller event (`beforePrint` veto / `print`). */
  on<K extends keyof PrintEvents>(event: K, fn: (payload: PrintEvents[K]) => unknown): () => void {
    return this.emitter.on(event, fn);
  }

  /**
   * Compute the pagination plan for the current scheduler + given config, without
   * building DOM. Useful for previews, page counts, and tests.
   */
  plan(config: PrintConfig = {}): PrintPlan {
    return paginate({
      axis: this.host.getAxis(),
      resourceCount: this.host.getResourceStore().count,
      rowHeights: (i) => this.rowHeightAt(i, config),
      config: this.mergeConfig(config),
    });
  }

  /**
   * Build the static, paginated print document (a detached element) for the
   * current scheduler. Does NOT open the print dialog — returns the root + plan so
   * callers can inject it into their own export pipeline or assert on it in tests.
   */
  buildDocument(config: PrintConfig = {}): PrintResult {
    const merged = this.mergeConfig(config);
    const plan = this.plan(config);
    const root = this.buildPrintRoot(plan, merged);
    return { plan, root };
  }

  /**
   * Render the paginated print document and send it to the printer.
   *
   * Renders into a hidden, same-document iframe (so the host page's own layout is
   * untouched and `@media print` rules apply to a clean document), calls the
   * frame's `print()`, then cleans the frame up. Emits a vetoable `beforePrint`
   * first (host + controller). Returns the `PrintResult`, or `null` if vetoed /
   * destroyed.
   */
  print(config: PrintConfig = {}): PrintResult | null {
    if (this.destroyed || this.host.isDestroyed) return null;
    const { plan, root } = this.buildDocument(config);

    const veto = { plan };
    if (this.emitter.emit('beforePrint', veto) === false) return null;
    if (this.host.emit('beforePrint', veto) === false) return null;

    this.renderToFrame(root, this.mergeConfig(config));

    const result: PrintResult = { plan, root };
    this.emitter.emit('print', result);
    this.host.emit('print', result);
    return result;
  }

  /** Remove the print iframe + listeners. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.teardownFrame();
    for (const off of this.disposers.splice(0)) {
      try {
        off();
      } catch {
        /* already gone */
      }
    }
    this.emitter.clear();
  }

  /* ── config resolution ────────────────────────────────────────────────────── */

  /** Merge user config with scheduler-derived defaults (columns, range, rowHeight). */
  private mergeConfig(config: PrintConfig): PrintConfigWithColumns {
    const cfg = this.host.getConfig();
    const columns = cfg.columns ?? [{ field: 'name' as const, text: 'Resource', width: 160 }];
    return {
      title: config.title ?? 'Schedule',
      orientation: config.orientation ?? 'landscape',
      paperSize: config.paperSize ?? 'a4',
      repeatHeader: config.repeatHeader ?? true,
      repeatResourceColumn: config.repeatResourceColumn ?? true,
      showNowMarker: config.showNowMarker ?? false,
      rowHeight: config.rowHeight ?? cfg.rowHeight ?? 48,
      ...(config.pageSize ? { pageSize: config.pageSize } : {}),
      ...(config.range ? { range: config.range } : {}),
      columns,
    };
  }

  private rowHeightAt(i: number, config: PrintConfig): number {
    const rec = this.host.getResourceStore().getAt(i);
    const fallback = config.rowHeight ?? this.host.getConfig().rowHeight ?? 48;
    return rec?.rowHeight ?? fallback;
  }

  /* ── rendering ────────────────────────────────────────────────────────────── */

  /**
   * Build the print root: one `.jects-scheduler-print__page` per sheet. Each page
   * draws (optionally) a repeated header band for ITS time slice + a repeated
   * resource column for ITS lane slice, then the gridlines, non-working shading,
   * and event bars clipped to that slice. Lanes never split across a boundary.
   */
  private buildPrintRoot(plan: PrintPlan, config: PrintConfigWithColumns): HTMLElement {
    const axis = this.host.getAxis();
    const resources = this.host.getResourceStore();
    const events = this.host.getEventStore();
    const columns = config.repeatResourceColumn === false ? [] : config.columns ?? [];
    const columnWidth =
      config.repeatResourceColumn === false ? 0 : resourceColumnsWidth(columns);

    const root = el('div', 'jects-scheduler-print');
    root.setAttribute('role', 'document');
    root.setAttribute('aria-label', `${config.title ?? 'Schedule'} (print preview)`);

    // Index events by resource for quick per-lane lookup.
    const byResource = new Map<RecordId, EventModel[]>();
    events.forEach((e) => {
      const list = byResource.get(e.resourceId);
      if (list) list.push(e);
      else byResource.set(e.resourceId, [e]);
    });

    for (const sheet of plan.pages) {
      const pageEl = el('section', 'jects-scheduler-print__page');
      pageEl.setAttribute('role', 'group');
      pageEl.setAttribute(
        'aria-label',
        `Page ${sheet.index + 1} of ${sheet.total}`,
      );

      // Title + time header (repeated per page when enabled).
      if (config.repeatHeader !== false) {
        pageEl.appendChild(
          this.buildPageHeader(axis, sheet, config, columnWidth),
        );
      }

      const bodyEl = el('div', 'jects-scheduler-print__body');
      bodyEl.style.width = `${columnWidth + sheet.time.width}px`;

      // Locked resource column (repeated per page when enabled).
      if (config.repeatResourceColumn !== false && columnWidth > 0) {
        bodyEl.appendChild(
          this.buildResourceColumn(resources, sheet, columns, columnWidth),
        );
      }

      bodyEl.appendChild(
        this.buildTimeGrid(axis, resources, byResource, sheet, config, columnWidth),
      );

      pageEl.appendChild(bodyEl);
      root.appendChild(pageEl);
    }

    return root;
  }

  /** Build the repeated header band for one page's time slice. */
  private buildPageHeader(
    axis: TimeAxis,
    sheet: PrintPage,
    config: PrintConfigWithColumns,
    columnWidth: number,
  ): HTMLElement {
    const head = el('header', 'jects-scheduler-print__header');

    const titleRow = el('div', 'jects-scheduler-print__title');
    titleRow.textContent = `${config.title ?? 'Schedule'} — page ${sheet.index + 1}/${sheet.total}`;
    head.appendChild(titleRow);

    const band = el('div', 'jects-scheduler-print__header-band');
    band.style.marginInlineStart = `${columnWidth}px`;
    band.style.width = `${sheet.time.width}px`;
    const preset = axis.preset;
    const headers: ViewPreset['headers'] = preset.headers;
    const finest = headers[headers.length - 1];
    const ticks = axis.ticksInRange(sheet.time.x, sheet.time.x + sheet.time.width);
    for (const tick of ticks) {
      const cell = el('div', 'jects-scheduler-print__header-cell');
      cell.classList.toggle('jects-scheduler-print__header-cell--major', tick.major);
      cell.style.insetInlineStart = `${tick.x - sheet.time.x}px`;
      cell.style.width = `${tick.width}px`;
      cell.textContent = formatTime(tick.span.start, finest?.format);
      band.appendChild(cell);
    }
    head.appendChild(band);
    return head;
  }

  /** Build the repeated locked resource column for one page's lane slice. */
  private buildResourceColumn(
    resources: PrintStore<ResourceModel>,
    sheet: PrintPage,
    columns: ResourceColumnConfig[],
    columnWidth: number,
  ): HTMLElement {
    const col = el('div', 'jects-scheduler-print__resources');
    col.style.width = `${columnWidth}px`;
    col.style.height = `${sheet.rows.height}px`;
    let y = 0;
    for (let i = sheet.rows.startRow; i < sheet.rows.endRow; i++) {
      const rec = resources.getAt(i);
      if (!rec) continue;
      const rowH = Math.max(1, rec.rowHeight ?? this.host.getConfig().rowHeight ?? 48);
      const rowEl = el('div', 'jects-scheduler-print__resource-row');
      rowEl.style.top = `${y}px`;
      rowEl.style.height = `${rowH}px`;
      for (const c of columns) {
        const cell = el('div', 'jects-scheduler-print__resource-cell');
        cell.style.width = `${c.width ?? 140}px`;
        if (c.renderer) cell.textContent = stripHtml(c.renderer(rec));
        else cell.textContent = String((rec as Record<string, unknown>)[c.field] ?? '');
        rowEl.appendChild(cell);
      }
      col.appendChild(rowEl);
      y += rowH;
    }
    return col;
  }

  /** Build the time grid (gridlines + non-working shading + bars) for one sheet. */
  private buildTimeGrid(
    axis: TimeAxis,
    resources: PrintStore<ResourceModel>,
    byResource: Map<RecordId, EventModel[]>,
    sheet: PrintPage,
    config: PrintConfigWithColumns,
    columnWidth: number,
  ): HTMLElement {
    const grid = el('div', 'jects-scheduler-print__grid');
    grid.style.insetInlineStart = `${columnWidth}px`;
    grid.style.width = `${sheet.time.width}px`;
    grid.style.height = `${sheet.rows.height}px`;

    // Vertical gridlines for this time slice.
    for (const tick of axis.ticksInRange(sheet.time.x, sheet.time.x + sheet.time.width)) {
      const line = el('div', 'jects-scheduler-print__gridline');
      line.classList.toggle('jects-scheduler-print__gridline--major', tick.major);
      line.style.insetInlineStart = `${tick.x - sheet.time.x}px`;
      grid.appendChild(line);
    }

    // Horizontal lane separators + bars, lane by lane.
    let y = 0;
    for (let i = sheet.rows.startRow; i < sheet.rows.endRow; i++) {
      const rec = resources.getAt(i);
      if (!rec) continue;
      const rowH = Math.max(1, rec.rowHeight ?? config.rowHeight ?? 48);

      const lane = el('div', 'jects-scheduler-print__lane');
      lane.style.top = `${y}px`;
      lane.style.height = `${rowH}px`;
      grid.appendChild(lane);

      const list = byResource.get(rec.id) ?? [];
      for (const ev of list) {
        const box = clipBarToPage(axis, ev, sheet.time);
        if (!box) continue;
        const bar = el('div', 'jects-scheduler-print__bar');
        bar.style.insetInlineStart = `${box.x}px`;
        bar.style.width = `${box.width}px`;
        bar.style.top = `${y + 4}px`;
        bar.style.height = `${rowH - 8}px`;
        if (ev.eventColor) bar.dataset.color = ev.eventColor;
        if (box.clippedStart) bar.classList.add('jects-scheduler-print__bar--clip-start');
        if (box.clippedEnd) bar.classList.add('jects-scheduler-print__bar--clip-end');
        const label = el('div', 'jects-scheduler-print__bar-label');
        label.textContent = ev.name ?? '';
        bar.appendChild(label);
        grid.appendChild(bar);
      }
      y += rowH;
    }

    return grid;
  }

  /* ── iframe lifecycle ─────────────────────────────────────────────────────── */

  /** Render the print root into a hidden iframe and call the frame's print(). */
  private renderToFrame(root: HTMLElement, config: PrintConfigWithColumns): void {
    if (typeof document === 'undefined') return;
    this.teardownFrame();

    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.className = 'jects-scheduler-print__frame';
    document.body.appendChild(frame);
    this.frame = frame;

    const doc = frame.contentDocument;
    if (!doc) return;

    // Pull the host document's stylesheets (so the print document inherits the
    // theme tokens + the @media print rules) into the frame.
    const headHtml = collectStyleLinks();
    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
        config.title ?? 'Schedule',
      )}</title>${headHtml}</head><body></body></html>`,
    );
    doc.close();
    doc.body.appendChild(root);

    // Defer the print so the frame document has laid out + styles applied.
    const win = frame.contentWindow;
    const fire = (): void => {
      try {
        win?.focus();
        win?.print();
      } catch {
        /* headless / no print dialog — the document is still built + emitted */
      }
    };
    if (win) {
      // Some engines need a tick before print() has the laid-out document.
      this.printTimer = setTimeout(() => {
        this.printTimer = null;
        fire();
      }, 0);
    }
  }

  private teardownFrame(): void {
    if (this.printTimer) {
      clearTimeout(this.printTimer);
      this.printTimer = null;
    }
    if (this.frame) {
      this.frame.remove();
      this.frame = null;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Pure helpers
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Project an event onto a time page, clipping it to the page's pixel slice.
 * Returns `null` when the event does not intersect the page. The `clipped*` flags
 * mark a bar that continues onto an adjacent page (so the renderer can flatten the
 * outer corner, signalling "continues").
 */
export function clipBarToPage(
  axis: TimeAxis,
  ev: { startDate: number; endDate: number },
  page: TimePage,
): { x: number; width: number; clippedStart: boolean; clippedEnd: boolean } | null {
  const x0 = axis.toX(ev.startDate);
  const x1 = axis.toX(ev.endDate);
  const left = page.x;
  const right = page.x + page.width;
  // No intersection.
  if (x1 <= left || x0 >= right) return null;
  const clampedL = Math.max(x0, left);
  const clampedR = Math.min(x1, right);
  return {
    x: clampedL - left,
    width: Math.max(1, clampedR - clampedL),
    clippedStart: x0 < left,
    clippedEnd: x1 > right,
  };
}

/** Create a div/section/etc. with a class. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/** Collect the host document's <link rel=stylesheet> + <style> markup for the frame. */
function collectStyleLinks(): string {
  if (typeof document === 'undefined') return '';
  const parts: string[] = [];
  for (const link of Array.from(document.querySelectorAll('link[rel="stylesheet"]'))) {
    const href = link.getAttribute('href');
    if (href) parts.push(`<link rel="stylesheet" href="${escapeHtml(href)}">`);
  }
  for (const style of Array.from(document.querySelectorAll('style'))) {
    parts.push(`<style>${style.textContent ?? ''}</style>`);
  }
  return parts.join('');
}

/** Reduce an HTML string to its text content (renderer output is plain text here). */
function stripHtml(html: string): string {
  if (typeof document === 'undefined') return html;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent ?? '';
}

/** Minimal HTML-escape for the document title interpolation. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ═══════════════════════════════════════════════════════════════════════════
   Install helper
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Install Print onto a scheduler. Returns the controller (call `.destroy()` to
 * remove it; it is also auto-removed on scheduler destroy).
 *
 * @example
 *   const sched = new Scheduler(host, { resources, events });
 *   const printer = installPrint(sched);
 *   document.querySelector('#print-btn')!.addEventListener('click', () =>
 *     printer.print({ title: 'Crew schedule', orientation: 'landscape' }),
 *   );
 */
export function installPrint(host: PrintHost): PrintController {
  return new PrintController(host);
}
