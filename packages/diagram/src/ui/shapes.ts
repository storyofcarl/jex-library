/**
 * SVG geometry for the Diagram UI: per-{@link ShapeType} outline generators and
 * connector path builders. Everything is pure (no DOM) and returns SVG path /
 * attribute data so the renderer can serialize it for both live display and
 * export. Colors are NOT emitted here — styling is applied via CSS classes and
 * token-derived CSS variables in the renderer, keeping this layer token-pure.
 */
import type {
  ArrowHead,
  ConnectorKind,
  Point,
  ShapeDefinition,
  ShapeType,
  Size,
} from '../contract.js';
import { round } from './geometry.js';

/** Build an SVG points attribute from a polygon in absolute coords. */
function poly(points: Array<[number, number]>): string {
  return points.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
}

/**
 * Description of how to render one shape body: either a `path` d-string, a
 * `polygon` points-string, an `ellipse`, or a `rect` (with optional radius).
 */
export type ShapeGeometry =
  | { tag: 'rect'; x: number; y: number; w: number; h: number; rx?: number }
  | { tag: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { tag: 'polygon'; points: string }
  | { tag: 'path'; d: string }
  /** Custom/HTML/image bodies carry an optional `transform` so a definition's
   *  local-space (0..w, 0..h) outline can be placed at the shape's top-left. */
  | { tag: 'path'; d: string; transform: string }
  /** An HTML shape body rendered via `<foreignObject>`. */
  | { tag: 'html'; x: number; y: number; w: number; h: number; html: string }
  /** An image shape body rendered via `<image href>`. */
  | { tag: 'image'; x: number; y: number; w: number; h: number; href: string };

/**
 * Compute the SVG body geometry for a shape of `type` at the given top-left
 * box (model coordinates). `radius` controls rounding for rounded variants.
 */
export function shapeGeometry(
  type: ShapeType,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 8,
  opts: {
    /** HTML markup for an HTML (`foreignObject`) shape body. */
    html?: string;
    /** Image href for an `image` shape body. */
    href?: string;
    /** Registered definition for a `custom` shape (supplies `outline`). */
    def?: ShapeDefinition;
  } = {},
): ShapeGeometry {
  const r = radius;
  const cx = x + w / 2;
  const cy = y + h / 2;

  // ── Extension / media bodies (resolved before the built-in switch) ──
  // An HTML shape: any type carrying `opts.html` renders as a foreignObject.
  if (opts.html != null) {
    return { tag: 'html', x, y, w, h, html: opts.html };
  }
  if (type === 'image' && opts.href != null) {
    return { tag: 'image', x, y, w, h, href: opts.href };
  }
  if (type === 'custom' && opts.def?.outline) {
    // Definition outline is in local box space (0..w, 0..h); place it at (x,y).
    return {
      tag: 'path',
      d: opts.def.outline({ width: w, height: h }),
      transform: `translate(${round(x)} ${round(y)})`,
    };
  }
  if (type === 'group') {
    // Group container: a plain bounding rect (the renderer styles it faint).
    return { tag: 'rect', x, y, w, h, rx: 0 };
  }

  switch (type) {
    case 'ellipse':
    case 'start':
    case 'end':
    case 'terminator':
      return { tag: 'rect', x, y, w, h, rx: Math.min(h / 2, w / 2) };
    case 'circle': {
      const d = Math.min(w, h);
      return { tag: 'ellipse', cx, cy, rx: d / 2, ry: d / 2 };
    }
    case 'rounded-rect':
    case 'process':
    case 'org-node':
    case 'mind-node':
    case 'pert-node':
    case 'card':
      return { tag: 'rect', x, y, w, h, rx: r };
    case 'diamond':
    case 'decision':
      return {
        tag: 'polygon',
        points: poly([
          [cx, y],
          [x + w, cy],
          [cx, y + h],
          [x, cy],
        ]),
      };
    case 'triangle':
      return {
        tag: 'polygon',
        points: poly([
          [cx, y],
          [x + w, y + h],
          [x, y + h],
        ]),
      };
    case 'parallelogram':
    case 'data': {
      const o = w * 0.2;
      return {
        tag: 'polygon',
        points: poly([
          [x + o, y],
          [x + w, y],
          [x + w - o, y + h],
          [x, y + h],
        ]),
      };
    }
    case 'trapezoid':
    case 'manual-operation': {
      const o = w * 0.2;
      return {
        tag: 'polygon',
        points: poly([
          [x + o, y],
          [x + w - o, y],
          [x + w, y + h],
          [x, y + h],
        ]),
      };
    }
    case 'manual-input': {
      const o = h * 0.25;
      return {
        tag: 'polygon',
        points: poly([
          [x, y + o],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ]),
      };
    }
    case 'pentagon': {
      const top = y;
      return {
        tag: 'polygon',
        points: poly([
          [cx, top],
          [x + w, y + h * 0.38],
          [x + w * 0.82, y + h],
          [x + w * 0.18, y + h],
          [x, y + h * 0.38],
        ]),
      };
    }
    case 'hexagon':
    case 'preparation': {
      const o = w * 0.18;
      return {
        tag: 'polygon',
        points: poly([
          [x + o, y],
          [x + w - o, y],
          [x + w, cy],
          [x + w - o, y + h],
          [x + o, y + h],
          [x, cy],
        ]),
      };
    }
    case 'octagon': {
      const ox = w * 0.29;
      const oy = h * 0.29;
      return {
        tag: 'polygon',
        points: poly([
          [x + ox, y],
          [x + w - ox, y],
          [x + w, y + oy],
          [x + w, y + h - oy],
          [x + w - ox, y + h],
          [x + ox, y + h],
          [x, y + h - oy],
          [x, y + oy],
        ]),
      };
    }
    case 'star': {
      const pts: Array<[number, number]> = [];
      const outerR = Math.min(w, h) / 2;
      const innerR = outerR * 0.4;
      for (let i = 0; i < 10; i++) {
        const ang = (Math.PI / 5) * i - Math.PI / 2;
        const rad = i % 2 === 0 ? outerR : innerR;
        pts.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
      }
      return { tag: 'polygon', points: poly(pts) };
    }
    case 'cross': {
      const t = Math.min(w, h) * 0.33;
      const x0 = x + (w - t) / 2;
      const y0 = y + (h - t) / 2;
      return {
        tag: 'polygon',
        points: poly([
          [x0, y],
          [x0 + t, y],
          [x0 + t, y0],
          [x + w, y0],
          [x + w, y0 + t],
          [x0 + t, y0 + t],
          [x0 + t, y + h],
          [x0, y + h],
          [x0, y0 + t],
          [x, y0 + t],
          [x, y0],
          [x0, y0],
        ]),
      };
    }
    case 'arrow-shape': {
      const head = w * 0.35;
      const shaft = h * 0.25;
      return {
        tag: 'polygon',
        points: poly([
          [x, cy - shaft],
          [x + w - head, cy - shaft],
          [x + w - head, y],
          [x + w, cy],
          [x + w - head, y + h],
          [x + w - head, cy + shaft],
          [x, cy + shaft],
        ]),
      };
    }
    case 'document':
    case 'multi-document': {
      const wave = h * 0.2;
      return {
        tag: 'path',
        d:
          `M ${round(x)} ${round(y)} ` +
          `H ${round(x + w)} V ${round(y + h - wave)} ` +
          `Q ${round(x + w * 0.75)} ${round(y + h)} ${round(cx)} ${round(y + h - wave)} ` +
          `Q ${round(x + w * 0.25)} ${round(y + h - 2 * wave)} ${round(x)} ${round(y + h - wave)} Z`,
      };
    }
    case 'database':
    case 'storage': {
      const ry = h * 0.14;
      return {
        tag: 'path',
        d:
          `M ${round(x)} ${round(y + ry)} ` +
          `A ${round(w / 2)} ${round(ry)} 0 0 1 ${round(x + w)} ${round(y + ry)} ` +
          `V ${round(y + h - ry)} ` +
          `A ${round(w / 2)} ${round(ry)} 0 0 1 ${round(x)} ${round(y + h - ry)} Z ` +
          `M ${round(x)} ${round(y + ry)} ` +
          `A ${round(w / 2)} ${round(ry)} 0 0 0 ${round(x + w)} ${round(y + ry)}`,
      };
    }
    case 'cloud':
      return {
        tag: 'path',
        d:
          `M ${round(x + w * 0.25)} ${round(y + h * 0.7)} ` +
          `a ${round(w * 0.18)} ${round(h * 0.22)} 0 0 1 0 ${round(-h * 0.4)} ` +
          `a ${round(w * 0.22)} ${round(h * 0.28)} 0 0 1 ${round(w * 0.4)} ${round(-h * 0.1)} ` +
          `a ${round(w * 0.2)} ${round(h * 0.26)} 0 0 1 ${round(w * 0.3)} ${round(h * 0.3)} ` +
          `a ${round(w * 0.16)} ${round(h * 0.2)} 0 0 1 ${round(-w * 0.05)} ${round(h * 0.3)} Z`,
      };
    case 'callout': {
      const tail = h * 0.25;
      return {
        tag: 'path',
        d:
          `M ${round(x)} ${round(y)} H ${round(x + w)} V ${round(y + h - tail)} ` +
          `H ${round(x + w * 0.35)} L ${round(x + w * 0.2)} ${round(y + h)} ` +
          `L ${round(x + w * 0.2)} ${round(y + h - tail)} H ${round(x)} Z`,
      };
    }
    case 'delay':
      return {
        tag: 'path',
        d:
          `M ${round(x)} ${round(y)} H ${round(x + w * 0.6)} ` +
          `A ${round(h / 2)} ${round(h / 2)} 0 0 1 ${round(x + w * 0.6)} ${round(y + h)} ` +
          `H ${round(x)} Z`,
      };
    case 'predefined-process':
      return { tag: 'rect', x, y, w, h, rx: 2 };
    case 'display':
      return {
        tag: 'path',
        d:
          `M ${round(x)} ${round(cy)} L ${round(x + w * 0.15)} ${round(y)} ` +
          `H ${round(x + w * 0.8)} ` +
          `A ${round(w * 0.2)} ${round(h / 2)} 0 0 1 ${round(x + w * 0.8)} ${round(y + h)} ` +
          `H ${round(x + w * 0.15)} Z`,
      };
    case 'off-page':
      return {
        tag: 'polygon',
        points: poly([
          [x, y],
          [x + w, y],
          [x + w, y + h * 0.6],
          [cx, y + h],
          [x, y + h * 0.6],
        ]),
      };
    case 'text':
      return { tag: 'rect', x, y, w, h, rx: 0 };
    case 'connector-ref': {
      const d = Math.min(w, h);
      return { tag: 'ellipse', cx, cy, rx: d / 2, ry: d / 2 };
    }
    case 'rect':
    case 'square':
    case 'image':
    case 'internal-storage':
    default:
      return { tag: 'rect', x, y, w, h, rx: 0 };
  }
}

/** Build the SVG `d` string for a connector polyline / curve. */
export function connectorPath(points: readonly Point[], kind: ConnectorKind): string {
  if (points.length < 2) return '';
  const p = points.map((pt) => ({ x: round(pt.x), y: round(pt.y) }));
  if (kind === 'curved' && p.length >= 2) {
    // Smooth cubic through the points.
    const p0 = p[0]!;
    let d = `M ${p0.x} ${p0.y}`;
    if (p.length === 2) {
      const p1 = p[1]!;
      const midX = (p0.x + p1.x) / 2;
      d += ` C ${midX} ${p0.y} ${midX} ${p1.y} ${p1.x} ${p1.y}`;
      return d;
    }
    for (let i = 1; i < p.length; i++) {
      const prev = p[i - 1]!;
      const cur = p[i]!;
      const midX = (prev.x + cur.x) / 2;
      const midY = (prev.y + cur.y) / 2;
      d += ` Q ${prev.x} ${prev.y} ${midX} ${midY}`;
    }
    const last = p[p.length - 1]!;
    d += ` L ${last.x} ${last.y}`;
    return d;
  }
  return `M ${p.map((pt) => `${pt.x} ${pt.y}`).join(' L ')}`;
}

/**
 * Build an arrowhead marker polygon/path at `tip`, pointing along the direction
 * from `from` → `tip`. Returns an SVG element string (or '' for 'none').
 */
export function arrowMarker(
  head: ArrowHead,
  tip: Point,
  from: Point,
  size = 9,
): string {
  if (head === 'none') return '';
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
  const ax = Math.cos(ang);
  const ay = Math.sin(ang);
  // Perpendicular.
  const px = -ay;
  const py = ax;
  const back = { x: tip.x - ax * size, y: tip.y - ay * size };
  const w = size * 0.5;
  switch (head) {
    case 'arrow':
    case 'open': {
      const left = { x: back.x + px * w, y: back.y + py * w };
      const right = { x: back.x - px * w, y: back.y - py * w };
      const fill = head === 'open' ? 'none' : 'currentColor';
      return `<polygon class="jects-diagram__arrowhead" points="${round(tip.x)},${round(tip.y)} ${round(left.x)},${round(left.y)} ${round(right.x)},${round(right.y)}" fill="${fill}" stroke="currentColor" />`;
    }
    case 'triangle': {
      const left = { x: back.x + px * w, y: back.y + py * w };
      const right = { x: back.x - px * w, y: back.y - py * w };
      return `<polygon class="jects-diagram__arrowhead" points="${round(tip.x)},${round(tip.y)} ${round(left.x)},${round(left.y)} ${round(right.x)},${round(right.y)}" fill="currentColor" />`;
    }
    case 'diamond': {
      const mid = { x: tip.x - ax * size, y: tip.y - ay * size };
      const left = { x: mid.x + px * w, y: mid.y + py * w };
      const right = { x: mid.x - px * w, y: mid.y - py * w };
      const tail = { x: tip.x - ax * size * 2, y: tip.y - ay * size * 2 };
      return `<polygon class="jects-diagram__arrowhead" points="${round(tip.x)},${round(tip.y)} ${round(left.x)},${round(left.y)} ${round(tail.x)},${round(tail.y)} ${round(right.x)},${round(right.y)}" fill="currentColor" />`;
    }
    case 'circle': {
      const c = { x: tip.x - ax * (size / 2), y: tip.y - ay * (size / 2) };
      return `<circle class="jects-diagram__arrowhead" cx="${round(c.x)}" cy="${round(c.y)}" r="${round(size / 2)}" fill="currentColor" />`;
    }
    default:
      return '';
  }
}

/** Default body size for a freshly-dropped shape of a given type. */
export function defaultShapeSize(type: ShapeType): Size {
  switch (type) {
    case 'circle':
    case 'connector-ref':
      return { width: 80, height: 80 };
    case 'start':
    case 'end':
    case 'terminator':
      return { width: 120, height: 48 };
    case 'decision':
    case 'diamond':
      return { width: 120, height: 80 };
    case 'text':
      return { width: 120, height: 32 };
    default:
      return { width: 120, height: 64 };
  }
}
