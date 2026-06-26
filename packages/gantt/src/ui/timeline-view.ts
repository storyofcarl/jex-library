/**
 * `GanttTimelineView` — the RIGHT pane: the time grid that renders one bar per
 * visible task row, aligned vertically to the left task-tree grid.
 *
 * It composes the framework-free `@jects/timeline-core` primitives (the contract
 * forbids reaching past them):
 *   - `DefaultTimeAxis`            → time ⇄ pixel projection + ticks
 *   - `computeColumnLines`         → vertical gridlines
 *   - `computeNonWorkingSpans`     → weekend / off-hours shading
 *   - `projectTimeRanges`          → the "today" marker line
 *   - `OrthogonalDependencyRouter` → FS/SS/FF/SF dependency connectors
 *   - `BarDragController`          → drag-move / resize-start / resize-end
 *   - `DragCreateController` is not used here; link-create is a bespoke gesture
 *     dragging from a bar terminal handle.
 *
 * The view is purely a renderer + gesture surface. Every proposed change is
 * reported through callbacks (`onTaskSpanChange`, `onDependencyCreate`,
 * `onTaskClick`, `onTaskDblClick`) so the owning `Gantt` widget can route it
 * THROUGH the scheduling engine and write the recomputed spans back here via
 * `setRows` / `refresh`. The view never schedules anything itself.
 */

import { createEl, type Model, type RecordId } from '@jects/core';
import {
  DefaultTimeAxis,
  OrthogonalDependencyRouter,
  BarDragController,
  projectTimeRanges,
  computeColumnLines,
  computeNonWorkingSpans,
  projectNonWorkingSpans,
  type TimeAxis,
  type TimeSpan,
  type ViewPreset,
  type DependencyLink,
  type DependencyTerminal,
  type EventBar,
  type TimeMs,
  type WorkingTimeCalendar,
} from '@jects/timeline-core';
import type {
  TaskModel,
  DependencyModel,
  DependencyType,
  BaselineTask,
} from '../contract.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** One row the timeline must paint, supplied by the owning Gantt widget. */
export interface TimelineRowInput<T extends Model = Model> {
  task: TaskModel<T>;
  /** Absolute top of the row within the scroll content, px. */
  top: number;
  /** Row height, px. */
  height: number;
  /** Whether this task lies on the critical path. */
  critical?: boolean;
  /** Baseline snapshot for this task, if a baseline is shown. */
  baseline?: BaselineTask;
}

export interface TimelineViewOptions {
  preset: ViewPreset;
  zoom?: number;
  range: TimeSpan;
  /** "Now" line time (defaults to `Date.now()` at construction). */
  now?: TimeMs;
  /**
   * Working-time calendar used to shade non-working (weekend/off-hours/holiday)
   * bands so the backdrop matches the engine's real scheduling calendar. When
   * omitted the timeline-core default (Sat/Sun, 09:00–17:00) is used.
   */
  calendar?: WorkingTimeCalendar;
  /** Pixels of horizontal scroll the timeline starts at. */
  onTaskSpanChange?(taskId: RecordId, span: TimeSpan, mode: DragMode): void;
  onDependencyCreate?(dep: { fromId: RecordId; toId: RecordId; type: DependencyType }): void;
  onTaskClick?(taskId: RecordId, native: MouseEvent): void;
  onTaskDblClick?(taskId: RecordId, native: MouseEvent): void;
  onScroll?(scrollTop: number, scrollLeft: number): void;
}

/** The drag gesture kind, surfaced to the span-change callback. */
export type DragMode = 'move' | 'resize-start' | 'resize-end';

/** Map a Gantt dependency type to the timeline terminals it links. */
export function terminalsFor(type: DependencyType): {
  fromSide: DependencyTerminal;
  toSide: DependencyTerminal;
} {
  switch (type) {
    case 'SS':
      return { fromSide: 'start', toSide: 'start' };
    case 'FF':
      return { fromSide: 'end', toSide: 'end' };
    case 'SF':
      return { fromSide: 'start', toSide: 'end' };
    case 'FS':
    default:
      return { fromSide: 'end', toSide: 'start' };
  }
}

export class GanttTimelineView<T extends Model = Model> {
  readonly el: HTMLElement;
  readonly axis: TimeAxis;

  private readonly header: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly content: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly barsLayer: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly hintId: string;
  private readonly depSvg: SVGSVGElement;
  private readonly opts: TimelineViewOptions;
  private readonly now: TimeMs;

  private rows: TimelineRowInput<T>[] = [];
  private deps: DependencyModel[] = [];
  private calendar: WorkingTimeCalendar | undefined;
  private rowOffsets = new Map<RecordId, number>();
  private barById = new Map<RecordId, EventBar<TaskModel<T>>>();
  private barEls = new Map<RecordId, HTMLElement>();
  private disposers: Array<() => void> = [];
  private activeDrag: BarDragController | null = null;
  private linkDrag: { fromId: RecordId; side: DependencyTerminal; move: (e: PointerEvent) => void; up: (e: PointerEvent) => void } | null = null;
  private destroyed = false;
  /** The bar id that currently holds the roving tabindex (the keyboard cursor). */
  private focusId: RecordId | null = null;
  /** Keyboard link-create: the bar armed as predecessor (press `l` to arm). */
  private linkSourceId: RecordId | null = null;
  /** One working-day nudge step for keyboard move/resize. */
  private static readonly NUDGE_MS = 86_400_000;

  constructor(opts: TimelineViewOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now();
    this.calendar = opts.calendar;
    this.axis = new DefaultTimeAxis({
      range: opts.range,
      preset: opts.preset,
      zoom: opts.zoom ?? 1,
      onChange: () => this.refresh(),
    });

    this.el = createEl('div', { className: 'jects-gantt__timeline' });
    this.header = createEl('div', { className: 'jects-gantt__timeline-header' });
    this.scroller = createEl('div', { className: 'jects-gantt__timeline-scroller' });
    this.content = createEl('div', { className: 'jects-gantt__timeline-content' });
    this.backdrop = createEl('div', { className: 'jects-gantt__timeline-backdrop' });
    this.barsLayer = createEl('div', { className: 'jects-gantt__bars' });
    this.barsLayer.setAttribute('role', 'list');
    this.barsLayer.setAttribute('aria-label', 'Task bars');
    // Visually-hidden usage hint referenced by every bar via aria-describedby so
    // keyboard/AT users learn the operable keys (the bars are fully keyboard
    // operable: open/edit, nudge move/resize, and link-create).
    this.hintId = `jects-gantt-bar-hint-${++GanttTimelineView.hintSeq}`;
    this.hint = createEl('div', { className: 'jects-gantt__sr-only' });
    this.hint.id = this.hintId;
    this.hint.textContent =
      'Press Enter or F2 to edit. Arrow Left/Right to move; with Shift to resize the finish, with Alt to resize the start. Press L to start a link, then Enter on another task to finish it. Up/Down to move between tasks.';
    this.depSvg = document.createElementNS(SVG_NS, 'svg');
    this.depSvg.setAttribute('class', 'jects-gantt__deps');
    this.depSvg.setAttribute('aria-hidden', 'true');

    this.content.append(this.backdrop, this.depSvg as unknown as Node, this.barsLayer, this.hint);
    this.scroller.append(this.content);
    this.el.append(this.header, this.scroller);

    const onScroll = (): void => {
      this.opts.onScroll?.(this.scroller.scrollTop, this.scroller.scrollLeft);
    };
    this.scroller.addEventListener('scroll', onScroll);
    this.disposers.push(() => this.scroller.removeEventListener('scroll', onScroll));

    // Pointer gestures (bar move/resize + link create) are delegated on bars.
    const onPointerDown = (e: PointerEvent): void => this.handlePointerDown(e);
    this.barsLayer.addEventListener('pointerdown', onPointerDown);
    this.disposers.push(() => this.barsLayer.removeEventListener('pointerdown', onPointerDown));

    const onClick = (e: MouseEvent): void => this.handleClick(e);
    const onDbl = (e: MouseEvent): void => this.handleDblClick(e);
    this.barsLayer.addEventListener('click', onClick);
    this.barsLayer.addEventListener('dblclick', onDbl);
    this.disposers.push(() => this.barsLayer.removeEventListener('click', onClick));
    this.disposers.push(() => this.barsLayer.removeEventListener('dblclick', onDbl));

    // Keyboard operability (delegated on the bar list): open/edit, nudge
    // move/resize, navigate, and link-create — so the bars are not pointer-only.
    const onKeyDown = (e: KeyboardEvent): void => this.handleKeyDown(e);
    const onFocusIn = (e: FocusEvent): void => this.handleFocusIn(e);
    this.barsLayer.addEventListener('keydown', onKeyDown);
    this.barsLayer.addEventListener('focusin', onFocusIn);
    this.disposers.push(() => this.barsLayer.removeEventListener('keydown', onKeyDown));
    this.disposers.push(() => this.barsLayer.removeEventListener('focusin', onFocusIn));
  }

  /** Monotonic counter so each view's hint element gets a unique id. */
  private static hintSeq = 0;

  /* ── public surface the Gantt widget drives ───────────────────────────── */

  /** Replace the visible rows + dependencies and repaint. */
  setRows(rows: TimelineRowInput<T>[], deps: DependencyModel[]): void {
    this.rows = rows;
    this.deps = deps;
    this.refresh();
  }

  /** Switch the active view preset/zoom. */
  setView(view: { preset?: ViewPreset; zoom?: number }): void {
    this.axis.setView(view);
  }

  /**
   * Set the working-time calendar used to shade non-working bands so the
   * backdrop reflects the engine's real scheduling calendar (custom weeks,
   * holidays, working-hours window). Pass `undefined` to fall back to the
   * timeline-core default.
   */
  setCalendar(calendar: WorkingTimeCalendar | undefined): void {
    this.calendar = calendar;
    this.refresh();
  }

  /** Widen/narrow the covered time range. */
  setRange(range: TimeSpan): void {
    this.axis.setRange(range);
  }

  /** Mirror an external vertical scroll (kept in lockstep with the tree pane). */
  syncScrollTop(scrollTop: number): void {
    if (this.scroller.scrollTop !== scrollTop) this.scroller.scrollTop = scrollTop;
  }

  /** Repaint backdrop, bars and dependency lines for the current model. */
  refresh(): void {
    if (this.destroyed) return;
    this.renderHeader();
    this.renderBackdrop();
    this.renderBars();
    this.renderDependencies();
  }

  destroy(): void {
    this.destroyed = true;
    this.activeDrag?.destroy();
    this.activeDrag = null;
    this.endLinkDrag();
    for (const d of this.disposers.splice(0)) d();
    this.el.remove();
  }

  /* ── rendering ─────────────────────────────────────────────────────────── */

  private contentWidth(): number {
    return Math.max(this.axis.contentWidth, 1);
  }

  private totalHeight(): number {
    let max = 0;
    for (const r of this.rows) max = Math.max(max, r.top + r.height);
    return max;
  }

  private renderHeader(): void {
    const width = this.contentWidth();
    // jects-safe-html: clears content; no interpolation
    this.header.innerHTML = '';
    const inner = createEl('div', { className: 'jects-gantt__timeline-header-inner' });
    inner.style.width = `${width}px`;
    const bands = this.axis.preset.headers;
    // Top (coarse) band + the finest tick band.
    const ticks = this.axis.ticksInRange(0, width);
    for (let b = 0; b < bands.length; b++) {
      const band = bands[b]!;
      const lane = createEl('div', { className: 'jects-gantt__header-band' });
      lane.style.width = `${width}px`;
      const isFinest = b === bands.length - 1;
      for (const tick of ticks) {
        if (!isFinest && !tick.major) continue;
        const cell = createEl('div', {
          className: `jects-gantt__header-cell jects-gantt__header-cell--${band.align ?? 'center'}`,
        });
        cell.style.left = `${tick.x}px`;
        cell.style.width = `${tick.width}px`;
        cell.textContent = this.formatTick(tick.span.start, band.unit);
        lane.append(cell);
      }
      inner.append(lane);
    }
    this.header.append(inner);
  }

  private formatTick(time: TimeMs, unit: string): string {
    const d = new Date(time);
    switch (unit) {
      case 'hour':
        return String(d.getUTCHours()).padStart(2, '0');
      case 'day':
        return String(d.getUTCDate());
      case 'week':
        return `W${weekNumber(d)}`;
      case 'month':
        return d.toLocaleString('en', { month: 'short', timeZone: 'UTC' });
      case 'quarter':
        return `Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
      case 'year':
        return String(d.getUTCFullYear());
      default:
        return d.toLocaleDateString('en', { timeZone: 'UTC' });
    }
  }

  private renderBackdrop(): void {
    const width = this.contentWidth();
    const height = this.totalHeight();
    this.content.style.width = `${width}px`;
    this.content.style.height = `${height}px`;
    this.backdrop.style.width = `${width}px`;
    this.backdrop.style.height = `${height}px`;
    // jects-safe-html: clears content; no interpolation
    this.backdrop.innerHTML = '';

    // Non-working shading (weekends/off-hours/holidays) — derived from the
    // engine's real calendar when supplied, so the shaded background matches
    // where bars are actually scheduled. Falls back to the timeline-core default
    // (Sat/Sun, 09:00–17:00) only when no calendar is threaded in.
    const granularity = this.axis.preset.tickUnit === 'hour' ? 'hour' : 'day';
    const nonWorking = projectNonWorkingSpans(
      computeNonWorkingSpans(this.axis, this.calendar ?? {}, granularity),
      this.axis,
    );
    for (const nw of nonWorking) {
      const band = createEl('div', { className: 'jects-gantt__nonworking' });
      band.style.left = `${nw.x}px`;
      band.style.width = `${nw.width}px`;
      this.backdrop.append(band);
    }

    // Column lines.
    for (const line of computeColumnLines(this.axis, 0, width)) {
      const el = createEl('div', {
        className: `jects-gantt__colline${line.major ? ' jects-gantt__colline--major' : ''}`,
      });
      el.style.left = `${line.x}px`;
      this.backdrop.append(el);
    }

    // Today / now marker.
    const [todayBox] = projectTimeRanges(
      [{ id: 'today', span: { start: this.now, end: this.now }, kind: 'marker' }],
      this.axis,
    );
    if (todayBox) {
      const el = createEl('div', { className: 'jects-gantt__today' });
      el.style.left = `${todayBox.x}px`;
      el.setAttribute('aria-hidden', 'true');
      this.backdrop.append(el);
    }
  }

  private renderBars(): void {
    // jects-safe-html: clears content; no interpolation
    this.barsLayer.innerHTML = '';
    this.barById.clear();
    this.barEls.clear();
    this.rowOffsets.clear();
    const barHeight = 18;

    // Keep the roving-tabindex cursor valid: default it to the first row, and
    // reset it if the previously-focused task is no longer present.
    if (this.focusId == null || !this.rows.some((r) => r.task.id === this.focusId)) {
      this.focusId = this.rows[0]?.task.id ?? null;
    }

    for (const row of this.rows) {
      this.rowOffsets.set(row.task.id, row.top);
      const span = this.spanOf(row.task);
      const box = this.axis.spanToBox(span);
      const yInRow = Math.max(0, (row.height - barHeight) / 2);

      const event: EventBar<TaskModel<T>>['event'] = {
        id: row.task.id,
        rowId: row.task.id,
        span,
        record: row.task,
        editable: !row.task.summary,
      };
      if (row.task.percentDone != null) event.progress = row.task.percentDone;
      const bar: EventBar<TaskModel<T>> = {
        event,
        x: box.x,
        width: Math.max(0, box.width),
        y: yInRow,
        height: barHeight,
        lane: 0,
      };
      this.barById.set(row.task.id, bar);

      // Baseline overlay (behind the live bar).
      if (row.baseline) {
        const bBox = this.axis.spanToBox({ start: row.baseline.start, end: row.baseline.end });
        const baselineEl = createEl('div', { className: 'jects-gantt__baseline' });
        baselineEl.style.left = `${bBox.x}px`;
        baselineEl.style.width = `${Math.max(2, bBox.width)}px`;
        baselineEl.style.top = `${row.top + row.height - 6}px`;
        baselineEl.setAttribute('aria-hidden', 'true');
        this.barsLayer.append(baselineEl);
      }

      const el = this.buildBarEl(row, bar, barHeight);
      this.barsLayer.append(el);
      this.barEls.set(row.task.id, el);
    }
  }

  private buildBarEl(
    row: TimelineRowInput<T>,
    bar: EventBar<TaskModel<T>>,
    barHeight: number,
  ): HTMLElement {
    const task = row.task;
    const kind = task.milestone ? 'milestone' : task.summary ? 'summary' : 'task';
    const el = createEl('div', {
      className: `jects-gantt__bar jects-gantt__bar--${kind}${row.critical ? ' jects-gantt__bar--critical' : ''}`,
    });
    el.dataset.taskId = String(task.id);
    el.setAttribute('role', 'listitem');
    // Roving tabindex: exactly one bar is in the tab order at a time; the rest
    // are reachable via Up/Down arrows. The first bar (or the remembered focus
    // cursor) is the tab stop.
    el.tabIndex = this.isFocusBar(task.id) ? 0 : -1;
    el.setAttribute('aria-describedby', this.hintId);
    const name = task.name ?? String(task.id);
    const pct = task.percentDone != null ? ` ${Math.round(task.percentDone * 100)}% complete` : '';
    el.setAttribute('aria-label', `${name}${pct}`);
    el.title = name;

    if (task.milestone) {
      el.style.left = `${bar.x - barHeight / 2}px`;
      el.style.top = `${row.top + bar.y}px`;
      el.style.width = `${barHeight}px`;
      el.style.height = `${barHeight}px`;
      return el;
    }

    el.style.left = `${bar.x}px`;
    el.style.top = `${row.top + bar.y}px`;
    el.style.width = `${Math.max(2, bar.width)}px`;
    el.style.height = `${barHeight}px`;

    // Progress fill (percent done).
    if (task.percentDone != null && task.percentDone > 0 && !task.summary) {
      const fill = createEl('div', { className: 'jects-gantt__bar-progress' });
      fill.style.width = `${Math.min(100, task.percentDone * 100)}%`;
      el.append(fill);
    }
    const label = createEl('span', { className: 'jects-gantt__bar-label' });
    label.textContent = name;
    el.append(label);

    if (!task.summary) {
      // Resize handles.
      const left = createEl('span', { className: 'jects-gantt__bar-handle jects-gantt__bar-handle--start' });
      left.dataset.zone = 'resize-start';
      const right = createEl('span', { className: 'jects-gantt__bar-handle jects-gantt__bar-handle--end' });
      right.dataset.zone = 'resize-end';
      // Link-create handle (drag from the finish terminal to a successor).
      const link = createEl('span', { className: 'jects-gantt__bar-link' });
      link.dataset.zone = 'link';
      link.setAttribute('aria-hidden', 'true');
      el.append(left, right, link);
    }
    return el;
  }

  private renderDependencies(): void {
    const width = this.contentWidth();
    const height = this.totalHeight();
    this.depSvg.setAttribute('width', String(width));
    this.depSvg.setAttribute('height', String(height));
    this.depSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    while (this.depSvg.firstChild) this.depSvg.removeChild(this.depSvg.firstChild);

    const links: DependencyLink[] = [];
    for (const d of this.deps) {
      if (d.active === false) continue;
      const { fromSide, toSide } = terminalsFor(d.type ?? 'FS');
      links.push({ id: d.id, fromId: d.fromId, toId: d.toId, fromSide, toSide });
    }
    // Build a router using current row offsets.
    const router = new OrthogonalDependencyRouter<TaskModel<T>>({ rowOffsets: this.rowOffsets });
    const lines = router.route({ links, bars: this.barById, axis: this.axis });
    for (const line of lines) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'jects-gantt__dep-line');
      path.setAttribute('d', line.path);
      path.setAttribute('fill', 'none');
      this.depSvg.append(path);
      const head = document.createElementNS(SVG_NS, 'path');
      head.setAttribute('class', 'jects-gantt__dep-arrow');
      head.setAttribute('d', router.arrowFor(line));
      this.depSvg.append(head);
    }
  }

  /* ── gestures ──────────────────────────────────────────────────────────── */

  private contentX(clientX: number): number {
    const rect = this.content.getBoundingClientRect();
    return clientX - rect.left;
  }

  private handlePointerDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    const barEl = target.closest('.jects-gantt__bar') as HTMLElement | null;
    if (!barEl) return;
    const taskId = barEl.dataset.taskId;
    if (taskId == null) return;
    const id = this.idFromString(taskId);
    const bar = this.barById.get(id);
    if (!bar) return;
    const task = bar.event.record;
    if (task.summary) return; // summaries are engine-derived, not draggable

    const zone = (target.dataset.zone ?? target.closest('[data-zone]')?.getAttribute('data-zone')) as
      | 'resize-start'
      | 'resize-end'
      | 'link'
      | undefined;

    if (zone === 'link') {
      this.beginLinkDrag(id, e);
      return;
    }
    if (task.milestone && zone !== undefined) return;

    const mode: DragMode =
      zone === 'resize-start' ? 'resize-start' : zone === 'resize-end' ? 'resize-end' : 'move';

    e.preventDefault();
    this.activeDrag = new BarDragController(e, {
      eventId: id,
      mode,
      origin: bar.event.span,
      axis: this.axis,
      snap: true,
      onPreview: (s) => this.previewBar(id, s.span),
      onCommit: (s) => this.opts.onTaskSpanChange?.(id, s.span, mode),
      onEnd: () => {
        this.activeDrag = null;
        this.refresh();
      },
    });
  }

  private previewBar(id: RecordId, span: TimeSpan): void {
    const el = this.barEls.get(id);
    if (!el) return;
    const box = this.axis.spanToBox(span);
    el.style.left = `${box.x}px`;
    el.style.width = `${Math.max(2, box.width)}px`;
  }

  private beginLinkDrag(fromId: RecordId, down: PointerEvent): void {
    down.preventDefault();
    const ghost = document.createElementNS(SVG_NS, 'path');
    ghost.setAttribute('class', 'jects-gantt__dep-line jects-gantt__dep-line--ghost');
    ghost.setAttribute('fill', 'none');
    this.depSvg.append(ghost);
    const fromBar = this.barById.get(fromId)!;
    const fromOff = this.rowOffsets.get(fromId) ?? 0;
    const fromBox = this.axis.spanToBox(fromBar.event.span);
    const fx = fromBox.x + fromBox.width;
    const fy = fromOff + fromBar.y + fromBar.height / 2;

    const move = (e: PointerEvent): void => {
      const x = this.contentX(e.clientX);
      const rect = this.content.getBoundingClientRect();
      const y = e.clientY - rect.top;
      ghost.setAttribute('d', `M ${fx} ${fy} L ${x} ${y}`);
    };
    const up = (e: PointerEvent): void => {
      const toEl = (e.target as HTMLElement)?.closest?.('.jects-gantt__bar') as HTMLElement | null;
      const toIdStr = toEl?.dataset.taskId;
      this.endLinkDrag();
      if (toIdStr != null) {
        const toId = this.idFromString(toIdStr);
        if (toId !== fromId) {
          this.opts.onDependencyCreate?.({ fromId, toId, type: 'FS' });
        }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    this.linkDrag = { fromId, side: 'end', move, up };
  }

  private endLinkDrag(): void {
    if (!this.linkDrag) return;
    window.removeEventListener('pointermove', this.linkDrag.move);
    window.removeEventListener('pointerup', this.linkDrag.up);
    this.linkDrag = null;
    const ghost = this.depSvg.querySelector('.jects-gantt__dep-line--ghost');
    ghost?.remove();
  }

  private handleClick(e: MouseEvent): void {
    const barEl = (e.target as HTMLElement).closest('.jects-gantt__bar') as HTMLElement | null;
    if (!barEl?.dataset.taskId) return;
    this.opts.onTaskClick?.(this.idFromString(barEl.dataset.taskId), e);
  }

  private handleDblClick(e: MouseEvent): void {
    const barEl = (e.target as HTMLElement).closest('.jects-gantt__bar') as HTMLElement | null;
    if (!barEl?.dataset.taskId) return;
    this.opts.onTaskDblClick?.(this.idFromString(barEl.dataset.taskId), e);
  }

  /* ── keyboard operability ─────────────────────────────────────────────── */

  /** Whether `id` is the bar currently holding the roving tabindex. */
  private isFocusBar(id: RecordId): boolean {
    return this.focusId != null && String(this.focusId) === String(id);
  }

  /** Track the focus cursor as the user tabs/clicks onto a bar. */
  private handleFocusIn(e: FocusEvent): void {
    const barEl = (e.target as HTMLElement | null)?.closest?.(
      '.jects-gantt__bar',
    ) as HTMLElement | null;
    const idStr = barEl?.dataset.taskId;
    if (idStr == null) return;
    this.focusId = this.idFromString(idStr);
  }

  /** Move the roving tabindex to `id` and focus its element. */
  private focusBar(id: RecordId): void {
    this.focusId = id;
    for (const [barId, el] of this.barEls) {
      el.tabIndex = String(barId) === String(id) ? 0 : -1;
    }
    this.barEls.get(id)?.focus();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const barEl = (e.target as HTMLElement | null)?.closest?.(
      '.jects-gantt__bar',
    ) as HTMLElement | null;
    const idStr = barEl?.dataset.taskId;
    if (idStr == null) return;
    const id = this.idFromString(idStr);
    const bar = this.barById.get(id);
    if (!bar) return;
    const task = bar.event.record;

    switch (e.key) {
      case 'Enter':
      case 'F2': {
        // If a link is armed and this is a *different* bar, complete the link;
        // otherwise open the editor.
        if (e.key === 'Enter' && this.linkSourceId != null && String(this.linkSourceId) !== String(id)) {
          e.preventDefault();
          const fromId = this.linkSourceId;
          this.linkSourceId = null;
          this.opts.onDependencyCreate?.({ fromId, toId: id, type: 'FS' });
          return;
        }
        e.preventDefault();
        this.opts.onTaskDblClick?.(id, new MouseEvent('dblclick'));
        return;
      }
      case 'l':
      case 'L': {
        // Arm/disarm keyboard link-create from this bar (summaries excepted —
        // they are engine-derived, not directly linkable here).
        if (task.summary) return;
        e.preventDefault();
        this.linkSourceId = this.isLinkArmed(id) ? null : id;
        return;
      }
      case 'Escape': {
        if (this.linkSourceId != null) {
          e.preventDefault();
          this.linkSourceId = null;
        }
        return;
      }
      case 'ArrowDown': {
        e.preventDefault();
        this.moveFocusBy(id, 1);
        return;
      }
      case 'ArrowUp': {
        e.preventDefault();
        this.moveFocusBy(id, -1);
        return;
      }
      case 'ArrowRight':
      case 'ArrowLeft': {
        // Move/resize nudges are not valid on summaries (engine-derived spans).
        if (task.summary) return;
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        this.nudge(id, dir, e);
        return;
      }
      default:
        return;
    }
  }

  /** Is the given bar the one currently armed as a link source? */
  private isLinkArmed(id: RecordId): boolean {
    return this.linkSourceId != null && String(this.linkSourceId) === String(id);
  }

  /** Move the focus cursor `delta` rows within the visible bar list. */
  private moveFocusBy(fromId: RecordId, delta: number): void {
    const idx = this.rows.findIndex((r) => String(r.task.id) === String(fromId));
    if (idx === -1) return;
    const next = this.rows[idx + delta];
    if (!next) return;
    this.focusBar(next.task.id);
  }

  /**
   * Keyboard nudge of a task span by one step:
   *   - plain Arrow → move the whole bar,
   *   - Shift+Arrow → resize the finish (end),
   *   - Alt+Arrow   → resize the start.
   * Milestones only support move. Routes through `onTaskSpanChange` exactly like
   * a pointer drag, so the engine reschedules dependents + the critical path.
   */
  private nudge(id: RecordId, dir: 1 | -1, e: KeyboardEvent): void {
    const bar = this.barById.get(id);
    if (!bar) return;
    const task = bar.event.record;
    const step = GanttTimelineView.NUDGE_MS * dir;
    const span = this.spanOf(task);
    let next: TimeSpan;
    let mode: DragMode;
    if (task.milestone) {
      next = { start: span.start + step, end: span.start + step };
      mode = 'move';
    } else if (e.shiftKey) {
      const end = Math.max(span.start + GanttTimelineView.NUDGE_MS, span.end + step);
      next = { start: span.start, end };
      mode = 'resize-end';
    } else if (e.altKey) {
      const start = Math.min(span.end - GanttTimelineView.NUDGE_MS, span.start + step);
      next = { start, end: span.end };
      mode = 'resize-start';
    } else {
      next = { start: span.start + step, end: span.end + step };
      mode = 'move';
    }
    this.opts.onTaskSpanChange?.(id, next, mode);
  }

  private idFromString(s: string): RecordId {
    // Row ids may be numeric; prefer the original task's id type when known.
    for (const row of this.rows) if (String(row.task.id) === s) return row.task.id;
    return s;
  }

  private spanOf(task: TaskModel<T>): TimeSpan {
    const start = task.start ?? this.axis.range.start;
    const end = task.milestone ? start : task.end ?? start + (task.duration ?? 0);
    return { start, end };
  }
}

/** ISO-ish week number (UTC), sufficient for header labels. */
function weekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = date.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 86_400_000));
}
