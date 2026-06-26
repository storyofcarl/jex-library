/**
 * Auto-layout — pure positioning passes producing a {@link LayoutResult} patch
 * the engine applies transactionally.
 *
 * Built-in layouts (contract {@link LayoutKind}):
 *   - `orthogonal` — a layered tree/flow layout (Reingold–Tilford-style tidy
 *     tree) honoring a flow {@link LayoutDirection} (down/up/right/left). Used
 *     for flowcharts, org-charts, and PERT networks.
 *   - `radial`     — a hub-and-spoke layout placing the root at the origin and
 *     descendants on concentric rings by depth. Used for mind-maps.
 *
 * {@link layoutForMode} maps each {@link DiagramMode} to its default layout kind
 * + option biases, encoding the per-mode layout rules:
 *   - flowchart → orthogonal, direction `down`
 *   - orgchart  → orthogonal, direction `down`, tighter ranks
 *   - mindmap   → radial
 *   - pert      → orthogonal, direction `right` (left-to-right network)
 */

import type {
  AutoLayout,
  AutoLayoutOptions,
  LayoutResult,
  LayoutKind,
  LayoutDirection,
  DiagramMode,
  ShapeModel,
  ConnectorModel,
  DiagramId,
  Point,
  Rect,
} from '../contract.js';
import { unionRects } from './geometry.js';

const DEFAULT_NODE_SPACING = 40;
const DEFAULT_RANK_SPACING = 80;

/* ── Graph helpers ────────────────────────────────────────────────────────── */

interface TreeNode {
  id: DiagramId;
  shape: ShapeModel;
  children: TreeNode[];
  parent: TreeNode | null;
  /** prelim x (in-rank coordinate), mod (subtree shift), final coords. */
  prelim: number;
  mod: number;
  depth: number;
  /** measured extent in the in-rank axis. */
  size: number;
}

/**
 * Build a forest from shapes + connectors. A node's parent is the source of the
 * first connector that targets it; nodes with no incoming edge are roots.
 */
interface Forest {
  roots: TreeNode[];
  /** Ids of shapes that participate in at least one connector. */
  connected: Set<DiagramId>;
}

function buildForest(
  shapes: readonly ShapeModel[],
  connectors: readonly ConnectorModel[],
  rankAxisSize: (s: ShapeModel) => number,
): Forest {
  const byId = new Map<DiagramId, TreeNode>();
  for (const s of shapes) {
    byId.set(s.id, {
      id: s.id,
      shape: s,
      children: [],
      parent: null,
      prelim: 0,
      mod: 0,
      depth: 0,
      size: rankAxisSize(s),
    });
  }
  const hasParent = new Set<DiagramId>();
  const connected = new Set<DiagramId>();
  // Preserve connector order for stable child ordering.
  for (const c of connectors) {
    const parent = byId.get(c.from.shape);
    const child = byId.get(c.to.shape);
    if (!parent || !child) continue;
    connected.add(parent.id);
    connected.add(child.id);
    if (child === parent) continue;
    if (hasParent.has(child.id)) continue; // first edge wins (tree-ify)
    // avoid cycles: don't attach if child is an ancestor of parent
    if (isAncestor(child, parent)) continue;
    child.parent = parent;
    parent.children.push(child);
    hasParent.add(child.id);
  }
  // Roots are connected nodes with no parent. Edge-less (isolated) nodes are
  // NOT laid out — they keep their original position.
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (!node.parent && connected.has(node.id)) roots.push(node);
  }
  // Stable root order = shape order.
  const order = new Map(shapes.map((s, i) => [s.id, i]));
  roots.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { roots, connected };
}

function isAncestor(maybe: TreeNode, node: TreeNode): boolean {
  let cur: TreeNode | null = node;
  while (cur) {
    if (cur === maybe) return true;
    cur = cur.parent;
  }
  return false;
}

function assignDepth(node: TreeNode, depth: number): void {
  node.depth = depth;
  for (const ch of node.children) assignDepth(ch, depth + 1);
}

/* ── Tidy-tree (Reingold–Tilford) ─────────────────────────────────────────── */

/**
 * First walk (post-order). Assigns each node a `prelim` (in-rank coordinate
 * RELATIVE to its parent) and a `mod` (the amount every descendant of this node
 * must be shifted in the second walk). Two passes per node:
 *
 *   1. Lay children out left-to-right by their measured `size` + `gap`, each
 *      child centered on its own (already-resolved) subtree.
 *   2. Center the parent over the span of its children. The offset needed to
 *      move the *block of children* under that center is recorded as the
 *      parent's `mod`, NOT baked into each child's prelim — so descendants stay
 *      addressable relative to their parent and the shift propagates correctly
 *      to ARBITRARY depth in {@link secondWalk}. Sibling-subtree overlaps are
 *      then pushed apart via contour comparison, again accumulating into `mod`.
 */
function firstWalk(node: TreeNode, gap: number): void {
  node.mod = 0;
  if (node.children.length === 0) {
    node.prelim = 0;
    return;
  }
  // 1. Place children side by side. firstWalk(child) leaves child.prelim as the
  //    center of child's OWN subtree (in the grandchild-local frame). We move
  //    the child into THIS node's frame at `cursor + size/2`, and record the
  //    delta as child.mod so the second walk translates every grandchild by the
  //    same amount — the mod accumulation the old code omitted entirely.
  let cursor = 0;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]!;
    firstWalk(child, gap);
    const ownCenter = child.prelim; // center within child's own subtree frame
    const placed = cursor + child.size / 2;
    child.prelim = placed;
    child.mod = placed - ownCenter;
    cursor += child.size + gap;
    // 2. Push this child's whole subtree clear of its left siblings, comparing
    //    real subtree contours (mod included), not just node.size.
    if (i > 0) {
      const leftMax = subtreeRight(node.children[i - 1]!, 0);
      const thisMin = subtreeLeft(child, 0);
      const overlap = leftMax + gap - thisMin;
      if (overlap > 0) {
        // Slide the whole subtree right: prelim moves the node, mod carries its
        // descendants, so the shift propagates to ARBITRARY depth.
        child.prelim += overlap;
        child.mod += overlap;
        cursor += overlap;
      }
    }
  }
  // 3. Center this node over its children (all now in this node's frame, so
  //    node.mod stays 0 — node and its children share one coordinate frame).
  const first = node.children[0]!;
  const last = node.children[node.children.length - 1]!;
  node.prelim = (first.prelim + last.prelim) / 2;
}

/**
 * Second walk (pre-order). Converts relative prelim + accumulated `mod` into an
 * absolute in-rank coordinate. Each level adds its ancestors' mods, so a shift
 * applied at any depth flows down to every descendant.
 */
function secondWalk(node: TreeNode, modSum: number, out: Map<DiagramId, number>): void {
  out.set(node.id, node.prelim + modSum);
  for (const child of node.children) {
    secondWalk(child, modSum + node.mod, out);
  }
}

/**
 * Left edge of `node`'s subtree contour. `modSum` is the mod accumulated from
 * ancestors above `node`; the node sits at `prelim + modSum`, and each child
 * additionally accumulates `node.mod`.
 */
function subtreeLeft(node: TreeNode, modSum: number): number {
  let min = node.prelim + modSum - node.size / 2;
  for (const ch of node.children) {
    const childMin = subtreeLeft(ch, modSum + node.mod);
    if (childMin < min) min = childMin;
  }
  return min;
}

/** Right edge of `node`'s subtree contour (see {@link subtreeLeft}). */
function subtreeRight(node: TreeNode, modSum: number): number {
  let max = node.prelim + modSum + node.size / 2;
  for (const ch of node.children) {
    const childMax = subtreeRight(ch, modSum + node.mod);
    if (childMax > max) max = childMax;
  }
  return max;
}

/* ── Orthogonal (layered tree) layout ─────────────────────────────────────── */

export class OrthogonalLayout implements AutoLayout {
  readonly kind: LayoutKind = 'orthogonal';

  apply(
    shapes: readonly ShapeModel[],
    connectors: readonly ConnectorModel[],
    options: AutoLayoutOptions,
  ): LayoutResult {
    const nodeSpacing = options.nodeSpacing ?? DEFAULT_NODE_SPACING;
    const rankSpacing = options.rankSpacing ?? DEFAULT_RANK_SPACING;
    const dir = options.direction ?? 'down';
    const origin = options.origin ?? { x: 0, y: 0 };
    const vertical = dir === 'down' || dir === 'up';

    // In-rank axis = the axis perpendicular to flow.
    const inRankSize = (s: ShapeModel): number => (vertical ? s.w : s.h);
    const rankSize = (s: ShapeModel): number => (vertical ? s.h : s.w);

    const { roots } = buildForest(shapes, connectors, inRankSize);

    const positions = new Map<DiagramId, Point>();
    const inRankCoord = new Map<DiagramId, number>();
    const allNodes: TreeNode[] = [];

    let forestOffset = 0;
    for (const root of roots) {
      assignDepth(root, 0);
      firstWalk(root, nodeSpacing);
      const out = new Map<DiagramId, number>();
      secondWalk(root, 0, out);
      // Normalize this tree to start at 0, then offset by accumulated width.
      let min = Infinity;
      let max = -Infinity;
      for (const v of out.values()) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (!isFinite(min)) {
        min = 0;
        max = 0;
      }
      for (const [id, v] of out) {
        inRankCoord.set(id, v - min + forestOffset);
      }
      forestOffset += max - min + nodeSpacing * 2;
      collect(root, allNodes);
    }

    // Compute rank (flow-axis) coordinate from depth, accounting for rank size.
    const maxDepth = allNodes.reduce((m, n) => Math.max(m, n.depth), 0);
    const rankExtent: number[] = new Array(maxDepth + 1).fill(0);
    for (const n of allNodes) {
      rankExtent[n.depth] = Math.max(rankExtent[n.depth]!, rankSize(n.shape));
    }
    const rankStart: number[] = new Array(maxDepth + 1).fill(0);
    for (let d = 1; d <= maxDepth; d++) {
      rankStart[d] = rankStart[d - 1]! + rankExtent[d - 1]! + rankSpacing;
    }

    for (const n of allNodes) {
      const cross = inRankCoord.get(n.id) ?? 0;
      const along = rankStart[n.depth]!;
      let x: number;
      let y: number;
      if (vertical) {
        x = origin.x + cross - n.shape.w / 2;
        y = dir === 'down' ? origin.y + along : origin.y - along - n.shape.h;
      } else {
        y = origin.y + cross - n.shape.h / 2;
        x = dir === 'right' ? origin.x + along : origin.x - along - n.shape.w;
      }
      positions.set(n.id, { x, y });
    }

    // Shapes not in any tree (isolated) keep their position.
    for (const s of shapes) {
      if (!positions.has(s.id)) positions.set(s.id, { x: s.x, y: s.y });
    }

    const bounds = boundsFromPositions(shapes, positions);
    return { positions, bounds };
  }
}

function collect(node: TreeNode, out: TreeNode[]): void {
  out.push(node);
  for (const ch of node.children) collect(ch, out);
}

/* ── Radial layout (mind-map / hub-and-spoke) ─────────────────────────────── */

export class RadialLayout implements AutoLayout {
  readonly kind: LayoutKind = 'radial';

  apply(
    shapes: readonly ShapeModel[],
    connectors: readonly ConnectorModel[],
    options: AutoLayoutOptions,
  ): LayoutResult {
    const rankSpacing = options.rankSpacing ?? 140;
    const origin = options.origin ?? { x: 0, y: 0 };

    const { roots } = buildForest(shapes, connectors, (s) => Math.max(s.w, s.h));
    const positions = new Map<DiagramId, Point>();

    // Use the first root as the hub; lay remaining roots as extra spokes.
    const primary = roots[0];
    if (!primary) {
      for (const s of shapes) positions.set(s.id, { x: s.x, y: s.y });
      return { positions, bounds: boundsFromPositions(shapes, positions) };
    }

    assignDepth(primary, 0);

    // Count leaves per subtree to allocate angular wedges.
    const leafCount = new Map<DiagramId, number>();
    const countLeaves = (n: TreeNode): number => {
      if (n.children.length === 0) {
        leafCount.set(n.id, 1);
        return 1;
      }
      let sum = 0;
      for (const ch of n.children) sum += countLeaves(ch);
      leafCount.set(n.id, sum);
      return sum;
    };
    countLeaves(primary);

    // Place hub at origin.
    positions.set(primary.id, {
      x: origin.x - primary.shape.w / 2,
      y: origin.y - primary.shape.h / 2,
    });

    // Recursive angular assignment.
    const place = (
      node: TreeNode,
      startAngle: number,
      endAngle: number,
    ): void => {
      const total = leafCount.get(node.id) ?? 1;
      let a = startAngle;
      for (const child of node.children) {
        const frac = (leafCount.get(child.id) ?? 1) / total;
        const childStart = a;
        const childEnd = a + (endAngle - startAngle) * frac;
        const mid = (childStart + childEnd) / 2;
        const radius = rankSpacing * (child.depth);
        const cx = origin.x + radius * Math.cos(mid);
        const cy = origin.y + radius * Math.sin(mid);
        positions.set(child.id, {
          x: cx - child.shape.w / 2,
          y: cy - child.shape.h / 2,
        });
        place(child, childStart, childEnd);
        a = childEnd;
      }
    };
    place(primary, 0, Math.PI * 2);

    // Remaining roots: stack to the right so they don't collide with the hub.
    let extraY = origin.y;
    for (let i = 1; i < roots.length; i++) {
      const r = roots[i]!;
      positions.set(r.id, { x: origin.x + rankSpacing * 2, y: extraY });
      extraY += r.shape.h + 40;
    }

    for (const s of shapes) {
      if (!positions.has(s.id)) positions.set(s.id, { x: s.x, y: s.y });
    }

    return { positions, bounds: boundsFromPositions(shapes, positions) };
  }
}

/* ── Bounds + mode mapping ────────────────────────────────────────────────── */

function boundsFromPositions(
  shapes: readonly ShapeModel[],
  positions: Map<DiagramId, Point>,
): Rect {
  const rects: Rect[] = shapes.map((s) => {
    const p = positions.get(s.id) ?? { x: s.x, y: s.y };
    return { x: p.x, y: p.y, width: s.w, height: s.h };
  });
  return unionRects(rects);
}

/** Per-mode default layout kind + option biases. */
export function layoutForMode(mode: DiagramMode): {
  kind: LayoutKind;
  options: AutoLayoutOptions;
} {
  switch (mode) {
    case 'flowchart':
      return { kind: 'orthogonal', options: { direction: 'down' } };
    case 'orgchart':
      return {
        kind: 'orthogonal',
        options: { direction: 'down', rankSpacing: 60, nodeSpacing: 32 },
      };
    case 'mindmap':
      return { kind: 'radial', options: { rankSpacing: 140 } };
    case 'pert':
      return {
        kind: 'orthogonal',
        options: { direction: 'right', rankSpacing: 100, nodeSpacing: 40 },
      };
  }
}

/** Construct the built-in layout set. */
export function builtinLayouts(): AutoLayout[] {
  return [new OrthogonalLayout(), new RadialLayout()];
}

/** Resolve a flow direction's perpendicular axis flag. */
export function isVertical(dir: LayoutDirection): boolean {
  return dir === 'down' || dir === 'up';
}
