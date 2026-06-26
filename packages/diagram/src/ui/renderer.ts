/**
 * SVG renderer for the Diagram UI. Given the engine's model graph plus the
 * current view transform and selection, it (re)builds the SVG scene: swimlanes,
 * connectors, shapes, ports, selection handles, snap lines, and the box-select
 * marquee. Pure-ish: it mutates a provided `<svg>` root but reads no global
 * state, so the widget owns lifecycle and the renderer owns geometry → DOM.
 *
 * Token purity: the renderer emits CSS classes + per-element CSS variables
 * (e.g. `--_fill`) whose values are `oklch(var(--jects-<token>))`; it never
 * writes raw color literals. Styles map `DiagramStyle` token NAMES onto those
 * variables.
 */
import { createEl, sanitizeHtml } from '@jects/core';
import type {
  ConnectorModel,
  DiagramEngine,
  DiagramId,
  DiagramStyle,
  Point,
  ShapeDefinition,
  ShapeModel,
  SwimlaneModel,
} from '../contract.js';
import { round, shapeRect } from './geometry.js';
import {
  arrowMarker,
  connectorPath,
  shapeGeometry,
  type ShapeGeometry,
} from './shapes.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export interface SnapLine {
  orientation: 'h' | 'v';
  /** Position in model coordinates (y for 'h', x for 'v'). */
  pos: number;
}

export interface RenderState {
  selection: ReadonlySet<DiagramId>;
  view: ViewTransform;
  grid: boolean;
  snap: number;
  editable: boolean;
  /** Active box-select marquee in model coords, or null. */
  marquee: { x: number; y: number; width: number; height: number } | null;
  /** Active snap guide lines. */
  snapLines: SnapLine[];
  /** A connector being drawn (from point → cursor), or null. */
  pendingConnector: { from: { x: number; y: number }; to: { x: number; y: number } } | null;
  /** Ids hidden by search/filter (rendered dimmed). */
  dimmed: ReadonlySet<DiagramId>;
  /**
   * The shape that holds the roving-tabindex keyboard focus, or null. That
   * shape renders with `tabindex=0` (all others `-1`) so Tab reaches exactly
   * one shape and arrow keys move the cursor between shapes. Only meaningful
   * when `editable`.
   */
  focusId?: DiagramId | null;
  /**
   * When a connector is being drawn with the keyboard, the id of the source
   * shape (so its body can be flagged as the pending connection origin).
   */
  connectSourceId?: DiagramId | null;
  /**
   * Resolve a registered custom {@link ShapeDefinition} by key, so `type:'custom'`
   * shapes render their definition outline rather than falling back to a rect.
   */
  resolveShapeDef?: (key: string) => ShapeDefinition | undefined;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Map a style token name to a CSS var() value, or undefined to inherit. */
function tokenColor(name: string | undefined): string | undefined {
  if (!name) return undefined;
  // Already a var()/oklch() expression — trust it.
  if (name.startsWith('var(') || name.startsWith('oklch(') || name.startsWith('#')) {
    return name;
  }
  return `oklch(var(--jects-${name}))`;
}

function applyShapeStyle(node: SVGElement, style: DiagramStyle | undefined): void {
  const fill = tokenColor(style?.fill) ?? 'oklch(var(--jects-card))';
  const stroke = tokenColor(style?.stroke) ?? 'oklch(var(--jects-border))';
  node.style.setProperty('--_fill', fill);
  node.style.setProperty('--_stroke', stroke);
  if (style?.strokeWidth != null) {
    node.style.setProperty('--_stroke-w', `${style.strokeWidth}px`);
  }
  if (style?.strokeDash && style.strokeDash.length) {
    node.style.setProperty('--_dash', style.strokeDash.join(' '));
  }
  if (style?.opacity != null) node.style.opacity = String(style.opacity);
}

function bodyNode(geo: ShapeGeometry): SVGElement {
  switch (geo.tag) {
    case 'rect':
      return svgEl('rect', {
        x: round(geo.x),
        y: round(geo.y),
        width: round(geo.w),
        height: round(geo.h),
        rx: round(geo.rx ?? 0),
      });
    case 'ellipse':
      return svgEl('ellipse', {
        cx: round(geo.cx),
        cy: round(geo.cy),
        rx: round(geo.rx),
        ry: round(geo.ry),
      });
    case 'polygon':
      return svgEl('polygon', { points: geo.points });
    case 'path': {
      const node = svgEl('path', { d: geo.d });
      if ('transform' in geo && geo.transform) node.setAttribute('transform', geo.transform);
      return node;
    }
    case 'image': {
      const node = svgEl('image', {
        x: round(geo.x),
        y: round(geo.y),
        width: round(geo.w),
        height: round(geo.h),
        preserveAspectRatio: 'xMidYMid meet',
      });
      // `href` (SVG2) + legacy xlink:href for broad rasterizer support.
      node.setAttribute('href', geo.href);
      node.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', geo.href);
      return node;
    }
    case 'html': {
      const fo = svgEl('foreignObject', {
        x: round(geo.x),
        y: round(geo.y),
        width: round(geo.w),
        height: round(geo.h),
      });
      const wrap = createEl('div', { className: 'jects-diagram__html-body' });
      wrap.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      // HTML (`foreignObject`) shape bodies carry caller-supplied markup; route
      // through the shared allow-list sanitizer (docs/SECURITY.md surface #5).
      wrap.innerHTML = sanitizeHtml(geo.html);
      fo.appendChild(wrap);
      return fo;
    }
  }
}

/** Build a `<g>` for one shape (body + label + ports). */
export function renderShape(
  shape: ShapeModel,
  state: RenderState,
): SVGGElement {
  const g = svgEl('g', {
    'data-shape': shape.id,
    class: 'jects-diagram__shape',
  });
  const selected = state.selection.has(shape.id);
  if (selected) g.classList.add('jects-diagram__shape--selected');
  if (shape.locked) g.classList.add('jects-diagram__shape--locked');
  if (state.dimmed.has(shape.id)) g.classList.add('jects-diagram__shape--dimmed');

  // Keyboard a11y: expose each shape as a focusable, named element so AT users
  // can Tab to a shape and operate it. Roving tabindex — exactly one shape (the
  // focus cursor) is in the tab order; arrow keys move the cursor between them.
  if (state.editable) {
    g.setAttribute('role', 'button');
    const label = shape.text?.trim()
      ? `${shape.text.trim()} (${shape.type})`
      : `${shape.type} shape`;
    g.setAttribute('aria-label', label);
    g.setAttribute('aria-roledescription', 'diagram shape');
    if (selected) g.setAttribute('aria-pressed', 'true');
    const isFocus = state.focusId != null && state.focusId === shape.id;
    g.setAttribute('tabindex', isFocus ? '0' : '-1');
    if (state.connectSourceId === shape.id) {
      g.classList.add('jects-diagram__shape--connect-source');
    }
  }
  if (shape.rotation) {
    const cx = shape.x + shape.w / 2;
    const cy = shape.y + shape.h / 2;
    g.setAttribute('transform', `rotate(${shape.rotation} ${round(cx)} ${round(cy)})`);
  }

  // Resolve extension/media inputs: HTML markup (`data.html`), image href
  // (`data.href`), and the registered definition for a `custom` shape.
  const html = typeof shape.data?.html === 'string' ? shape.data.html : undefined;
  const href = typeof shape.data?.href === 'string' ? shape.data.href : undefined;
  const def =
    shape.type === 'custom' && shape.shapeDef
      ? state.resolveShapeDef?.(shape.shapeDef)
      : undefined;
  const geoOpts: { html?: string; href?: string; def?: ShapeDefinition } = {};
  if (html != null) geoOpts.html = html;
  if (href != null) geoOpts.href = href;
  if (def) geoOpts.def = def;

  const geo = shapeGeometry(
    shape.type,
    shape.x,
    shape.y,
    shape.w,
    shape.h,
    shape.style?.radius ?? 8,
    geoOpts,
  );
  const body = bodyNode(geo);
  body.classList.add('jects-diagram__shape-body');
  if (shape.type === 'group') body.classList.add('jects-diagram__group-body');
  // Image / HTML bodies are self-painting; skip the fill/stroke styling that
  // would otherwise tint them. Custom path + built-ins still get styled.
  if (geo.tag !== 'image' && geo.tag !== 'html') {
    applyShapeStyle(body, shape.style);
  }
  g.appendChild(body);

  if (shape.text) {
    const text = svgEl('text', {
      x: round(shape.x + shape.w / 2),
      y: round(shape.y + shape.h / 2),
      class: 'jects-diagram__shape-text',
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
    });
    const tc = tokenColor(shape.style?.textColor);
    if (tc) text.style.setProperty('--_text', tc);
    if (shape.style?.fontSize) text.style.fontSize = `${shape.style.fontSize}px`;
    if (shape.style?.fontWeight) text.style.fontWeight = String(shape.style.fontWeight);
    text.textContent = shape.text;
    g.appendChild(text);
  }

  // Ports only render in editable mode (interaction affordance).
  if (state.editable && shape.ports) {
    const r = shapeRect(shape);
    for (const p of shape.ports) {
      const port = svgEl('circle', {
        cx: round(r.x + p.offset.x * r.width),
        cy: round(r.y + p.offset.y * r.height),
        r: 4,
        class: 'jects-diagram__port',
        'data-port': p.id,
        'data-shape': shape.id,
      });
      g.appendChild(port);
    }
  }
  return g;
}

/** An engine that can compute a route purely (no model mutation). */
interface PureRouteEngine {
  computeRoute(c: ConnectorModel): { points: Point[] };
}

function hasComputeRoute(e: DiagramEngine): e is DiagramEngine & PureRouteEngine {
  return typeof (e as Partial<PureRouteEngine>).computeRoute === 'function';
}

/**
 * Resolve the waypoints to draw for a connector WITHOUT mutating the model.
 * Prefers the cached `connector.points`; if absent, uses the engine's pure
 * `computeRoute()` when available, else a trivial 2-point fallback derived from
 * shape centers. It never calls the mutating `engine.route()`.
 */
function resolveRenderPoints(
  connector: ConnectorModel,
  engine: DiagramEngine,
): Point[] {
  if (connector.points && connector.points.length >= 2) return connector.points;
  if (hasComputeRoute(engine)) {
    const r = engine.computeRoute(connector);
    if (r.points && r.points.length >= 2) return r.points;
  }
  // Last-resort fallback: straight line between shape centers (read-only).
  const from = engine.getShape(connector.from.shape);
  const to = engine.getShape(connector.to.shape);
  if (from && to) {
    return [
      { x: from.x + from.w / 2, y: from.y + from.h / 2 },
      { x: to.x + to.w / 2, y: to.y + to.h / 2 },
    ];
  }
  return [{ x: 0, y: 0 }, { x: 0, y: 0 }];
}

/** Build a `<g>` for one connector (path + arrowheads + label). */
export function renderConnector(
  connector: ConnectorModel,
  engine: DiagramEngine,
  state: RenderState,
): SVGGElement {
  const g = svgEl('g', {
    'data-connector': connector.id,
    class: 'jects-diagram__connector',
  });
  if (state.selection.has(connector.id)) {
    g.classList.add('jects-diagram__connector--selected');
  }
  if (state.dimmed.has(connector.id)) {
    g.classList.add('jects-diagram__connector--dimmed');
  }
  // Render from the cached route — NEVER call engine.route() here. route() is a
  // model-mutating cache step that writes points back and emits events; calling
  // it on every paint (selection, zoom, pan, marquee, snap redraw) dirties the
  // model and fires routing events every frame. The engine re-routes on
  // structural changes, so by paint time `connector.points` is up to date. When
  // a cache is absent (e.g. endpoints were missing at add time), fall back to a
  // pure, read-only compute if the engine exposes one, else to the endpoints.
  const pts = resolveRenderPoints(connector, engine);
  const d = connectorPath(pts, connector.kind);

  // Invisible fat hit-path for easy selection.
  const hit = svgEl('path', { d, class: 'jects-diagram__connector-hit' });
  g.appendChild(hit);

  const path = svgEl('path', { d, class: 'jects-diagram__connector-path' });
  const stroke = tokenColor(connector.style?.stroke) ?? 'oklch(var(--jects-foreground))';
  path.style.setProperty('--_stroke', stroke);
  if (connector.style?.strokeWidth != null) {
    path.style.setProperty('--_stroke-w', `${connector.style.strokeWidth}px`);
  }
  if (connector.style?.strokeDash?.length) {
    path.style.setProperty('--_dash', connector.style.strokeDash.join(' '));
  }
  g.appendChild(path);

  const arrows = connector.arrows ?? { end: 'arrow' };
  const a = pts[0] ?? { x: 0, y: 0 };
  const b = pts[pts.length - 1] ?? a;
  const second = pts[1] ?? b;
  const penult = pts[pts.length - 2] ?? a;
  if (arrows.end && arrows.end !== 'none') {
    // jects-safe-html: SVG arrow marker from internal geometry, no user data
    g.insertAdjacentHTML('beforeend', arrowMarker(arrows.end, b, penult));
  }
  if (arrows.start && arrows.start !== 'none') {
    // jects-safe-html: SVG arrow marker from internal geometry, no user data
    g.insertAdjacentHTML('beforeend', arrowMarker(arrows.start, a, second));
  }

  if (connector.label) {
    const mid = pts[Math.floor(pts.length / 2)] ?? a;
    const label = svgEl('text', {
      x: round(mid.x),
      y: round(mid.y - 6),
      class: 'jects-diagram__connector-label',
      'text-anchor': 'middle',
    });
    label.textContent = connector.label;
    g.appendChild(label);
  }
  return g;
}

/** Build a `<g>` for a swimlane (body + header + title). */
export function renderSwimlane(lane: SwimlaneModel): SVGGElement {
  const g = svgEl('g', { 'data-swimlane': lane.id, class: 'jects-diagram__lane' });
  const body = svgEl('rect', {
    x: round(lane.x),
    y: round(lane.y),
    width: round(lane.w),
    height: round(lane.h),
    class: 'jects-diagram__lane-body',
  });
  g.appendChild(body);
  const headerThickness = 28;
  const header = svgEl('rect', {
    x: round(lane.x),
    y: round(lane.y),
    width:
      lane.orientation === 'horizontal' ? headerThickness : round(lane.w),
    height:
      lane.orientation === 'horizontal' ? round(lane.h) : headerThickness,
    class: 'jects-diagram__lane-header',
  });
  g.appendChild(header);
  if (lane.title) {
    const tx =
      lane.orientation === 'horizontal'
        ? lane.x + headerThickness / 2
        : lane.x + lane.w / 2;
    const ty =
      lane.orientation === 'horizontal'
        ? lane.y + lane.h / 2
        : lane.y + headerThickness / 2;
    const title = svgEl('text', {
      x: round(tx),
      y: round(ty),
      class: 'jects-diagram__lane-title',
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
    });
    if (lane.orientation === 'horizontal') {
      title.setAttribute('transform', `rotate(-90 ${round(tx)} ${round(ty)})`);
    }
    title.textContent = lane.title;
    g.appendChild(title);
  }
  return g;
}

/** Selection handles + bounding outline for one selected shape. */
export function renderSelectionOverlay(shape: ShapeModel): SVGGElement {
  const g = svgEl('g', { class: 'jects-diagram__handles', 'data-handles': shape.id });
  const outline = svgEl('rect', {
    x: round(shape.x),
    y: round(shape.y),
    width: round(shape.w),
    height: round(shape.h),
    class: 'jects-diagram__sel-outline',
  });
  g.appendChild(outline);
  if (shape.locked) return g;
  const anchors: Array<[string, number, number]> = [
    ['nw', 0, 0],
    ['n', 0.5, 0],
    ['ne', 1, 0],
    ['e', 1, 0.5],
    ['se', 1, 1],
    ['s', 0.5, 1],
    ['sw', 0, 1],
    ['w', 0, 0.5],
  ];
  for (const [name, ax, ay] of anchors) {
    const h = svgEl('rect', {
      x: round(shape.x + ax * shape.w - 4),
      y: round(shape.y + ay * shape.h - 4),
      width: 8,
      height: 8,
      class: 'jects-diagram__handle',
      'data-handle': name,
      'data-shape': shape.id,
    });
    g.appendChild(h);
  }
  return g;
}

/**
 * Full scene rebuild. Clears and repopulates the layer groups inside `svg`. The
 * widget calls this on any model/selection/view change (coalesced via rAF).
 */
export function renderScene(
  _svg: SVGSVGElement,
  engine: DiagramEngine,
  state: RenderState,
  layers: {
    grid: SVGGElement;
    lanes: SVGGElement;
    connectors: SVGGElement;
    shapes: SVGGElement;
    overlay: SVGGElement;
  },
): void {
  const { zoom, panX, panY } = state.view;
  const root = layers.shapes.parentElement as unknown as SVGGElement | null;
  if (root) {
    root.setAttribute(
      'transform',
      `translate(${round(panX)} ${round(panY)}) scale(${round(zoom, 4)})`,
    );
  }

  // Lanes (behind everything).
  layers.lanes.replaceChildren();
  for (const lane of engine.swimlanes.toArray()) {
    layers.lanes.appendChild(renderSwimlane(lane));
  }

  // Connectors.
  layers.connectors.replaceChildren();
  for (const c of engine.connectors.toArray()) {
    layers.connectors.appendChild(renderConnector(c, engine, state));
  }

  // Pending connector (drawing).
  if (state.pendingConnector) {
    const pc = state.pendingConnector;
    const p = svgEl('path', {
      d: `M ${round(pc.from.x)} ${round(pc.from.y)} L ${round(pc.to.x)} ${round(pc.to.y)}`,
      class: 'jects-diagram__connector-pending',
    });
    layers.connectors.appendChild(p);
  }

  // Shapes (sorted by z; group containers always render behind their children).
  layers.shapes.replaceChildren();
  const shapes = [...engine.shapes.toArray()].sort((a, b) => {
    const ga = a.type === 'group' ? 0 : 1;
    const gb = b.type === 'group' ? 0 : 1;
    if (ga !== gb) return ga - gb;
    return (a.z ?? 0) - (b.z ?? 0);
  });
  const visible = shapes.filter((s) => !(s.data && s.data.__hidden));
  // Roving tabindex: ensure exactly one shape is Tab-reachable. If no shape is
  // the focus cursor yet, the first visible shape becomes the tab stop so AT
  // users can Tab from the canvas straight onto a shape.
  const effState: RenderState =
    state.editable && state.focusId == null && visible[0]
      ? { ...state, focusId: visible[0].id }
      : state;
  for (const s of shapes) layers.shapes.appendChild(renderShape(s, effState));

  // Overlay: snap lines, selection handles, marquee.
  layers.overlay.replaceChildren();
  for (const line of state.snapLines) {
    const bounds = engine.getBounds();
    const guide =
      line.orientation === 'h'
        ? svgEl('line', {
            x1: round(bounds.x - 200),
            y1: round(line.pos),
            x2: round(bounds.x + bounds.width + 200),
            y2: round(line.pos),
            class: 'jects-diagram__snapline',
          })
        : svgEl('line', {
            x1: round(line.pos),
            y1: round(bounds.y - 200),
            x2: round(line.pos),
            y2: round(bounds.y + bounds.height + 200),
            class: 'jects-diagram__snapline',
          });
    layers.overlay.appendChild(guide);
  }
  if (state.editable) {
    for (const id of state.selection) {
      const s = engine.getShape(id);
      if (s) layers.overlay.appendChild(renderSelectionOverlay(s));
    }
  }
  if (state.marquee) {
    const m = state.marquee;
    layers.overlay.appendChild(
      svgEl('rect', {
        x: round(m.x),
        y: round(m.y),
        width: round(m.width),
        height: round(m.height),
        class: 'jects-diagram__marquee',
      }),
    );
  }
}

/** Build the full SVG layer skeleton once; returns the layer group handles. */
export function buildSvgLayers(svg: SVGSVGElement): {
  root: SVGGElement;
  grid: SVGGElement;
  lanes: SVGGElement;
  connectors: SVGGElement;
  shapes: SVGGElement;
  overlay: SVGGElement;
} {
  const root = svgEl('g', { class: 'jects-diagram__viewport' });
  const grid = svgEl('g', { class: 'jects-diagram__grid-layer' });
  const lanes = svgEl('g', { class: 'jects-diagram__lanes-layer' });
  const connectors = svgEl('g', { class: 'jects-diagram__connectors-layer' });
  const shapes = svgEl('g', { class: 'jects-diagram__shapes-layer' });
  const overlay = svgEl('g', { class: 'jects-diagram__overlay-layer' });
  root.append(grid, lanes, connectors, shapes, overlay);
  svg.appendChild(root);
  return { root, grid, lanes, connectors, shapes, overlay };
}

// Re-export so the widget can build chrome without importing createEl twice.
export { createEl };
