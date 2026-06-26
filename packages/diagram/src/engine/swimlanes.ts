/**
 * Swimlane model helpers — pure utilities over the lane partition.
 *
 * Lanes partition the canvas; a shape "belongs" to the lane whose box contains
 * its center (unless it carries an explicit `lane` id). Lanes may nest via
 * `parent`; nested lanes are resolved innermost-first.
 */

import type {
  SwimlaneModel,
  ShapeModel,
  DiagramId,
  Point,
  Rect,
} from '../contract.js';
import { rectContains } from './geometry.js';

/** The rect of a lane. */
export function laneRect(l: SwimlaneModel): Rect {
  return { x: l.x, y: l.y, width: l.w, height: l.h };
}

/** Center of a shape (model coords). */
export function shapeCenter(s: ShapeModel): Point {
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
}

/**
 * Resolve the lane a shape belongs to: explicit `shape.lane` wins; otherwise
 * the smallest-area lane whose box contains the shape center (innermost when
 * nested). Returns undefined when no lane contains it.
 */
export function laneOf(
  shape: ShapeModel,
  lanes: readonly SwimlaneModel[],
): SwimlaneModel | undefined {
  if (shape.lane) {
    const explicit = lanes.find((l) => l.id === shape.lane);
    if (explicit) return explicit;
  }
  const c = shapeCenter(shape);
  let best: SwimlaneModel | undefined;
  let bestArea = Infinity;
  for (const l of lanes) {
    if (rectContains(laneRect(l), c)) {
      const area = l.w * l.h;
      if (area < bestArea) {
        best = l;
        bestArea = area;
      }
    }
  }
  return best;
}

/** All shapes whose membership resolves to `laneId`. */
export function shapesInLane(
  laneId: DiagramId,
  shapes: readonly ShapeModel[],
  lanes: readonly SwimlaneModel[],
): ShapeModel[] {
  return shapes.filter((s) => laneOf(s, lanes)?.id === laneId);
}

/** Direct child lanes of a pool/lane (by `parent`), in `order`. */
export function childLanes(
  parentId: DiagramId,
  lanes: readonly SwimlaneModel[],
): SwimlaneModel[] {
  return lanes
    .filter((l) => l.parent === parentId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Top-level lanes (no parent), in `order`. */
export function rootLanes(lanes: readonly SwimlaneModel[]): SwimlaneModel[] {
  return lanes
    .filter((l) => l.parent == null)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Re-flow a shape's position so it sits within its assigned lane, clamping the
 * shape box inside the lane rect with `pad`. Returns a position patch (or null
 * if already inside / no lane).
 */
export function clampToLane(
  shape: ShapeModel,
  lanes: readonly SwimlaneModel[],
  pad = 4,
): Point | null {
  const lane = laneOf(shape, lanes);
  if (!lane) return null;
  const minX = lane.x + pad;
  const minY = lane.y + pad;
  const maxX = lane.x + lane.w - shape.w - pad;
  const maxY = lane.y + lane.h - shape.h - pad;
  const x = Math.max(minX, Math.min(shape.x, Math.max(minX, maxX)));
  const y = Math.max(minY, Math.min(shape.y, Math.max(minY, maxY)));
  if (x === shape.x && y === shape.y) return null;
  return { x, y };
}
