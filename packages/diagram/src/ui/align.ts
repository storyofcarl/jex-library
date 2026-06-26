/**
 * Alignment, distribution, and snap-guide computation for the Diagram UI. Pure
 * functions over {@link ShapeModel}s; each returns a position patch keyed by
 * shape id which the widget applies through the engine. Connector waypoints are
 * left to the engine's `routeAll` after positions change.
 */
import type { DiagramId, Point, ShapeModel } from '../contract.js';
import type { SnapLine } from './renderer.js';

export type AlignEdge =
  | 'left'
  | 'center-x'
  | 'right'
  | 'top'
  | 'center-y'
  | 'bottom';

export type DistributeAxis = 'horizontal' | 'vertical';

/** Align a set of shapes to a shared edge/center; returns a position patch. */
export function alignShapes(
  shapes: readonly ShapeModel[],
  edge: AlignEdge,
): Map<DiagramId, Point> {
  const patch = new Map<DiagramId, Point>();
  if (shapes.length < 2) return patch;
  const lefts = shapes.map((s) => s.x);
  const rights = shapes.map((s) => s.x + s.w);
  const tops = shapes.map((s) => s.y);
  const bottoms = shapes.map((s) => s.y + s.h);
  const minLeft = Math.min(...lefts);
  const maxRight = Math.max(...rights);
  const minTop = Math.min(...tops);
  const maxBottom = Math.max(...bottoms);
  const cx = (minLeft + maxRight) / 2;
  const cy = (minTop + maxBottom) / 2;

  for (const s of shapes) {
    let { x, y } = s;
    switch (edge) {
      case 'left':
        x = minLeft;
        break;
      case 'right':
        x = maxRight - s.w;
        break;
      case 'center-x':
        x = cx - s.w / 2;
        break;
      case 'top':
        y = minTop;
        break;
      case 'bottom':
        y = maxBottom - s.h;
        break;
      case 'center-y':
        y = cy - s.h / 2;
        break;
    }
    patch.set(s.id, { x, y });
  }
  return patch;
}

/**
 * Distribute shapes so the gaps between them are equal along an axis. Requires
 * >=3 shapes; the two extremes stay put and the inner shapes are spaced evenly.
 */
export function distributeShapes(
  shapes: readonly ShapeModel[],
  axis: DistributeAxis,
): Map<DiagramId, Point> {
  const patch = new Map<DiagramId, Point>();
  if (shapes.length < 3) return patch;
  const horizontal = axis === 'horizontal';
  const sorted = [...shapes].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
  const sizeOf = (s: ShapeModel): number => (horizontal ? s.w : s.h);
  const startOf = (s: ShapeModel): number => (horizontal ? s.x : s.y);

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const span = startOf(last) - (startOf(first) + sizeOf(first));
  const totalInner = sorted
    .slice(1, -1)
    .reduce((sum, s) => sum + sizeOf(s), 0);
  const gap = (span - totalInner) / (sorted.length - 1);

  let cursor = startOf(first) + sizeOf(first) + gap;
  for (let i = 1; i < sorted.length - 1; i++) {
    const s = sorted[i]!;
    patch.set(s.id, horizontal ? { x: cursor, y: s.y } : { x: s.x, y: cursor });
    cursor += sizeOf(s) + gap;
  }
  return patch;
}

/**
 * Compute snap guide lines for a shape being dragged to `proposed` position,
 * matching its edges/center against the other shapes' edges/centers within
 * `threshold` px. Returns the (possibly snapped) position and the guide lines.
 */
export function computeSnap(
  moving: ShapeModel,
  proposed: Point,
  others: readonly ShapeModel[],
  threshold = 6,
): { position: Point; lines: SnapLine[] } {
  const lines: SnapLine[] = [];
  let { x, y } = proposed;

  const movingVEdges = [x, x + moving.w / 2, x + moving.w];
  const movingHEdges = [y, y + moving.h / 2, y + moving.h];

  let bestVDelta = Infinity;
  let bestVPos = 0;
  let bestHDelta = Infinity;
  let bestHPos = 0;

  for (const o of others) {
    if (o.id === moving.id) continue;
    const oV = [o.x, o.x + o.w / 2, o.x + o.w];
    const oH = [o.y, o.y + o.h / 2, o.y + o.h];
    for (const me of movingVEdges) {
      for (const ot of oV) {
        const d = Math.abs(me - ot);
        if (d <= threshold && d < bestVDelta) {
          bestVDelta = d;
          bestVPos = ot;
          // Shift x so this edge aligns.
          x = proposed.x + (ot - me);
        }
      }
    }
    for (const me of movingHEdges) {
      for (const ot of oH) {
        const d = Math.abs(me - ot);
        if (d <= threshold && d < bestHDelta) {
          bestHDelta = d;
          bestHPos = ot;
          y = proposed.y + (ot - me);
        }
      }
    }
  }

  if (bestVDelta <= threshold) lines.push({ orientation: 'v', pos: bestVPos });
  if (bestHDelta <= threshold) lines.push({ orientation: 'h', pos: bestHPos });
  return { position: { x, y }, lines };
}
