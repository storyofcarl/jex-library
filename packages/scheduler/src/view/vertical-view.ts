/**
 * Vertical Scheduler renderer — resources as columns, time flows DOWN.
 *
 * This is the full "vertical orientation" mode the parity checklist calls for
 * (Bryntum `mode: 'vertical'` / DHTMLX vertical timeline): the time axis is
 * projected on the Y dimension, resources become virtualized columns laid out
 * left-to-right across the top, event bars are positioned by `(column x, time y)`
 * and drag/resize along Y, and the headers are turned 90°:
 *
 *   ┌──────────┬───────────────────────────────┐
 *   │  corner  │  resource columns (Alice|Bob…) │   ← top: resource header band
 *   ├──────────┼───────────────────────────────┤
 *   │  time    │   ▓ bars laid out per column   │
 *   │  bands   │   ▓ time gridlines run across  │   ← left: vertical time axis
 *   │  (down)  │   ▓                            │
 *   └──────────┴───────────────────────────────┘
 *
 * It is a **standalone module** (concurrency rule): it does not subclass or edit
 * the main `Scheduler`. The integrator wires it in by constructing it with a
 * `VerticalHostContext` view of the scheduler's DOM parts + engine + stores, and
 * delegating `paint()` / pointer / keyboard to it whenever
 * `orientation === 'vertical'`. See `wireNotes` in the feature manifest.
 *
 * Geometry is written entirely against the {@link Orientation} abstraction
 * (`resolveOrientation('vertical')`) so the time→pixel mapping is shared with the
 * horizontal path; only the cross-axis (resource) layout differs. Light-DOM,
 * token-pure CSS, no engine state of its own beyond render bookkeeping.
 */

import { createEl, computeWindow, type RecordId } from '@jects/core';
import type {
  TimeAxis,
  TimeSpan,
  TimelineEvent,
  EventBar,
} from '@jects/timeline-core';
import {
  computeNonWorkingSpans,
  projectNonWorkingSpans,
} from '@jects/timeline-core';

import type {
  SchedulerConfig,
  EventModel,
} from '../contract.js';
import type { ResourceStore, EventStore } from '../stores/stores.js';
import { layoutLane } from '../model/event-layout.js';
import { parseRRule, expandOccurrences } from '../model/recurrence.js';
import { formatTime } from './format.js';
import { resolveOrientation, type Orientation } from './orientation.js';
import {
  startAxisBarDrag,
  startAxisDragCreate,
  type AxisDragController,
  type AxisDragMode,
} from './axis-drag.js';

/** A resolved event span + its source record (mirrors the horizontal path). */
interface ResolvedEvent {
  id: RecordId;
  resourceId: RecordId;
  span: TimeSpan;
  record: EventModel;
  masterId?: RecordId;
}

/**
 * The seam the host `Scheduler` exposes to the vertical renderer. It is a
 * read-mostly view of the scheduler's owned DOM parts, time axis, data stores,
 * and the few mutating callbacks the renderer needs (commit/create/announce/
 * emit). The host keeps ownership + lifecycle; this view only paints + gestures.
 */
export interface VerticalHostContext {
  readonly config: SchedulerConfig;
  readonly axis: TimeAxis;
  readonly resourceStore: ResourceStore;
  readonly eventStore: EventStore;
  readonly rowHeight: number;
  /** Scheduler DOM parts (the same nodes the horizontal path paints). */
  readonly elHeader: HTMLElement;
  readonly elResourceHeader: HTMLElement;
  readonly elResourcePanel: HTMLElement;
  readonly elScroller: HTMLElement;
  readonly elContent: HTMLElement;
  readonly elBackdrop: HTMLElement;
  readonly elBars: HTMLElement;
  readonly elDeps: SVGSVGElement;
  /** Current scroll offsets (host tracks these on its scroller). */
  scrollTop: number;
  scrollLeft: number;
  /** Commit a span change (veto + emit + store write live in the host). */
  commitEventChange(record: EventModel, from: TimeSpan, to: TimeSpan): void;
  /** Create a new event in a resource (veto + emit live in the host). */
  createEvent(resourceId: RecordId, span: TimeSpan): void;
  /** Announce a message to the host's polite live region. */
  announce(message: string): void;
}

/** Default column width (px) for a resource column in vertical mode. */
const DEFAULT_COLUMN_WIDTH = 140;
/** Resize-edge hit zone (px) along the time axis. */
const EDGE = 6;

export class VerticalSchedulerView {
  private readonly o: Orientation = resolveOrientation('vertical');
  /** Resolved bars keyed by bar id (incl. recurrence occurrences). */
  private readonly bars = new Map<RecordId, EventBar<EventModel>>();
  private readonly resolvedById = new Map<RecordId, ResolvedEvent>();
  /** Absolute cross (x) offset of each resource column, by resource id. */
  private readonly colLefts = new Map<RecordId, number>();
  private activeDrag: AxisDragController | null = null;
  private destroyed = false;

  constructor(private readonly host: VerticalHostContext) {
    this.ensureScrollerAccessible();
  }

  /* ── public lifecycle ───────────────────────────────────────────────────── */

  /**
   * The scrollable time grid must be keyboard-reachable on its own (axe
   * `scrollable-region-focusable`: a scroll region with no focusable content
   * has to be focusable itself). The horizontal shell wires this up when it
   * builds its scroller, but the vertical view can be handed a bare host
   * scroller, so ensure it here too. Idempotent — it never clobbers an
   * already-configured host scroller.
   */
  private ensureScrollerAccessible(): void {
    const scroller = this.host.elScroller;
    if (!scroller) return;
    if (!scroller.hasAttribute('tabindex')) scroller.tabIndex = 0;
    if (!scroller.hasAttribute('role')) scroller.setAttribute('role', 'group');
    if (!scroller.hasAttribute('aria-label')) {
      scroller.setAttribute('aria-label', 'Schedule timeline');
    }
  }

  /** Tear down any in-flight gesture (host calls this on destroy / mode switch). */
  dispose(): void {
    this.destroyed = true;
    this.activeDrag?.destroy();
    this.activeDrag = null;
  }

  /** The total content size along the time (main) axis = full time extent. */
  private mainExtent(): number {
    return this.host.axis.contentWidth;
  }

  /** The total content size along the cross (resource) axis = sum of columns. */
  private crossExtent(): number {
    return this.host.resourceStore.count * this.columnWidth();
  }

  private columnWidth(): number {
    return this.host.config.rowHeight ?? this.host.rowHeight ?? DEFAULT_COLUMN_WIDTH;
  }

  /* ── full paint ─────────────────────────────────────────────────────────── */

  /**
   * Full repaint in vertical geometry. Sizes the content box so the scroller's
   * Y dimension is time and its X dimension is resources, then paints each layer.
   */
  paint(): void {
    if (this.destroyed) return;
    const empty = this.host.resourceStore.count === 0;
    if (empty) {
      this.host.elBars.replaceChildren();
      this.host.elBackdrop.replaceChildren();
      this.host.elResourcePanel.replaceChildren();
      this.host.elHeader.replaceChildren();
      this.host.elResourceHeader.replaceChildren();
      return;
    }

    const mainSize = this.mainExtent();
    const crossSize = this.crossExtent();
    // In vertical mode the content's height is the time extent and its width is
    // the resource extent (the inverse of the horizontal path).
    this.host.elContent.style.height = `${mainSize}px`;
    this.host.elContent.style.width = `${crossSize}px`;
    this.host.elDeps.setAttribute('width', String(crossSize));
    this.host.elDeps.setAttribute('height', String(mainSize));

    this.paintHeader();
    this.paintResourceColumns();
    this.paintBackdrop();
    this.paintBars();
    // Dependencies are intentionally not routed in vertical mode yet (the
    // orthogonal router is horizontal-only); the layer is cleared so stale
    // horizontal paths never linger when switching orientation.
    this.host.elDeps.replaceChildren();
  }

  /* ── header (resource columns across top + time bands down the side) ────── */

  /**
   * Vertical header has two pieces:
   *   - the TOP band (`elResourceHeader`, inside the corner+header strip): one
   *     cell per visible resource column, horizontally scrolled with the body.
   *   - the LEFT band (`elHeader`): the time axis turned 90° — finest ticks +
   *     coarser bands stacked as horizontal rows running DOWN, scrolled
   *     vertically with the body.
   */
  private paintHeader(): void {
    // Top: resource column headers.
    const colWin = this.columnWindow();
    const colFrag = document.createDocumentFragment();
    for (let i = colWin.startIndex; i < colWin.endIndex; i++) {
      const record = this.host.resourceStore.getAt(i);
      if (!record) continue;
      const cell = createEl('div', {
        className: 'jects-scheduler__col-header',
      });
      cell.style.left = `${i * this.columnWidth() - this.host.scrollLeft}px`;
      cell.style.width = `${this.columnWidth()}px`;
      cell.textContent = record.name;
      cell.dataset.resourceId = String(record.id);
      colFrag.appendChild(cell);
    }
    this.host.elResourceHeader.replaceChildren(colFrag);

    // Left: the time axis as stacked horizontal rows running down.
    const headers = this.host.config.preset?.headers ?? this.host.axis.preset.headers;
    const yStart = this.host.scrollTop;
    const yEnd = this.host.scrollTop + this.viewportMain();
    const ticks = this.host.axis.ticksInRange(yStart - 200, yEnd + 200);
    const frag = document.createDocumentFragment();
    for (let b = 0; b < headers.length; b++) {
      const band = createEl('div', { className: 'jects-scheduler__time-band' });
      const isFinest = b === headers.length - 1;
      if (isFinest) {
        for (const tick of ticks) {
          const cell = createEl('div', { className: 'jects-scheduler__time-cell' });
          cell.style.top = `${tick.x - this.host.scrollTop}px`;
          cell.style.height = `${tick.width}px`;
          cell.classList.toggle('jects-scheduler__time-cell--major', tick.major);
          cell.textContent = formatTime(tick.span.start, headers[b]!.format);
          band.appendChild(cell);
        }
      } else {
        const majors = ticks.filter((t) => t.major);
        const bounds = majors.length > 0 ? majors : ticks.length > 0 ? [ticks[0]!] : [];
        for (let i = 0; i < bounds.length; i++) {
          const startTick = bounds[i]!;
          const next = bounds[i + 1];
          const cell = createEl('div', { className: 'jects-scheduler__time-cell' });
          cell.style.top = `${startTick.x - this.host.scrollTop}px`;
          const size = next
            ? next.x - startTick.x
            : (ticks[ticks.length - 1]?.x ?? startTick.x) + 80 - startTick.x;
          cell.style.height = `${Math.max(0, size)}px`;
          cell.textContent = formatTime(startTick.span.start, headers[b]!.format);
          band.appendChild(cell);
        }
      }
      frag.appendChild(band);
    }
    this.host.elHeader.replaceChildren(frag);
  }

  /* ── resource columns (virtualized across X) ────────────────────────────── */

  /**
   * Paint the resource columns. In vertical mode the "locked" panel becomes a
   * thin spacer (the resource identity lives in the TOP header band painted in
   * `paintHeader`), but we still render lightweight per-column separators in the
   * body so the column grid reads clearly. The panel is kept empty of rows so the
   * left rail (now the time axis) is not duplicated.
   */
  private paintResourceColumns(): void {
    // Vertical column separators are drawn in the backdrop; the locked left
    // panel holds nothing in vertical mode (time bands live in elHeader).
    this.host.elResourcePanel.replaceChildren();
  }

  /* ── backdrop (horizontal time gridlines + column separators + now) ─────── */

  private paintBackdrop(): void {
    const frag = document.createDocumentFragment();
    const yStart = this.host.scrollTop;
    const yEnd = this.host.scrollTop + this.viewportMain();

    // Non-working shading: bands that span the whole cross axis at a time range.
    if (this.host.config.showNonWorkingTime !== false) {
      const spans = computeNonWorkingSpans(this.host.axis, this.host.config.calendar ?? {}, 'day');
      for (const box of projectNonWorkingSpans(spans, this.host.axis)) {
        const el = createEl('div', { className: 'jects-scheduler__nonworking' });
        this.o.applyMainBand(el, box.x, box.width);
        frag.appendChild(el);
      }
    }

    // Time gridlines: horizontal lines running across, one per tick (down Y).
    for (const tick of this.host.axis.ticksInRange(yStart - 100, yEnd + 100)) {
      const line = createEl('div', { className: 'jects-scheduler__gridline' });
      line.classList.toggle('jects-scheduler__gridline--major', tick.major);
      this.o.applyMainLine(line, tick.x);
      frag.appendChild(line);
    }

    // Column separators: vertical lines at each resource column boundary.
    const colWin = this.columnWindow();
    for (let i = colWin.startIndex; i <= colWin.endIndex; i++) {
      const sep = createEl('div', { className: 'jects-scheduler__col-sep' });
      sep.style.left = `${i * this.columnWidth()}px`;
      frag.appendChild(sep);
    }

    // Now marker: a horizontal line across the cross axis at the current time.
    if (this.host.config.showNowMarker !== false) {
      const now = Date.now();
      if (now >= this.host.axis.range.start && now <= this.host.axis.range.end) {
        const marker = createEl('div', { className: 'jects-scheduler__now' });
        this.o.applyMainLine(marker, this.host.axis.toX(now));
        frag.appendChild(marker);
      }
    }

    this.host.elBackdrop.replaceChildren(frag);
  }

  /* ── bars (positioned by column x + time y) ─────────────────────────────── */

  private paintBars(): void {
    const colWin = this.columnWindow();
    const strategy = this.host.config.overlap ?? 'stack';
    const frag = document.createDocumentFragment();
    this.bars.clear();
    this.resolvedById.clear();
    this.colLefts.clear();

    const visibleSpan = this.visibleSpan();
    const colWidth = this.columnWidth();

    for (let i = colWin.startIndex; i < colWin.endIndex; i++) {
      const resource = this.host.resourceStore.getAt(i);
      if (!resource) continue;
      const colLeft = i * colWidth;
      this.colLefts.set(resource.id, colLeft);

      const events = this.resolveColumnEvents(resource.id, visibleSpan);
      for (const e of events) this.resolvedById.set(e.id, e);
      const tlEvents: TimelineEvent<EventModel>[] = events.map((e) => ({
        id: e.id,
        rowId: e.resourceId,
        span: e.span,
        record: e.record,
        ...(e.record.percentDone !== undefined ? { progress: e.record.percentDone } : {}),
        editable: e.record.draggable !== false && !this.isOccurrence(e),
        ...(e.record.eventColor !== undefined ? { styleKey: e.record.eventColor } : {}),
      }));

      // Reuse the lane-stacking layout. It returns the time extent as `x`/`width`
      // (the main axis) and the cross-axis offset as `y`/`height` measured within
      // a band of `columnWidth`. In vertical mode the band IS the column width, so
      // `y`/`height` become the bar's intra-column horizontal sub-lane.
      const { bars } = layoutLane<EventModel>({
        rowId: resource.id,
        events: tlEvents,
        axis: this.host.axis,
        rowHeight: colWidth,
        strategy,
      });

      for (const bar of bars) {
        this.bars.set(bar.event.id, bar);
        frag.appendChild(this.renderBar(bar, colLeft));
      }
    }
    this.host.elBars.replaceChildren(frag);
  }

  private renderBar(bar: EventBar<EventModel>, colLeft: number): HTMLElement {
    const ev = bar.event.record;
    const el = createEl('div', { className: 'jects-scheduler__bar' });
    el.dataset.eventId = String(bar.event.id);
    // main axis = time (top/height); cross axis = column (left/width). `bar.x`/
    // `bar.width` are the time projection; `bar.y`/`bar.height` are the
    // intra-column sub-lane offset, shifted by the column's absolute left.
    this.o.applyBox(el, {
      main: bar.x,
      mainSize: bar.width,
      cross: colLeft + bar.y,
      crossSize: bar.height,
    });
    el.setAttribute('role', 'button');
    el.tabIndex = -1;
    const locked = bar.event.editable === false;
    el.setAttribute('aria-label', this.barAriaLabel(ev, bar.event.span));
    if (locked) {
      el.classList.add('jects-scheduler__bar--locked');
      el.setAttribute('aria-readonly', 'true');
      el.dataset.locked = 'true';
    }
    if (bar.event.id !== ev.id) el.dataset.occurrence = 'true';
    if (bar.event.styleKey) el.dataset.color = bar.event.styleKey;

    const inner = createEl('div', { className: 'jects-scheduler__bar-label' });
    inner.textContent = ev.name ?? '';
    el.appendChild(inner);

    if (typeof ev.percentDone === 'number' && ev.percentDone > 0) {
      const fill = createEl('div', { className: 'jects-scheduler__bar-progress' });
      // Progress fills along the time (main) axis → height in vertical mode.
      fill.style.height = `${Math.min(100, ev.percentDone * 100)}%`;
      fill.style.width = '100%';
      el.appendChild(fill);
    }
    return el;
  }

  private barAriaLabel(ev: EventModel, span?: TimeSpan): string {
    const name = ev.name ?? 'Event';
    const startT = span?.start ?? ev.startDate;
    const endT = span?.end ?? ev.endDate;
    return `${name}, ${formatTime(startT, 'datetime')} to ${formatTime(endT, 'datetime')}`;
  }

  /* ── recurrence + event resolution (mirrors the horizontal path) ────────── */

  private isOccurrence(e: ResolvedEvent): boolean {
    return e.masterId != null && e.id !== e.masterId;
  }

  private resolveColumnEvents(resourceId: RecordId, window: TimeSpan): ResolvedEvent[] {
    const out: ResolvedEvent[] = [];
    this.host.eventStore.forEach((record) => {
      if (record.resourceId !== resourceId) return;
      const masterSpan: TimeSpan = { start: record.startDate, end: record.endDate };
      if (record.recurrenceRule) {
        const rule = parseRRule(record.recurrenceRule);
        if (rule) {
          const occs = expandOccurrences(masterSpan, rule, window);
          occs.forEach((span, idx) => {
            out.push({
              id: idx === 0 ? record.id : `${record.id}::${span.start}`,
              resourceId,
              span,
              record,
              masterId: record.id,
            });
          });
          return;
        }
      }
      if (masterSpan.end > window.start && masterSpan.start < window.end) {
        out.push({ id: record.id, resourceId, span: masterSpan, record });
      }
    });
    return out;
  }

  /* ── windowing ──────────────────────────────────────────────────────────── */

  /** Effective viewport size along the main (time/Y) axis. */
  private viewportMain(): number {
    const h = this.host.elScroller.clientHeight;
    return h > 0 ? h : this.mainExtent();
  }
  /** Effective viewport size along the cross (resource/X) axis. */
  private viewportCross(): number {
    const w = this.host.elScroller.clientWidth;
    return w > 0 ? w : this.crossExtent();
  }

  /** The visible time span (down the Y axis). */
  private visibleSpan(): TimeSpan {
    const top = this.host.scrollTop;
    const bottom = top + this.viewportMain();
    return { start: this.host.axis.toTime(top), end: this.host.axis.toTime(bottom) };
  }

  /** Virtualized window over the resource COLUMNS (the cross axis, scrolled X). */
  private columnWindow(): { startIndex: number; endIndex: number } {
    const w = computeWindow({
      scrollTop: this.host.scrollLeft,
      viewportHeight: this.viewportCross(),
      itemSize: this.columnWidth(),
      count: this.host.resourceStore.count,
      overscan: this.host.config.overscan ?? 5,
    });
    return {
      startIndex: w.startIndex,
      endIndex: Math.min(this.host.resourceStore.count, w.endIndex + 1),
    };
  }

  /* ── coordinate mapping ─────────────────────────────────────────────────── */

  private localPoint(clientX: number, clientY: number): { main: number; cross: number } {
    const rect = this.host.elContent.getBoundingClientRect();
    return this.o.toAxisPoint(clientX - rect.left, clientY - rect.top);
  }

  /** Map a pointer event → content-space MAIN (time) coordinate. */
  private toContentMain(e: { clientX: number; clientY: number }): number {
    return this.localPoint(e.clientX, e.clientY).main;
  }

  private barElFromEvent(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) return null;
    return target.closest('.jects-scheduler__bar');
  }
  private eventForBarEl(el: HTMLElement): EventModel | undefined {
    const id = el.dataset.eventId;
    if (id == null) return undefined;
    const bar = this.bars.get(id) ?? this.bars.get(Number(id));
    return bar?.event.record;
  }
  private resolvedForBarEl(el: HTMLElement): ResolvedEvent | undefined {
    const id = el.dataset.eventId;
    if (id == null) return undefined;
    return this.resolvedById.get(id) ?? this.resolvedById.get(Number(id));
  }

  /* ── gestures (drag/resize along Y, drag-create along Y) ────────────────── */

  /**
   * Handle a `pointerdown` in the content area. Returns `true` if the view
   * started a gesture (so the host can stop its own horizontal handling).
   */
  onPointerDown(e: PointerEvent): boolean {
    if (e.button !== 0) return false;
    const barEl = this.barElFromEvent(e.target);
    if (barEl) {
      this.startBarGesture(e, barEl);
      return true;
    }
    if (this.host.config.creatable) {
      this.startCreateGesture(e);
      return true;
    }
    return false;
  }

  private startBarGesture(down: PointerEvent, barEl: HTMLElement): void {
    const record = this.eventForBarEl(barEl);
    if (!record || record.draggable === false) return;
    const resolved = this.resolvedForBarEl(barEl);
    if (resolved && this.isOccurrence(resolved)) {
      this.host.announce('Recurring occurrences cannot be moved.');
      return;
    }
    const bar = this.bars.get(barEl.dataset.eventId!) ?? this.bars.get(Number(barEl.dataset.eventId));
    if (!bar) return;

    // Hit-test the resize edges along the MAIN (time/Y) axis. `bar.x`/`bar.width`
    // are the time projection, so the local main coordinate compares against them.
    const main = this.localPoint(down.clientX, down.clientY).main;
    const zone = this.zoneAlongMain(bar, main);
    let mode: AxisDragMode = 'move';
    if (zone === 'start' && this.host.config.resizable !== false) mode = 'resize-start';
    else if (zone === 'end' && this.host.config.resizable !== false) mode = 'resize-end';
    if (mode === 'move' && this.host.config.draggable === false) return;

    const origin: TimeSpan = { start: bar.event.span.start, end: bar.event.span.end };
    barEl.classList.add('jects-scheduler__bar--dragging');

    this.activeDrag = startAxisBarDrag(down, {
      eventId: record.id,
      mode,
      origin,
      axis: this.host.axis,
      mainClient: (ev) => this.o.mainClient(ev),
      snap: this.host.config.snap !== false,
      onPreview: (state) => {
        if (this.destroyed) return;
        const m = this.o.spanToMain(this.host.axis, state.span);
        this.o.applyMain(barEl, m.start, m.size);
      },
      onCommit: (state) => {
        if (this.destroyed) return;
        this.host.commitEventChange(record, origin, state.span);
      },
      onEnd: () => {
        this.activeDrag = null;
        if (this.destroyed) return;
        barEl.classList.remove('jects-scheduler__bar--dragging');
        this.paint();
      },
    });
  }

  private startCreateGesture(down: PointerEvent): void {
    const pt = this.localPoint(down.clientX, down.clientY);
    const colIndex = Math.floor(pt.cross / this.columnWidth());
    const resource = this.host.resourceStore.getAt(colIndex);
    if (!resource) return;
    const anchorTime = this.host.axis.toTime(pt.main);
    const colLeft = colIndex * this.columnWidth();

    const ghost = createEl('div', { className: 'jects-scheduler__bar jects-scheduler__bar--ghost' });
    ghost.style.left = `${colLeft + 4}px`;
    ghost.style.width = `${this.columnWidth() - 8}px`;
    this.host.elBars.appendChild(ghost);

    this.activeDrag = startAxisDragCreate(down, {
      rowId: resource.id,
      anchorTime,
      axis: this.host.axis,
      toContentMain: (e) => this.toContentMain(e),
      snap: this.host.config.snap !== false,
      onPreview: (state) => {
        if (this.destroyed) return;
        const m = this.o.spanToMain(this.host.axis, state.span);
        this.o.applyMain(ghost, m.start, m.size);
      },
      onCommit: (state) => {
        if (this.destroyed) return;
        this.host.createEvent(resource.id, state.span);
      },
      onEnd: () => {
        this.activeDrag = null;
        ghost.remove();
      },
    });
  }

  /**
   * Hit-test a content-space MAIN coordinate against a bar's time extent,
   * returning which zone (resize start / body / resize end) along the time axis.
   */
  private zoneAlongMain(
    bar: EventBar<EventModel>,
    main: number,
  ): 'start' | 'body' | 'end' | null {
    const start = bar.x;
    const size = bar.width;
    if (main < start || main > start + size) return null;
    if (size <= 0) return 'body';
    const e = Math.min(EDGE, size / 2);
    if (main <= start + e) return 'start';
    if (main >= start + size - e) return 'end';
    return 'body';
  }
}
