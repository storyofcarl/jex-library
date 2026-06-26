/**
 * `GanttSegmentedTasksFeature` — render + interaction layer for **split /
 * segmented tasks** (Bryntum/DHTMLX "Split tasks" parity feature).
 *
 * A split task is ONE task whose work is interrupted into several working
 * segments with gaps between them (see `engine/segments.ts` for the headless
 * model + math). This feature is the visual + gesture half:
 *
 *   - It decorates each already-laid-out leaf `.jects-gantt__bar` whose task
 *     carries `segments[]`, drawing every segment as a **sub-bar** positioned at
 *     its real pixel span and joining consecutive segments with a thin dashed
 *     **connector** spanning each gap. The base bar's own fill/label is dimmed to
 *     a hull so the segments read as the task's actual work.
 *   - **Split**: double-click a segment (or press `S` on a focused bar) cuts it
 *     into two segments around a working gap, routed through the engine.
 *   - **Join**: click a connector (or press `J` on a focused split bar) merges
 *     the two pieces it joins back into one.
 *   - **Per-segment drag**: pointer-drag a sub-bar (move) or its edge handles
 *     (resize) re-schedules just that segment against the task calendar, leaving
 *     the others put; the whole task's span + total duration are recomputed and
 *     written back THROUGH the engine so dependents reschedule.
 *
 * Design — identical discipline to `GanttRollupFeature` (concurrency-safe,
 * contract-pure):
 *   - A `GanttFeature`: installed via `gantt.use(new GanttSegmentedTasksFeature())`
 *     or `new Gantt(el, { plugins: [...] })`. It touches ONLY the public
 *     `GanttApi` (engine reads/edits via `updateTask`, the timeline `el`/`axis`,
 *     events, `track`). It NEVER edits the timeline renderer, the Gantt class, or
 *     the frozen contract.
 *   - It re-decorates after every repaint, observed by a `MutationObserver` on
 *     the bars layer (rebuilt wholesale on each `refresh()`), coalesced to one
 *     paint per frame — so it survives drags, reschedules, baseline/critical
 *     toggles, and expand/collapse without coupling to a specific event.
 *   - The span→pixel projection is a PURE function (`computeSegmentBoxes`) so the
 *     geometry is fully unit-testable without a DOM.
 *
 * All times are epoch milliseconds (UTC), matching the rest of the Gantt contract.
 */

import './segmented-tasks.css';
import type { Model, RecordId } from '@jects/core';
import type { TimeMs, TimeSpan } from '@jects/timeline-core';
import type { GanttApi, GanttFeature, TaskModel } from '../contract.js';
import {
  readSegments,
  splitTask,
  joinSegments,
  joinAll,
  moveSegment,
  segmentsSpan,
  segmentsWorkingDuration,
  ONE_WORKING_DAY,
  type TaskSegment,
  type SegmentDragMode,
} from '../engine/segments.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. CONFIG
   ═══════════════════════════════════════════════════════════════════════════ */

/** Configuration for the segmented-tasks feature. */
export interface GanttSegmentedTasksConfig<T extends Model = Model> {
  /**
   * Working gap (ms) inserted between the two pieces when a task is split.
   * Default one working day.
   */
  splitGap?: number;
  /**
   * Allow interactive split/join/segment-drag gestures. When `false` the feature
   * still RENDERS segments but is read-only (useful for print/export views).
   * Default `true`.
   */
  interactive?: boolean;
  /**
   * Resolve whether a task may be split/segmented. Defaults to: any non-summary,
   * non-milestone leaf task. Returning `undefined` falls back to that default.
   */
  canSplit?(task: TaskModel<T>): boolean | undefined;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. PURE GEOMETRY (unit-testable, no DOM)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A segment projected into BAR-LOCAL pixel space (offsets from the bar's left). */
export interface SegmentBox {
  /** Index of the segment in the task's segment list. */
  index: number;
  /** Left offset WITHIN the bar, px. */
  left: number;
  /** Width, px (>= a visible minimum). */
  width: number;
  /** The segment's resolved span (epoch ms). */
  span: TimeSpan;
}

/** A connector drawn across the gap between two segments, in bar-local px. */
export interface SegmentConnector {
  /** The index of the gap (== left segment index). */
  gapIndex: number;
  /** Left offset within the bar, px. */
  left: number;
  /** Width spanning the gap, px (>= 0). */
  width: number;
}

/** The pure projection of a split task's segments onto its bar. */
export interface SegmentLayout {
  boxes: SegmentBox[];
  connectors: SegmentConnector[];
}

/** Minimum painted width (px) for a segment sub-bar so a short piece stays usable. */
export const MIN_SEGMENT_WIDTH = 6;

/**
 * Project a split task's segments into bar-local pixel boxes + gap connectors.
 *
 * `barLeft` is the bar's absolute content-x (`axis.toX(taskStart)`); `toX` maps
 * an epoch-ms instant → absolute content-x. Each segment box is translated into
 * the bar's local frame (`toX(seg.start) - barLeft`) and floored to a minimum
 * visible width; connectors fill the px gap between consecutive boxes. Pure: no
 * DOM, no time math beyond the supplied projector.
 */
export function computeSegmentBoxes(
  segments: ReadonlyArray<TaskSegment>,
  barLeft: number,
  toX: (t: TimeMs) => number,
): SegmentLayout {
  const boxes: SegmentBox[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const xs = toX(seg.start);
    const xe = toX(seg.end);
    const left = xs - barLeft;
    const width = Math.max(MIN_SEGMENT_WIDTH, xe - xs);
    boxes.push({ index: i, left, width, span: { start: seg.start, end: seg.end } });
  }
  boxes.sort((a, b) => a.left - b.left);

  const connectors: SegmentConnector[] = [];
  for (let i = 1; i < boxes.length; i++) {
    const prev = boxes[i - 1]!;
    const cur = boxes[i]!;
    const from = prev.left + prev.width;
    const width = Math.max(0, cur.left - from);
    connectors.push({ gapIndex: prev.index, left: from, width });
  }
  return { boxes, connectors };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. THE FEATURE
   ═══════════════════════════════════════════════════════════════════════════ */

const LAYER_CLASS = 'jects-gantt__segments';
const SEG_CLASS = 'jects-gantt__segment';
const CONNECTOR_CLASS = 'jects-gantt__segment-connector';
const HANDLE_CLASS = 'jects-gantt__segment-handle';

/** Per-segment pointer drag in flight. */
interface SegDrag {
  taskId: RecordId;
  index: number;
  mode: SegmentDragMode;
  startClientX: number;
  msPerPx: number;
  move(e: PointerEvent): void;
  up(e: PointerEvent): void;
}

/**
 * The split / segmented-tasks feature. All DOM it creates lives inside a single
 * `.jects-gantt__segments` layer per split bar and is fully removed on
 * `destroy()`; the instance is reusable via re-`init`.
 */
export class GanttSegmentedTasksFeature<T extends Model = Model>
  implements GanttFeature<T>
{
  readonly name = 'segmentedTasks';

  private readonly config: GanttSegmentedTasksConfig<T>;

  private api: GanttApi<T> | null = null;
  private barsLayer: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private rafId = 0;
  private disposers: Array<() => void> = [];
  private drag: SegDrag | null = null;
  private destroyed = false;

  constructor(config: GanttSegmentedTasksConfig<T> = {}) {
    this.config = { ...config };
  }

  /* ── GanttFeature lifecycle ────────────────────────────────────────────── */

  init(api: GanttApi<T>): void {
    this.destroyed = false;
    this.disposers = [];
    this.api = api;

    const layer = api.timeline.el.querySelector<HTMLElement>('.jects-gantt__bars');
    this.barsLayer = layer;

    this.disposers.push(api.on('scheduleChange', () => this.schedulePaint()));
    this.disposers.push(api.on('taskChange', () => this.schedulePaint()));

    if (layer) {
      const observer = new MutationObserver(() => this.schedulePaint());
      observer.observe(layer, { childList: true });
      this.observer = observer;

      if (this.interactive) {
        const onPointerDown = (e: PointerEvent): void => this.handlePointerDown(e);
        const onDblClick = (e: MouseEvent): void => this.handleDblClick(e);
        const onClick = (e: MouseEvent): void => this.handleClick(e);
        const onKeyDown = (e: KeyboardEvent): void => this.handleKeyDown(e);
        layer.addEventListener('pointerdown', onPointerDown);
        layer.addEventListener('dblclick', onDblClick);
        layer.addEventListener('click', onClick);
        layer.addEventListener('keydown', onKeyDown);
        this.disposers.push(() => layer.removeEventListener('pointerdown', onPointerDown));
        this.disposers.push(() => layer.removeEventListener('dblclick', onDblClick));
        this.disposers.push(() => layer.removeEventListener('click', onClick));
        this.disposers.push(() => layer.removeEventListener('keydown', onKeyDown));
      }
    }

    api.track(() => this.destroy());
    this.paint();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.endDrag();
    for (const off of this.disposers) {
      try {
        off();
      } catch {
        /* best-effort */
      }
    }
    this.disposers = [];
    this.observer?.disconnect();
    this.observer = null;
    if (this.barsLayer) this.clearAll(this.barsLayer);
    this.barsLayer = null;
    this.api = null;
  }

  private get interactive(): boolean {
    return this.config.interactive !== false;
  }

  /* ── public API (programmatic split/join + readouts for tests) ─────────── */

  /** The resolved, normalized segments of a task (or `[]` when not split). */
  segmentsOf(taskId: RecordId): TaskSegment[] {
    const task = this.taskFromBar(String(taskId));
    return task ? readSegments(task) : [];
  }

  /** The bar-local segment boxes + connectors for a rendered split task. */
  layoutFor(taskId: RecordId): SegmentLayout {
    const api = this.api;
    const layer = this.barsLayer;
    if (!api || !layer) return { boxes: [], connectors: [] };
    const bar = layer.querySelector<HTMLElement>(
      `.jects-gantt__bar[data-task-id="${cssId(taskId)}"]`,
    );
    const task = this.taskFromBar(String(taskId));
    if (!bar || !task) return { boxes: [], connectors: [] };
    const segments = readSegments(task);
    if (segments.length < 2) return { boxes: [], connectors: [] };
    const barLeft = parsePx(bar.style.left) ?? 0;
    return computeSegmentBoxes(segments, barLeft, (t) => api.timeline.axis.toX(t));
  }

  /**
   * Split a task at `at` (epoch ms), routed through the engine. Returns `true`
   * when the task became (or stayed) split. No-op for ineligible tasks.
   */
  split(taskId: RecordId, at: TimeMs): boolean {
    const api = this.api;
    if (!api) return false;
    const task = api.getTask(taskId);
    if (!task || !this.eligible(task)) return false;
    const calc = api.engine.getCalculatorFor(taskId);
    const origin = this.taskSpan(task);
    const result = splitTask(readSegments(task), origin, at, calc, this.splitGap());
    if (result.segments.length < 2) return false;
    return this.writeBack(taskId, result.segments, result.span);
  }

  /**
   * Join the gap after segment `gapIndex` of a split task (default: the first
   * gap), routed through the engine. Returns `true` on a successful merge.
   */
  join(taskId: RecordId, gapIndex = 0): boolean {
    const api = this.api;
    if (!api) return false;
    const task = api.getTask(taskId);
    if (!task) return false;
    const segments = readSegments(task);
    if (segments.length < 2) return false;
    const calc = api.engine.getCalculatorFor(taskId);
    const result = joinSegments(segments, gapIndex, calc, this.taskSpan(task));
    return this.writeBack(taskId, result.segments, result.span);
  }

  /** Collapse a split task back to a single contiguous bar (joins every gap). */
  joinAll(taskId: RecordId): boolean {
    const api = this.api;
    if (!api) return false;
    const task = api.getTask(taskId);
    if (!task) return false;
    const segments = readSegments(task);
    if (segments.length < 2) return false;
    const calc = api.engine.getCalculatorFor(taskId);
    const result = joinAll(segments, calc, this.taskSpan(task));
    return this.writeBack(taskId, result.segments, result.span);
  }

  /* ── painting ──────────────────────────────────────────────────────────── */

  private schedulePaint(): void {
    if (this.rafId || this.destroyed) return;
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: FrameRequestCallback): number => {
            queueMicrotask(() => cb(0));
            return 1;
          };
    this.rafId = raf(() => {
      this.rafId = 0;
      this.paint();
    });
  }

  /** (Re)decorate every visible leaf bar that carries segments. */
  paint(): void {
    const layer = this.barsLayer;
    const api = this.api;
    if (!layer || !api) return;

    const bars = layer.querySelectorAll<HTMLElement>('.jects-gantt__bar');
    for (const bar of bars) {
      const idStr = bar.dataset.taskId;
      if (idStr == null) {
        this.clearBar(bar);
        continue;
      }
      const task = this.taskFromBar(idStr);
      const segments = task ? readSegments(task) : [];
      if (!task || segments.length < 2 || bar.classList.contains('jects-gantt__bar--summary')) {
        this.clearBar(bar);
        continue;
      }
      this.decorateBar(bar, task, segments);
    }
  }

  private decorateBar(
    bar: HTMLElement,
    task: TaskModel<T>,
    segments: ReadonlyArray<TaskSegment>,
  ): void {
    this.clearBar(bar);
    const api = this.api;
    if (!api) return;
    const barLeft = parsePx(bar.style.left) ?? 0;
    const layout = computeSegmentBoxes(segments, barLeft, (t) => api.timeline.axis.toX(t));
    if (layout.boxes.length < 2) {
      bar.removeAttribute('data-split');
      return;
    }

    const overlay = document.createElement('span');
    overlay.className = LAYER_CLASS;
    overlay.setAttribute('role', 'group');
    const name = task.name ?? String(task.id);
    overlay.setAttribute(
      'aria-label',
      `${name} is split into ${layout.boxes.length} working segments with ${layout.connectors.length} gap${
        layout.connectors.length === 1 ? '' : 's'
      }`,
    );

    // Connectors first (behind the sub-bars).
    for (const c of layout.connectors) {
      const el = document.createElement('span');
      el.className = CONNECTOR_CLASS;
      el.dataset.gapIndex = String(c.gapIndex);
      el.style.insetInlineStart = `${round(c.left)}px`;
      el.style.inlineSize = `${round(c.width)}px`;
      el.setAttribute('role', 'button');
      el.tabIndex = -1;
      el.title = 'Join segments';
      el.setAttribute('aria-label', `Join segments around gap ${c.gapIndex + 1}`);
      overlay.append(el);
    }

    // Sub-bars.
    for (const box of layout.boxes) {
      const seg = segments[box.index]!;
      const el = document.createElement('span');
      el.className = `${SEG_CLASS}`;
      el.dataset.segIndex = String(box.index);
      el.style.insetInlineStart = `${round(box.left)}px`;
      el.style.inlineSize = `${round(box.width)}px`;
      // No `listitem` role: the overlay is a `group` (it also hosts connector
      // buttons), so the pieces are labelled `group` children, not list items —
      // `listitem` would require a `list` parent (axe aria-required-parent).
      el.setAttribute('role', 'group');
      el.title = `Segment ${box.index + 1}`;
      el.setAttribute(
        'aria-label',
        `Segment ${box.index + 1} of ${layout.boxes.length}`,
      );
      const pct = seg.percentDone ?? task.percentDone;
      if (pct != null && pct > 0) {
        const fill = document.createElement('span');
        fill.className = 'jects-gantt__segment-progress';
        fill.style.inlineSize = `${Math.min(100, pct * 100)}%`;
        el.append(fill);
      }
      if (this.interactive) {
        const start = document.createElement('span');
        start.className = `${HANDLE_CLASS} ${HANDLE_CLASS}--start`;
        start.dataset.segZone = 'resize-start';
        start.setAttribute('aria-hidden', 'true');
        const end = document.createElement('span');
        end.className = `${HANDLE_CLASS} ${HANDLE_CLASS}--end`;
        end.dataset.segZone = 'resize-end';
        end.setAttribute('aria-hidden', 'true');
        el.append(start, end);
      }
      overlay.append(el);
    }

    bar.dataset.split = String(layout.boxes.length);
    bar.append(overlay);
  }

  /* ── gestures ──────────────────────────────────────────────────────────── */

  private handlePointerDown(e: PointerEvent): void {
    if (this.drag) return;
    const target = e.target as HTMLElement;
    const segEl = target.closest(`.${SEG_CLASS}`) as HTMLElement | null;
    if (!segEl) return;
    const { taskId, index } = this.segContext(segEl);
    if (taskId == null || index == null) return;
    const api = this.api;
    if (!api) return;

    const zone = (target.dataset.segZone ??
      target.closest('[data-seg-zone]')?.getAttribute('data-seg-zone')) as
      | 'resize-start'
      | 'resize-end'
      | undefined;
    const mode: SegmentDragMode =
      zone === 'resize-start' ? 'resize-start' : zone === 'resize-end' ? 'resize-end' : 'move';

    // Stop the underlying bar drag from also firing.
    e.preventDefault();
    e.stopPropagation();

    const axis = api.timeline.axis;
    // Wall-clock ms-per-pixel at the current zoom (a 1-day probe).
    const x0 = axis.toX(0);
    const x1 = axis.toX(ONE_WORKING_DAY);
    const msPerPx = x1 > x0 ? ONE_WORKING_DAY / (x1 - x0) : ONE_WORKING_DAY / 1;

    segEl.classList.add('jects-gantt__segment--dragging');
    const baseLeft = parsePx(segEl.style.insetInlineStart) ?? 0;
    const baseWidth = parsePx(segEl.style.inlineSize) ?? MIN_SEGMENT_WIDTH;

    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - e.clientX;
      // Live visual preview (the real reschedule lands on pointerup).
      if (mode === 'move') {
        segEl.style.insetInlineStart = `${round(baseLeft + dx)}px`;
      } else if (mode === 'resize-start') {
        segEl.style.insetInlineStart = `${round(baseLeft + dx)}px`;
        segEl.style.inlineSize = `${round(Math.max(MIN_SEGMENT_WIDTH, baseWidth - dx))}px`;
      } else {
        segEl.style.inlineSize = `${round(Math.max(MIN_SEGMENT_WIDTH, baseWidth + dx))}px`;
      }
    };
    const up = (ev: PointerEvent): void => {
      const dx = ev.clientX - e.clientX;
      this.endDrag();
      const delta = Math.round(dx * msPerPx);
      if (delta !== 0) this.commitSegmentDrag(taskId, index, delta, mode);
      else this.paint();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    this.drag = { taskId, index, mode, startClientX: e.clientX, msPerPx, move, up };
  }

  private commitSegmentDrag(
    taskId: RecordId,
    index: number,
    delta: number,
    mode: SegmentDragMode,
  ): void {
    const api = this.api;
    if (!api) return;
    const task = api.getTask(taskId);
    if (!task) return;
    const calc = api.engine.getCalculatorFor(taskId);
    const result = moveSegment(readSegments(task), index, delta, mode, calc, this.taskSpan(task));
    this.writeBack(taskId, result.segments, result.span);
  }

  private handleDblClick(e: MouseEvent): void {
    const segEl = (e.target as HTMLElement).closest(`.${SEG_CLASS}`) as HTMLElement | null;
    if (!segEl) return;
    const { taskId } = this.segContext(segEl);
    if (taskId == null) return;
    e.preventDefault();
    e.stopPropagation();
    // Split at the pointer's instant within the segment.
    const at = this.timeAtClientX(e.clientX);
    if (at != null) this.split(taskId, at);
  }

  private handleClick(e: MouseEvent): void {
    const conn = (e.target as HTMLElement).closest(`.${CONNECTOR_CLASS}`) as HTMLElement | null;
    if (!conn) return;
    const bar = conn.closest('.jects-gantt__bar') as HTMLElement | null;
    const idStr = bar?.dataset.taskId;
    if (idStr == null) return;
    e.preventDefault();
    e.stopPropagation();
    const taskId = this.idFromBar(idStr);
    const gapIndex = Number(conn.dataset.gapIndex ?? 0);
    this.join(taskId, gapIndex);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const bar = (e.target as HTMLElement | null)?.closest?.(
      '.jects-gantt__bar',
    ) as HTMLElement | null;
    const idStr = bar?.dataset.taskId;
    if (idStr == null) return;
    const taskId = this.idFromBar(idStr);
    const task = this.taskFromBar(idStr);
    if (!task) return;

    if (e.key === 's' || e.key === 'S') {
      if (!this.eligible(task)) return;
      e.preventDefault();
      // Split at the midpoint of the task (or its first segment).
      const at = this.midpoint(task);
      if (at != null) this.split(taskId, at);
    } else if (e.key === 'j' || e.key === 'J') {
      if (readSegments(task).length < 2) return;
      e.preventDefault();
      this.join(taskId, 0);
    }
  }

  private endDrag(): void {
    if (!this.drag) return;
    window.removeEventListener('pointermove', this.drag.move);
    window.removeEventListener('pointerup', this.drag.up);
    for (const el of this.barsLayer?.querySelectorAll('.jects-gantt__segment--dragging') ?? []) {
      el.classList.remove('jects-gantt__segment--dragging');
    }
    this.drag = null;
  }

  /* ── engine write-back ─────────────────────────────────────────────────── */

  /**
   * Write a new segment list + span back THROUGH the engine. When the list
   * collapses to a single segment, the `segments` field is cleared so the task
   * renders as a normal contiguous bar. Routing through `updateTask` lets the
   * engine recompute duration + reschedule dependents, then we repaint.
   */
  private writeBack(taskId: RecordId, segments: TaskSegment[], span: TimeSpan): boolean {
    const api = this.api;
    if (!api) return false;
    const calc = api.engine.getCalculatorFor(taskId);
    const resolved = segmentsSpan(segments) ?? span;
    const patch: Partial<TaskModel<T>> = {
      start: resolved.start,
      end: resolved.end,
      duration: segmentsWorkingDuration(segments, calc),
    };
    // Single segment ⇒ no longer split: drop the segments field entirely.
    (patch as { segments?: TaskSegment[] | undefined }).segments =
      segments.length >= 2 ? segments : undefined;
    const ok = api.updateTask(taskId, patch);
    this.schedulePaint();
    return ok;
  }

  /* ── resolution helpers ────────────────────────────────────────────────── */

  /** Is `task` eligible to be split (leaf, non-summary, non-milestone)? */
  private eligible(task: TaskModel<T>): boolean {
    const override = this.config.canSplit?.(task);
    if (override != null) return override;
    if (task.summary || task.milestone) return false;
    return this.api ? this.api.getChildren(task.id).length === 0 : true;
  }

  private splitGap(): number {
    return this.config.splitGap ?? ONE_WORKING_DAY;
  }

  /** Resolve a task's contiguous span from its model / engine schedule. */
  private taskSpan(task: TaskModel<T>): TimeSpan {
    const segs = readSegments(task);
    const fromSegs = segmentsSpan(segs);
    if (fromSegs) return fromSegs;
    const sched = this.api?.getSchedule(task.id);
    const start = task.start ?? sched?.start ?? 0;
    const end = task.end ?? sched?.end ?? start + (task.duration ?? 0);
    return { start, end: Math.max(start, end) };
  }

  /** Time at the middle of a task (or its first segment) for keyboard split. */
  private midpoint(task: TaskModel<T>): TimeMs | null {
    const segs = readSegments(task);
    if (segs.length > 0) {
      const s = segs[0]!;
      return s.start + Math.floor((s.end - s.start) / 2);
    }
    const span = this.taskSpan(task);
    if (span.end <= span.start) return null;
    return span.start + Math.floor((span.end - span.start) / 2);
  }

  /** Map a client-X coordinate to an epoch-ms instant on the axis. */
  private timeAtClientX(clientX: number): TimeMs | null {
    const api = this.api;
    const layer = this.barsLayer;
    if (!api || !layer) return null;
    const content =
      (layer.closest('.jects-gantt__timeline-content') as HTMLElement | null) ??
      (layer.parentElement as HTMLElement | null);
    if (!content) return null;
    const rect = content.getBoundingClientRect();
    return api.timeline.axis.toTime(clientX - rect.left);
  }

  /** `{ taskId, index }` from a segment element. */
  private segContext(segEl: HTMLElement): { taskId: RecordId | null; index: number | null } {
    const bar = segEl.closest('.jects-gantt__bar') as HTMLElement | null;
    const idStr = bar?.dataset.taskId;
    const idxStr = segEl.dataset.segIndex;
    if (idStr == null || idxStr == null) return { taskId: null, index: null };
    return { taskId: this.idFromBar(idStr), index: Number(idxStr) };
  }

  private taskFromBar(idStr: string): TaskModel<T> | undefined {
    const api = this.api;
    if (!api) return undefined;
    return (
      api.getTask(idStr) ?? (/^-?\d+$/.test(idStr) ? api.getTask(Number(idStr)) : undefined)
    );
  }

  /** Coerce a bar's string id back to the engine's original id type. */
  private idFromBar(idStr: string): RecordId {
    if (this.api?.getTask(idStr)) return idStr;
    if (/^-?\d+$/.test(idStr) && this.api?.getTask(Number(idStr))) return Number(idStr);
    return idStr;
  }

  private clearBar(bar: HTMLElement): void {
    for (const layer of bar.querySelectorAll(`.${LAYER_CLASS}`)) layer.remove();
    bar.removeAttribute('data-split');
  }

  private clearAll(root: HTMLElement): void {
    for (const layer of root.querySelectorAll(`.${LAYER_CLASS}`)) layer.remove();
    for (const bar of root.querySelectorAll<HTMLElement>('.jects-gantt__bar[data-split]')) {
      bar.removeAttribute('data-split');
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. HELPERS / FACTORY
   ═══════════════════════════════════════════════════════════════════════════ */

/** Escape an id for use inside a `[data-task-id="..."]` attribute selector. */
function cssId(id: RecordId): string {
  return String(id).replace(/(["\\])/g, '\\$1');
}

function parsePx(value: string | undefined): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Convenience factory mirroring the other Gantt feature factories. */
export function createSegmentedTasksFeature<T extends Model = Model>(
  config?: GanttSegmentedTasksConfig<T>,
): GanttSegmentedTasksFeature<T> {
  return new GanttSegmentedTasksFeature<T>(config);
}
