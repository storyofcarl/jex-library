/**
 * `GanttProgressLineFeature` — the Gantt **Progress line / status line**
 * (Bryntum/DHTMLX "ProgressLine" parity feature).
 *
 * A progress line (a.k.a. status line, jagged line, or "line of balance") is a
 * vertical marker drawn at a chosen **status date** that *zig-zags* away from
 * that date for every in-progress task to visualise schedule health at a glance:
 *
 *   - For each task, the line connects to the point on the task's bar that
 *     represents how far the task *actually* is (its `percentDone`), measured in
 *     working-time-proportional bar space.
 *   - When that progress point sits **left** of the status date the task is
 *     **behind** schedule (it should have been further along by now); the line
 *     bows left. When it sits **right** of the status date the task is **ahead**.
 *   - Tasks that have not started yet (status date before the task start) or are
 *     already finished before the status date are pinned straight to the status
 *     date, so completed/upcoming work reads as "on the line".
 *
 * This is the classic project-controls instrument for "are we on track?" — the
 * deeper a task's vertex bows to the left, the further behind it is.
 *
 * Design (concurrency-safe, contract-pure — mirrors the Indicators feature):
 *   - It is a `GanttFeature`: installed via `gantt.use(new GanttProgressLineFeature())`
 *     or `new Gantt(el, { plugins: [new GanttProgressLineFeature()] })`. It touches
 *     ONLY the public `GanttApi` (engine reads, the timeline `el`/`axis`, events,
 *     `track`). It never edits the timeline renderer or the Gantt class.
 *   - It paints into ONE owned light-DOM overlay appended to the timeline content
 *     (a sibling of `.jects-gantt__bars`), and re-paints whenever the bars layer
 *     is rebuilt (observed via `MutationObserver`, exactly like Indicators) or the
 *     engine reschedules — coalesced to one paint per frame.
 *   - Bar geometry is read from the already-laid-out `.jects-gantt__bar` elements
 *     (their `left`/`top`/`width` within the content), so the feature stays
 *     decoupled from the row virtualizer and survives drag/resize/expand/collapse.
 *   - The zig-zag projection itself is a PURE function (`computeProgressVertices`)
 *     so the geometry is fully unit-testable without a DOM.
 *
 * All times are epoch milliseconds (UTC), matching the rest of the Gantt contract.
 */

import './progress-line.css';
import type { Model, RecordId } from '@jects/core';
import type { TimeMs } from '@jects/timeline-core';
import type { GanttApi, GanttFeature, TaskModel } from '../contract.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. CONFIG / EVENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A symbolic status-date anchor. `'today'` tracks the timeline's now-marker;
 * `'projectStart'` / `'projectEnd'` pin to the live project span boundary.
 */
export type ProgressLineAnchor = 'today' | 'projectStart' | 'projectEnd';

/** Configuration for the Progress-line feature. */
export interface GanttProgressLineConfig<T extends Model = Model> {
  /**
   * The status date the line is anchored to, in epoch ms. Takes precedence over
   * `anchor`. When neither is given the line tracks `'today'`.
   */
  statusDate?: TimeMs;
  /** Symbolic status-date anchor used when `statusDate` is omitted. */
  anchor?: ProgressLineAnchor;
  /**
   * Display label rendered at the top of the line (also the accessible name of
   * the line's anchor handle). Defaults to a formatted status date.
   */
  label?: string;
  /**
   * Only draw vertices for tasks that are in progress (0 < percentDone < 1) and
   * straddle the status date. When `false`, every leaf task gets a vertex,
   * pinned to the status date when it has nothing to report. Default `true`.
   */
  inProgressOnly?: boolean;
  /**
   * Include summary (parent) tasks in the line. Summary rollup progress is
   * usually noisy, so they are skipped by default. Default `false`.
   */
  includeSummaries?: boolean;
  /**
   * Custom per-task progress override (0..1). Lets a consumer drive the line from
   * a field other than `percentDone` (e.g. earned-value % complete). Returning
   * `undefined` falls back to the task's `percentDone`.
   */
  getProgress?(task: TaskModel<T>): number | undefined;
}

/** A single resolved vertex on the progress line, in content-pixel space. */
export interface ProgressVertex {
  /** The task this vertex belongs to. */
  taskId: RecordId;
  /** The row's vertical centre within the content, px. */
  y: number;
  /** Top of the task's bar within the content, px (segment top). */
  top: number;
  /** Bottom of the task's bar within the content, px (segment bottom). */
  bottom: number;
  /** The x the line bows to for this task (the progress point), px. */
  x: number;
  /** Signed deviation from the status-date x (negative = behind, positive = ahead). */
  deviation: number;
  /** Schedule status derived from the deviation. */
  status: ProgressStatus;
}

/** Per-task schedule status relative to the status date. */
export type ProgressStatus = 'behind' | 'ahead' | 'onTrack';

/** Payload emitted when the status date changes (via {@link GanttProgressLineFeature.setStatusDate}). */
export interface ProgressLineChangePayload {
  /** The new resolved status date (epoch ms). */
  statusDate: TimeMs;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. PURE GEOMETRY (unit-testable, no DOM)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Geometry + progress for one bar, in content-pixel space — the projector input. */
export interface ProgressBarGeometry {
  taskId: RecordId;
  /** Bar left within content, px. */
  left: number;
  /** Bar width within content, px (>= 0). */
  width: number;
  /** Bar top within content, px. */
  top: number;
  /** Bar height, px. */
  height: number;
  /** Completion fraction 0..1 (clamped). */
  percentDone: number;
}

/** Threshold (px) within which a deviation is treated as "on track". */
const ON_TRACK_EPSILON = 0.5;

/**
 * Project bar geometry + a status-date x into the zig-zag vertices of a progress
 * line. Pure: no DOM, no time math beyond the supplied pixels.
 *
 * For each bar the **progress point** is the x at `left + percentDone * width`
 * (where the bar's completion shading ends). The line bows to that x. The signed
 * deviation `progressX - statusX` classifies the task as behind (left/negative),
 * ahead (right/positive), or on-track (within {@link ON_TRACK_EPSILON}).
 *
 * @param bars      Visible bar geometries.
 * @param statusX   The status date projected to a content-pixel x.
 * @returns Vertices ordered top-to-bottom (by `top`), ready to draw as a polyline.
 */
export function computeProgressVertices(
  bars: ReadonlyArray<ProgressBarGeometry>,
  statusX: number,
): ProgressVertex[] {
  const out: ProgressVertex[] = [];
  for (const bar of bars) {
    const pct = clamp01(bar.percentDone);
    const width = Math.max(0, bar.width);
    // The progress point: where completion shading ends along the bar. A zero-
    // width bar (milestone) collapses to its left edge.
    const progressX = bar.left + pct * width;
    const deviation = progressX - statusX;
    out.push({
      taskId: bar.taskId,
      y: bar.top + bar.height / 2,
      top: bar.top,
      bottom: bar.top + bar.height,
      x: progressX,
      deviation,
      status:
        Math.abs(deviation) <= ON_TRACK_EPSILON
          ? 'onTrack'
          : deviation < 0
            ? 'behind'
            : 'ahead',
    });
  }
  out.sort((a, b) => a.top - b.top);
  return out;
}

/**
 * Build the SVG polyline `points` string for a progress line: it starts at the
 * status date at the top, threads through each task vertex, and returns to the
 * status date at the bottom, so the line always closes back onto the status x at
 * its extremes (the classic jagged "line of balance" silhouette).
 *
 * @param vertices  Vertices from {@link computeProgressVertices} (top→bottom).
 * @param statusX   The status-date x.
 * @param top       The y the line should start at (content top, usually 0).
 * @param bottom    The y the line should end at (content height).
 */
export function progressPolylinePoints(
  vertices: ReadonlyArray<ProgressVertex>,
  statusX: number,
  top: number,
  bottom: number,
): string {
  const pts: Array<[number, number]> = [[statusX, top]];
  for (const v of vertices) {
    // Enter the row at the bar top on the status line, bow out to the progress
    // point at the row centre, then return to the status line at the bar bottom.
    pts.push([statusX, v.top]);
    pts.push([v.x, v.y]);
    pts.push([statusX, v.bottom]);
  }
  pts.push([statusX, bottom]);
  return pts.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. THE FEATURE
   ═══════════════════════════════════════════════════════════════════════════ */

const SVG_NS = 'http://www.w3.org/2000/svg';
const LAYER_CLASS = 'jects-gantt__progress-line';

/**
 * The Progress-line feature. Owns a single absolutely-positioned SVG overlay in
 * the timeline content and repaints it on every relevant change. All DOM and all
 * subscriptions are released on `destroy()` (instance is reusable via re-`init`).
 */
export class GanttProgressLineFeature<T extends Model = Model>
  implements GanttFeature<T>
{
  readonly name = 'progressLine';

  private readonly config: GanttProgressLineConfig<T>;
  /** Explicit status date override set at runtime (wins over config/anchor). */
  private statusDateOverride: TimeMs | null = null;

  private api: GanttApi<T> | null = null;
  private content: HTMLElement | null = null;
  private barsLayer: HTMLElement | null = null;
  private layer: SVGSVGElement | null = null;
  private observer: MutationObserver | null = null;
  private rafId = 0;
  private disposers: Array<() => void> = [];
  private destroyed = false;

  constructor(config: GanttProgressLineConfig<T> = {}) {
    this.config = { ...config };
    if (config.statusDate != null) this.statusDateOverride = config.statusDate;
  }

  /* ── GanttFeature lifecycle ────────────────────────────────────────────── */

  init(api: GanttApi<T>): void {
    // Re-init after destroy() (instance reuse) must start clean.
    this.destroyed = false;
    this.disposers = [];
    this.api = api;

    const timelineEl = api.timeline.el;
    this.barsLayer =
      timelineEl.querySelector<HTMLElement>('.jects-gantt__bars') ?? null;
    // The bars layer's parent is the scrollable content; the overlay must be a
    // sibling so it shares the same coordinate space (content-pixel space).
    this.content = (this.barsLayer?.parentElement as HTMLElement | null) ?? null;

    if (this.content) {
      const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
      svg.setAttribute('class', LAYER_CLASS);
      svg.setAttribute('aria-hidden', 'false');
      svg.setAttribute('role', 'img');
      this.layer = svg;
      this.content.append(svg);
    }

    // Repaint on reschedule / task edits (progress + bar positions move).
    this.disposers.push(api.on('scheduleChange', () => this.schedulePaint()));
    this.disposers.push(api.on('taskChange', () => this.schedulePaint()));

    if (this.barsLayer) {
      // The bars layer is rebuilt wholesale on each timeline repaint; re-paint
      // the line after every rebuild, coalesced to one frame.
      const observer = new MutationObserver(() => this.schedulePaint());
      observer.observe(this.barsLayer, { childList: true });
      this.observer = observer;
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
    this.layer?.remove();
    this.layer = null;
    this.barsLayer = null;
    this.content = null;
    this.api = null;
  }

  /* ── public controls ───────────────────────────────────────────────────── */

  /**
   * Set the status date the line is anchored to (epoch ms) and repaint. Emits a
   * `progressLineChange` event on the Gantt with the resolved date.
   */
  setStatusDate(date: TimeMs): void {
    this.statusDateOverride = date;
    this.paint();
    this.api?.emit('progressLineChange', { statusDate: date });
  }

  /** The currently resolved status date (epoch ms), or `undefined` if unresolved. */
  getStatusDate(): TimeMs | undefined {
    return this.resolveStatusDate();
  }

  /**
   * The resolved vertices for the current view (for tests / external readouts).
   * Returns `[]` when not installed or no bars are present.
   */
  getVertices(): ProgressVertex[] {
    const statusX = this.resolveStatusX();
    if (statusX == null) return [];
    return computeProgressVertices(this.collectBars(), statusX);
  }

  /* ── status-date resolution ────────────────────────────────────────────── */

  private resolveStatusDate(): TimeMs | undefined {
    if (this.statusDateOverride != null) return this.statusDateOverride;
    const anchor = this.config.anchor ?? 'today';
    if (anchor === 'today') return Date.now();
    const api = this.api;
    if (!api) return undefined;
    const span = projectSpanFromTasks(api);
    if (!span) return undefined;
    return anchor === 'projectStart' ? span.start : span.end;
  }

  private resolveStatusX(): number | null {
    const api = this.api;
    if (!api) return null;
    const date = this.resolveStatusDate();
    if (date == null || !Number.isFinite(date)) return null;
    const axis = api.timeline.axis;
    const { start, end } = axis.range;
    if (date < start || date > end) return null;
    return axis.toX(date);
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

  /** (Re)draw the progress line for the current view. Idempotent. */
  paint(): void {
    const svg = this.layer;
    const content = this.content;
    if (!svg || !content) return;

    // Clear prior drawing.
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const statusX = this.resolveStatusX();
    if (statusX == null) {
      svg.setAttribute('aria-label', 'Progress line (status date out of range)');
      return;
    }

    const width = Math.max(content.scrollWidth, content.clientWidth, 1);
    const height = Math.max(content.scrollHeight, content.clientHeight, 1);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const vertices = computeProgressVertices(this.collectBars(), statusX);

    // The base (straight) status line behind the zig-zag, for orientation.
    const base = document.createElementNS(SVG_NS, 'line');
    base.setAttribute('class', `${LAYER_CLASS}-base`);
    base.setAttribute('x1', String(round(statusX)));
    base.setAttribute('y1', '0');
    base.setAttribute('x2', String(round(statusX)));
    base.setAttribute('y2', String(height));
    svg.append(base);

    // The jagged progress polyline.
    const poly = document.createElementNS(SVG_NS, 'polyline');
    poly.setAttribute('class', `${LAYER_CLASS}-poly`);
    poly.setAttribute(
      'points',
      progressPolylinePoints(vertices, statusX, 0, height),
    );
    svg.append(poly);

    // Per-task vertex dots (status-coloured) for legibility + hit-testing.
    for (const v of vertices) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute(
        'class',
        `${LAYER_CLASS}-vertex ${LAYER_CLASS}-vertex--${v.status}`,
      );
      dot.setAttribute('cx', String(round(v.x)));
      dot.setAttribute('cy', String(round(v.y)));
      dot.setAttribute('r', '3');
      dot.dataset.taskId = String(v.taskId);
      dot.dataset.status = v.status;
      svg.append(dot);
    }

    const behind = vertices.filter((v) => v.status === 'behind').length;
    const ahead = vertices.filter((v) => v.status === 'ahead').length;
    svg.setAttribute(
      'aria-label',
      `Progress line at ${formatDate(this.resolveStatusDate() ?? 0)}: ` +
        `${behind} task${behind === 1 ? '' : 's'} behind, ` +
        `${ahead} ahead`,
    );
  }

  /* ── bar collection ────────────────────────────────────────────────────── */

  /**
   * Read bar geometry + progress from the laid-out bars layer. Geometry is taken
   * from inline `left/top/width` styles (the renderer sets these), so we don't
   * depend on layout being flushed (jsdom never flushes layout).
   */
  private collectBars(): ProgressBarGeometry[] {
    const layer = this.barsLayer;
    const api = this.api;
    if (!layer || !api) return [];
    const out: ProgressBarGeometry[] = [];
    const bars = layer.querySelectorAll<HTMLElement>('.jects-gantt__bar');
    for (const bar of bars) {
      const idStr = bar.dataset.taskId;
      if (idStr == null) continue;
      const task = this.taskFromId(idStr);
      if (!task) continue;
      const isSummary = task.summary === true || api.getChildren(task.id).length > 0;
      if (isSummary && !this.config.includeSummaries) continue;

      const progress = this.progressOf(task);
      // In-progress-only filtering: skip tasks with nothing to report unless the
      // consumer opted into a full line.
      if (this.config.inProgressOnly !== false) {
        if (progress <= 0 || progress >= 1) continue;
      }

      const geom = readBarGeometry(bar);
      if (!geom) continue;
      out.push({ taskId: task.id, percentDone: progress, ...geom });
    }
    return out;
  }

  private progressOf(task: TaskModel<T>): number {
    const custom = this.config.getProgress?.(task);
    const raw = custom != null ? custom : (task.percentDone ?? 0);
    return clamp01(raw);
  }

  private taskFromId(idStr: string): TaskModel<T> | undefined {
    const api = this.api;
    if (!api) return undefined;
    return (
      api.getTask(idStr) ??
      (/^-?\d+$/.test(idStr) ? api.getTask(Number(idStr)) : undefined)
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Read a bar's content-space geometry from its inline left/top/width styles. */
function readBarGeometry(
  bar: HTMLElement,
): { left: number; width: number; top: number; height: number } | null {
  const left = parsePx(bar.style.left);
  const top = parsePx(bar.style.top);
  if (left == null || top == null) return null;
  // Width may be absent on milestones (diamond sized via height); default to 0.
  const width = parsePx(bar.style.width) ?? 0;
  const height = parsePx(bar.style.height) ?? bar.offsetHeight ?? 0;
  return { left, top, width, height };
}

function parsePx(value: string | undefined): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** Derive a project span from the engine's tasks (min start / max end). */
function projectSpanFromTasks<T extends Model>(
  api: GanttApi<T>,
): { start: TimeMs; end: TimeMs } | undefined {
  let start = Infinity;
  let end = -Infinity;
  // Walk every row in the timeline's row virtualizer (not just the painted
  // window) so the project span covers the whole plan, not the viewport.
  const rows = api.timeline.rows;
  for (let i = 0; i < rows.count; i++) {
    const row = rows.rowAt(i);
    if (!row) continue;
    const task = row.record as unknown as TaskModel<T>;
    const s = task.start ?? api.getSchedule(task.id)?.start;
    const e = task.end ?? api.getSchedule(task.id)?.end;
    if (s != null && s < start) start = s;
    if (e != null && e > end) end = e;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return { start, end };
}

/** Compact UTC date (YYYY-MM-DD) for the accessible label. */
function formatDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Convenience factory mirroring the other Gantt feature factories. */
export function createProgressLine<T extends Model = Model>(
  config?: GanttProgressLineConfig<T>,
): GanttProgressLineFeature<T> {
  return new GanttProgressLineFeature<T>(config);
}
