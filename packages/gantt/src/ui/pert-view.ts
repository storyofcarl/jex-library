/**
 * `PertView` — the Gantt **PERT / network-diagram view** (Bryntum/DHTMLX
 * "PERT chart" parity feature).
 *
 * An alternate, non-time-axis view of the same project: instead of bars on a
 * calendar, every task is drawn as a **node box** (showing its id, name, dates,
 * duration and slack) and every dependency as a directed **edge** between boxes.
 * The graph is **auto-laid-out by topological rank** (longest-path layering, the
 * classic "network diagram" / activity-on-node layout): a node sits one rank to
 * the right of its latest predecessor, and ranks are stacked vertically so edges
 * flow strictly left→right. The **critical path** (zero-slack chain) is
 * emphasised — both its nodes and the edges between consecutive critical nodes —
 * exactly like the reference products. Basic **pan** (drag the canvas) and
 * **zoom** (wheel / +/− / fit) are supported.
 *
 * It reads the SAME engine results the Gantt bars do (per-task
 * {@link TaskSchedule} + the critical path), so the PERT pane and the bar pane
 * always agree. It is rendered as a standalone pane (its own SVG) — it does not
 * depend on the timeline's time axis, because a network diagram is laid out by
 * dependency rank, not by date.
 *
 * Architecture (concurrency-safe, contract-pure — mirrors `ResourceHistogram` /
 * `ResourceUtilizationView`):
 *   - A standalone framework-free {@link Widget} with its own root + CSS. It does
 *     NOT edit the `Gantt` class, the timeline view, the package barrel, or the
 *     frozen contract. It consumes plain typed input (tasks + dependencies +
 *     a schedule resolver), so it is usable both with a live `Gantt`
 *     (via {@link PertView.fromGantt}) and standalone.
 *   - The graph layout itself is a PURE function (`computePertLayout`) over plain
 *     typed input with no DOM, so the (topological-rank) layout + critical-path
 *     marking is fully unit-testable under jsdom.
 *   - `refresh()` re-reads the model + schedule and repaints; the integrator
 *     wires it to `scheduleChange` / `taskChange` (see wire notes). All listeners
 *     and DOM are released on `destroy()`.
 *
 * All times are epoch milliseconds (UTC); durations are milliseconds — same as
 * the rest of the Gantt contract.
 */

import './pert-view.css';
import {
  Widget,
  createEl,
  register,
  type Model,
  type RecordId,
  type WidgetConfig,
  type WidgetEvents,
} from '@jects/core';
import type { TimeMs, DurationMs } from '@jects/timeline-core';
import type {
  GanttApi,
  TaskSchedule,
  DependencyType,
} from '../contract.js';
// NB: `TaskModel` is referenced by name in JSDoc `{@link}`s only; `PertTask`/
// `PertTaskInput` deliberately stay decoupled from the (index-signature-bearing)
// `TaskModel` so plain task literals remain assignable under
// `exactOptionalPropertyTypes`.

const BLOCK = 'jects-pert';
const SVG_NS = 'http://www.w3.org/2000/svg';
const DAY_MS = 86_400_000;

/* ═══════════════════════════════════════════════════════════════════════════
   1. PURE LAYOUT MODEL (unit-testable, no DOM)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Minimal task shape the PERT layout needs (a subset of {@link TaskModel}). */
export interface PertTaskInput {
  /** Task id. */
  id: RecordId;
  /** Display name. */
  name?: string;
  /** Scheduled start (epoch ms). */
  start?: TimeMs;
  /** Scheduled end (epoch ms). */
  end?: TimeMs;
  /** Working duration (ms). */
  duration?: DurationMs;
  /** Total slack/float (working ms); `0` ⇒ on the critical path. */
  totalSlack?: DurationMs;
  /** Whether this task is a zero-duration milestone. */
  milestone?: boolean;
  /** Whether this task is on the critical path (overrides the slack test). */
  critical?: boolean;
  /** Arbitrary passthrough payload (e.g. the original task record). */
  data?: unknown;
}

/**
 * The task input the PERT view accepts. It is exactly {@link PertTaskInput} —
 * the minimal fields the layout needs. A full {@link TaskModel} is structurally
 * assignable to it (it has `id` plus the same optional fields), so consumers can
 * pass their existing task records directly without re-mapping; richer payloads
 * ride along on {@link PertTaskInput.data}. (Generic for API symmetry with the
 * rest of the Gantt surface; the type parameter does not constrain the shape.)
 */
export type PertTask<T extends Model = Model> = PertTaskInput & {
  /**
   * Phantom carrier for the task payload type `T`. Never present at runtime; it
   * only keeps `T` referenced (so the generic parameter is not "unused") while
   * leaving the assignable shape exactly {@link PertTaskInput}.
   */
  readonly [PERT_TASK_BRAND]?: T;
};

/** Unique phantom key for {@link PertTask}'s `T` carrier (never set at runtime). */
declare const PERT_TASK_BRAND: unique symbol;

/** Minimal dependency shape the PERT layout needs. */
export interface PertDependencyInput {
  /** Stable link id. */
  id: RecordId;
  /** Predecessor task id. */
  fromId: RecordId;
  /** Successor task id. */
  toId: RecordId;
  /** Dependency type (FS/SS/FF/SF). Default `'FS'`. */
  type?: DependencyType;
  /** Lag (+) / lead (−) in ms. */
  lag?: DurationMs;
}

/** Node-box geometry (px) within the laid-out content space. */
export interface PertNode<T extends Model = Model> {
  /** Task id. */
  id: RecordId;
  /** The source task (for renderers / tooltips). */
  task: PertTask<T>;
  /** Topological rank (0 = a task with no predecessors). The x-column index. */
  rank: number;
  /** Row index within the rank (the y-slot). */
  row: number;
  /** Left edge in content px. */
  x: number;
  /** Top edge in content px. */
  y: number;
  /** Box width in px. */
  width: number;
  /** Box height in px. */
  height: number;
  /** Whether this node lies on the critical path. */
  critical: boolean;
  /** Whether this node is a milestone. */
  milestone: boolean;
}

/** An edge connecting two node boxes, with a polyline routed orthogonally. */
export interface PertEdge {
  /** Dependency link id. */
  id: RecordId;
  /** Predecessor node id. */
  fromId: RecordId;
  /** Successor node id. */
  toId: RecordId;
  /** Dependency type. */
  type: DependencyType;
  /** Whether both endpoints are critical AND adjacent on the critical path. */
  critical: boolean;
  /** Orthogonal routing points (content px), from source terminal to target. */
  points: ReadonlyArray<{ x: number; y: number }>;
}

/** The full laid-out PERT graph. */
export interface PertLayout<T extends Model = Model> {
  /** Laid-out node boxes, keyed-insertion in rank/row order. */
  nodes: ReadonlyArray<PertNode<T>>;
  /** Laid-out edges. */
  edges: ReadonlyArray<PertEdge>;
  /** Total content width in px. */
  width: number;
  /** Total content height in px. */
  height: number;
  /** Number of ranks (columns). */
  rankCount: number;
  /** Ids that form a dependency cycle (excluded from ranking), if any. */
  cycleMembers: ReadonlyArray<RecordId>;
}

/** Tunable layout metrics (px). */
export interface PertLayoutOptions {
  /** Node box width. Default `180`. */
  nodeWidth?: number;
  /** Node box height. Default `72`. */
  nodeHeight?: number;
  /** Horizontal gap between ranks. Default `64`. */
  rankGap?: number;
  /** Vertical gap between nodes in a rank. Default `28`. */
  rowGap?: number;
  /** Outer padding around the whole graph. Default `24`. */
  padding?: number;
}

const DEFAULT_LAYOUT: Required<PertLayoutOptions> = {
  nodeWidth: 180,
  nodeHeight: 72,
  rankGap: 64,
  rowGap: 28,
  padding: 24,
};

/**
 * Lay out the task/dependency graph as an activity-on-node network diagram.
 *
 * Ranking is the classic **longest-path layering**: `rank(n) = 0` for a task
 * with no (in-graph) predecessors, else `1 + max(rank(predecessors))`. This puts
 * every node strictly to the right of all its predecessors so edges only ever
 * flow left→right. Nodes sharing a rank are stacked vertically in stable input
 * order. A node is **critical** when its slack is zero (or it is flagged), and an
 * edge is critical when it connects two consecutive critical nodes.
 *
 * Dependency **cycles** are handled defensively: edges that would close a cycle
 * are dropped from the ranking pass (their members are reported in
 * `cycleMembers`) so the layout always terminates; the dropped edges are still
 * emitted (routed best-effort) so the user sees the offending link.
 *
 * Pure: no DOM, no time-axis — geometry is derived purely from the supplied
 * metrics, so the whole layout is unit-testable.
 */
export function computePertLayout<T extends Model = Model>(
  tasks: ReadonlyArray<PertTask<T>>,
  dependencies: ReadonlyArray<PertDependencyInput>,
  options: PertLayoutOptions = {},
): PertLayout<T> {
  const m = { ...DEFAULT_LAYOUT, ...options };
  const taskById = new Map<RecordId, PertTask<T>>();
  for (const t of tasks) taskById.set(t.id, t);

  // Adjacency over only the dependencies whose endpoints both exist.
  const valid: PertDependencyInput[] = [];
  const successors = new Map<RecordId, RecordId[]>();
  const predecessors = new Map<RecordId, RecordId[]>();
  for (const t of tasks) {
    successors.set(t.id, []);
    predecessors.set(t.id, []);
  }
  for (const dep of dependencies) {
    if (!taskById.has(dep.fromId) || !taskById.has(dep.toId)) continue;
    if (dep.fromId === dep.toId) continue; // self-loop: ignore for ranking
    valid.push(dep);
    successors.get(dep.fromId)!.push(dep.toId);
    predecessors.get(dep.toId)!.push(dep.fromId);
  }

  // ── Rank by longest path via Kahn topological order; detect cycles. ──────
  const indegree = new Map<RecordId, number>();
  for (const t of tasks) indegree.set(t.id, predecessors.get(t.id)!.length);
  const rank = new Map<RecordId, number>();
  for (const t of tasks) rank.set(t.id, 0);

  const queue: RecordId[] = [];
  for (const t of tasks) if (indegree.get(t.id) === 0) queue.push(t.id);

  let processed = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    processed++;
    const r = rank.get(id)!;
    for (const succ of successors.get(id)!) {
      // Longest-path: a successor is at least one rank past this predecessor.
      if (rank.get(succ)! < r + 1) rank.set(succ, r + 1);
      const d = indegree.get(succ)! - 1;
      indegree.set(succ, d);
      if (d === 0) queue.push(succ);
    }
  }

  // Any node still with indegree > 0 sits on a cycle. Rank it past whatever
  // predecessors it *can* be ranked from so the layout still terminates.
  const cycleMembers: RecordId[] = [];
  if (processed < tasks.length) {
    for (const t of tasks) {
      if ((indegree.get(t.id) ?? 0) > 0) {
        cycleMembers.push(t.id);
        let r = 0;
        for (const p of predecessors.get(t.id)!) {
          const pr = rank.get(p);
          if (pr != null && rank.get(p)! < (rank.get(t.id) ?? 0)) {
            r = Math.max(r, pr + 1);
          }
        }
        if (r > rank.get(t.id)!) rank.set(t.id, r);
      }
    }
  }

  // ── Critical marking (zero slack or explicit flag). ──────────────────────
  const isCritical = (t: PertTaskInput): boolean => {
    if (t.critical === true) return true;
    if (t.critical === false) return false;
    return t.totalSlack != null && t.totalSlack <= 0;
  };

  // ── Bucket nodes per rank, in stable input order. ────────────────────────
  const ranks = new Map<number, RecordId[]>();
  let maxRank = 0;
  for (const t of tasks) {
    const r = rank.get(t.id)!;
    maxRank = Math.max(maxRank, r);
    (ranks.get(r) ?? ranks.set(r, []).get(r)!).push(t.id);
  }

  // ── Position. ────────────────────────────────────────────────────────────
  const nodes: PertNode<T>[] = [];
  const nodeById = new Map<RecordId, PertNode<T>>();
  let maxRowsHeight = 0;
  const colX = (r: number): number => m.padding + r * (m.nodeWidth + m.rankGap);

  for (let r = 0; r <= maxRank; r++) {
    const ids = ranks.get(r) ?? [];
    let y = m.padding;
    let row = 0;
    for (const id of ids) {
      const task = taskById.get(id)!;
      const node: PertNode<T> = {
        id,
        task,
        rank: r,
        row,
        x: colX(r),
        y,
        width: m.nodeWidth,
        height: m.nodeHeight,
        critical: isCritical(task),
        milestone: task.milestone === true,
      };
      nodes.push(node);
      nodeById.set(id, node);
      y += m.nodeHeight + m.rowGap;
      row++;
    }
    maxRowsHeight = Math.max(maxRowsHeight, y - m.rowGap + m.padding);
  }

  // ── Critical-path adjacency set (consecutive critical nodes linked). ─────
  const criticalEdge = (fromId: RecordId, toId: RecordId): boolean => {
    const a = nodeById.get(fromId);
    const b = nodeById.get(toId);
    return a != null && b != null && a.critical && b.critical && b.rank > a.rank;
  };

  // ── Route edges orthogonally: exit right of source, enter left of target. ─
  const edges: PertEdge[] = [];
  for (const dep of valid) {
    const a = nodeById.get(dep.fromId);
    const b = nodeById.get(dep.toId);
    if (!a || !b) continue;
    const type = dep.type ?? 'FS';
    const start = terminalPoint(a, type, 'from');
    const finish = terminalPoint(b, type, 'to');
    const midX = (start.x + finish.x) / 2;
    const points =
      Math.abs(start.y - finish.y) < 0.5
        ? [start, finish]
        : [start, { x: midX, y: start.y }, { x: midX, y: finish.y }, finish];
    edges.push({
      id: dep.id,
      fromId: dep.fromId,
      toId: dep.toId,
      type,
      critical: criticalEdge(dep.fromId, dep.toId),
      points,
    });
  }

  const rankCount = tasks.length === 0 ? 0 : maxRank + 1;
  const width =
    tasks.length === 0
      ? m.padding * 2
      : colX(maxRank) + m.nodeWidth + m.padding;
  const height = Math.max(m.padding * 2, maxRowsHeight);

  return {
    nodes,
    edges,
    width,
    height,
    rankCount,
    cycleMembers,
  };
}

/** The terminal anchor of a node for a given dependency type + end. */
function terminalPoint<T extends Model>(
  node: PertNode<T>,
  type: DependencyType,
  end: 'from' | 'to',
): { x: number; y: number } {
  const midY = node.y + node.height / 2;
  // For the predecessor ('from'): FS/FF leave the finish (right) edge,
  // SS/SF leave the start (left) edge. For the successor ('to'): FS/SF enter
  // the start (left) edge, FF leave… i.e. enter the finish (right) edge.
  const leftX = node.x;
  const rightX = node.x + node.width;
  if (end === 'from') {
    const fromStart = type === 'SS' || type === 'SF';
    return { x: fromStart ? leftX : rightX, y: midY };
  }
  const toFinish = type === 'FF' || type === 'SF';
  return { x: toFinish ? rightX : leftX, y: midY };
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. WIDGET CONFIG + EVENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/** How a node's date row is formatted. */
export type PertDateFormatter = (time: TimeMs | undefined) => string;

/** Configuration for the {@link PertView} widget. */
export interface PertViewConfig<T extends Model = Model> extends WidgetConfig {
  /** The tasks to render as node boxes. */
  tasks?: ReadonlyArray<PertTask<T>>;
  /** The dependency links between tasks. */
  dependencies?: ReadonlyArray<PertDependencyInput>;
  /**
   * Resolve the latest engine schedule for a task (slack + dates). When present,
   * it overrides per-task `start`/`end`/`totalSlack`/`critical` so the PERT view
   * tracks the live engine results. Used by {@link PertView.fromGantt}.
   */
  schedule?: (taskId: RecordId) => TaskSchedule | undefined;
  /** Layout metrics override. */
  layout?: PertLayoutOptions;
  /** Emphasise the critical path. Default `true`. */
  showCriticalPath?: boolean;
  /** Accessible label for the diagram region. Default `'PERT network diagram'`. */
  label?: string;
  /** Format dates shown on a node. Default an ISO `YYYY-MM-DD` formatter. */
  formatDate?: PertDateFormatter;
  /** Min zoom. Default `0.25`. */
  minZoom?: number;
  /** Max zoom. Default `2.5`. */
  maxZoom?: number;
}

/** Typed event map for {@link PertView}. */
export interface PertViewEvents<T extends Model = Model> extends WidgetEvents {
  /** A node box was activated (click / Enter / Space). */
  nodeClick: { task: PertTask<T>; native: Event };
  /** The pan/zoom transform changed. */
  viewportChange: { zoom: number; panX: number; panY: number };
  /** The graph was (re)laid out and repainted. */
  layout: { layout: PertLayout<T> };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. THE WIDGET
   ═══════════════════════════════════════════════════════════════════════════ */

/** Off-field viewport state for a {@link PertView} (see the class comment). */
interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
  dragging: boolean;
  dragStart: { x: number; y: number; panX: number; panY: number } | null;
}

/** Per-instance viewport state, kept off-field so it survives the field-define wipe. */
const STATE = new WeakMap<object, ViewState>();
/** Per-instance last layout, kept off-field for the same reason. */
const LAYOUTS = new WeakMap<object, PertLayout<Model>>();

/**
 * The PERT / network-diagram view. A standalone SVG pane; drive it with
 * `update({ tasks, dependencies })` or build it from a live Gantt with
 * {@link PertView.fromGantt}. Pan by dragging the canvas, zoom with the wheel,
 * `+`/`-`, or {@link PertView.zoomToFit}.
 */
export class PertView<T extends Model = Model> extends Widget<
  PertViewConfig<T>,
  PertViewEvents<T>
> {
  // IMPORTANT: this package builds with `useDefineForClassFields: true`, and
  // `Widget` runs the first `render()` from its constructor BEFORE the subclass'
  // field declarations are *defined*. Under define-semantics every declared class
  // field — even one with no explicit initializer — is (re)assigned `undefined`
  // AFTER the constructor returns, which would wipe any value the first render
  // produced AND any DOM reference cached in `buildEl()`. So this Widget keeps
  // NO load-bearing class fields: SVG layers are re-queried from `this.el` (they
  // live in the DOM), mutable scalars are lazily defaulted through `??=` view-
  // state accessors, and the last layout is held in a module `WeakMap` (not a
  // field). See `ViewState` / `LAYOUTS` below.

  /* ── DOM accessors (queried live — survive the field-define wipe) ──────── */
  private get svg(): SVGSVGElement | null {
    return this.el.querySelector<SVGSVGElement>(`.${BLOCK}__svg`);
  }
  private get viewportG(): SVGGElement | null {
    return this.el.querySelector<SVGGElement>(`.${BLOCK}__viewport`);
  }
  private get edgesLayer(): SVGGElement | null {
    return this.el.querySelector<SVGGElement>(`.${BLOCK}__edges`);
  }
  private get nodesLayer(): SVGGElement | null {
    return this.el.querySelector<SVGGElement>(`.${BLOCK}__nodes`);
  }

  /* ── view-state (held off-field; survives the field-define wipe) ───────── */
  private get vs(): ViewState {
    let s = STATE.get(this);
    if (!s) STATE.set(this, (s = { zoom: 1, panX: 0, panY: 0, dragging: false, dragStart: null }));
    return s;
  }
  private get _zoom(): number {
    return this.vs.zoom;
  }
  private set _zoom(v: number) {
    this.vs.zoom = v;
  }
  private get _panX(): number {
    return this.vs.panX;
  }
  private set _panX(v: number) {
    this.vs.panX = v;
  }
  private get _panY(): number {
    return this.vs.panY;
  }
  private set _panY(v: number) {
    this.vs.panY = v;
  }
  private get _dragging(): boolean {
    return this.vs.dragging;
  }
  private set _dragging(v: boolean) {
    this.vs.dragging = v;
  }
  private get _dragStart(): ViewState['dragStart'] {
    return this.vs.dragStart;
  }
  private set _dragStart(v: ViewState['dragStart']) {
    this.vs.dragStart = v;
  }
  private get _lastLayout(): PertLayout<T> | null {
    return (LAYOUTS.get(this) as PertLayout<T> | undefined) ?? null;
  }
  private set _lastLayout(v: PertLayout<T> | null) {
    if (v) LAYOUTS.set(this, v as unknown as PertLayout<Model>);
    else LAYOUTS.delete(this);
  }

  /* ── lifecycle ───────────────────────────────────────────────────────── */

  protected override defaults(): Partial<PertViewConfig<T>> {
    return {
      tasks: [],
      dependencies: [],
      showCriticalPath: true,
      label: 'PERT network diagram',
      minZoom: 0.25,
      maxZoom: 2.5,
      formatDate: defaultFormatDate,
    } as Partial<PertViewConfig<T>>;
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: BLOCK });
    root.tabIndex = 0;
    root.setAttribute('role', 'group');

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', `${BLOCK}__svg`);
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('focusable', 'false');

    // Arrowhead marker defs (critical + normal variants).
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.append(arrowMarker('pert-arrow', `${BLOCK}__arrow`));
    defs.append(arrowMarker('pert-arrow-critical', `${BLOCK}__arrow--critical`));
    svg.append(defs);

    const viewport = document.createElementNS(SVG_NS, 'g');
    viewport.setAttribute('class', `${BLOCK}__viewport`);
    const edgesLayer = document.createElementNS(SVG_NS, 'g');
    edgesLayer.setAttribute('class', `${BLOCK}__edges`);
    const nodesLayer = document.createElementNS(SVG_NS, 'g');
    nodesLayer.setAttribute('class', `${BLOCK}__nodes`);
    viewport.append(edgesLayer, nodesLayer);
    svg.append(viewport);
    root.append(svg);
    return root;
  }

  protected override render(): void {
    const root = this.el;
    if (!this.svg) return; // render() may run before buildEl wiring in edge cases

    root.setAttribute('aria-label', this.config.label ?? 'PERT network diagram');
    this.relayout();
    this.bindInteractions();
  }

  /* ── public API ──────────────────────────────────────────────────────── */

  /** Re-read the model + schedule and repaint. */
  refresh(): void {
    this.relayout();
  }

  /** The last computed layout (for tests / external readouts). */
  get layout(): PertLayout<T> | null {
    return this._lastLayout ?? null;
  }

  /** Current zoom factor. */
  get zoom(): number {
    return this._zoom;
  }

  /** Current pan offset (content px, pre-zoom). */
  get pan(): { x: number; y: number } {
    return { x: this._panX, y: this._panY };
  }

  /** Set the zoom factor (clamped), keeping the top-left anchored. */
  setZoom(zoom: number): void {
    const min = this.config.minZoom ?? 0.25;
    const max = this.config.maxZoom ?? 2.5;
    const next = clamp(zoom, min, max);
    if (next === this._zoom) return;
    this._zoom = next;
    this.applyTransform();
    this.emit('viewportChange', { zoom: this._zoom, panX: this._panX, panY: this._panY });
  }

  /** Zoom in one step. */
  zoomIn(): void {
    this.setZoom(round2(this._zoom * 1.2));
  }

  /** Zoom out one step. */
  zoomOut(): void {
    this.setZoom(round2(this._zoom / 1.2));
  }

  /** Set the pan offset (content px). */
  setPan(x: number, y: number): void {
    this._panX = x;
    this._panY = y;
    this.applyTransform();
    this.emit('viewportChange', { zoom: this._zoom, panX: this._panX, panY: this._panY });
  }

  /** Fit the whole graph into the current viewport box. */
  zoomToFit(): void {
    const layout = this._lastLayout;
    const svg = this.svg;
    if (!layout || !svg) return;
    const box = svg.getBoundingClientRect();
    const vw = box.width || layout.width;
    const vh = box.height || layout.height;
    if (layout.width <= 0 || layout.height <= 0) return;
    const min = this.config.minZoom ?? 0.25;
    const max = this.config.maxZoom ?? 2.5;
    const fit = clamp(
      Math.min(vw / layout.width, vh / layout.height),
      min,
      max,
    );
    this._zoom = fit;
    this._panX = 0;
    this._panY = 0;
    this.applyTransform();
    this.emit('viewportChange', { zoom: this._zoom, panX: this._panX, panY: this._panY });
  }

  /**
   * Build a `PertView` from a live `Gantt`. The Gantt's public API does not
   * expose a "get all tasks/dependencies" call (it is tree- and task-scoped), so
   * the caller passes the same `tasks`/`dependencies` it handed the Gantt; this
   * helper then wires the live schedule resolver (slack + critical) and a
   * `scheduleChange`/`taskChange` refresh so the PERT pane tracks the engine.
   */
  static fromGantt<T extends Model = Model>(
    host: HTMLElement | string,
    api: GanttApi<T>,
    input: {
      tasks: ReadonlyArray<PertTask<T>>;
      dependencies: ReadonlyArray<PertDependencyInput>;
    } & Omit<PertViewConfig<T>, 'tasks' | 'dependencies' | 'schedule'>,
  ): PertView<T> {
    const { tasks, dependencies, ...rest } = input;
    const view = new PertView<T>(host, {
      ...rest,
      tasks,
      dependencies,
      schedule: (id) => api.getSchedule(id),
    });
    const offSched = api.on('scheduleChange', () => view.refresh());
    const offTask = api.on('taskChange', () => view.refresh());
    api.track(() => {
      offSched();
      offTask();
      if (!view.isDestroyed) view.destroy();
    });
    return view;
  }

  override destroy(): void {
    LAYOUTS.delete(this);
    STATE.delete(this);
    super.destroy();
  }

  /* ── internals ───────────────────────────────────────────────────────── */

  /** Resolve the effective task inputs, merging live schedule when supplied. */
  private resolvedTasks(): Array<PertTask<T>> {
    const tasks = this.config.tasks ?? [];
    const schedule = this.config.schedule;
    if (!schedule) return [...tasks];
    return tasks.map((t) => {
      const s = schedule(t.id);
      if (!s) return t;
      return {
        ...t,
        start: s.start,
        end: s.end,
        totalSlack: s.totalSlack,
        critical: s.critical,
      };
    });
  }

  private relayout(): void {
    const nodesLayer = this.nodesLayer;
    const edgesLayer = this.edgesLayer;
    const svg = this.svg;
    if (!nodesLayer || !edgesLayer || !svg) return;

    const layout = computePertLayout<T>(
      this.resolvedTasks(),
      this.config.dependencies ?? [],
      this.config.layout,
    );
    this._lastLayout = layout;

    svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);

    // Clear + repaint (the graph is small; full repaint is simplest + leak-safe).
    edgesLayer.replaceChildren();
    nodesLayer.replaceChildren();

    const showCritical = this.config.showCriticalPath !== false;
    for (const edge of layout.edges) this.paintEdge(edge, showCritical, edgesLayer);
    for (const node of layout.nodes) this.paintNode(node, showCritical, nodesLayer);

    this.applyTransform();
    this.emit('layout', { layout });
  }

  private paintEdge(
    edge: PertEdge,
    showCritical: boolean,
    layer: SVGGElement,
  ): void {
    const poly = document.createElementNS(SVG_NS, 'polyline');
    const isCrit = showCritical && edge.critical;
    poly.setAttribute(
      'class',
      isCrit ? `${BLOCK}__edge ${BLOCK}__edge--critical` : `${BLOCK}__edge`,
    );
    poly.setAttribute('fill', 'none');
    poly.setAttribute(
      'points',
      edge.points.map((p) => `${round2(p.x)},${round2(p.y)}`).join(' '),
    );
    poly.setAttribute(
      'marker-end',
      isCrit ? 'url(#pert-arrow-critical)' : 'url(#pert-arrow)',
    );
    poly.setAttribute('data-dep-id', String(edge.id));
    layer.append(poly);
  }

  private paintNode(
    node: PertNode<T>,
    showCritical: boolean,
    layer: SVGGElement,
  ): void {
    const fmt = this.config.formatDate ?? defaultFormatDate;
    const g = document.createElementNS(SVG_NS, 'g');
    const classes = [`${BLOCK}__node`];
    if (showCritical && node.critical) classes.push(`${BLOCK}__node--critical`);
    if (node.milestone) classes.push(`${BLOCK}__node--milestone`);
    g.setAttribute('class', classes.join(' '));
    g.setAttribute('transform', `translate(${round2(node.x)},${round2(node.y)})`);
    g.setAttribute('data-task-id', String(node.id));
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');

    const name = node.task.name ?? String(node.id);
    const slack = node.task.totalSlack;
    const slackText =
      slack == null ? '' : `, slack ${formatDuration(slack)}`;
    const dateText = `${fmt(node.task.start)} to ${fmt(node.task.end)}`;
    g.setAttribute(
      'aria-label',
      `${name}${node.critical ? ', critical' : ''}${node.milestone ? ', milestone' : ''}. ${dateText}${slackText}`,
    );

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', `${BLOCK}__box`);
    rect.setAttribute('width', String(node.width));
    rect.setAttribute('height', String(node.height));
    rect.setAttribute('rx', '6');
    g.append(rect);

    // Title (name) + id badge.
    g.append(
      svgText(`${BLOCK}__title`, 10, 18, truncate(name, 24)),
      svgText(`${BLOCK}__id`, node.width - 10, 18, `#${node.id}`, 'end'),
    );
    // Date row.
    g.append(svgText(`${BLOCK}__dates`, 10, 40, dateText));
    // Slack / duration row.
    const dur = node.task.duration;
    const meta =
      (dur != null ? `${formatDuration(dur)}` : '') +
      (slack != null ? `  •  float ${formatDuration(slack)}` : '');
    if (meta) g.append(svgText(`${BLOCK}__meta`, 10, 60, meta));

    // Activation.
    const fire = (native: Event): void => {
      this.emit('nodeClick', { task: node.task, native });
    };
    g.addEventListener('click', fire);
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        fire(ev);
      }
    });

    layer.append(g);
  }

  private applyTransform(): void {
    this.viewportG?.setAttribute(
      'transform',
      `translate(${round2(this._panX)},${round2(this._panY)}) scale(${round2(this._zoom)})`,
    );
  }

  private bindInteractions(): void {
    const root = this.el;
    // `Widget` resets subclass field initializers AFTER the first `render()`, so a
    // boolean field guard is unreliable here. Mark the bound state on the DOM
    // root (not reset by field initializers) so we bind the listeners exactly once
    // across the initial render + every later `update()`/`render()`.
    if (root.dataset.pertBound === '1') return;
    root.dataset.pertBound = '1';

    // Pan by dragging the empty canvas (not a node box).
    this.listen('pointerdown', (ev: Event) => {
      const pe = ev as PointerEvent;
      const target = pe.target as Element | null;
      if (target && target.closest(`.${BLOCK}__node`)) return; // node handles its own
      this._dragging = true;
      this._dragStart = {
        x: pe.clientX,
        y: pe.clientY,
        panX: this._panX,
        panY: this._panY,
      };
      root.classList.add(`${BLOCK}--panning`);
      try {
        (root as HTMLElement).setPointerCapture?.(pe.pointerId);
      } catch {
        /* jsdom / no capture */
      }
    });
    this.listen('pointermove', (ev: Event) => {
      if (!this._dragging || !this._dragStart) return;
      const pe = ev as PointerEvent;
      const dx = pe.clientX - this._dragStart.x;
      const dy = pe.clientY - this._dragStart.y;
      this.setPan(this._dragStart.panX + dx, this._dragStart.panY + dy);
    });
    const endPan = (): void => {
      if (!this._dragging) return;
      this._dragging = false;
      this._dragStart = null;
      root.classList.remove(`${BLOCK}--panning`);
    };
    this.listen('pointerup', endPan);
    this.listen('pointercancel', endPan);

    // Wheel to zoom.
    this.listen('wheel', (ev: Event) => {
      const we = ev as WheelEvent;
      we.preventDefault();
      if (we.deltaY < 0) this.zoomIn();
      else this.zoomOut();
    });

    // Keyboard: +/- zoom, 0/F fit, arrows pan.
    this.listen('keydown', (ev: Event) => {
      const ke = ev as KeyboardEvent;
      const target = ke.target as Element | null;
      // Let node activation handle its own keys.
      if (target && target.closest(`.${BLOCK}__node`) && (ke.key === 'Enter' || ke.key === ' ')) {
        return;
      }
      switch (ke.key) {
        case '+':
        case '=':
          ke.preventDefault();
          this.zoomIn();
          break;
        case '-':
        case '_':
          ke.preventDefault();
          this.zoomOut();
          break;
        case '0':
        case 'f':
        case 'F':
          ke.preventDefault();
          this.zoomToFit();
          break;
        case 'ArrowLeft':
          ke.preventDefault();
          this.setPan(this._panX + 40, this._panY);
          break;
        case 'ArrowRight':
          ke.preventDefault();
          this.setPan(this._panX - 40, this._panY);
          break;
        case 'ArrowUp':
          ke.preventDefault();
          this.setPan(this._panX, this._panY + 40);
          break;
        case 'ArrowDown':
          ke.preventDefault();
          this.setPan(this._panX, this._panY - 40);
          break;
        default:
          break;
      }
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. SVG / FORMAT HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function arrowMarker(id: string, cls: string): SVGMarkerElement {
  const marker = document.createElementNS(SVG_NS, 'marker');
  marker.setAttribute('id', id);
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '9');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('orient', 'auto-start-reverse');
  marker.setAttribute('markerUnits', 'userSpaceOnUse');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  path.setAttribute('class', cls);
  marker.append(path);
  return marker;
}

function svgText(
  cls: string,
  x: number,
  y: number,
  text: string,
  anchor?: 'end' | 'middle' | 'start',
): SVGTextElement {
  const t = document.createElementNS(SVG_NS, 'text');
  t.setAttribute('class', cls);
  t.setAttribute('x', String(x));
  t.setAttribute('y', String(y));
  if (anchor) t.setAttribute('text-anchor', anchor);
  t.textContent = text;
  return t;
}

function defaultFormatDate(time: TimeMs | undefined): string {
  if (time == null || !Number.isFinite(time)) return '—';
  const d = new Date(time);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** Format a working-ms duration as a compact day-count string. */
function formatDuration(ms: DurationMs): string {
  if (ms === 0) return '0d';
  const days = ms / DAY_MS;
  if (Number.isInteger(days)) return `${days}d`;
  return `${Math.round(days * 10) / 10}d`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. FACTORY REGISTRATION + CONVENIENCE
   ═══════════════════════════════════════════════════════════════════════════ */

register('pertview', PertView as never);

/** Convenience factory mirroring the other Gantt view factories. */
export function createPertView<T extends Model = Model>(
  host: HTMLElement | string,
  config?: PertViewConfig<T>,
): PertView<T> {
  return new PertView<T>(host, config);
}
