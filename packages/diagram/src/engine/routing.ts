/**
 * Connector routing — pure path computation between two shapes.
 *
 * Implements the four contract {@link ConnectorKind}s:
 *   - `straight`    — a single line between resolved perimeter points.
 *   - `elbow`       — a simple L / Z bend (axis-first), no obstacle avoidance.
 *   - `orthogonal`  — A*-style grid pathfinding that routes around shape
 *                     obstacles with axis-aligned segments.
 *   - `curved`      — a straight skeleton flagged for spline rendering (the
 *                     renderer turns the 2 points into a quadratic curve).
 *
 * Routers are pure: they take the connector + endpoint shapes + obstacle list
 * and return a {@link RouteResult}. Arrowhead geometry lives here too so the
 * renderer can draw heads without re-deriving direction.
 */

import type {
  ConnectorModel,
  ConnectorRouter,
  ConnectorKind,
  RouteResult,
  ShapeModel,
  Point,
  ArrowHead,
} from '../contract.js';
import {
  shapeRect,
  rectCenter,
  perimeterPoint,
  sideOf,
  sideNormal,
  inflate,
  rectContains,
  segmentIntersectsRect,
  simplifyPath,
  type Side,
} from './geometry.js';
import { resolvePorts, portPoint } from './shapes.js';

/** Default obstacle clearance (model units) used by orthogonal routing. */
export const ROUTE_CLEARANCE = 12;

/* ── Endpoint resolution ──────────────────────────────────────────────────── */

/** Resolve the attachment point for one connector end. */
function endPoint(
  shape: ShapeModel,
  portId: string | undefined,
  toward: Point,
): { point: Point; side: Side } {
  if (portId) {
    const port = resolvePorts(shape).find((p) => p.id === portId);
    if (port) {
      const pt = portPoint(shape, port);
      const r = shapeRect(shape);
      return { point: pt, side: sideOf(r, pt) };
    }
  }
  const r = shapeRect(shape);
  const pt = perimeterPoint(r, toward);
  return { point: pt, side: sideOf(r, pt) };
}

/** Resolve both endpoints, each aimed at the other's center. */
export function resolveEndpoints(
  connector: ConnectorModel,
  from: ShapeModel,
  to: ShapeModel,
): { start: Point; end: Point; startSide: Side; endSide: Side } {
  const a = endPoint(from, connector.from.port, rectCenter(shapeRect(to)));
  const b = endPoint(to, connector.to.port, rectCenter(shapeRect(from)));
  return { start: a.point, end: b.point, startSide: a.side, endSide: b.side };
}

/* ── Straight ─────────────────────────────────────────────────────────────── */

export class StraightRouter implements ConnectorRouter {
  readonly kind: ConnectorKind = 'straight';
  route(
    c: ConnectorModel,
    from: ShapeModel,
    to: ShapeModel,
    _obstacles?: readonly ShapeModel[],
  ): RouteResult {
    void _obstacles;
    const { start, end } = resolveEndpoints(c, from, to);
    return { points: [start, end], startPoint: start, endPoint: end };
  }
}

/* ── Curved (skeleton == straight; renderer splines it) ───────────────────── */

export class CurvedRouter implements ConnectorRouter {
  readonly kind: ConnectorKind = 'curved';
  route(
    c: ConnectorModel,
    from: ShapeModel,
    to: ShapeModel,
    _obstacles?: readonly ShapeModel[],
  ): RouteResult {
    void _obstacles;
    const { start, end } = resolveEndpoints(c, from, to);
    const mid: Point = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    return { points: [start, mid, end], startPoint: start, endPoint: end };
  }
}

/* ── Elbow (simple axis-first L/Z bend) ───────────────────────────────────── */

export class ElbowRouter implements ConnectorRouter {
  readonly kind: ConnectorKind = 'elbow';
  route(
    c: ConnectorModel,
    from: ShapeModel,
    to: ShapeModel,
    _obstacles?: readonly ShapeModel[],
  ): RouteResult {
    void _obstacles;
    const { start, end, startSide } = resolveEndpoints(c, from, to);
    const pts = elbowPath(start, end, startSide);
    return { points: simplifyPath(pts), startPoint: start, endPoint: end };
  }
}

/** Build an L/Z elbow honoring the start side's axis. */
export function elbowPath(start: Point, end: Point, startSide: Side): Point[] {
  const horizontalStart = startSide === 'left' || startSide === 'right';
  if (horizontalStart) {
    const midX = (start.x + end.x) / 2;
    return [
      start,
      { x: midX, y: start.y },
      { x: midX, y: end.y },
      end,
    ];
  }
  const midY = (start.y + end.y) / 2;
  return [
    start,
    { x: start.x, y: midY },
    { x: end.x, y: midY },
    end,
  ];
}

/* ── Orthogonal (A* on a sparse grid that avoids obstacles) ───────────────── */

interface GridNode {
  x: number;
  y: number;
}

export class OrthogonalRouter implements ConnectorRouter {
  readonly kind: ConnectorKind = 'orthogonal';
  constructor(private readonly clearance = ROUTE_CLEARANCE) {}

  route(
    c: ConnectorModel,
    from: ShapeModel,
    to: ShapeModel,
    obstacles: readonly ShapeModel[],
  ): RouteResult {
    const { start, end, startSide, endSide } = resolveEndpoints(c, from, to);

    // Push the route a small "stub" out of each shape so it leaves on its side.
    const startStub = offsetAlong(start, startSide, this.clearance);
    const endStub = offsetAlong(end, endSide, this.clearance);

    // Obstacle rects = every shape except the two endpoints, inflated.
    const rects = obstacles
      .filter((o) => o.id !== from.id && o.id !== to.id)
      .map((o) => inflate(shapeRect(o), this.clearance));

    const path = aStarOrthogonal(startStub, endStub, rects);
    const full = path
      ? [start, startStub, ...path.slice(1, -1), endStub, end]
      : [start, startStub, ...elbowMid(startStub, endStub), endStub, end];

    return { points: simplifyPath(full), startPoint: start, endPoint: end };
  }
}

function elbowMid(a: Point, b: Point): Point[] {
  // fallback when pathfinding fails: a single mid bend
  return [{ x: b.x, y: a.y }];
}

function offsetAlong(p: Point, side: Side, d: number): Point {
  const n = sideNormal(side);
  return { x: p.x + n.x * d, y: p.y + n.y * d };
}

/**
 * A* over a sparse grid formed by the X/Y coordinates of interest (endpoints
 * plus the four edges of every obstacle, each padded). Movement is restricted
 * to axis-aligned hops between adjacent grid lines, and an edge is rejected if
 * it crosses any obstacle. Turn cost biases toward straighter paths.
 */
function aStarOrthogonal(
  start: Point,
  goal: Point,
  obstacles: readonly { x: number; y: number; width: number; height: number }[],
): Point[] | null {
  const xs = new Set<number>([start.x, goal.x]);
  const ys = new Set<number>([start.y, goal.y]);
  // Margin so grid lines sit just OUTSIDE each obstacle edge, opening a
  // navigable corridor around it (obstacles are already clearance-inflated).
  const M = 1;
  for (const r of obstacles) {
    xs.add(r.x - M);
    xs.add(r.x + r.width + M);
    ys.add(r.y - M);
    ys.add(r.y + r.height + M);
    // mid-lines help thread between obstacles
    xs.add(r.x + r.width / 2);
    ys.add(r.y + r.height / 2);
  }
  const xArr = [...xs].sort((a, b) => a - b);
  const yArr = [...ys].sort((a, b) => a - b);
  const xi = new Map(xArr.map((v, i) => [v, i]));
  const yi = new Map(yArr.map((v, i) => [v, i]));

  const key = (x: number, y: number): string => `${x},${y}`;
  const blocked = (a: Point, b: Point): boolean =>
    obstacles.some((r) => segmentIntersectsRect(a, b, r));
  const insideObstacle = (p: Point): boolean =>
    obstacles.some((r) => rectContains(r, p, -0.001));

  const startNode: GridNode = { x: start.x, y: start.y };
  const goalKey = key(goal.x, goal.y);

  const open: Array<{ node: GridNode; f: number }> = [
    { node: startNode, f: 0 },
  ];
  const cameFrom = new Map<string, GridNode>();
  const gScore = new Map<string, number>([[key(start.x, start.y), 0]]);
  const closed = new Set<string>();

  const h = (n: GridNode): number =>
    Math.abs(n.x - goal.x) + Math.abs(n.y - goal.y);

  let guard = 0;
  const GUARD_MAX = 20000;

  while (open.length > 0 && guard++ < GUARD_MAX) {
    open.sort((p, q) => p.f - q.f);
    const current = open.shift()!.node;
    const ck = key(current.x, current.y);
    if (ck === goalKey) return reconstruct(cameFrom, current);
    if (closed.has(ck)) continue;
    closed.add(ck);

    const cxIdx = xi.get(current.x);
    const cyIdx = yi.get(current.y);
    if (cxIdx === undefined || cyIdx === undefined) continue;

    // Neighbors: step to adjacent grid lines in 4 directions.
    const neighbors: Point[] = [];
    if (cxIdx + 1 < xArr.length) neighbors.push({ x: xArr[cxIdx + 1]!, y: current.y });
    if (cxIdx - 1 >= 0) neighbors.push({ x: xArr[cxIdx - 1]!, y: current.y });
    if (cyIdx + 1 < yArr.length) neighbors.push({ x: current.x, y: yArr[cyIdx + 1]! });
    if (cyIdx - 1 >= 0) neighbors.push({ x: current.x, y: yArr[cyIdx - 1]! });

    for (const nb of neighbors) {
      if (insideObstacle(nb)) continue;
      if (blocked(current, nb)) continue;
      const nk = key(nb.x, nb.y);
      if (closed.has(nk)) continue;
      const stepCost = Math.abs(nb.x - current.x) + Math.abs(nb.y - current.y);
      // Turn penalty: discourage zig-zag.
      const prev = cameFrom.get(ck);
      let turn = 0;
      if (prev) {
        const wasH = Math.abs(prev.y - current.y) < 1e-6;
        const isH = Math.abs(current.y - nb.y) < 1e-6;
        if (wasH !== isH) turn = 10;
      }
      const tentative = (gScore.get(ck) ?? Infinity) + stepCost + turn;
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, current);
        gScore.set(nk, tentative);
        open.push({ node: nb, f: tentative + h(nb) });
      }
    }
  }
  return null;
}

function reconstruct(cameFrom: Map<string, GridNode>, end: GridNode): Point[] {
  const path: Point[] = [end];
  let cur = end;
  let k = `${cur.x},${cur.y}`;
  const seen = new Set<string>();
  while (cameFrom.has(k) && !seen.has(k)) {
    seen.add(k);
    cur = cameFrom.get(k)!;
    path.unshift(cur);
    k = `${cur.x},${cur.y}`;
  }
  return path;
}

/* ── Arrowheads ───────────────────────────────────────────────────────────── */

/** Geometry for an arrowhead glyph, ready for the renderer. */
export interface ArrowGeometry {
  head: ArrowHead;
  /** Tip point (on the shape perimeter). */
  tip: Point;
  /** The two barb points (for `arrow`/`open`/`triangle`). */
  left: Point;
  right: Point;
  /** Polygon points (closed glyphs: triangle/diamond). */
  polygon: Point[];
  /** Unit direction the head points along (into the tip). */
  dir: Point;
}

/**
 * Build arrowhead geometry at `tip`, pointing along the segment from `prev` to
 * `tip`. `size` is the glyph length in model units.
 */
export function arrowGeometry(
  head: ArrowHead,
  tip: Point,
  prev: Point,
  size = 10,
): ArrowGeometry {
  let dx = tip.x - prev.x;
  let dy = tip.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  // perpendicular
  const px = -dy;
  const py = dx;
  const back = { x: tip.x - dx * size, y: tip.y - dy * size };
  const half = size * 0.45;
  const left = { x: back.x + px * half, y: back.y + py * half };
  const right = { x: back.x - px * half, y: back.y - py * half };

  let polygon: Point[];
  switch (head) {
    case 'triangle':
    case 'arrow':
    case 'open':
      polygon = [tip, left, right];
      break;
    case 'diamond': {
      const farther = { x: tip.x - dx * size * 2, y: tip.y - dy * size * 2 };
      polygon = [tip, left, farther, right];
      break;
    }
    case 'circle': {
      // approximate circle by an octagon centered at `back`.
      polygon = octagon(back, size * 0.5);
      break;
    }
    default:
      polygon = [];
  }
  return { head, tip, left, right, polygon, dir: { x: dx, y: dy } };
}

function octagon(center: Point, r: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    pts.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
  }
  return pts;
}

/* ── Router registry helper ──────────────────────────────────────────────── */

/** Construct the built-in router set keyed by kind. */
export function builtinRouters(clearance = ROUTE_CLEARANCE): ConnectorRouter[] {
  return [
    new StraightRouter(),
    new ElbowRouter(),
    new OrthogonalRouter(clearance),
    new CurvedRouter(),
  ];
}
