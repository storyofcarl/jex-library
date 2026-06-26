/**
 * Hit-testing — resolve which model element a query point lands on.
 *
 * Precedence (topmost wins): ports → shapes → connectors → swimlanes → none.
 * Ports take priority over their shapes so endpoint dragging works; shapes
 * (higher `z` first) beat connectors; swimlanes are the lowest backdrop.
 *
 * Pure and DOM-free: takes plain model arrays + a point, returns a
 * {@link HitResult}.
 */

import type {
  ShapeModel,
  ConnectorModel,
  SwimlaneModel,
  Point,
  HitResult,
  DiagramId,
} from '../contract.js';
import {
  shapeRect,
  rectContains,
  distToPolyline,
  dist,
} from './geometry.js';
import { resolvePorts, portPoint, shapeOutline } from './shapes.js';

/** Default pixel tolerance (model units) for thin connectors / port grabs. */
export const HIT_TOLERANCE = 6;
const PORT_RADIUS = 6;

export interface HitTestInput {
  shapes: readonly ShapeModel[];
  connectors: readonly ConnectorModel[];
  swimlanes: readonly SwimlaneModel[];
  /** Cached routed waypoints by connector id (for accurate connector hits). */
  routes?: Map<DiagramId, Point[]>;
}

/** Z-descending sort key (higher z renders on top → tested first). */
function byZDesc<T extends { z?: number }>(a: T, b: T): number {
  return (b.z ?? 0) - (a.z ?? 0);
}

/**
 * Resolve the topmost element under `point`. `tolerance` widens connector and
 * port hit areas.
 */
export function hitTest(
  input: HitTestInput,
  point: Point,
  tolerance = HIT_TOLERANCE,
): HitResult {
  // 1. Ports (only on shapes whose box is near the point).
  for (const shape of [...input.shapes].sort(byZDesc)) {
    if (!rectContains(shapeRect(shape), point, PORT_RADIUS + tolerance)) continue;
    for (const port of resolvePorts(shape)) {
      const pp = portPoint(shape, port);
      const d = dist(point, pp);
      if (d <= PORT_RADIUS + tolerance) {
        return { kind: 'port', id: port.id, shape: shape.id, port: port.id, distance: d };
      }
    }
  }

  // 2. Shapes (topmost z first). Use the box; for non-rect outlines this is a
  //    conservative bounding-box test, which is the standard pick heuristic.
  for (const shape of [...input.shapes].sort(byZDesc)) {
    const r = shapeRect(shape);
    if (rectContains(r, point)) {
      // Refine for clearly non-filled `text` shapes only when far from edges:
      // bounding-box hit is acceptable and matches editor expectations.
      void shapeOutline; // outline available to renderers; bbox pick here.
      return { kind: 'shape', id: shape.id, distance: 0 };
    }
  }

  // 3. Connectors (topmost z first) — distance to routed polyline.
  let bestConnector: { id: DiagramId; d: number } | null = null;
  for (const c of [...input.connectors].sort(byZDesc)) {
    const pts = input.routes?.get(c.id) ?? c.points;
    if (!pts || pts.length < 2) continue;
    const d = distToPolyline(point, pts);
    if (d <= tolerance && (!bestConnector || d < bestConnector.d)) {
      bestConnector = { id: c.id, d };
    }
  }
  if (bestConnector) {
    return { kind: 'connector', id: bestConnector.id, distance: bestConnector.d };
  }

  // 4. Swimlanes (innermost / smallest-area first so nested lanes win).
  const lanes = [...input.swimlanes].sort(
    (a, b) => a.w * a.h - b.w * b.h,
  );
  for (const lane of lanes) {
    if (rectContains({ x: lane.x, y: lane.y, width: lane.w, height: lane.h }, point)) {
      return { kind: 'swimlane', id: lane.id, distance: 0 };
    }
  }

  return { kind: 'none' };
}
