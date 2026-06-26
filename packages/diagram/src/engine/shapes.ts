/**
 * Built-in shape catalog for the diagram engine.
 *
 * Every {@link ShapeType} in the contract (30+ kinds) has a {@link BuiltinShape}
 * entry: a default size, a set of default ports, a token-based default style,
 * and an `outline(size)` generator that returns an SVG path string scaled to
 * the shape's box. The engine and renderers consult this catalog; it is pure
 * and DOM-free (just string math).
 *
 * `custom` shapes are NOT in this catalog — they resolve through a
 * {@link ShapeDefinition} registered on the engine.
 */

import type {
  ShapeType,
  Size,
  PortModel,
  DiagramStyle,
  ShapeModel,
} from '../contract.js';

/** A built-in shape entry. */
export interface BuiltinShape {
  type: ShapeType;
  defaultSize: Size;
  defaultPorts: PortModel[];
  defaultStyle: DiagramStyle;
  /** SVG path command string for the perimeter, scaled to `size`. */
  outline(size: Size): string;
}

/* ── Port presets ────────────────────────────────────────────────────────── */

/** The four cardinal perimeter ports (T/R/B/L), all in+out. */
export function cardinalPorts(): PortModel[] {
  return [
    { id: 'top', side: 'top', offset: { x: 0.5, y: 0 }, in: true, out: true },
    { id: 'right', side: 'right', offset: { x: 1, y: 0.5 }, in: true, out: true },
    { id: 'bottom', side: 'bottom', offset: { x: 0.5, y: 1 }, in: true, out: true },
    { id: 'left', side: 'left', offset: { x: 0, y: 0.5 }, in: true, out: true },
  ];
}

/** Decision (diamond) ports labelled for branch logic. */
function decisionPorts(): PortModel[] {
  return [
    { id: 'top', side: 'top', offset: { x: 0.5, y: 0 }, in: true, out: false },
    { id: 'right', side: 'right', offset: { x: 1, y: 0.5 }, label: 'No', in: false, out: true },
    { id: 'bottom', side: 'bottom', offset: { x: 0.5, y: 1 }, label: 'Yes', in: false, out: true },
    { id: 'left', side: 'left', offset: { x: 0, y: 0.5 }, label: 'No', in: false, out: true },
  ];
}

/* ── Default style helpers (token names only — no literals) ───────────────── */

function baseStyle(over: Partial<DiagramStyle> = {}): DiagramStyle {
  return {
    fill: 'card',
    stroke: 'border',
    strokeWidth: 1.5,
    textColor: 'card-foreground',
    fontSize: 13,
    radius: 0,
    ...over,
  };
}

/* ── Outline generators (normalized to the box [0,0,w,h]) ─────────────────── */

function rectPath(s: Size): string {
  const { width: w, height: h } = s;
  return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
}

function roundedRectPath(s: Size, r = 8): string {
  const { width: w, height: h } = s;
  const rad = Math.min(r, w / 2, h / 2);
  return (
    `M ${rad} 0 L ${w - rad} 0 Q ${w} 0 ${w} ${rad} ` +
    `L ${w} ${h - rad} Q ${w} ${h} ${w - rad} ${h} ` +
    `L ${rad} ${h} Q 0 ${h} 0 ${h - rad} ` +
    `L 0 ${rad} Q 0 0 ${rad} 0 Z`
  );
}

function ellipsePath(s: Size): string {
  const { width: w, height: h } = s;
  const rx = w / 2;
  const ry = h / 2;
  return (
    `M 0 ${ry} ` +
    `A ${rx} ${ry} 0 0 1 ${w} ${ry} ` +
    `A ${rx} ${ry} 0 0 1 0 ${ry} Z`
  );
}

function polyPath(pts: Array<[number, number]>): string {
  return (
    pts
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`)
      .join(' ') + ' Z'
  );
}

function trianglePath(s: Size): string {
  const { width: w, height: h } = s;
  return polyPath([
    [w / 2, 0],
    [w, h],
    [0, h],
  ]);
}

function diamondPath(s: Size): string {
  const { width: w, height: h } = s;
  return polyPath([
    [w / 2, 0],
    [w, h / 2],
    [w / 2, h],
    [0, h / 2],
  ]);
}

function parallelogramPath(s: Size): string {
  const { width: w, height: h } = s;
  const o = w * 0.2;
  return polyPath([
    [o, 0],
    [w, 0],
    [w - o, h],
    [0, h],
  ]);
}

function trapezoidPath(s: Size): string {
  const { width: w, height: h } = s;
  const o = w * 0.2;
  return polyPath([
    [o, 0],
    [w - o, 0],
    [w, h],
    [0, h],
  ]);
}

function regularPolyPath(s: Size, n: number, rot = -Math.PI / 2): string {
  const { width: w, height: h } = s;
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return polyPath(pts);
}

function starPath(s: Size, points = 5): string {
  const { width: w, height: h } = s;
  const cx = w / 2;
  const cy = h / 2;
  const outerX = w / 2;
  const outerY = h / 2;
  const inner = 0.5;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rx = i % 2 === 0 ? outerX : outerX * inner;
    const ry = i % 2 === 0 ? outerY : outerY * inner;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return polyPath(pts);
}

function crossPath(s: Size): string {
  const { width: w, height: h } = s;
  const tw = w * 0.34;
  const th = h * 0.34;
  const x0 = (w - tw) / 2;
  const x1 = (w + tw) / 2;
  const y0 = (h - th) / 2;
  const y1 = (h + th) / 2;
  return polyPath([
    [x0, 0],
    [x1, 0],
    [x1, y0],
    [w, y0],
    [w, y1],
    [x1, y1],
    [x1, h],
    [x0, h],
    [x0, y1],
    [0, y1],
    [0, y0],
    [x0, y0],
  ]);
}

function arrowShapePath(s: Size): string {
  const { width: w, height: h } = s;
  const head = w * 0.6;
  const ty = h * 0.25;
  const by = h * 0.75;
  return polyPath([
    [0, ty],
    [head, ty],
    [head, 0],
    [w, h / 2],
    [head, h],
    [head, by],
    [0, by],
  ]);
}

function pentagonArrowPath(s: Size): string {
  // "preparation"-ish chevron pentagon
  const { width: w, height: h } = s;
  const o = h / 2;
  return polyPath([
    [0, 0],
    [w - o, 0],
    [w, h / 2],
    [w - o, h],
    [0, h],
  ]);
}

function calloutPath(s: Size): string {
  const { width: w, height: h } = s;
  const bodyH = h * 0.75;
  const r = Math.min(8, w / 2, bodyH / 2);
  const tx = w * 0.25;
  return (
    `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} ` +
    `L ${w} ${bodyH - r} Q ${w} ${bodyH} ${w - r} ${bodyH} ` +
    `L ${tx + 20} ${bodyH} L ${tx} ${h} L ${tx} ${bodyH} ` +
    `L ${r} ${bodyH} Q 0 ${bodyH} 0 ${bodyH - r} ` +
    `L 0 ${r} Q 0 0 ${r} 0 Z`
  );
}

function cloudPath(s: Size): string {
  const { width: w, height: h } = s;
  // Approximate cloud via four arcs.
  const y = h * 0.7;
  return (
    `M ${w * 0.25} ${y} ` +
    `A ${w * 0.18} ${h * 0.22} 0 0 1 ${w * 0.25} ${h * 0.3} ` +
    `A ${w * 0.22} ${h * 0.28} 0 0 1 ${w * 0.6} ${h * 0.22} ` +
    `A ${w * 0.2} ${h * 0.25} 0 0 1 ${w * 0.85} ${h * 0.45} ` +
    `A ${w * 0.16} ${h * 0.2} 0 0 1 ${w * 0.78} ${y} Z`
  );
}

function documentPath(s: Size): string {
  const { width: w, height: h } = s;
  const wave = h * 0.18;
  return (
    `M 0 0 L ${w} 0 L ${w} ${h - wave} ` +
    `Q ${w * 0.75} ${h} ${w * 0.5} ${h - wave} ` +
    `Q ${w * 0.25} ${h - wave * 2} 0 ${h - wave} Z`
  );
}

function multiDocumentPath(s: Size): string {
  const { width: w, height: h } = s;
  const off = h * 0.12;
  const inner = documentPath({ width: w - off, height: h - off });
  return (
    `M ${off} ${off} L ${w} ${off} L ${w} ${h - off} L ${off} ${h - off} Z ` +
    inner
  );
}

function cylinderPath(s: Size): string {
  const { width: w, height: h } = s;
  const ry = h * 0.12;
  return (
    `M 0 ${ry} ` +
    `A ${w / 2} ${ry} 0 0 1 ${w} ${ry} ` +
    `L ${w} ${h - ry} ` +
    `A ${w / 2} ${ry} 0 0 1 0 ${h - ry} Z ` +
    `M 0 ${ry} A ${w / 2} ${ry} 0 0 0 ${w} ${ry}`
  );
}

function internalStoragePath(s: Size): string {
  const { width: w, height: h } = s;
  const o = Math.min(w, h) * 0.18;
  return `${rectPath(s)} M ${o} 0 L ${o} ${h} M 0 ${o} L ${w} ${o}`;
}

function displayPath(s: Size): string {
  const { width: w, height: h } = s;
  const o = w * 0.18;
  return (
    `M ${o} 0 L ${w - o} 0 ` +
    `A ${o} ${h / 2} 0 0 1 ${w - o} ${h} ` +
    `L ${o} ${h} ` +
    `Q 0 ${h / 2} ${o} 0 Z`
  );
}

function cardPath(s: Size): string {
  const { width: w, height: h } = s;
  const o = Math.min(w, h) * 0.2;
  return polyPath([
    [o, 0],
    [w, 0],
    [w, h],
    [0, h],
    [0, o],
  ]);
}

function delayPath(s: Size): string {
  const { width: w, height: h } = s;
  return (
    `M 0 0 L ${w * 0.7} 0 ` +
    `A ${w * 0.3} ${h / 2} 0 0 1 ${w * 0.7} ${h} ` +
    `L 0 ${h} Z`
  );
}

function manualInputPath(s: Size): string {
  const { width: w, height: h } = s;
  return polyPath([
    [0, h * 0.25],
    [w, 0],
    [w, h],
    [0, h],
  ]);
}

function manualOperationPath(s: Size): string {
  const { width: w, height: h } = s;
  const o = w * 0.15;
  return polyPath([
    [0, 0],
    [w, 0],
    [w - o, h],
    [o, h],
  ]);
}

function offPagePath(s: Size): string {
  const { width: w, height: h } = s;
  const o = h * 0.3;
  return polyPath([
    [0, 0],
    [w, 0],
    [w, h - o],
    [w / 2, h],
    [0, h - o],
  ]);
}

function predefinedProcessPath(s: Size): string {
  const { width: w, height: h } = s;
  const o = w * 0.1;
  return `${rectPath(s)} M ${o} 0 L ${o} ${h} M ${w - o} 0 L ${w - o} ${h}`;
}

/* ── Catalog construction ─────────────────────────────────────────────────── */

function entry(
  type: ShapeType,
  outline: (s: Size) => string,
  size: Size,
  ports: PortModel[] = cardinalPorts(),
  style: Partial<DiagramStyle> = {},
): BuiltinShape {
  return {
    type,
    defaultSize: size,
    defaultPorts: ports,
    defaultStyle: baseStyle(style),
    outline,
  };
}

const STD: Size = { width: 120, height: 64 };
const SQ: Size = { width: 80, height: 80 };

const CATALOG: Record<string, BuiltinShape> = {
  // ── Generic primitives ──
  rect: entry('rect', rectPath, STD),
  'rounded-rect': entry('rounded-rect', (s) => roundedRectPath(s, 10), STD, cardinalPorts(), {
    radius: 10,
  }),
  ellipse: entry('ellipse', ellipsePath, STD),
  circle: entry('circle', ellipsePath, SQ),
  square: entry('square', rectPath, SQ),
  triangle: entry('triangle', trianglePath, SQ),
  diamond: entry('diamond', diamondPath, { width: 100, height: 100 }, decisionPorts()),
  parallelogram: entry('parallelogram', parallelogramPath, STD),
  trapezoid: entry('trapezoid', trapezoidPath, STD),
  pentagon: entry('pentagon', (s) => regularPolyPath(s, 5), SQ),
  hexagon: entry('hexagon', (s) => regularPolyPath(s, 6, 0), STD),
  octagon: entry('octagon', (s) => regularPolyPath(s, 8, Math.PI / 8), SQ),
  star: entry('star', (s) => starPath(s, 5), SQ),
  cross: entry('cross', crossPath, SQ),
  'arrow-shape': entry('arrow-shape', arrowShapePath, STD),
  callout: entry('callout', calloutPath, STD),
  cloud: entry('cloud', cloudPath, STD),

  // ── Classic flowchart ──
  process: entry('process', rectPath, STD),
  'predefined-process': entry('predefined-process', predefinedProcessPath, STD),
  decision: entry('decision', diamondPath, { width: 120, height: 80 }, decisionPorts()),
  terminator: entry('terminator', (s) => roundedRectPath(s, s.height / 2), STD, cardinalPorts(), {
    radius: 999,
  }),
  start: entry('start', (s) => roundedRectPath(s, s.height / 2), STD, cardinalPorts(), {
    fill: 'success',
    textColor: 'success-foreground',
  }),
  end: entry('end', (s) => roundedRectPath(s, s.height / 2), STD, cardinalPorts(), {
    fill: 'destructive',
    textColor: 'destructive-foreground',
  }),
  delay: entry('delay', delayPath, STD),
  preparation: entry('preparation', pentagonArrowPath, STD),
  'manual-input': entry('manual-input', manualInputPath, STD),
  'manual-operation': entry('manual-operation', manualOperationPath, STD),

  // ── Data / IO ──
  data: entry('data', parallelogramPath, STD),
  document: entry('document', documentPath, STD),
  'multi-document': entry('multi-document', multiDocumentPath, STD),
  database: entry('database', cylinderPath, SQ),
  storage: entry('storage', cylinderPath, SQ),
  'internal-storage': entry('internal-storage', internalStoragePath, STD),
  display: entry('display', displayPath, STD),
  card: entry('card', cardPath, STD),
  'connector-ref': entry('connector-ref', ellipsePath, { width: 48, height: 48 }),
  'off-page': entry('off-page', offPagePath, STD),

  // ── Org-chart / mind-map / project ──
  'org-node': entry('org-node', (s) => roundedRectPath(s, 6), { width: 140, height: 56 }, cardinalPorts(), {
    radius: 6,
  }),
  'mind-node': entry('mind-node', (s) => roundedRectPath(s, s.height / 2), { width: 130, height: 44 }, cardinalPorts(), {
    radius: 999,
  }),
  'pert-node': entry('pert-node', rectPath, { width: 150, height: 80 }),
  text: entry('text', rectPath, { width: 120, height: 40 }, cardinalPorts(), {
    fill: 'background',
    stroke: 'background',
    strokeWidth: 0,
  }),
  image: entry('image', rectPath, { width: 120, height: 90 }),
};

/** Look up a built-in shape entry by type. */
export function getBuiltinShape(type: ShapeType): BuiltinShape | undefined {
  return CATALOG[type];
}

/** All built-in shape types (excludes `custom`). */
export function builtinShapeTypes(): ShapeType[] {
  return Object.keys(CATALOG) as ShapeType[];
}

/** Number of built-in shape types in the catalog. */
export const BUILTIN_SHAPE_COUNT = Object.keys(CATALOG).length;

/**
 * Resolve effective ports for a shape: explicit `shape.ports` win, else the
 * built-in defaults for its type, else the four cardinal ports.
 */
export function resolvePorts(shape: ShapeModel): PortModel[] {
  if (shape.ports && shape.ports.length > 0) return shape.ports;
  const def = getBuiltinShape(shape.type);
  return def ? def.defaultPorts : cardinalPorts();
}

/**
 * Compute the absolute position of a port on a shape (model coords) from its
 * normalized offset.
 */
export function portPoint(shape: ShapeModel, port: PortModel): { x: number; y: number } {
  return {
    x: shape.x + port.offset.x * shape.w,
    y: shape.y + port.offset.y * shape.h,
  };
}

/** The SVG outline path for a shape (built-in only; custom returns rect). */
export function shapeOutline(shape: ShapeModel): string {
  const def = getBuiltinShape(shape.type);
  const size: Size = { width: shape.w, height: shape.h };
  if (def) return def.outline(size);
  return rectPath(size);
}
