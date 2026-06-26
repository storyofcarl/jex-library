/**
 * Dependency-line rendering: orthogonal SVG connectors between event bars.
 *
 * Implements the contract's `DependencyRouter` over the four classic precedence
 * link types, expressed via the `fromSide`/`toSide` terminals on each
 * `DependencyLink`:
 *
 *   FS (finish→start)  fromSide:'end'   toSide:'start'   (the default)
 *   SS (start→start)   fromSide:'start' toSide:'start'
 *   FF (finish→finish) fromSide:'end'   toSide:'end'
 *   SF (start→finish)  fromSide:'start' toSide:'end'
 *
 * Routing is pure geometry against laid-out `EventBar`s + the `TimeAxis`; it
 * produces orthogonal waypoints and a ready-to-paint SVG `path` `d` string. An
 * arrowhead marker path is provided separately so the renderer can draw it at
 * the target terminal without re-deriving the approach direction.
 */

import type { RecordId, Model } from '@jects/core';
import type {
  TimeAxis,
  DependencyLink,
  DependencyLine,
  DependencyRouter,
  DependencyTerminal,
  EventBar,
} from '../contract.js';
import { terminalPoint, type Point } from './positioning.js';

/** Tuning for the orthogonal router. */
export interface OrthogonalRouterOptions {
  /** Minimum horizontal stub off a terminal before the line turns. Default 12. */
  stub?: number;
  /** Arrowhead length in px. Default 7. */
  arrowSize?: number;
  /**
   * Map a `rowId` to the absolute top (content y) of its row. Without it lines
   * are routed in row-local coordinates (every row at y origin 0), which is only
   * correct for single-row scenarios — supply it for a real multi-row timeline.
   */
  rowOffsets?: ReadonlyMap<RecordId, number>;
}

/** Default terminals per the FS convention when a link omits them. */
function fromSideOf(link: DependencyLink): DependencyTerminal {
  return link.fromSide ?? 'end';
}
function toSideOf(link: DependencyLink): DependencyTerminal {
  return link.toSide ?? 'start';
}

/** The sign a terminal stub extends in (start exits left, end exits right). */
function dirOf(side: DependencyTerminal): -1 | 1 {
  return side === 'end' ? 1 : -1;
}

/**
 * Build orthogonal waypoints between two terminal points. The line leaves each
 * terminal along its natural horizontal direction (a `stub`), then routes with
 * right angles. The classic shapes:
 *   - forward (target reachable ahead): a single mid-x vertical jog.
 *   - backward (target behind the source): route out, around, and back in.
 */
export function routeWaypoints(
  from: Point,
  fromDir: -1 | 1,
  to: Point,
  toDir: -1 | 1,
  stub: number,
): Point[] {
  const ax = from.x + fromDir * stub;
  const bx = to.x + toDir * stub;
  const pts: Point[] = [from, { x: ax, y: from.y }];

  // Can we route straight forward? Source stub end is "before" the target stub
  // end along both their exit directions.
  const forward = fromDir === 1 ? ax <= bx : ax >= bx;

  if (forward && fromDir !== toDir) {
    // Mid-x vertical jog (the common FS L/Z shape).
    const midX = (ax + bx) / 2;
    pts.push({ x: midX, y: from.y });
    pts.push({ x: midX, y: to.y });
    pts.push({ x: bx, y: to.y });
  } else {
    // Route out, vertically to a midpoint between the rows, across, then in.
    const midY = (from.y + to.y) / 2;
    pts.push({ x: ax, y: midY });
    pts.push({ x: bx, y: midY });
    pts.push({ x: bx, y: to.y });
  }

  pts.push({ x: to.x, y: to.y });
  return dedupe(pts);
}

/** Drop consecutive duplicate points (collinear cleanup for tidy paths). */
function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

/** Serialize a polyline of points to an SVG path `d` string. */
export function toPath(points: ReadonlyArray<Point>): string {
  if (points.length === 0) return '';
  let d = `M ${fmt(points[0]!.x)} ${fmt(points[0]!.y)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${fmt(points[i]!.x)} ${fmt(points[i]!.y)}`;
  }
  return d;
}

function fmt(n: number): string {
  // Round to 0.01px to keep paths compact and deterministic across runs.
  return String(Math.round(n * 100) / 100);
}

/**
 * Arrowhead path (a filled triangle `d` string) at the target point, opening
 * back toward the incoming segment. `approachDir` is the x-direction the line
 * travels as it arrives (the target terminal's stub direction, negated).
 */
export function arrowheadPath(tip: Point, approachDir: -1 | 1, size = 7): string {
  // The line arrives traveling toward the tip; the arrow points the same way.
  // For a target 'start' terminal (toDir -1) the line arrives heading +x.
  const heading = -approachDir; // travel direction into the tip
  const baseX = tip.x - heading * size;
  const half = size * 0.6;
  return (
    `M ${fmt(tip.x)} ${fmt(tip.y)} ` +
    `L ${fmt(baseX)} ${fmt(tip.y - half)} ` +
    `L ${fmt(baseX)} ${fmt(tip.y + half)} Z`
  );
}

/**
 * Default orthogonal dependency router. Routes every visible link whose two
 * endpoints are present in the supplied bar map; links touching an off-screen /
 * unlaid-out bar are skipped (the renderer simply won't draw them).
 */
export class OrthogonalDependencyRouter<E extends Model = Model>
  implements DependencyRouter<E>
{
  private readonly stub: number;
  private readonly arrowSize: number;
  private readonly rowOffsets: ReadonlyMap<RecordId, number> | undefined;

  constructor(options: OrthogonalRouterOptions = {}) {
    this.stub = options.stub ?? 12;
    this.arrowSize = options.arrowSize ?? 7;
    this.rowOffsets = options.rowOffsets;
  }

  route(input: {
    links: ReadonlyArray<DependencyLink>;
    bars: ReadonlyMap<RecordId, EventBar<E>>;
    axis: TimeAxis;
  }): DependencyLine[] {
    const { links, bars, axis } = input;
    const out: DependencyLine[] = [];
    for (const link of links) {
      const line = this.routeOne(link, bars, axis);
      if (line) out.push(line);
    }
    return out;
  }

  /** Route a single link, or `undefined` if an endpoint bar is missing. */
  routeOne(
    link: DependencyLink,
    bars: ReadonlyMap<RecordId, EventBar<E>>,
    axis: TimeAxis,
  ): DependencyLine | undefined {
    const fromBar = bars.get(link.fromId);
    const toBar = bars.get(link.toId);
    if (!fromBar || !toBar) return undefined;

    const fromSide = fromSideOf(link);
    const toSide = toSideOf(link);
    const fromOff = this.rowOffsets?.get(fromBar.event.rowId) ?? 0;
    const toOff = this.rowOffsets?.get(toBar.event.rowId) ?? 0;

    const from = terminalPoint(axis, fromBar, fromSide, fromOff);
    const to = terminalPoint(axis, toBar, toSide, toOff);
    const fromDir = dirOf(fromSide);
    const toDir = dirOf(toSide);

    const waypoints = routeWaypoints(from, fromDir, to, toDir, this.stub);
    return {
      link,
      from,
      to,
      waypoints: waypoints.slice(1, -1),
      path: toPath(waypoints),
    };
  }

  /** Arrowhead `d` for a routed line (target terminal). */
  arrowFor(line: DependencyLine): string {
    const toSide = toSideOf(line.link);
    return arrowheadPath(line.to, dirOf(toSide), this.arrowSize);
  }
}
