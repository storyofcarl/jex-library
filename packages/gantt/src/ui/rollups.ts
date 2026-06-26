/**
 * `GanttRollups` — visual **child-task rollup glyphs on collapsed parent bars**
 * with **interactive hover/focus tooltips** (Bryntum/DHTMLX "Rollups" parity).
 *
 * The scheduling engine already rolls up summary *dates* (a parent summary spans
 * min-child-start → max-child-end). This additive `GanttFeature` adds the *visual*
 * rollup layer the vendors call "Rollups": for a **collapsed** summary row, every
 * descendant leaf task / milestone is projected onto the parent summary bar as a
 * small positioned glyph, so the collapsed parent still shows where its children
 * sit in time — without expanding the tree.
 *
 *   - A child *task* projects to a thin segment spanning its start→end, drawn as a
 *     rollup glyph on the lower edge of the summary bar.
 *   - A child *milestone* (zero-duration) projects to a small diamond at its
 *     instant.
 *   - Each glyph carries an **interactive tooltip**: hovering (or keyboard-focusing)
 *     a glyph surfaces the child's name, its start/finish dates and percent-done in
 *     a floating popover positioned over the glyph. This is the Bryntum "Rollups +
 *     tooltip" behaviour — the collapsed summary becomes a scannable mini-timeline.
 *
 * This module is deliberately **independent** of (and uses different CSS class
 * names than) any other rollup module in the package, so the two can coexist. It
 * owns the `jects-gantt__rollup-track` overlay and `jects-gantt__rollup-glyph`
 * glyphs, plus a single shared `jects-gantt__rollup-tip` tooltip element.
 *
 * Opt-in, matching the vendor `task.rollup` flag + a global default:
 *   - Per task: `task.rollup === true` (read off the model or `task.data`).
 *   - Globally: `{ allSummaries: true }` rolls up every collapsed summary.
 * `mode: 'collapsed'` (default) only paints on **collapsed** summaries (an expanded
 * summary already shows its children as their own rows); `mode: 'always'` paints
 * regardless of expansion state.
 *
 * Design (concurrency-safe, contract-pure — mirrors Indicators / Progress-line):
 *   - It is a `GanttFeature`: installed via `gantt.use(new GanttRollups())` or
 *     `new Gantt(el, { plugins: [new GanttRollups()] })`. It touches ONLY the public
 *     `GanttApi` (engine reads, the timeline `el`/`axis`, events, `track`). It never
 *     edits the timeline renderer or the Gantt class.
 *   - It decorates the already-laid-out `.jects-gantt__bar--summary` elements after
 *     every repaint, observed through a `MutationObserver` on the bars layer, so it
 *     survives drags, reschedules, baseline/critical toggles, and expand/collapse —
 *     coalesced to one paint per frame.
 *   - Whether a summary is *collapsed* is read from the live DOM (does any descendant
 *     currently have its own bar?), so the feature stays decoupled from the
 *     tree-store's expansion API.
 *   - The span→pixel projection is a PURE function (`projectRollups`) so the geometry
 *     is fully unit-testable without a DOM.
 *
 * All times are epoch milliseconds (UTC), matching the rest of the Gantt contract.
 */

import './rollups.css';
import type { Model, RecordId } from '@jects/core';
import type { TimeSpan } from '@jects/timeline-core';
import type { GanttApi, GanttFeature, TaskModel } from '../contract.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. CONFIG
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * When the rollup glyphs are painted on a summary:
 *   - `'collapsed'` — only while the summary is collapsed (children hidden). The
 *     classic vendor behaviour; an expanded summary already shows its children.
 *   - `'always'` — paint even when the summary is expanded.
 */
export type RollupMode = 'collapsed' | 'always';

/** Configuration for the Rollups feature. */
export interface GanttRollupsConfig<T extends Model = Model> {
  /**
   * Roll up *every* eligible summary, ignoring the per-task `rollup` flag. When
   * `false` (default) only summaries flagged `rollup` (themselves or with a flagged
   * descendant — see {@link GanttRollupsConfig.includeSummary}) host glyphs.
   */
  allSummaries?: boolean;
  /**
   * When the glyphs are shown. Default `'collapsed'` — only on collapsed summaries,
   * where the rollup actually adds information.
   */
  mode?: RollupMode;
  /**
   * Enable the interactive hover/focus tooltip on each glyph. Default `true`. When
   * `false`, glyphs still carry a native `title` for the accessible name but no
   * floating popover is shown.
   */
  tooltips?: boolean;
  /**
   * Resolve whether a given leaf task should appear as a rollup glyph. Defaults to
   * reading a truthy `rollup` flag off the task (or `task.data`). Returning
   * `undefined` falls back to that default.
   */
  includeChild?(task: TaskModel<T>): boolean | undefined;
  /**
   * Resolve whether a given *summary* should host rollup glyphs. Defaults to:
   * `allSummaries`, OR the summary itself is flagged `rollup`, OR any descendant is
   * flagged `rollup`. Returning `undefined` falls back to that default.
   */
  includeSummary?(summary: TaskModel<T>): boolean | undefined;
  /**
   * Build the tooltip's text content for a child. Defaults to
   * `"<name> · <start> – <end>[ · NN%]"`. Returning `''` suppresses the tooltip for
   * that glyph (the glyph is still painted).
   */
  tooltipText?(task: TaskModel<T>, span: TimeSpan): string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. PURE GEOMETRY (unit-testable, no DOM)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A child task/milestone projected into a rollup glyph, in BAR-LOCAL pixels. */
export interface RollupGlyph {
  /** The child task this glyph represents. */
  taskId: RecordId;
  /** Glyph kind — a span bar for tasks, a point diamond for milestones. */
  kind: 'bar' | 'milestone';
  /** Left offset WITHIN the summary bar, px (already clamped to the bar). */
  left: number;
  /** Glyph width, px (>= a minimum so it stays visible). */
  width: number;
  /** The child's resolved span (epoch ms), for tooltips / readouts. */
  span: TimeSpan;
}

/** One child's span + identity in absolute content-pixel space — projector input. */
export interface RollupChild {
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
export interface RollupBar {
  /** Summary bar left within the content, px. */
  left: number;
  /** Summary bar width within the content, px. */
  width: number;
}

/** Minimum painted width (px) for a task glyph so a short child stays visible. */
export const MIN_GLYPH_WIDTH = 4;
/** Painted size (px) of a milestone diamond glyph. */
export const MILESTONE_GLYPH_SIZE = 8;
/**
 * The milestone glyph is a square rotated 45° (`transform: rotate(45deg)` in CSS),
 * so its on-screen BOUNDING BOX is √2× wider than its `inline-size`, overhanging
 * each edge by `(√2 − 1)/2 · size`. We must reserve that overhang when clamping
 * the diamond's left, or the rightmost milestone's rotated corner pokes past the
 * summary bar's right edge.
 */
const MILESTONE_DIAGONAL_OVERHANG = ((Math.SQRT2 - 1) / 2) * MILESTONE_GLYPH_SIZE;

/**
 * Project a summary bar's children onto the bar as rollup glyphs. Pure: no DOM, no
 * time math beyond the supplied content-pixel geometry.
 *
 * Each child is translated from absolute content-x into the bar's local frame
 * (`childLeft - barLeft`) and clamped so the glyph never extends past either edge
 * of the summary bar. A milestone collapses to a centred diamond at its instant.
 * Children with no resolvable geometry (a non-milestone fully outside the bar) are
 * dropped. The result is ordered left→right.
 *
 * @param bar      The summary bar geometry in content-pixel space.
 * @param children The child geometries in content-pixel space.
 */
export function projectRollups(
  bar: RollupBar,
  children: ReadonlyArray<RollupChild>,
): RollupGlyph[] {
  const barLeft = bar.left;
  const barWidth = Math.max(0, bar.width);
  const barRight = barLeft + barWidth;
  const out: RollupGlyph[] = [];

  for (const child of children) {
    if (child.milestone) {
      const centre = clamp(child.left, barLeft, barRight);
      const local = centre - barLeft - MILESTONE_GLYPH_SIZE / 2;
      // Keep the ROTATED diamond's bounding box inside the bar: its corners
      // overhang the element box by `MILESTONE_DIAGONAL_OVERHANG` on each side,
      // so the usable left range shrinks by that overhang at both ends.
      const minLeft = MILESTONE_DIAGONAL_OVERHANG;
      const maxLeft = Math.max(
        minLeft,
        barWidth - MILESTONE_GLYPH_SIZE - MILESTONE_DIAGONAL_OVERHANG,
      );
      out.push({
        taskId: child.taskId,
        kind: 'milestone',
        left: clamp(local, minLeft, maxLeft),
        width: MILESTONE_GLYPH_SIZE,
        span: child.span,
      });
      continue;
    }

    // Clamp the child's [start, end] interval to the bar's [left, right].
    const childLeft = Math.max(child.left, barLeft);
    const childRight = Math.min(child.left + Math.max(0, child.width), barRight);
    if (childRight <= childLeft && child.width > 0) {
      // A real (non-zero) interval fully outside the bar — nothing to draw.
      continue;
    }
    const local = childLeft - barLeft;
    const rawWidth = Math.max(MIN_GLYPH_WIDTH, childRight - childLeft);
    out.push({
      taskId: child.taskId,
      kind: 'bar',
      left: clamp(local, 0, Math.max(0, barWidth - 1)),
      width: Math.min(rawWidth, Math.max(MIN_GLYPH_WIDTH, barWidth - local)),
      span: child.span,
    });
  }

  out.sort((a, b) => a.left - b.left || compareId(a.taskId, b.taskId));
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (hi < lo) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

function compareId(a: RecordId, b: RecordId): number {
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. THE FEATURE
   ═══════════════════════════════════════════════════════════════════════════ */

const TRACK = 'jects-gantt__rollup-track';
const GLYPH = 'jects-gantt__rollup-glyph';
const TIP = 'jects-gantt__rollup-tip';
/** Vertical gap (CSS px) between the tooltip's bottom and the glyph's top. */
const TIP_GAP_PX = 4;

/**
 * The Rollups feature. All DOM it creates lives inside one
 * `.jects-gantt__rollup-track` overlay per summary bar plus a single shared
 * `.jects-gantt__rollup-tip` tooltip; everything is removed on `destroy()` and the
 * instance is reusable via re-`init`.
 */
export class GanttRollups<T extends Model = Model> implements GanttFeature<T> {
  readonly name = 'rollups-tooltip';

  private readonly config: GanttRollupsConfig<T>;

  private api: GanttApi<T> | null = null;
  private barsLayer: HTMLElement | null = null;
  private tip: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private rafId = 0;
  private disposers: Array<() => void> = [];
  private destroyed = false;
  private activeGlyph: HTMLElement | null = null;

  constructor(config: GanttRollupsConfig<T> = {}) {
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
      // The bars layer is rebuilt wholesale on each timeline repaint (which is how
      // expand/collapse surfaces); re-decorate after every rebuild, coalesced to
      // one frame. A removed bar takes its glyphs with it, so the tooltip must hide
      // if its anchor vanished.
      const observer = new MutationObserver(() => {
        if (this.activeGlyph && !this.activeGlyph.isConnected) this.hideTip();
        this.schedulePaint();
      });
      observer.observe(layer, { childList: true, subtree: true });
      this.observer = observer;

      if (this.tooltipsEnabled()) this.wireTooltips(layer);
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
    this.tip?.remove();
    this.tip = null;
    this.activeGlyph = null;
    this.api = null;
  }

  /* ── public readouts (for tests / external use) ────────────────────────── */

  /**
   * The resolved rollup glyphs for one summary task in BAR-LOCAL pixel space, or
   * `[]` if the task is not an eligible/rendered summary. Useful for tests and
   * external readouts without scraping the DOM.
   */
  glyphsFor(summaryId: RecordId): RollupGlyph[] {
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

  /** (Re)decorate every visible summary bar with its child rollup glyphs. */
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
      const glyphs = this.computeFor(summary, bar);
      this.decorateBar(bar, glyphs);
    }
  }

  private decorateBar(bar: HTMLElement, glyphs: ReadonlyArray<RollupGlyph>): void {
    // Remove any prior decoration first (idempotent re-paint).
    this.clearBar(bar);
    if (glyphs.length === 0) {
      bar.removeAttribute('data-rollups');
      return;
    }

    const track = document.createElement('span');
    track.className = TRACK;
    // The track is a decorative summary of hidden child positions; expose it as a
    // labelled group so AT users learn the collapsed summary still carries its
    // children's schedule.
    track.setAttribute('role', 'group');
    track.setAttribute(
      'aria-label',
      `${glyphs.length} rolled-up child task${glyphs.length === 1 ? '' : 's'}`,
    );

    for (const g of glyphs) {
      const child = this.taskFromBar(String(g.taskId));
      const name = child?.name ?? String(g.taskId);
      const tipText = child ? this.resolveTooltip(child, g.span) : name;

      const el = document.createElement('span');
      el.className = `${GLYPH} ${GLYPH}--${g.kind}`;
      el.dataset.taskId = String(g.taskId);
      el.dataset.rollupKind = g.kind;
      el.style.insetInlineStart = `${round(g.left)}px`;
      el.style.inlineSize = `${round(g.width)}px`;
      // Each glyph is an individually focusable, named item so keyboard users can
      // tab through the rolled-up children and read each tooltip.
      el.tabIndex = 0;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', tipText || name);
      el.title = tipText || name;
      if (tipText) el.dataset.tip = tipText;
      track.append(el);
    }

    bar.dataset.rollups = String(glyphs.length);
    bar.append(track);
  }

  /* ── tooltip ───────────────────────────────────────────────────────────── */

  private tooltipsEnabled(): boolean {
    return this.config.tooltips !== false;
  }

  /** Delegate hover/focus on glyphs to the shared floating tooltip. */
  private wireTooltips(layer: HTMLElement): void {
    const show = (e: Event): void => {
      const glyph = (e.target as HTMLElement | null)?.closest?.(`.${GLYPH}`) as
        | HTMLElement
        | null;
      if (!glyph || !glyph.dataset.tip) return;
      this.showTip(glyph, glyph.dataset.tip);
    };
    const hide = (e: Event): void => {
      const glyph = (e.target as HTMLElement | null)?.closest?.(`.${GLYPH}`) as
        | HTMLElement
        | null;
      if (glyph) this.hideTip();
    };
    layer.addEventListener('pointerover', show);
    layer.addEventListener('pointerout', hide);
    layer.addEventListener('focusin', show);
    layer.addEventListener('focusout', hide);
    this.disposers.push(() => layer.removeEventListener('pointerover', show));
    this.disposers.push(() => layer.removeEventListener('pointerout', hide));
    this.disposers.push(() => layer.removeEventListener('focusin', show));
    this.disposers.push(() => layer.removeEventListener('focusout', hide));
  }

  /** Show the shared tooltip anchored over `glyph`. */
  private showTip(glyph: HTMLElement, text: string): void {
    if (this.destroyed) return;
    const host = this.api?.el;
    if (!host) return;
    let tip = this.tip;
    if (!tip) {
      tip = document.createElement('div');
      tip.className = TIP;
      tip.setAttribute('role', 'tooltip');
      tip.hidden = true;
      this.tip = tip;
    }
    if (tip.parentElement !== host) host.append(tip);
    tip.textContent = text;
    tip.hidden = false;
    this.activeGlyph = glyph;

    // Position the tip centred above the glyph, in host-local coordinates.
    //
    // The vertical lift is computed in JS rather than left to the CSS
    // `translate(…, calc(-100% - var(--jects-space-1)))`: if the spacing token is
    // not resolvable in the current cascade (e.g. the host page is themed
    // elsewhere), that `calc()` is invalid-at-computed-value and the WHOLE
    // transform is dropped — leaving the tip rendered DOWNWARD from the glyph top.
    // Measuring the laid-out tip height and subtracting it (plus a gap) keeps the
    // tip's bottom clear above the glyph regardless of whether the token resolves.
    const hostRect = host.getBoundingClientRect();
    const gRect = glyph.getBoundingClientRect();
    const x = gRect.left - hostRect.left + gRect.width / 2;
    // The tip is laid out (not hidden) so its box has a real height now.
    const tipH = tip.getBoundingClientRect().height || tip.offsetHeight || 0;
    const gap = TIP_GAP_PX;
    const y = gRect.top - hostRect.top - tipH - gap;
    tip.style.insetInlineStart = `${round(x)}px`;
    tip.style.insetBlockStart = `${round(y)}px`;
    // Only centre horizontally here; the vertical offset is already baked into
    // `insetBlockStart` above, so neutralise the CSS vertical translate to avoid
    // double-applying (and to stay correct when the token is missing).
    tip.style.transform = 'translateX(-50%)';
  }

  /** Hide the shared tooltip. */
  private hideTip(): void {
    if (this.tip) this.tip.hidden = true;
    this.activeGlyph = null;
  }

  private resolveTooltip(task: TaskModel<T>, span: TimeSpan): string {
    const custom = this.config.tooltipText?.(task, span);
    if (custom != null) return custom;
    return defaultTooltipText(task, span);
  }

  /* ── resolution helpers ────────────────────────────────────────────────── */

  /**
   * Whether `summary` should host rollup glyphs right now: it must be an actual
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
    const override = this.config.includeSummary?.(summary);
    if (override != null) return override;
    if (this.config.allSummaries) return true;
    if (readFlag(summary)) return true;
    // Or any descendant leaf is flagged for rollup.
    return this.descendants(summary.id).some((d) => this.childEligible(d));
  }

  /** Is a leaf/child eligible to appear as a rollup glyph? */
  private childEligible(child: TaskModel<T>): boolean {
    const override = this.config.includeChild?.(child);
    if (override != null) return override;
    if (this.config.allSummaries) return true;
    return readFlag(child);
  }

  /**
   * A summary is collapsed when NONE of its descendants currently has a bar in the
   * layer (an expanded summary renders each child as its own row → bar).
   */
  private isCollapsed(summary: TaskModel<T>, bar: HTMLElement): boolean {
    const layer = this.barsLayer ?? bar.parentElement;
    if (!layer) return true;
    for (const d of this.descendants(summary.id)) {
      if (layer.querySelector(`.jects-gantt__bar[data-task-id="${cssId(d.id)}"]`)) {
        return false;
      }
    }
    return true;
  }

  /** Compute the bar-local glyphs for a summary from the engine + axis. */
  private computeFor(summary: TaskModel<T>, bar: HTMLElement): RollupGlyph[] {
    const api = this.api;
    if (!api) return [];
    const barGeom = readBarGeometry(bar);
    if (!barGeom) return [];

    const axis = api.timeline.axis;
    const children: RollupChild[] = [];
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
    return projectRollups(barGeom, children);
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
    for (const track of bar.querySelectorAll(`.${TRACK}`)) track.remove();
    bar.removeAttribute('data-rollups');
  }

  private clearAll(root: HTMLElement): void {
    for (const track of root.querySelectorAll(`.${TRACK}`)) track.remove();
    for (const bar of root.querySelectorAll<HTMLElement>(
      '.jects-gantt__bar[data-rollups]',
    )) {
      bar.removeAttribute('data-rollups');
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
function readBarGeometry(bar: HTMLElement): RollupBar | null {
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

/** Default tooltip text: `"<name> · <start> – <end>[ · NN%]"` (UTC dates). */
export function defaultTooltipText(task: TaskModel, span: TimeSpan): string {
  const name = task.name ?? String(task.id);
  if (task.milestone || span.end === span.start) {
    return `${name} · ${isoDate(span.start)}`;
  }
  const pct =
    typeof task.percentDone === 'number'
      ? ` · ${Math.round(task.percentDone * 100)}%`
      : '';
  return `${name} · ${isoDate(span.start)} – ${isoDate(span.end)}${pct}`;
}

/** Format an epoch-ms instant as a `YYYY-MM-DD` UTC date for tooltips. */
export function isoDate(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

/** Convenience factory mirroring the other Gantt feature factories. */
export function createRollups<T extends Model = Model>(
  config?: GanttRollupsConfig<T>,
): GanttRollups<T> {
  return new GanttRollups<T>(config);
}
