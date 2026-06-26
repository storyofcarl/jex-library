/**
 * `GanttPertChart` — the Gantt **PERT / network-diagram chart view**
 * (Bryntum / DHTMLX "PERT chart" parity feature).
 *
 * A PERT (Program Evaluation and Review Technique) chart renders the project as a
 * *network diagram* rather than a time-axis Gantt: every task is a **node box**
 * (showing its id, name, start/finish dates, slack/float, and whether it is on the
 * critical path) and every dependency is a directed **edge** between two nodes.
 * The nodes are auto-arranged into **layers** by a topological / longest-path
 * layering of the dependency graph so the flow of work reads left→right (or, when
 * `direction: 'vertical'`, top→bottom), the **critical path** is highlighted, and
 * the whole canvas supports **pan + zoom** and **selection sync** with the main
 * Gantt.
 *
 * Design (fully ADDITIVE + contract-pure — mirrors the rest of the package):
 *   - It is a self-contained `Widget` + its own token-pure CSS. It does NOT edit
 *     the `Gantt` class, the timeline view, the package barrel, or any config.
 *   - It consumes the engine's SCHEDULE RESULT (per-task early/late dates + slack +
 *     `critical`) plus the task + dependency models — exactly the data the frozen
 *     {@link GanttApi} already exposes (`getSchedule` / `getDependenciesFor` /
 *     `getTask`). A consumer can feed it a live `GanttApi` (see {@link fromGanttApi})
 *     or a captured schedule result (see {@link fromScheduleResult}) — so the view
 *     stands alone over the headless engine.
 *   - The graph layout (`layoutPertChart`) is a PURE, DOM-free function: it builds
 *     the DAG, breaks cycles defensively, computes a longest-path layering, orders
 *     each layer to reduce crossings, and assigns node/edge geometry. This is the
 *     heavy logic and is fully unit-testable under jsdom.
 *   - Pan/zoom is a CSS `transform` over one owned content group; selection is a
 *     single-source `Set` mirrored to `aria-pressed` + a `nodeSelect` event, and
 *     `setSelected` lets the owner push the Gantt's selection INTO the view (two-way
 *     sync without coupling to a specific selection API).
 *
 * NOTE (concurrency): this module uses the distinct `GanttPertChart` /
 * `.jects-pert-chart` / `ganttPertChart` naming so it can coexist with any other
 * PERT module authored in parallel; the integrator should pick one. See wireNotes.
 *
 * All times are epoch milliseconds (UTC), matching the rest of the Gantt contract.
 */

import './pert-chart.css';
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
  DependencyModel,
  DependencyType,
  GanttApi,
  ScheduleResult,
  TaskModel,
  TaskSchedule,
} from '../contract.js';

const BLOCK = 'jects-pert-chart';
const SVG_NS = 'http://www.w3.org/2000/svg';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ARROW_ID = 'jects-pert-chart-arrow';
const ARROW_CRITICAL_ID = 'jects-pert-chart-arrow-critical';

/* ═══════════════════════════════════════════════════════════════════════════
   1. PUBLIC NODE / EDGE MODEL (the snapshot the view renders)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A single PERT node: a task plus the scheduling metrics shown inside its box.
 * This is the framework-free input the layout + renderer operate on; it is built
 * from the engine's `TaskSchedule` (see {@link fromGanttApi} / {@link fromScheduleResult}).
 */
export interface PertChartNode {
  /** Stable task id (matches the task model + schedule). */
  id: RecordId;
  /** Display name (falls back to the id when absent). */
  name?: string;
  /** Scheduled start (epoch ms). */
  start?: TimeMs;
  /** Scheduled finish (epoch ms). */
  end?: TimeMs;
  /** Total slack / float in working ms (0 ⇒ on the critical path). */
  totalSlack?: DurationMs;
  /** Whether the task lies on the critical path. */
  critical?: boolean;
  /** A zero-duration milestone (drawn with the milestone modifier). */
  milestone?: boolean;
  /** Whether the task is a summary/parent (drawn with the summary modifier). */
  summary?: boolean;
}

/** A directed PERT edge (dependency) between two nodes. */
export interface PertChartEdge {
  /** Stable link id. */
  id: RecordId;
  /** Predecessor node id. */
  fromId: RecordId;
  /** Successor node id. */
  toId: RecordId;
  /** Dependency type (FS/SS/FF/SF). */
  type?: DependencyType;
  /** Whether both endpoints are critical (edge highlighted as critical). */
  critical?: boolean;
}

/** The minimal snapshot the view renders, decoupled from any live engine. */
export interface PertChartSnapshot {
  nodes: PertChartNode[];
  edges: PertChartEdge[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. LAYOUT MODEL (pure layout output)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Layout direction: layers flow left→right (`horizontal`) or top→bottom. */
export type PertChartDirection = 'horizontal' | 'vertical';

/** Tuning for the pure {@link layoutPertChart} layered layout. */
export interface PertChartLayoutOptions {
  /** Flow direction. Default `'horizontal'`. */
  direction?: PertChartDirection;
  /** Node box width in px. Default 168. */
  nodeWidth?: number;
  /** Node box height in px. Default 92. */
  nodeHeight?: number;
  /** Gap between adjacent layers (px, along the flow axis). Default 64. */
  layerGap?: number;
  /** Gap between nodes within a layer (px, across the flow axis). Default 28. */
  nodeGap?: number;
  /** Outer padding around the whole diagram (px). Default 24. */
  padding?: number;
}

/** A node placed by the layout, in absolute content-pixel space. */
export interface PertChartNodeBox {
  /** The source node. */
  node: PertChartNode;
  /** Layer index (0 = roots / no predecessors). */
  layer: number;
  /** Order within the layer (0-based, top/left → bottom/right). */
  order: number;
  /** Left within the content, px. */
  x: number;
  /** Top within the content, px. */
  y: number;
  /** Box width, px. */
  width: number;
  /** Box height, px. */
  height: number;
}

/** A 2-D point in content-pixel space. */
export interface PertChartPoint {
  x: number;
  y: number;
}

/** An edge routed by the layout, as an orthogonal poly-line of points. */
export interface PertChartEdgeRoute {
  /** The source edge. */
  edge: PertChartEdge;
  /** Start terminal (centre of the predecessor's trailing edge), content px. */
  from: PertChartPoint;
  /** End terminal (centre of the successor's leading edge), content px. */
  to: PertChartPoint;
  /** The full poly-line including from/to (orthogonal elbow routing). */
  points: PertChartPoint[];
  /** Whether the edge connects two critical nodes (critical edge). */
  critical: boolean;
}

/** The full result of a layout pass. */
export interface PertChartLayout {
  /** Placed node boxes (iteration order = layer-major render order). */
  nodes: PertChartNodeBox[];
  /** Routed edges. */
  edges: PertChartEdgeRoute[];
  /** Total content width in px (for the scroll surface + fit math). */
  width: number;
  /** Total content height in px. */
  height: number;
  /** Number of layers produced. */
  layerCount: number;
  /** Node ids that were part of a broken cycle (drawn but flagged). */
  cycleNodeIds: RecordId[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. PURE LAYERED LAYOUT (topological longest-path + crossing reduction)
   ═══════════════════════════════════════════════════════════════════════════ */

const DEFAULT_LAYOUT: Required<PertChartLayoutOptions> = {
  direction: 'horizontal',
  nodeWidth: 168,
  nodeHeight: 92,
  layerGap: 64,
  nodeGap: 28,
  padding: 24,
};

/**
 * Compute a layered (Sugiyama-style) layout of the PERT graph. Pure: no DOM, no
 * time math beyond reading node fields. The algorithm:
 *
 *   1. Build adjacency from the edges, keeping only edges whose endpoints are
 *      present nodes (dangling/self edges are dropped from layout).
 *   2. **Longest-path layering:** each node's layer = the longest predecessor
 *      chain length over the acyclic projection, computed by a topological (Kahn)
 *      sweep with forward relaxation. Cyclic remnants are placed deterministically
 *      and their ids reported in `cycleNodeIds` (defensive cycle breaking). Roots
 *      (no incoming kept-edge) land in layer 0.
 *   3. **Ordering / crossing reduction:** within each layer, order nodes by the
 *      median order of their predecessors in the previous layer (one downward
 *      median sweep) — the cheap, deterministic Sugiyama heuristic.
 *   4. **Coordinate assignment:** layers are spaced along the flow axis; nodes are
 *      packed across the cross axis with `nodeGap`, shorter layers centred.
 *   5. **Edge routing:** each edge is an orthogonal 3-segment elbow from the
 *      predecessor's trailing-edge midpoint to the successor's leading-edge
 *      midpoint, with the bend at the mid-gap between the layers.
 *
 * @param nodes The PERT nodes to place.
 * @param edges The directed dependencies.
 * @param options Layout tuning (sizes / gaps / direction).
 */
export function layoutPertChart(
  nodes: ReadonlyArray<PertChartNode>,
  edges: ReadonlyArray<PertChartEdge>,
  options: PertChartLayoutOptions = {},
): PertChartLayout {
  const opt = { ...DEFAULT_LAYOUT, ...options };
  const horizontal = opt.direction !== 'vertical';

  const nodeById = new Map<RecordId, PertChartNode>();
  const indexOf = new Map<RecordId, number>();
  nodes.forEach((n, i) => {
    nodeById.set(n.id, n);
    indexOf.set(n.id, i);
  });

  // Adjacency (only edges between present, distinct nodes).
  const out = new Map<RecordId, RecordId[]>();
  const inn = new Map<RecordId, RecordId[]>();
  for (const n of nodes) {
    out.set(n.id, []);
    inn.set(n.id, []);
  }
  const keptEdges: PertChartEdge[] = [];
  for (const e of edges) {
    if (!nodeById.has(e.fromId) || !nodeById.has(e.toId)) continue;
    if (sameId(e.fromId, e.toId)) continue;
    out.get(e.fromId)!.push(e.toId);
    inn.get(e.toId)!.push(e.fromId);
    keptEdges.push(e);
  }

  const cycleNodeIds = detectCycles(nodes, out);
  const cyclic = new Set(cycleNodeIds);
  const layer = longestPathLayering(nodes, out, inn, cyclic);

  const layerCount = nodes.length === 0 ? 0 : Math.max(...layer.values()) + 1;
  const layers: PertChartNode[][] = Array.from({ length: layerCount }, () => []);
  for (const n of nodes) layers[layer.get(n.id)!]!.push(n);

  // Crossing reduction: order each layer by median predecessor order.
  const orderInLayer = new Map<RecordId, number>();
  layers.forEach((bucket, li) => {
    if (li === 0) {
      bucket.forEach((n, i) => orderInLayer.set(n.id, i));
      return;
    }
    const median = (n: PertChartNode): number => {
      const preds = inn
        .get(n.id)!
        .map((p) => orderInLayer.get(p))
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b);
      if (preds.length === 0) return indexOf.get(n.id)!;
      const mid = Math.floor(preds.length / 2);
      return preds.length % 2 ? preds[mid]! : (preds[mid - 1]! + preds[mid]!) / 2;
    };
    bucket
      .map((n) => ({ n, m: median(n), seed: indexOf.get(n.id)! }))
      .sort((a, b) => a.m - b.m || a.seed - b.seed)
      .forEach((entry, i) => orderInLayer.set(entry.n.id, i));
    bucket.sort((a, b) => orderInLayer.get(a.id)! - orderInLayer.get(b.id)!);
  });

  // Coordinate assignment. Flow axis = layer; cross axis = order in layer.
  const flowStep = (horizontal ? opt.nodeWidth : opt.nodeHeight) + opt.layerGap;
  const crossSize = horizontal ? opt.nodeHeight : opt.nodeWidth;
  const crossStep = crossSize + opt.nodeGap;
  const maxInLayer = layers.reduce((m, b) => Math.max(m, b.length), 0);
  const crossContent =
    maxInLayer * crossSize + Math.max(0, maxInLayer - 1) * opt.nodeGap;

  const boxes: PertChartNodeBox[] = [];
  const boxById = new Map<RecordId, PertChartNodeBox>();
  layers.forEach((bucket, li) => {
    const layerSpan =
      bucket.length * crossSize + Math.max(0, bucket.length - 1) * opt.nodeGap;
    const crossOffset = opt.padding + (crossContent - layerSpan) / 2;
    bucket.forEach((node, oi) => {
      const flow = opt.padding + li * flowStep;
      const cross = crossOffset + oi * crossStep;
      const box: PertChartNodeBox = {
        node,
        layer: li,
        order: oi,
        x: horizontal ? flow : cross,
        y: horizontal ? cross : flow,
        width: opt.nodeWidth,
        height: opt.nodeHeight,
      };
      boxes.push(box);
      boxById.set(node.id, box);
    });
  });

  const flowExtent = Math.max(0, layerCount * flowStep - opt.layerGap);
  const width =
    opt.padding * 2 + (horizontal ? flowExtent : crossContent);
  const height =
    opt.padding * 2 + (horizontal ? crossContent : flowExtent);

  const edgeRoutes: PertChartEdgeRoute[] = [];
  for (const e of keptEdges) {
    const a = boxById.get(e.fromId);
    const b = boxById.get(e.toId);
    if (!a || !b) continue;
    const critical = e.critical ?? (!!a.node.critical && !!b.node.critical);
    const route = routeEdge(a, b, horizontal);
    edgeRoutes.push({ edge: e, from: route.from, to: route.to, points: route.points, critical });
  }

  return {
    nodes: boxes,
    edges: edgeRoutes,
    width: Math.max(width, opt.padding * 2 + opt.nodeWidth),
    height: Math.max(height, opt.padding * 2 + opt.nodeHeight),
    layerCount,
    cycleNodeIds,
  };
}

/** Orthogonal 3-segment elbow route between two placed boxes. */
function routeEdge(
  a: PertChartNodeBox,
  b: PertChartNodeBox,
  horizontal: boolean,
): { from: PertChartPoint; to: PertChartPoint; points: PertChartPoint[] } {
  let from: PertChartPoint;
  let to: PertChartPoint;
  if (horizontal) {
    from = { x: a.x + a.width, y: a.y + a.height / 2 };
    to = { x: b.x, y: b.y + b.height / 2 };
  } else {
    from = { x: a.x + a.width / 2, y: a.y + a.height };
    to = { x: b.x + b.width / 2, y: b.y };
  }
  const points: PertChartPoint[] = [from];
  if (horizontal) {
    const midX = (from.x + to.x) / 2;
    if (from.y !== to.y) {
      points.push({ x: midX, y: from.y });
      points.push({ x: midX, y: to.y });
    }
  } else {
    const midY = (from.y + to.y) / 2;
    if (from.x !== to.x) {
      points.push({ x: from.x, y: midY });
      points.push({ x: to.x, y: midY });
    }
  }
  points.push(to);
  return { from, to, points };
}

/** Longest-path layering over the acyclic projection (Kahn + forward relaxation). */
function longestPathLayering(
  nodes: ReadonlyArray<PertChartNode>,
  out: Map<RecordId, RecordId[]>,
  inn: Map<RecordId, RecordId[]>,
  cyclic: Set<RecordId>,
): Map<RecordId, number> {
  const layer = new Map<RecordId, number>();
  for (const n of nodes) layer.set(n.id, 0);

  const indeg = new Map<RecordId, number>();
  for (const n of nodes) indeg.set(n.id, inn.get(n.id)!.length);

  const queue: RecordId[] = [];
  for (const n of nodes) if ((indeg.get(n.id) ?? 0) === 0) queue.push(n.id);

  const processed = new Set<RecordId>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (processed.has(id)) continue;
    processed.add(id);
    const base = layer.get(id)!;
    for (const next of out.get(id)!) {
      if (base + 1 > (layer.get(next) ?? 0)) layer.set(next, base + 1);
      const d = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, d);
      if (d <= 0) queue.push(next);
    }
  }

  // Cyclic remnants: relax against non-back-edges so they still render sensibly.
  const leftover = nodes.filter((n) => !processed.has(n.id));
  for (let pass = 0; pass < leftover.length; pass++) {
    let changed = false;
    for (const n of leftover) {
      let best = layer.get(n.id)!;
      for (const p of inn.get(n.id)!) {
        if (cyclic.has(p) && cyclic.has(n.id)) continue; // ignore back-edges
        best = Math.max(best, (layer.get(p) ?? 0) + 1);
      }
      if (best !== layer.get(n.id)) {
        layer.set(n.id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return layer;
}

/** DFS cycle detection; returns the node ids that participate in a cycle. */
function detectCycles(
  nodes: ReadonlyArray<PertChartNode>,
  out: Map<RecordId, RecordId[]>,
): RecordId[] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<RecordId, number>();
  for (const n of nodes) color.set(n.id, WHITE);
  const cyclic = new Set<RecordId>();
  const stack: RecordId[] = [];

  const visit = (id: RecordId): void => {
    color.set(id, GRAY);
    stack.push(id);
    for (const next of out.get(id) ?? []) {
      const c = color.get(next);
      if (c === GRAY) {
        const at = stack.lastIndexOf(next);
        if (at >= 0) for (let i = at; i < stack.length; i++) cyclic.add(stack[i]!);
      } else if (c === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  };

  for (const n of nodes) if (color.get(n.id) === WHITE) visit(n.id);
  return [...cyclic];
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. SNAPSHOT BUILDERS (engine schedule-result → PERT nodes/edges)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Build a PERT snapshot from a live {@link GanttApi}. Reads each task's schedule
 * (start/end/slack/critical) from the engine via `getSchedule`, and the dependency
 * set from `getDependenciesFor`. Summary/parent tasks are included by default
 * (they are real network nodes); pass `leafOnly` to drop them.
 *
 * This is the primary entry point: the network renders over the SAME CPM solution
 * the Gantt bars reflect, with no separate scheduling.
 */
export function fromGanttApi<T extends Model = Model>(
  api: GanttApi<T>,
  opts: { tasks?: ReadonlyArray<TaskModel<T>>; leafOnly?: boolean } = {},
): PertChartSnapshot {
  const tasks = opts.tasks ?? collectTasks(api);
  const criticalSet = new Set(api.getCriticalPath());
  const nodes: PertChartNode[] = [];
  for (const task of tasks) {
    const isSummary = task.summary === true || api.getChildren(task.id).length > 0;
    if (opts.leafOnly && isSummary) continue;
    const sched = api.getSchedule(task.id);
    nodes.push(nodeFromTask(task, sched, criticalSet.has(task.id), isSummary));
  }

  const present = new Set(nodes.map((n) => n.id));
  const seen = new Set<RecordId>();
  const edges: PertChartEdge[] = [];
  for (const node of nodes) {
    for (const dep of api.getDependenciesFor(node.id)) {
      if (seen.has(dep.id)) continue;
      seen.add(dep.id);
      if (dep.active === false) continue;
      if (!present.has(dep.fromId) || !present.has(dep.toId)) continue;
      edges.push(edgeFrom(dep, criticalSet));
    }
  }
  return { nodes, edges };
}

/**
 * Build a PERT snapshot from a plain task list + dependency list + a captured
 * {@link ScheduleResult} (or just its `schedules` map). Lets the view run head-less
 * over a stored schedule result without a live `GanttApi`.
 */
export function fromScheduleResult<T extends Model = Model>(
  tasks: ReadonlyArray<TaskModel<T>>,
  dependencies: ReadonlyArray<DependencyModel>,
  result: ScheduleResult | ReadonlyMap<RecordId, TaskSchedule>,
): PertChartSnapshot {
  const schedules: ReadonlyMap<RecordId, TaskSchedule> =
    result instanceof Map ? result : (result as ScheduleResult).schedules;
  const criticalSet = new Set<RecordId>();
  for (const [, s] of schedules) if (s.critical) criticalSet.add(s.taskId);

  const childCount = new Map<RecordId, number>();
  for (const t of tasks) {
    if (t.parentId != null) {
      childCount.set(t.parentId, (childCount.get(t.parentId) ?? 0) + 1);
    }
  }
  const nodes = tasks.map((t) =>
    nodeFromTask(
      t,
      schedules.get(t.id),
      criticalSet.has(t.id),
      t.summary === true || (childCount.get(t.id) ?? 0) > 0,
    ),
  );
  const present = new Set(nodes.map((n) => n.id));
  const edges: PertChartEdge[] = [];
  for (const dep of dependencies) {
    if (dep.active === false) continue;
    if (!present.has(dep.fromId) || !present.has(dep.toId)) continue;
    edges.push(edgeFrom(dep, criticalSet));
  }
  return { nodes, edges };
}

function nodeFromTask<T extends Model>(
  task: TaskModel<T>,
  sched: TaskSchedule | undefined,
  critical: boolean,
  summary: boolean,
): PertChartNode {
  const start = task.start ?? sched?.start;
  const end = task.end ?? sched?.end;
  const totalSlack = sched?.totalSlack;
  const node: PertChartNode = {
    id: task.id,
    critical: critical || sched?.critical === true,
    milestone: task.milestone === true || (start != null && start === end),
    summary,
  };
  if (task.name !== undefined) node.name = task.name;
  if (start !== undefined) node.start = start;
  if (end !== undefined) node.end = end;
  if (totalSlack !== undefined) node.totalSlack = totalSlack;
  return node;
}

function edgeFrom(dep: DependencyModel, criticalSet: Set<RecordId>): PertChartEdge {
  return {
    id: dep.id,
    fromId: dep.fromId,
    toId: dep.toId,
    type: dep.type ?? 'FS',
    critical: criticalSet.has(dep.fromId) && criticalSet.has(dep.toId),
  };
}

/** Discover the task forest from a `GanttApi` (which exposes children, not a flat list). */
function collectTasks<T extends Model>(api: GanttApi<T>): TaskModel<T>[] {
  const out: TaskModel<T>[] = [];
  const seen = new Set<RecordId>();
  const pushTree = (id: RecordId): void => {
    if (seen.has(id)) return;
    const task = api.getTask(id);
    if (!task) return;
    seen.add(id);
    out.push(task);
    for (const child of api.getChildren(id)) pushTree(child.id);
  };
  // Seed from the critical path, climb each seed to its root, expand the forest.
  for (const id of new Set<RecordId>(api.getCriticalPath())) {
    let task = api.getTask(id);
    while (task?.parentId != null) {
      const parent = api.getTask(task.parentId);
      if (!parent) break;
      task = parent;
    }
    if (task) pushTree(task.id);
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. THE PERT CHART WIDGET
   ═══════════════════════════════════════════════════════════════════════════ */

/** Configuration for the {@link GanttPertChart} widget. */
export interface GanttPertChartConfig extends WidgetConfig {
  /** The nodes to render. */
  nodes?: PertChartNode[];
  /** The dependency edges to render. */
  edges?: PertChartEdge[];
  /** Layout direction. Default `'horizontal'`. */
  direction?: PertChartDirection;
  /** Layout tuning passed to {@link layoutPertChart}. */
  layout?: PertChartLayoutOptions;
  /** Highlight the critical path. Default `true`. */
  showCriticalPath?: boolean;
  /** Enable wheel/drag pan + zoom. Default `true`. */
  interactive?: boolean;
  /** Initial zoom (1 = 100%). Clamped to `[minZoom, maxZoom]`. Default 1. */
  zoom?: number;
  /** Minimum zoom. Default 0.25. */
  minZoom?: number;
  /** Maximum zoom. Default 2.5. */
  maxZoom?: number;
  /** Selected node ids (drives `aria-pressed`). */
  selected?: RecordId[];
  /** Date formatter for the node box dates. Defaults to a short UTC ISO date. */
  formatDate?(time: TimeMs): string;
  /** Slack formatter. Defaults to whole-day rounding (`"3d"`). */
  formatSlack?(slackMs: DurationMs): string;
}

/** Typed event map for {@link GanttPertChart}. */
export interface GanttPertChartEvents extends WidgetEvents {
  /** A node was selected (click / keyboard). `native` present for input events. */
  nodeSelect: {
    nodeId: RecordId;
    selected: ReadonlyArray<RecordId>;
    native?: MouseEvent | KeyboardEvent;
  };
  /** A node was activated (double-click / Enter) — e.g. open the task editor. */
  nodeActivate: { nodeId: RecordId; native?: MouseEvent | KeyboardEvent };
  /** The pan/zoom transform changed. */
  viewChange: { zoom: number; panX: number; panY: number };
  /** A (re)layout completed. */
  layout: { layout: PertChartLayout };
}

const DEFAULTS: Partial<GanttPertChartConfig> = {
  direction: 'horizontal',
  showCriticalPath: true,
  interactive: true,
  zoom: 1,
  minZoom: 0.25,
  maxZoom: 2.5,
};

/**
 * The PERT / network-diagram chart Widget. Renders nodes + edges from a
 * {@link PertChartSnapshot}, auto-lays them out into layers, highlights the
 * critical path, and supports pan/zoom + selection. Selection is the sync seam
 * with the main Gantt: the owner pushes the Gantt's selection in via
 * {@link setSelected} and listens for `nodeSelect` to push the view's back.
 */
export class GanttPertChart extends Widget<GanttPertChartConfig, GanttPertChartEvents> {
  // The owned sub-elements are resolved from `this.el` on demand (rather than
  // cached in fields) for the same `useDefineForClassFields` reason as the state
  // getters below: a cached element field would be wiped to `undefined` right
  // after the base constructor's first `render()`. Querying `this.el` is cheap
  // (the tree is small and stable) and always correct.
  private get viewport(): HTMLElement {
    return this.el.querySelector(`.${BLOCK}__viewport`) as HTMLElement;
  }
  private get content(): HTMLElement {
    return this.el.querySelector(`.${BLOCK}__content`) as HTMLElement;
  }
  private get svg(): SVGSVGElement {
    return this.el.querySelector(`.${BLOCK}__edges`) as unknown as SVGSVGElement;
  }
  private get edgeGroup(): SVGGElement {
    return this.el.querySelector(`.${BLOCK}__edge-group`) as unknown as SVGGElement;
  }
  private get nodeLayer(): HTMLElement {
    return this.el.querySelector(`.${BLOCK}__nodes`) as HTMLElement;
  }
  private get liveRegion(): HTMLElement {
    return this.el.querySelector(`.${BLOCK}__sr`) as HTMLElement;
  }

  // NOTE: lazy getters (backed by optional fields) rather than initialized
  // fields. With `useDefineForClassFields` (ES2022), a subclass field with an
  // initializer is (re)assigned AFTER `super()` returns — but the base Widget
  // constructor calls `buildEl()` + `render()` INSIDE `super()`, so a normal
  // field would be wiped to its initializer value right after that first render.
  // The lazy `_x ??= new …()` getters survive that ordering (mirrors the
  // ResourceUtilizationView pattern in this package).
  private _currentLayout?: PertChartLayout;
  private _boxById?: Map<RecordId, PertChartNodeBox>;
  private _selected?: Set<RecordId>;

  private get currentLayout(): PertChartLayout {
    return (this._currentLayout ??= emptyLayout());
  }
  private set currentLayout(v: PertChartLayout) {
    this._currentLayout = v;
  }
  private get boxById(): Map<RecordId, PertChartNodeBox> {
    return (this._boxById ??= new Map<RecordId, PertChartNodeBox>());
  }
  private get selected(): Set<RecordId> {
    return (this._selected ??= new Set<RecordId>());
  }

  private zoomLevel = 1;
  private panX = 0;
  private panY = 0;

  private panning = false;
  private panStart: { x: number; y: number; panX: number; panY: number } | null = null;
  private movedDuringPan = false;
  private activePointerId: number | null = null;

  constructor(host: HTMLElement | string, config?: GanttPertChartConfig) {
    super(host, config);
    // The base constructor already ran `render()` once — but under
    // `useDefineForClassFields` this subclass's field initializers (which run
    // AFTER `super()`) reset `_boxById` / `_currentLayout` / `zoomLevel` / pan
    // back to `undefined`/defaults, discarding that first paint's state. Re-run
    // the (idempotent) render once more here, now that all fields are settled, so
    // the rendered DOM and the cached layout/selection state are consistent.
    this.render();
    // Bind delegated/pan-zoom interactions exactly once (post-settle) — they live
    // on `this.el` and survive every subsequent re-paint.
    this.bindInteractions();
  }

  protected override defaults(): Partial<GanttPertChartConfig> {
    return DEFAULTS;
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: BLOCK });
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'PERT network diagram');
    root.tabIndex = -1;

    const viewport = createEl('div', { className: `${BLOCK}__viewport` });
    const content = createEl('div', { className: `${BLOCK}__content` });

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', `${BLOCK}__edges`);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.append(buildArrowMarker(ARROW_ID), buildArrowMarker(ARROW_CRITICAL_ID));
    svg.append(defs);
    const edgeGroup = document.createElementNS(SVG_NS, 'g');
    edgeGroup.setAttribute('class', `${BLOCK}__edge-group`);
    svg.append(edgeGroup);

    const nodeLayer = createEl('div', { className: `${BLOCK}__nodes` });

    content.append(svg, nodeLayer);
    viewport.append(content);

    const liveRegion = createEl('div', { className: `${BLOCK}__sr` });
    liveRegion.setAttribute('aria-live', 'polite');

    root.append(viewport, liveRegion);
    return root;
  }

  protected override render(): void {
    this.zoomLevel = clamp(
      this.config.zoom ?? 1,
      this.config.minZoom ?? 0.25,
      this.config.maxZoom ?? 2.5,
    );
    this.selected.clear();
    for (const id of this.config.selected ?? []) this.selected.add(id);

    this.relayout();
    // Interactions are delegated on `this.el`, so they are bound ONCE (in the
    // constructor) and survive every re-paint; they are not re-bound per render.
  }

  /* ── public API ────────────────────────────────────────────────────────── */

  /** Replace the rendered snapshot (nodes + edges) and re-layout. */
  setData(snapshot: PertChartSnapshot): this {
    this.config.nodes = snapshot.nodes;
    this.config.edges = snapshot.edges;
    this.relayout();
    return this;
  }

  /** The current computed layout (node boxes + routed edges). */
  getLayout(): Readonly<PertChartLayout> {
    return this.currentLayout;
  }

  /** The current selection (node ids), in insertion order. */
  getSelected(): ReadonlyArray<RecordId> {
    return [...this.selected];
  }

  /**
   * Push the selection INTO the view (the Gantt→PERT sync direction). Replaces the
   * current selection; does NOT emit `nodeSelect` unless `{ silent: false }`.
   */
  setSelected(ids: ReadonlyArray<RecordId>, opts: { silent?: boolean } = {}): this {
    this.selected.clear();
    for (const id of ids) this.selected.add(id);
    this.applySelectionDom();
    if (opts.silent === false && ids.length > 0) {
      this.emit('nodeSelect', {
        nodeId: ids[ids.length - 1]!,
        selected: this.getSelected(),
      });
    }
    return this;
  }

  /** Set the zoom level (clamped) and re-apply the transform. */
  setZoom(zoom: number): this {
    this.zoomLevel = clamp(zoom, this.config.minZoom ?? 0.25, this.config.maxZoom ?? 2.5);
    this.applyTransform();
    return this;
  }

  /** Current zoom multiplier. */
  getZoom(): number {
    return this.zoomLevel;
  }

  /** Set the pan offset (content-pixel translation) and re-apply the transform. */
  setPan(x: number, y: number): this {
    this.panX = x;
    this.panY = y;
    this.applyTransform();
    return this;
  }

  /** Current pan offset. */
  getPan(): { x: number; y: number } {
    return { x: this.panX, y: this.panY };
  }

  /**
   * Fit the whole diagram into the viewport (zoom-to-fit + centre). When the
   * viewport has no measured size (jsdom), falls back to the current zoom.
   */
  fit(padding = 16): this {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const cw = this.currentLayout.width;
    const ch = this.currentLayout.height;
    if (vw > 0 && vh > 0 && cw > 0 && ch > 0) {
      const z = clamp(
        Math.min((vw - padding * 2) / cw, (vh - padding * 2) / ch),
        this.config.minZoom ?? 0.25,
        this.config.maxZoom ?? 2.5,
      );
      this.zoomLevel = z;
      this.panX = (vw - cw * z) / 2;
      this.panY = (vh - ch * z) / 2;
    }
    this.applyTransform();
    return this;
  }

  /** Toggle critical-path highlighting (re-paints so edges/nodes update). */
  setCriticalPathVisible(visible: boolean): this {
    this.config.showCriticalPath = visible;
    this.relayout();
    return this;
  }

  /** The node box for a task id (post-layout), if present. */
  boxFor(id: RecordId): Readonly<PertChartNodeBox> | undefined {
    return this.boxById.get(id);
  }

  /* ── layout + paint ──────────────────────────────────────────────────────── */

  private relayout(): void {
    const nodes = this.config.nodes ?? [];
    const edges = this.config.edges ?? [];
    const layout = layoutPertChart(nodes, edges, {
      ...(this.config.direction !== undefined ? { direction: this.config.direction } : {}),
      ...this.config.layout,
    });
    this.currentLayout = layout;
    this.boxById.clear();
    for (const box of layout.nodes) this.boxById.set(box.node.id, box);

    this.content.style.width = `${layout.width}px`;
    this.content.style.height = `${layout.height}px`;
    this.svg.setAttribute('width', String(layout.width));
    this.svg.setAttribute('height', String(layout.height));
    this.svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);

    this.el.classList.toggle(
      `${BLOCK}--no-critical`,
      this.config.showCriticalPath === false,
    );

    this.paintEdges(layout);
    this.paintNodes(layout);
    this.applySelectionDom();
    this.applyTransform();

    this.emit('layout', { layout });
  }

  private paintEdges(layout: PertChartLayout): void {
    this.edgeGroup.replaceChildren();
    const showCritical = this.config.showCriticalPath !== false;
    for (const route of layout.edges) {
      const path = document.createElementNS(SVG_NS, 'path');
      const critical = route.critical && showCritical;
      path.setAttribute(
        'class',
        `${BLOCK}__edge${critical ? ` ${BLOCK}__edge--critical` : ''}`,
      );
      path.setAttribute('d', polylinePath(route.points));
      path.setAttribute('fill', 'none');
      path.setAttribute(
        'marker-end',
        `url(#${critical ? ARROW_CRITICAL_ID : ARROW_ID})`,
      );
      path.dataset.edgeId = String(route.edge.id);
      this.edgeGroup.append(path);
    }
  }

  private paintNodes(layout: PertChartLayout): void {
    this.nodeLayer.replaceChildren();
    const cyclic = new Set(layout.cycleNodeIds.map(String));
    const showCritical = this.config.showCriticalPath !== false;
    const fmtDate = this.config.formatDate ?? defaultFormatDate;
    const fmtSlack = this.config.formatSlack ?? defaultFormatSlack;

    for (const box of layout.nodes) {
      const n = box.node;
      const critical = n.critical === true && showCritical;
      const el = createEl('div', {
        className:
          `${BLOCK}__node` +
          (critical ? ` ${BLOCK}__node--critical` : '') +
          (n.milestone ? ` ${BLOCK}__node--milestone` : '') +
          (n.summary ? ` ${BLOCK}__node--summary` : '') +
          (cyclic.has(String(n.id)) ? ` ${BLOCK}__node--cycle` : ''),
      });
      el.style.left = `${box.x}px`;
      el.style.top = `${box.y}px`;
      el.style.width = `${box.width}px`;
      el.style.height = `${box.height}px`;
      el.dataset.nodeId = String(n.id);
      el.setAttribute('role', 'button');
      el.tabIndex = -1;
      el.setAttribute('aria-pressed', 'false');

      const name = n.name ?? String(n.id);
      const dates =
        n.start != null
          ? `${fmtDate(n.start)}${n.end != null && n.end !== n.start ? ` – ${fmtDate(n.end)}` : ''}`
          : '';
      const slack = n.totalSlack != null && !critical ? fmtSlack(n.totalSlack) : '';
      const label =
        `${name}` +
        (dates ? `, ${dates}` : '') +
        (critical ? ', critical path' : slack ? `, slack ${slack}` : '');
      el.setAttribute('aria-label', label);

      const title = createEl('div', { className: `${BLOCK}__node-title` });
      title.textContent = name;
      el.append(title);

      const meta = createEl('div', { className: `${BLOCK}__node-meta` });
      if (dates) {
        const d = createEl('span', { className: `${BLOCK}__node-dates` });
        d.textContent = dates;
        meta.append(d);
      }
      const slackEl = createEl('span', { className: `${BLOCK}__node-slack` });
      slackEl.textContent = critical ? 'Critical' : slack ? `Slack ${slack}` : 'Slack 0';
      meta.append(slackEl);
      el.append(meta);

      this.nodeLayer.append(el);
    }

    const first = this.nodeLayer.querySelector<HTMLElement>(`.${BLOCK}__node`);
    if (first) first.tabIndex = 0;
  }

  /* ── selection ───────────────────────────────────────────────────────────── */

  private applySelectionDom(): void {
    const sel = new Set([...this.selected].map(String));
    for (const el of this.nodeLayer.querySelectorAll<HTMLElement>(`.${BLOCK}__node`)) {
      const on = el.dataset.nodeId != null && sel.has(el.dataset.nodeId);
      el.classList.toggle(`${BLOCK}__node--selected`, on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  private selectNode(
    nodeId: RecordId,
    native: MouseEvent | KeyboardEvent | undefined,
    additive: boolean,
  ): void {
    if (!additive) this.selected.clear();
    if (additive && this.selected.has(nodeId)) this.selected.delete(nodeId);
    else this.selected.add(nodeId);
    this.applySelectionDom();
    const node = this.boxById.get(nodeId)?.node;
    this.liveRegion.textContent = node ? `Selected ${node.name ?? String(nodeId)}` : '';
    this.emit('nodeSelect', {
      nodeId,
      selected: this.getSelected(),
      ...(native !== undefined ? { native } : {}),
    });
  }

  /* ── interactions ──────────────────────────────────────────────────────── */

  private bindInteractions(): void {
    this.on2(`.${BLOCK}__node`, 'click', (e: MouseEvent) => {
      if (this.movedDuringPan) return;
      const id = nodeIdFromEvent(e, this.boxById);
      if (id == null) return;
      this.focusNode(id);
      this.selectNode(id, e, e.shiftKey || e.ctrlKey || e.metaKey);
    });
    this.on2(`.${BLOCK}__node`, 'dblclick', (e: MouseEvent) => {
      const id = nodeIdFromEvent(e, this.boxById);
      if (id == null) return;
      this.emit('nodeActivate', { nodeId: id, native: e });
    });
    this.on2(`.${BLOCK}__node`, 'keydown', (e: KeyboardEvent) => {
      this.handleNodeKeydown(e);
    });

    if (this.config.interactive === false) return;

    this.listen('wheel', (e: WheelEvent) => this.handleWheel(e));
    this.listen('pointerdown', (e: PointerEvent) => this.handlePointerDown(e));
    this.listen('pointermove', (e: PointerEvent) => this.handlePointerMove(e));
    const endPan = (): void => this.handlePointerUp();
    this.listen('pointerup', endPan);
    this.listen('pointercancel', endPan);
  }

  private handleNodeKeydown(e: KeyboardEvent): void {
    const current = e.target as HTMLElement | null;
    const raw = current?.dataset.nodeId;
    const id = raw != null ? coerceId(raw, this.boxById) : null;
    if (id == null) return;

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        this.emit('nodeActivate', { nodeId: id, native: e });
        return;
      case ' ':
      case 'Spacebar':
        e.preventDefault();
        this.selectNode(id, e, e.shiftKey || e.ctrlKey || e.metaKey);
        return;
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        this.moveFocus(id, +1);
        return;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        this.moveFocus(id, -1);
        return;
      case 'Home':
        e.preventDefault();
        this.focusByOrder(0);
        return;
      case 'End':
        e.preventDefault();
        this.focusByOrder(this.currentLayout.nodes.length - 1);
        return;
      default:
        return;
    }
  }

  private moveFocus(from: RecordId, delta: number): void {
    const order = this.currentLayout.nodes;
    const idx = order.findIndex((b) => sameId(b.node.id, from));
    if (idx < 0) return;
    this.focusByOrder(idx + delta);
  }

  private focusByOrder(index: number): void {
    const box = this.currentLayout.nodes[clampIndex(index, this.currentLayout.nodes.length)];
    if (box) this.focusNode(box.node.id);
  }

  private focusNode(id: RecordId): void {
    for (const el of this.nodeLayer.querySelectorAll<HTMLElement>(`.${BLOCK}__node`)) {
      const on = el.dataset.nodeId != null && sameId(el.dataset.nodeId, id);
      el.tabIndex = on ? 0 : -1;
      if (on) el.focus();
    }
  }

  private handleWheel(e: WheelEvent): void {
    if (this.config.interactive === false) return;
    e.preventDefault();
    const rect = this.viewport.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.zoomAt(cx, cy, this.zoomLevel * factor);
  }

  private zoomAt(cx: number, cy: number, nextZoom: number): void {
    const z0 = this.zoomLevel;
    const z1 = clamp(nextZoom, this.config.minZoom ?? 0.25, this.config.maxZoom ?? 2.5);
    if (z1 === z0) return;
    const contentX = (cx - this.panX) / z0;
    const contentY = (cy - this.panY) / z0;
    this.zoomLevel = z1;
    this.panX = cx - contentX * z1;
    this.panY = cy - contentY * z1;
    this.applyTransform();
  }

  private handlePointerDown(e: PointerEvent): void {
    if (this.config.interactive === false) return;
    if ((e.target as HTMLElement | null)?.closest(`.${BLOCK}__node`)) return;
    if (e.button !== 0) return;
    this.panning = true;
    this.movedDuringPan = false;
    this.activePointerId = e.pointerId;
    this.panStart = { x: e.clientX, y: e.clientY, panX: this.panX, panY: this.panY };
    this.el.classList.add(`${BLOCK}--panning`);
    try {
      this.viewport.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.panning || !this.panStart) return;
    const dx = e.clientX - this.panStart.x;
    const dy = e.clientY - this.panStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.movedDuringPan = true;
    this.panX = this.panStart.panX + dx;
    this.panY = this.panStart.panY + dy;
    this.applyTransform();
  }

  private handlePointerUp(): void {
    if (!this.panning) return;
    this.panning = false;
    this.panStart = null;
    this.el.classList.remove(`${BLOCK}--panning`);
    if (this.activePointerId != null) {
      try {
        this.viewport.releasePointerCapture?.(this.activePointerId);
      } catch {
        /* best-effort */
      }
      this.activePointerId = null;
    }
    if (this.movedDuringPan) {
      queueMicrotask(() => {
        this.movedDuringPan = false;
      });
    }
  }

  private applyTransform(): void {
    this.content.style.transformOrigin = '0 0';
    this.content.style.transform = `translate(${round(this.panX)}px, ${round(
      this.panY,
    )}px) scale(${round(this.zoomLevel)})`;
    this.emit('viewChange', { zoom: this.zoomLevel, panX: this.panX, panY: this.panY });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Build the reusable SVG arrowhead marker (themed via the path's context-stroke). */
function buildArrowMarker(id: string): SVGMarkerElement {
  const marker = document.createElementNS(SVG_NS, 'marker') as SVGMarkerElement;
  marker.setAttribute('id', id);
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '9');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('orient', 'auto-start-reverse');
  marker.setAttribute('markerUnits', 'userSpaceOnUse');
  const tri = document.createElementNS(SVG_NS, 'path');
  tri.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  // `context-stroke` makes the arrowhead inherit the connected path's stroke
  // colour, so the themed CSS owns colour with no literal here.
  tri.setAttribute('fill', 'context-stroke');
  marker.append(tri);
  return marker;
}

/** An empty layout (the initial `currentLayout` before the first relayout). */
function emptyLayout(): PertChartLayout {
  return { nodes: [], edges: [], width: 0, height: 0, layerCount: 0, cycleNodeIds: [] };
}

/** SVG path `d` for an orthogonal poly-line. */
function polylinePath(points: ReadonlyArray<PertChartPoint>): string {
  if (points.length === 0) return '';
  let d = `M ${round(points[0]!.x)} ${round(points[0]!.y)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${round(points[i]!.x)} ${round(points[i]!.y)}`;
  }
  return d;
}

function nodeIdFromEvent(
  e: Event,
  boxById: Map<RecordId, PertChartNodeBox>,
): RecordId | null {
  const el = (e.target as HTMLElement | null)?.closest(
    `.${BLOCK}__node`,
  ) as HTMLElement | null;
  const raw = el?.dataset.nodeId;
  return raw == null ? null : coerceId(raw, boxById);
}

/** Recover the original RecordId type from its stringified dataset form. */
function coerceId(raw: string, boxById: Map<RecordId, PertChartNodeBox>): RecordId {
  if (boxById.has(raw)) return raw;
  if (/^-?\d+$/.test(raw)) {
    const n = Number(raw);
    if (boxById.has(n)) return n;
  }
  return raw;
}

function sameId(a: RecordId, b: RecordId): boolean {
  return String(a) === String(b);
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (hi < lo) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

function clampIndex(i: number, len: number): number {
  if (len <= 0) return 0;
  return i < 0 ? 0 : i >= len ? len - 1 : i;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Default short UTC ISO date (`YYYY-MM-DD`). */
function defaultFormatDate(time: TimeMs): string {
  if (!Number.isFinite(time)) return '';
  return new Date(time).toISOString().slice(0, 10);
}

/** Default slack formatter: whole days (`"3d"`), hours (`"4h"`), or minutes. */
function defaultFormatSlack(slackMs: DurationMs): string {
  if (!Number.isFinite(slackMs) || slackMs <= 0) return '0';
  if (slackMs >= DAY) return `${Math.round(slackMs / DAY)}d`;
  if (slackMs >= HOUR) return `${Math.round(slackMs / HOUR)}h`;
  return `${Math.round(slackMs / 60_000)}m`;
}

/** Convenience factory mirroring the other Gantt view factories. */
export function createPertChart(
  host: HTMLElement | string,
  config?: GanttPertChartConfig,
): GanttPertChart {
  return new GanttPertChart(host, config);
}

register('ganttPertChart', GanttPertChart as never);
