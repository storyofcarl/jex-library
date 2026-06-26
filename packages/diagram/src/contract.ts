/**
 * @jects/diagram — FROZEN DIAGRAM CONTRACT (types & interfaces only; no implementation).
 *
 * This file is the stable, contract-first API for the ENGINE-UI seam of the
 * Jects diagramming component. It freezes the boundary the build agents code
 * against:
 *
 *   - The ENGINE agent implements the headless `DiagramEngine` — the framework-
 *     free model graph (shapes + connectors + swimlanes), connector routing,
 *     auto-layout, hit-testing, and JSON (de)serialization. The engine never
 *     touches the DOM.
 *   - The UI agent implements the `Diagram` Widget class (extends `Widget` from
 *     @jects/core, registers `register('diagram', Diagram)`) which OWNS a
 *     `DiagramEngine`, renders its model to SVG/DOM, and exposes the imperative
 *     `DiagramApi` consumers call. The UI talks to the engine ONLY through the
 *     `DiagramEngine` interface below.
 *
 * Rules of the contract:
 *   - Nothing here imports DOM-building or runtime logic; it only re-uses the
 *     framework-free types from `@jects/core` (`Store`, `Model`, `RecordId`,
 *     `WidgetConfig`, `WidgetEvents`, `EventMap`).
 *   - The `Diagram` Widget class itself is implemented by the UI agent; here we
 *     declare ONLY its public type signature (`DiagramCtor` + the `Diagram`
 *     interface shape) and the `DiagramApi` it surfaces.
 *   - Extension behaviors (custom shape kinds, custom routers, custom layouts)
 *     never reach into engine internals — they register against the engine
 *     through the typed extension registries declared at the bottom. This is
 *     the "DiagramEngine extension model".
 *
 * Serialization format: JSON. `toJSON()` returns a plain `DiagramDocument`
 * object (structured-clonable, `JSON.stringify`-safe); `fromJSON()` rehydrates
 * it. There is no binary or DOM-coupled format in the contract.
 */

import type {
  Store,
  Model,
  RecordId,
  WidgetConfig,
  WidgetEvents,
  EventMap,
  EventEmitter,
} from '@jects/core';

/* ═══════════════════════════════════════════════════════════════════════════
   0. PRIMITIVES — geometry & identifiers
   ═══════════════════════════════════════════════════════════════════════════ */

/** Stable identifier for a shape, connector, port, or swimlane. */
export type DiagramId = string;

/** A point in diagram (model) coordinate space. */
export interface Point {
  x: number;
  y: number;
}

/** A size in diagram coordinate space. */
export interface Size {
  width: number;
  height: number;
}

/** An axis-aligned bounding box in diagram coordinate space. */
export interface Rect extends Point, Size {}

/* ═══════════════════════════════════════════════════════════════════════════
   1. SHAPES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Built-in shape kinds (30+). `custom` defers geometry/rendering to a shape
 * definition registered via the engine's `registerShape` extension point.
 *
 * Grouped by family so authors can scan: flowchart, data/IO, control-flow,
 * UML-ish, org/mind, and generic primitives.
 */
export type ShapeType =
  // ── Generic primitives ──
  | 'rect'
  | 'rounded-rect'
  | 'ellipse'
  | 'circle'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'parallelogram'
  | 'trapezoid'
  | 'pentagon'
  | 'hexagon'
  | 'octagon'
  | 'star'
  | 'cross'
  | 'arrow-shape'
  | 'callout'
  | 'cloud'
  // ── Classic flowchart ──
  | 'process'
  | 'predefined-process'
  | 'decision'
  | 'terminator'
  | 'start'
  | 'end'
  | 'delay'
  | 'preparation'
  | 'manual-input'
  | 'manual-operation'
  // ── Data / IO ──
  | 'data'
  | 'document'
  | 'multi-document'
  | 'database'
  | 'storage'
  | 'internal-storage'
  | 'display'
  | 'card'
  | 'connector-ref'
  | 'off-page'
  // ── Org-chart / mind-map / project ──
  | 'org-node'
  | 'mind-node'
  | 'pert-node'
  | 'text'
  | 'image'
  // ── Containers ──
  | 'group'
  // ── Extension hook ──
  | 'custom';

/** Where a port sits on a shape's perimeter (or a free-floating offset). */
export type PortSide = 'top' | 'right' | 'bottom' | 'left' | 'center' | 'free';

/**
 * A connection anchor on a shape. Connectors attach to ports; if a connector
 * names no port, the engine resolves the nearest perimeter point at route time.
 */
export interface PortModel {
  /** Unique within the owning shape. */
  id: DiagramId;
  /** Perimeter side (or `free` for an absolute offset). */
  side: PortSide;
  /**
   * Normalized position along/within the shape, 0..1 in each axis relative to
   * the shape's bounding box (0,0 = top-left, 1,1 = bottom-right).
   */
  offset: Point;
  /** Optional human label (e.g. decision branch "Yes"/"No"). */
  label?: string;
  /** Whether connectors may originate / terminate here. */
  in?: boolean;
  out?: boolean;
}

/**
 * Visual style for a shape or connector. All values are theme-token names or
 * token-derived strings — renderers map these onto `--jects-*` tokens; the
 * contract carries no hardcoded color literals.
 */
export interface DiagramStyle {
  /** Fill token name, e.g. 'card' → `oklch(var(--jects-card))`. */
  fill?: string;
  /** Stroke (border) token name. */
  stroke?: string;
  strokeWidth?: number;
  /** Dash pattern in px, e.g. [4, 2]; empty/undefined = solid. */
  strokeDash?: number[];
  /** Text color token name. */
  textColor?: string;
  fontSize?: number;
  fontWeight?: number;
  /** Corner radius token or px for rounded variants. */
  radius?: number;
  /** 0..1 opacity. */
  opacity?: number;
  /** Free-form, renderer-specific extensions. */
  [key: string]: unknown;
}

/**
 * A single shape (node) in the diagram model. Extends `Model` so a `Store` of
 * shapes is a first-class `@jects/core` collection.
 */
export interface ShapeModel extends Model {
  id: DiagramId;
  /** Built-in kind or `custom` (resolved by a registered shape definition). */
  type: ShapeType;
  /** Top-left position in diagram coordinates. */
  x: number;
  y: number;
  /** Bounding-box size in diagram coordinates. */
  w: number;
  h: number;
  /** Primary text label rendered inside the shape. */
  text?: string;
  /** Visual style overrides. */
  style?: DiagramStyle;
  /** Named connection anchors. */
  ports?: PortModel[];
  /** Clockwise rotation in degrees about the shape center. */
  rotation?: number;
  /** Parent shape id for containment/grouping (e.g. a swimlane member). */
  parent?: DiagramId;
  /** Swimlane this shape belongs to, if any. */
  lane?: DiagramId;
  /** Z-order; higher renders on top. */
  z?: number;
  /** Whether the shape may be moved/resized by the UI. */
  locked?: boolean;
  /** Arbitrary user payload preserved across (de)serialization. */
  data?: Record<string, unknown>;
  /** For `type: 'custom'`, the registered shape-definition key. */
  shapeDef?: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. CONNECTORS
   ═══════════════════════════════════════════════════════════════════════════ */

/** How a connector's path is computed between its endpoints. */
export type ConnectorKind = 'straight' | 'elbow' | 'orthogonal' | 'curved';

/** Arrowhead glyph at a connector endpoint. */
export type ArrowHead = 'none' | 'arrow' | 'triangle' | 'diamond' | 'circle' | 'open';

/** A connector endpoint: a shape, optionally pinned to one of its ports. */
export interface ConnectorEnd {
  /** Target shape id. */
  shape: DiagramId;
  /** Optional port id on that shape; omitted = engine picks nearest perimeter. */
  port?: DiagramId;
}

/** Arrowhead configuration for both ends of a connector. */
export interface ConnectorArrows {
  start?: ArrowHead;
  end?: ArrowHead;
}

/**
 * A connector (edge/link) between two shapes. Extends `Model` so connectors
 * live in their own `Store`.
 */
export interface ConnectorModel extends Model {
  id: DiagramId;
  /** Source endpoint. */
  from: ConnectorEnd;
  /** Target endpoint. */
  to: ConnectorEnd;
  /** Routing strategy. */
  kind: ConnectorKind;
  /** Arrowheads (default `{ end: 'arrow' }`). */
  arrows?: ConnectorArrows;
  /** Midpoint label (e.g. "Yes"/"No" on a decision edge). */
  label?: string;
  /** Visual style overrides. */
  style?: DiagramStyle;
  /**
   * Cached/explicit waypoints from the last `route()` (model coordinates).
   * Populated by the engine; user-supplied points pin the route.
   */
  points?: Point[];
  /** If true, `points` are user-pinned and the router must preserve them. */
  pinned?: boolean;
  /** Z-order; higher renders on top. */
  z?: number;
  /** Arbitrary user payload preserved across (de)serialization. */
  data?: Record<string, unknown>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. SWIMLANES
   ═══════════════════════════════════════════════════════════════════════════ */

/** Orientation of a swimlane pool. */
export type LaneOrientation = 'horizontal' | 'vertical';

/**
 * A swimlane (pool/lane) that partitions the canvas and contains shapes.
 * Lanes may nest (a pool with child lanes) via `parent`.
 */
export interface SwimlaneModel extends Model {
  id: DiagramId;
  /** Lane header / title text. */
  title?: string;
  orientation: LaneOrientation;
  /** Bounding box of the lane in diagram coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Parent pool/lane id for nesting. */
  parent?: DiagramId;
  /** Ordering among sibling lanes. */
  order?: number;
  /** Visual style overrides (header + body). */
  style?: DiagramStyle;
  /** Arbitrary user payload. */
  data?: Record<string, unknown>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. MODES & AUTO-LAYOUT
   ═══════════════════════════════════════════════════════════════════════════ */

/** Authoring/interaction mode; biases defaults, tooling, and auto-layout. */
export type DiagramMode = 'flowchart' | 'orgchart' | 'mindmap' | 'pert';

/** Auto-layout algorithm family. */
export type LayoutKind = 'orthogonal' | 'radial';

/** Direction for directed layouts (flow / tree). */
export type LayoutDirection = 'down' | 'up' | 'right' | 'left';

/** Tunables passed to an auto-layout pass. */
export interface AutoLayoutOptions {
  /** Spacing between sibling nodes (px, diagram coords). */
  nodeSpacing?: number;
  /** Spacing between ranks/levels (px). */
  rankSpacing?: number;
  /** Flow direction for orthogonal/tree layouts. */
  direction?: LayoutDirection;
  /** Origin the layout grows from. */
  origin?: Point;
  /** Re-route connectors after positioning (default true). */
  rerouteConnectors?: boolean;
}

/**
 * A pluggable auto-layout algorithm. The engine ships `orthogonal` (layered /
 * Sugiyama-style flow & org trees) and `radial` (mind-map / hub-and-spoke);
 * extensions register additional layouts under their own `kind`.
 */
export interface AutoLayout {
  /** Unique layout kind (built-in or extension). */
  readonly kind: LayoutKind | string;
  /**
   * Compute new positions for `shapes` (and optionally connector waypoints).
   * Pure: returns a positions patch; the engine applies it transactionally.
   */
  apply(
    shapes: readonly ShapeModel[],
    connectors: readonly ConnectorModel[],
    options: AutoLayoutOptions,
  ): LayoutResult;
}

/** Output of an `AutoLayout.apply` pass — a patch the engine applies. */
export interface LayoutResult {
  /** New top-left positions, keyed by shape id. */
  positions: Map<DiagramId, Point>;
  /** Optional new connector waypoints, keyed by connector id. */
  routes?: Map<DiagramId, Point[]>;
  /** Resulting content bounds (for fit-to-view). */
  bounds?: Rect;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. ROUTING (connector path computation)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Resolved geometry for a connector after routing. */
export interface RouteResult {
  /** Ordered waypoints in diagram coordinates (>= 2 points). */
  points: Point[];
  /** Resolved start/end attachment points on the shapes' perimeters. */
  startPoint: Point;
  endPoint: Point;
}

/**
 * A pluggable connector router. The engine maps each `ConnectorKind` to a
 * registered `ConnectorRouter`; extensions can override or add kinds.
 */
export interface ConnectorRouter {
  /** The connector kind this router handles. */
  readonly kind: ConnectorKind | string;
  /** Compute the path for `connector` given the current model graph. */
  route(
    connector: ConnectorModel,
    from: ShapeModel,
    to: ShapeModel,
    obstacles: readonly ShapeModel[],
  ): RouteResult;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. HIT-TESTING
   ═══════════════════════════════════════════════════════════════════════════ */

/** What kind of model element a hit landed on. */
export type HitKind = 'shape' | 'connector' | 'port' | 'swimlane' | 'none';

/** Result of a point hit-test against the model graph. */
export interface HitResult {
  kind: HitKind;
  /** Id of the hit element (undefined when `kind === 'none'`). */
  id?: DiagramId;
  /** For a port hit, the owning shape id and port id. */
  shape?: DiagramId;
  port?: DiagramId;
  /** Distance from the query point to the element (model units). */
  distance?: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. SERIALIZATION (JSON)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The plain-object JSON document produced by `toJSON()` / consumed by
 * `fromJSON()`. Structured-clonable and `JSON.stringify`-safe.
 */
export interface DiagramDocument {
  /** Schema version for forward/backward migration. */
  version: number;
  /** Active authoring mode at save time. */
  mode: DiagramMode;
  shapes: ShapeModel[];
  connectors: ConnectorModel[];
  swimlanes?: SwimlaneModel[];
  /** Optional canvas / view metadata (pan, zoom, page size). */
  meta?: Record<string, unknown>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. ENGINE — headless model graph + algorithms (no DOM)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Construction options for a `DiagramEngine`. */
export interface DiagramEngineOptions {
  mode?: DiagramMode;
  shapes?: ShapeModel[];
  connectors?: ConnectorModel[];
  swimlanes?: SwimlaneModel[];
  /** Pre-registered custom shape definitions. */
  shapeDefs?: ShapeDefinition[];
  /** Pre-registered routers (override built-ins by `kind`). */
  routers?: ConnectorRouter[];
  /** Pre-registered layouts (override built-ins by `kind`). */
  layouts?: AutoLayout[];
}

/** Typed event map the engine emits as the model mutates. */
export interface DiagramEngineEvents extends EventMap {
  shapeAdd: { shape: ShapeModel };
  shapeRemove: { shape: ShapeModel };
  shapeChange: { shape: ShapeModel; changes: Partial<ShapeModel> };
  connectorAdd: { connector: ConnectorModel };
  connectorRemove: { connector: ConnectorModel };
  connectorChange: { connector: ConnectorModel; changes: Partial<ConnectorModel> };
  connectorRoute: { connector: ConnectorModel; route: RouteResult };
  laneChange: { lane: SwimlaneModel };
  layout: { kind: LayoutKind | string; result: LayoutResult };
  load: { document: DiagramDocument };
  /** Any structural change (coalesced) — UI re-render trigger. */
  change: { reason: string };
}

/**
 * The headless diagram engine: the framework-free model graph plus the
 * routing / layout / hit-test / serialization algorithms. The UI Widget owns
 * one of these and is the only thing that renders it.
 *
 * Shapes, connectors, and swimlanes are exposed as `@jects/core` `Store`s so
 * the UI can subscribe to fine-grained collection events.
 */
export interface DiagramEngine {
  /** Active authoring mode. */
  readonly mode: DiagramMode;
  readonly shapes: Store<ShapeModel>;
  readonly connectors: Store<ConnectorModel>;
  readonly swimlanes: Store<SwimlaneModel>;
  /** Engine-level event bus. */
  readonly events: EventEmitter<DiagramEngineEvents>;

  /** Switch authoring mode (re-biases tooling defaults). */
  setMode(mode: DiagramMode): void;

  // ── Shape graph mutation ──
  addShape(shape: ShapeModel): ShapeModel;
  updateShape(id: DiagramId, changes: Partial<ShapeModel>): ShapeModel | undefined;
  removeShape(id: DiagramId): ShapeModel | undefined;
  getShape(id: DiagramId): ShapeModel | undefined;

  // ── Connector graph mutation ──
  addConnector(connector: ConnectorModel): ConnectorModel;
  updateConnector(id: DiagramId, changes: Partial<ConnectorModel>): ConnectorModel | undefined;
  removeConnector(id: DiagramId): ConnectorModel | undefined;
  getConnector(id: DiagramId): ConnectorModel | undefined;

  // ── Swimlanes ──
  addSwimlane(lane: SwimlaneModel): SwimlaneModel;
  updateSwimlane(id: DiagramId, changes: Partial<SwimlaneModel>): SwimlaneModel | undefined;
  removeSwimlane(id: DiagramId): SwimlaneModel | undefined;

  /** Compute (and cache on the model) the path for one connector. */
  route(connector: ConnectorModel | DiagramId): RouteResult;
  /** Re-route every connector (e.g. after a bulk move). */
  routeAll(): void;

  /** Run an auto-layout pass and apply it transactionally. */
  autoLayout(kind: LayoutKind | string, options?: AutoLayoutOptions): LayoutResult;

  /** Point hit-test against the model graph (topmost element wins). */
  hitTest(point: Point, tolerance?: number): HitResult;

  /** Axis-aligned content bounds of all elements (for fit-to-view). */
  getBounds(): Rect;

  // ── Serialization (JSON) ──
  toJSON(): DiagramDocument;
  fromJSON(doc: DiagramDocument): void;

  // ── Extension registries (the DiagramEngine extension model) ──
  registerShape(def: ShapeDefinition): void;
  registerRouter(router: ConnectorRouter): void;
  registerLayout(layout: AutoLayout): void;

  /** Dispose stores, listeners, and registries. */
  destroy(): void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   9. EXTENSION MODEL — shape definitions
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A custom shape kind registered via `engine.registerShape`. Provides default
 * geometry/ports and a token-based default style; the matching `ShapeModel`
 * uses `type: 'custom'` + `shapeDef: <key>`.
 */
export interface ShapeDefinition {
  /** Registry key referenced by `ShapeModel.shapeDef`. */
  key: string;
  /** Default size when a shape of this kind is created. */
  defaultSize: Size;
  /** Default ports for instances of this kind. */
  defaultPorts?: PortModel[];
  /** Default token-based style. */
  defaultStyle?: DiagramStyle;
  /**
   * Perimeter path generator in normalized 0..1 coordinates — the renderer
   * scales it to the shape box. Returns an SVG path command string.
   */
  outline?(size: Size): string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   10. UI — the Diagram Widget + the imperative API consumers call
   ═══════════════════════════════════════════════════════════════════════════ */

/** Selection granularity in the UI. */
export type DiagramSelectionMode = 'none' | 'single' | 'multi';

/** Public config for the `Diagram` Widget (merged under user config). */
export interface DiagramConfig extends WidgetConfig {
  mode?: DiagramMode;
  shapes?: ShapeModel[];
  connectors?: ConnectorModel[];
  swimlanes?: SwimlaneModel[];
  /** Whether the canvas is editable (vs. read-only viewer). */
  editable?: boolean;
  /** Initial zoom (1 = 100%). */
  zoom?: number;
  /** Show the background grid. */
  grid?: boolean;
  /** Snap moved/resized shapes to this grid step (model units). */
  snap?: number;
  selectionMode?: DiagramSelectionMode;
  /** Default routing kind for newly drawn connectors. */
  defaultConnectorKind?: ConnectorKind;
}

/** Typed event map emitted by the `Diagram` Widget (UI-level). */
export interface DiagramEvents extends WidgetEvents {
  /** Vetoable: return false to cancel the selection change. */
  beforeSelect: { ids: DiagramId[] };
  select: { ids: DiagramId[] };
  /** Vetoable: return false to cancel a shape/connector creation. */
  beforeChange: { reason: string };
  change: { document: DiagramDocument };
  shapeClick: { shape: ShapeModel; event: MouseEvent };
  connectorClick: { connector: ConnectorModel; event: MouseEvent };
  /** A shape was moved/resized by the user. */
  shapeTransform: { shape: ShapeModel };
  zoom: { zoom: number };
}

/**
 * The imperative public API the UI surfaces to consumers (and wrappers wrap).
 * This is the stable contract callers depend on; it delegates to the owned
 * `DiagramEngine` for model/algorithm work and adds view/selection concerns.
 */
export interface DiagramApi {
  /** The headless engine backing this view. */
  readonly engine: DiagramEngine;

  // ── Model authoring (delegates to engine, then re-renders) ──
  addShape(shape: ShapeModel): ShapeModel;
  addConnector(connector: ConnectorModel): ConnectorModel;
  updateShape(id: DiagramId, changes: Partial<ShapeModel>): void;
  updateConnector(id: DiagramId, changes: Partial<ConnectorModel>): void;
  remove(ids: DiagramId | DiagramId[]): void;

  // ── Swimlanes ──
  addSwimlane(lane: SwimlaneModel): SwimlaneModel;
  updateSwimlane(id: DiagramId, changes: Partial<SwimlaneModel>): void;
  removeSwimlane(id: DiagramId): void;

  // ── Grouping ──
  /** Group the given shapes under a freshly-created group container; returns its id. */
  group(ids: DiagramId[]): DiagramId | undefined;
  /** Dissolve a group, detaching its children; returns the freed child ids. */
  ungroup(id: DiagramId): DiagramId[];

  // ── Undo / redo ──
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // ── Layout & routing ──
  autoLayout(kind: LayoutKind | string, options?: AutoLayoutOptions): void;
  route(connector: DiagramId): RouteResult;

  // ── Selection ──
  select(ids: DiagramId | DiagramId[]): void;
  getSelection(): DiagramId[];
  clearSelection(): void;

  // ── View ──
  setZoom(zoom: number): void;
  getZoom(): number;
  fitToView(): void;
  /** Screen → diagram coordinate conversion (for custom interactions). */
  toModelPoint(clientX: number, clientY: number): Point;
  hitTest(point: Point): HitResult;

  // ── Mode + persistence ──
  setMode(mode: DiagramMode): void;
  getMode(): DiagramMode;
  toJSON(): DiagramDocument;
  fromJSON(doc: DiagramDocument): void;

  destroy(): void;
}

/**
 * The `Diagram` Widget public shape: a `Widget` (built by the UI agent) that
 * implements `DiagramApi`. Declared here as an interface so the contract has
 * no runtime dependency on the implementation.
 */
export interface Diagram extends DiagramApi {
  readonly id: string;
  readonly el: HTMLElement;
  update(patch: Partial<DiagramConfig>): this;
  getConfig(): Readonly<DiagramConfig>;
  on<K extends keyof DiagramEvents>(
    event: K,
    fn: (payload: DiagramEvents[K]) => unknown,
  ): () => void;
  emit<K extends keyof DiagramEvents>(event: K, payload: DiagramEvents[K]): boolean;
  show(): this;
  hide(): this;
  get isDestroyed(): boolean;
}

/** Constructor signature for the `Diagram` Widget (implemented by the UI agent). */
export interface DiagramCtor {
  new (host: HTMLElement | string, config?: DiagramConfig): Diagram;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Re-export the shared id alias for convenience at the package boundary.
   ═══════════════════════════════════════════════════════════════════════════ */

export type { RecordId };
