/**
 * `GanttRollupFeature` — visual **child-task rollup markers** on summary bars
 * (Bryntum/DHTMLX "Rollups" parity feature).
 *
 * The scheduling engine already rolls up summary *dates* (a parent summary spans
 * min-child-start → max-child-end). This feature adds the *visual* rollup layer
 * Bryntum/DHTMLX call "rollups": each child task / milestone is projected as a
 * thin marker **overlaid on the parent summary bar**, so a *collapsed* summary
 * still shows where its children sit in time without expanding the tree.
 *
 *   - A child *task* projects to a thin horizontal segment spanning its
 *     start→end, drawn near the lower edge of the summary bar.
 *   - A child *milestone* (zero-duration) projects to a small diamond at its
 *     instant.
 *   - Markers are clamped to the summary bar's own width, so a marker never
 *     paints outside its parent (the engine guarantees children lie within the
 *     parent's rolled-up span, but clamping keeps sub-pixel rounding honest).
 *
 * Opt-in, two ways (matching the vendor `task.rollup` flag + a global default):
 *   - Per task: set `task.rollup === true` (a flag read off the model / `data`).
 *   - Globally: construct with `{ allSummaries: true }` to roll up every collapsed
 *     summary regardless of the per-task flag.
 * `'collapsed'` (default) only paints rollups on **collapsed** summaries — the
 * classic behaviour, since an expanded summary already shows its children as
 * their own rows. `'always'` paints them even when expanded.
 *
 * Design (concurrency-safe, contract-pure — mirrors Indicators / Progress-line):
 *   - It is a `GanttFeature`: installed via `gantt.use(new GanttRollupFeature())`
 *     or `new Gantt(el, { plugins: [new GanttRollupFeature()] })`. It touches
 *     ONLY the public `GanttApi` (engine reads, the timeline `el`/`axis`, events,
 *     `track`). It never edits the timeline renderer or the Gantt class.
 *   - It decorates the already-laid-out `.jects-gantt__bar--summary` elements
 *     after every repaint, observed through a `MutationObserver` on the bars
 *     layer (the layer's children are rebuilt on each `refresh()`), so it survives
 *     drags, reschedules, baseline/critical toggles, and expand/collapse without
 *     coupling to a specific event — coalesced to one paint per frame.
 *   - Whether a summary is *collapsed* is read from the live DOM (do any of its
 *     descendants have their own bar?), so the feature stays decoupled from the
 *     tree-store's expansion API.
 *   - The span→pixel projection is a PURE function (`computeRollupMarkers`) so the
 *     geometry is fully unit-testable without a DOM.
 *
 * All times are epoch milliseconds (UTC), matching the rest of the Gantt contract.
 */

import './rollup-markers.css';
import type { Model, RecordId } from '@jects/core';
import type { TimeSpan } from '@jects/timeline-core';
import type { GanttApi, GanttFeature, TaskModel } from '../contract.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. CONFIG / EVENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * When the rollup markers are painted on a summary:
 *   - `'collapsed'` — only while the summary is collapsed (children hidden). The
 *     classic vendor behaviour; an expanded summary already shows its children.
 *   - `'always'` — paint even when the summary is expanded.
 */
export type RollupMode = 'collapsed' | 'always';

/** Configuration for the Rollup feature. */
export interface GanttRollupConfig<T extends Model = Model> {
  /**
   * Roll up *every* eligible summary, ignoring the per-task `rollup` flag. When
   * `false` (default) only tasks flagged `rollup === true` (on the model or its
   * descendants — see {@link GanttRollupConfig.rollupChildrenOf}) contribute.
   */
  allSummaries?: boolean;
  /**
   * When the markers are shown. Default `'collapsed'` — only on collapsed
   * summaries, where the rollup actually adds information.
   */
  mode?: RollupMode;
  /**
   * Resolve whether a given task should appear as a rollup marker on its parent.
   * Defaults to reading a truthy `rollup` flag off the task (or `task.data`).
   * Returning `undefined` falls back to that default.
   */
  isRollup?(task: TaskModel<T>): boolean | undefined;
  /**
   * Resolve whether a given *summary* should host rollup markers. Defaults to:
   * `allSummaries`, OR the summary itself is flagged `rollup`, OR any descendant
   * is flagged `rollup`. Returning `undefined` falls back to that default.
   */
  rollupChildrenOf?(summary: TaskModel<T>): boolean | undefined;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. PURE GEOMETRY (unit-testable, no DOM)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A child task/milestone projected into a rollup marker, in BAR-LOCAL pixels. */
export interface RollupMarker {
  /** The child task this marker represents. */
  taskId: RecordId;
  /** Marker kind — a span segment for tasks, a point diamond for milestones. */
  kind: 'task' | 'milestone';
  /** Left offset WITHIN the summary bar, px (already clamped to the bar). */
  left: number;
  /** Marker width, px (>= a minimum so it stays visible; 0-mapped for points). */
  width: number;
  /** The child's resolved span (epoch ms), for tooltips / readouts. */
  span: TimeSpan;
}

/** One child's span + identity in absolute content-pixel space — projector input. */
export interface RollupChildGeometry {
  taskId: RecordId;
  /** Child left within the timeline content, px (`axis.toX(start)`). */
  left: number;
  /** Child width within the content, px (`axis.toX(end) - axis.toX(start)`). */
  width: number;
  /** Whether the child is a milestone (drawn as a point diamond). */
  milestone: boolean;
  /** The child's resolved span (epoch ms). */
  span: TimeSpan;
}

/** The summary bar's own geometry in absolute content-pixel space. */
export interface RollupBarGeometry {
  /** Summary bar left within the content, px. */
  left: number;
  /** Summary bar width within the content, px. */
  width: number;
}

/** Minimum painted width (px) for a task marker so a short child stays visible. */
export const MIN_MARKER_WIDTH = 3;
/** Painted size (px) of a milestone diamond marker. */
export const MILESTONE_MARKER_SIZE = 7;

/**
 * Project a summary bar's children onto the bar as rollup markers. Pure: no DOM,
 * no time math beyond the supplied content-pixel geometry.
 *
 * Each child is translated from absolute content-x into the bar's local frame
 * (`childLeft - barLeft`) and clamped so the marker never extends past either
 * edge of the summary bar. A milestone collapses to a centred diamond at its
 * instant. Children with no resolvable geometry (zero-width non-milestone, fully
 * outside the bar) are dropped.
 *
 * @param bar      The summary bar geometry in content-pixel space.
 * @param children The child geometries in content-pixel space.
 * @returns Markers in bar-local pixels, ordered left→right.
 */
export function computeRollupMarkers(
  bar: RollupBarGeometry,
  children: ReadonlyArray<RollupChildGeometry>,
): RollupMarker[] {
  const barLeft = bar.left;
  const barWidth = Math.max(0, bar.width);
  const barRight = barLeft + barWidth;
  const out: RollupMarker[] = [];

  for (const child of children) {
    if (child.milestone) {
      // Centre the diamond on the child's instant, clamped within the bar.
      const centre = clamp(child.left, barLeft, barRight);
      const local = centre - barLeft - MILESTONE_MARKER_SIZE / 2;
      out.push({
        taskId: child.taskId,
        kind: 'milestone',
        left: clamp(local, 0, Math.max(0, barWidth - MILESTONE_MARKER_SIZE)),
        width: MILESTONE_MARKER_SIZE,
        span: child.span,
      });
      continue;
    }

    // Clamp the child's [start, end] interval to the bar's [left, right].
    const childLeft = Math.max(child.left, barLeft);
    const childRight = Math.min(child.left + Math.max(0, child.width), barRight);
    if (childRight <= childLeft && child.width > 0) {
      // Fully outside the bar — nothing to draw.
      continue;
    }
    const local = childLeft - barLeft;
    const width = Math.max(MIN_MARKER_WIDTH, childRight - childLeft);
    out.push({
      taskId: child.taskId,
      kind: 'task',
      left: clamp(local, 0, Math.max(0, barWidth - 1)),
      width: Math.min(width, Math.max(MIN_MARKER_WIDTH, barWidth - local)),
      span: child.span,
    });
  }

  out.sort((a, b) => a.left - b.left);
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (hi < lo) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. THE FEATURE
   ═══════════════════════════════════════════════════════════════════════════ */

const BLOCK = 'jects-gantt__rollup';
const LAYER_CLASS = 'jects-gantt__rollups';

/**
 * The Rollup feature. Stateless across tasks; all DOM it creates lives inside a
 * single `.jects-gantt__rollups` layer per summary bar and is fully removed on
 * `destroy()` (instance is reusable via re-`init`).
 */
export class GanttRollupFeature<T extends Model = Model> implements GanttFeature<T> {
  readonly name = 'rollups';

  private readonly config: GanttRollupConfig<T>;

  private api: GanttApi<T> | null = null;
  private barsLayer: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private rafId = 0;
  private disposers: Array<() => void> = [];
  private destroyed = false;

  constructor(config: GanttRollupConfig<T> = {}) {
    this.config = { ...config };
  }

  /* ── GanttFeature lifecycle ────────────────────────────────────────────── */

  init(api: GanttApi<T>): void {
    // Re-init after destroy() (instance reuse) must start clean.
    this.destroyed = false;
    this.disposers = [];
    this.api = api;

    const layer = api.timeline.el.querySelector<HTMLElement>('.jects-gantt__bars');
    this.barsLayer = layer;

    // Repaint on reschedule / task edits (child spans + bar positions move).
    this.disposers.push(api.on('scheduleChange', () => this.schedulePaint()));
    this.disposers.push(api.on('taskChange', () => this.schedulePaint()));

    if (layer) {
      // The bars layer is rebuilt wholesale on each timeline repaint (which is
      // also how expand/collapse surfaces); re-decorate after every rebuild,
      // coalesced to one frame.
      const observer = new MutationObserver(() => this.schedulePaint());
      observer.observe(layer, { childList: true });
      this.observer = observer;
    }

    api.track(() => this.destroy());
    // Initial paint over whatever is already rendered.
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
    if (this.barsLayer) this.clearAll(this.barsLayer);
    this.barsLayer = null;
    this.api = null;
  }

  /* ── public readouts (for tests / external use) ────────────────────────── */

  /**
   * The resolved rollup markers for one summary task in BAR-LOCAL pixel space, or
   * `[]` if the task is not an eligible/rendered summary. Useful for tests and
   * external readouts without scraping the DOM.
   */
  markersFor(summaryId: RecordId): RollupMarker[] {
    const api = this.api;
    const layer = this.barsLayer;
    if (!api || !layer) return [];
    const bar = layer.querySelector<HTMLElement>(
      `.jects-gantt__bar[data-task-id="${cssId(summaryId)}"]`,
    );
    if (!bar) return [];
    const summary = this.taskFromBar(String(summaryId));
    if (!summary || !this.shouldRollup(summary, bar)) return [];
    return this.computeFor(summary, bar);
  }

  /* ── painting ──────────────────────────────────────────────────────────── */

  /** Coalesce repaints to one per animation frame (or microtask in jsdom). */
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

  /** (Re)decorate every visible summary bar with its child rollup markers. */
  paint(): void {
    const layer = this.barsLayer;
    const api = this.api;
    if (!layer || !api) return;

    const bars = layer.querySelectorAll<HTMLElement>('.jects-gantt__bar--summary');
    for (const bar of bars) {
      const idStr = bar.dataset.taskId;
      if (idStr == null) {
        this.clearBar(bar);
        continue;
      }
      const summary = this.taskFromBar(idStr);
      if (!summary || !this.shouldRollup(summary, bar)) {
        this.clearBar(bar);
        continue;
      }
      const markers = this.computeFor(summary, bar);
      this.decorateBar(bar, markers);
    }
  }

  private decorateBar(
    bar: HTMLElement,
    markers: ReadonlyArray<RollupMarker>,
  ): void {
    // Remove any prior decoration first (idempotent re-paint).
    this.clearBar(bar);
    if (markers.length === 0) {
      bar.removeAttribute('data-rollup');
      return;
    }

    const overlay = document.createElement('span');
    overlay.className = LAYER_CLASS;
    // The overlay is a decorative summary of hidden child positions; expose it as
    // a labelled group so AT users learn the collapsed summary still carries its
    // children's schedule.
    overlay.setAttribute('role', 'img');
    overlay.setAttribute(
      'aria-label',
      `${markers.length} rolled-up child task${markers.length === 1 ? '' : 's'}`,
    );

    for (const m of markers) {
      const el = document.createElement('span');
      el.className = `${BLOCK} ${BLOCK}--${m.kind}`;
      el.dataset.taskId = String(m.taskId);
      el.dataset.rollupKind = m.kind;
      el.style.insetInlineStart = `${round(m.left)}px`;
      el.style.inlineSize = `${round(m.width)}px`;
      const child = this.taskFromBar(String(m.taskId));
      const name = child?.name ?? String(m.taskId);
      el.title = name;
      el.setAttribute('aria-hidden', 'true');
      overlay.append(el);
    }

    // Flag the host bar so CSS/consumers can react to "has rollups".
    bar.dataset.rollup = String(markers.length);
    bar.append(overlay);
  }

  /* ── resolution helpers ────────────────────────────────────────────────── */

  /**
   * Whether `summary` should host rollup markers right now: it must be an actual
   * summary, eligible (per config / flags), and — in `'collapsed'` mode — actually
   * collapsed (no descendant currently has its own bar).
   */
  private shouldRollup(summary: TaskModel<T>, bar: HTMLElement): boolean {
    const api = this.api;
    if (!api) return false;
    const children = api.getChildren(summary.id);
    if (children.length === 0) return false; // not a real summary

    if (!this.summaryEligible(summary)) return false;

    const mode = this.config.mode ?? 'collapsed';
    if (mode === 'always') return true;
    return this.isCollapsed(summary, bar);
  }

  /** Is the summary eligible to host rollups, per config + per-task flags? */
  private summaryEligible(summary: TaskModel<T>): boolean {
    const override = this.config.rollupChildrenOf?.(summary);
    if (override != null) return override;
    if (this.config.allSummaries) return true;
    if (readFlag(summary)) return true;
    // Or any descendant is flagged for rollup.
    return this.descendants(summary.id).some((d) => this.childEligible(d));
  }

  /** Is a leaf/child eligible to appear as a rollup marker? */
  private childEligible(child: TaskModel<T>): boolean {
    const override = this.config.isRollup?.(child);
    if (override != null) return override;
    if (this.config.allSummaries) return true;
    return readFlag(child);
  }

  /**
   * A summary is collapsed when NONE of its descendants currently has a bar in
   * the layer (an expanded summary renders each child as its own row → bar).
   */
  private isCollapsed(summary: TaskModel<T>, bar: HTMLElement): boolean {
    const layer = bar.parentElement;
    if (!layer) return true;
    for (const d of this.descendants(summary.id)) {
      if (layer.querySelector(`.jects-gantt__bar[data-task-id="${cssId(d.id)}"]`)) {
        return false;
      }
    }
    return true;
  }

  /** Compute the bar-local markers for a summary from the engine + axis. */
  private computeFor(summary: TaskModel<T>, bar: HTMLElement): RollupMarker[] {
    const api = this.api;
    if (!api) return [];
    const barGeom = readBarGeometry(bar);
    if (!barGeom) return [];

    const axis = api.timeline.axis;
    const children: RollupChildGeometry[] = [];
    for (const leaf of this.rollupLeaves(summary)) {
      const span = this.spanOf(leaf);
      if (span == null) continue;
      const xStart = axis.toX(span.start);
      const xEnd = axis.toX(span.end);
      children.push({
        taskId: leaf.id,
        left: xStart,
        width: Math.max(0, xEnd - xStart),
        milestone: leaf.milestone === true || span.end === span.start,
        span,
      });
    }
    return computeRollupMarkers(barGeom, children);
  }

  /**
   * The leaf descendants of a summary that should roll up: every leaf (non-summary)
   * descendant that is itself eligible. We project leaves (not intermediate
   * summaries) so nested plans roll up to the actual schedulable work + milestones.
   */
  private rollupLeaves(summary: TaskModel<T>): TaskModel<T>[] {
    const api = this.api;
    if (!api) return [];
    const out: TaskModel<T>[] = [];
    for (const d of this.descendants(summary.id)) {
      const isLeaf = api.getChildren(d.id).length === 0;
      if (!isLeaf) continue;
      if (this.childEligible(d)) out.push(d);
    }
    return out;
  }

  /** Depth-first descendants of a task (excluding the task itself). */
  private descendants(rootId: RecordId): TaskModel<T>[] {
    const api = this.api;
    if (!api) return [];
    const out: TaskModel<T>[] = [];
    const seen = new Set<RecordId>();
    const walk = (id: RecordId): void => {
      for (const child of api.getChildren(id)) {
        if (seen.has(child.id)) continue; // cycle guard
        seen.add(child.id);
        out.push(child);
        walk(child.id);
      }
    };
    walk(rootId);
    return out;
  }

  /** Resolve a task's span (epoch ms) from the model, falling back to the engine. */
  private spanOf(task: TaskModel<T>): TimeSpan | null {
    const sched = this.api?.getSchedule(task.id);
    const start = task.start ?? sched?.start;
    if (start == null) return null;
    if (task.milestone) return { start, end: start };
    const end = task.end ?? sched?.end ?? start + (task.duration ?? 0);
    return { start, end: Math.max(start, end) };
  }

  private taskFromBar(idStr: string): TaskModel<T> | undefined {
    const api = this.api;
    if (!api) return undefined;
    // Bar ids are stringified; the engine stores the original id type. Try the
    // string first, then a numeric coercion for numeric ids.
    return (
      api.getTask(idStr) ??
      (/^-?\d+$/.test(idStr) ? api.getTask(Number(idStr)) : undefined)
    );
  }

  private clearBar(bar: HTMLElement): void {
    for (const layer of bar.querySelectorAll(`.${LAYER_CLASS}`)) layer.remove();
    bar.removeAttribute('data-rollup');
  }

  private clearAll(root: HTMLElement): void {
    for (const layer of root.querySelectorAll(`.${LAYER_CLASS}`)) layer.remove();
    for (const bar of root.querySelectorAll<HTMLElement>('.jects-gantt__bar[data-rollup]')) {
      bar.removeAttribute('data-rollup');
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Read the opt-in `rollup` flag off a task model (direct or under `data`). */
function readFlag(task: Model): boolean {
  const direct = (task as { rollup?: unknown }).rollup;
  if (direct === true) return true;
  const data = (task as { data?: { rollup?: unknown } }).data;
  return data?.rollup === true;
}

/** Read a summary bar's content-space geometry from its inline left/width styles. */
function readBarGeometry(bar: HTMLElement): RollupBarGeometry | null {
  const left = parsePx(bar.style.left);
  if (left == null) return null;
  const width = parsePx(bar.style.width) ?? 0;
  return { left, width };
}

function parsePx(value: string | undefined): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** Escape an id for use inside a `[data-task-id="..."]` attribute selector. */
function cssId(id: RecordId): string {
  return String(id).replace(/(["\\])/g, '\\$1');
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Convenience factory mirroring the other Gantt feature factories. */
export function createRollupFeature<T extends Model = Model>(
  config?: GanttRollupConfig<T>,
): GanttRollupFeature<T> {
  return new GanttRollupFeature<T>(config);
}
