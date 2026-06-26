/**
 * @jects/diagram — Jects UI diagramming component built on @jects/core.
 *
 * Framework-free `DiagramEngine` (model graph + routing + auto-layout +
 * hit-test + JSON serialization) with a `Diagram` Widget UI on top. Reuses
 * @jects/widgets controls (Toolbar/Menu/Popup) for chrome. Importing this
 * module registers the component(s) with the factory.
 *
 * Side-effect CSS: `import '@jects/diagram/style.css'`.
 */

import './styles.css';

/* ── Frozen public contract (types only) ─────────────────────────────────
   The ENGINE-UI seam the build agents code against. See contract.ts. */
export type {
  // Primitives
  DiagramId,
  Point,
  Size,
  Rect,
  // Shapes
  ShapeType,
  PortSide,
  PortModel,
  DiagramStyle,
  ShapeModel,
  // Connectors
  ConnectorKind,
  ArrowHead,
  ConnectorEnd,
  ConnectorArrows,
  ConnectorModel,
  // Swimlanes
  LaneOrientation,
  SwimlaneModel,
  // Modes & auto-layout
  DiagramMode,
  LayoutKind,
  LayoutDirection,
  AutoLayoutOptions,
  AutoLayout,
  LayoutResult,
  // Routing
  RouteResult,
  ConnectorRouter,
  // Hit-testing
  HitKind,
  HitResult,
  // Serialization
  DiagramDocument,
  // Engine
  DiagramEngineOptions,
  DiagramEngineEvents,
  DiagramEngine,
  // Extension model
  ShapeDefinition,
  // UI surfaces
  DiagramSelectionMode,
  DiagramConfig,
  DiagramEvents,
  DiagramApi,
  DiagramCtor,
} from './contract.js';

/* ── Runtime: the Diagram Widget (importing runs `register('diagram', Diagram)`)
   plus the headless engine it drives. ─────────────────────────────────────── */
export { Diagram } from './ui/diagram.js';

/* ── Headless engine: the production `DiagramEngine` implementation + factory,
   plus the self-contained local engine the UI uses by default. Either may be
   injected via `DiagramConfig.engine` / `engineFactory`. ───────────────────── */
export { DiagramEngineImpl, createDiagramEngine, BUILTIN_SHAPE_COUNT } from './engine/index.js';
export { LocalDiagramEngine, createLocalEngine } from './ui/local-engine.js';

/* ── Selected UI helpers consumers may need (properties panel, align/export
   utilities). The full surface lives in the `./ui` and `./engine` barrels. ── */
export {
  PropertiesPanel,
  type PropertiesPanelConfig,
  type PropertiesPanelEvents,
  type PanelTarget,
} from './ui/properties-panel.js';

/* ── Engine algorithm surface ─────────────────────────────────────────────────
   The headless routing / layout / swimlane / shape-catalog helpers from the
   `./engine` barrel. Previously unreachable from the package root despite the
   header comment claiming otherwise. Named (not `export *`) so the shared
   geometry helpers — re-exported by BOTH barrels — don't collide. */
export {
  // Routing
  StraightRouter,
  ElbowRouter,
  OrthogonalRouter,
  CurvedRouter,
  builtinRouters,
  resolveEndpoints,
  elbowPath,
  arrowGeometry,
  ROUTE_CLEARANCE,
  type ArrowGeometry,
  // Layout
  OrthogonalLayout,
  RadialLayout,
  builtinLayouts,
  layoutForMode,
  isVertical,
  // Shape catalog
  getBuiltinShape,
  builtinShapeTypes,
  resolvePorts,
  portPoint,
  shapeOutline,
  cardinalPorts,
  type BuiltinShape,
  // Swimlane utilities
  laneRect,
  laneOf,
  shapesInLane,
  childLanes,
  rootLanes,
  clampToLane,
  shapeCenter,
  // Hit-testing
  hitTest,
  HIT_TOLERANCE,
  type HitTestInput,
  // Serialization
  toDocument,
  fromDocument,
  DOCUMENT_VERSION,
  type NormalizedDocument,
  type SerializeInput,
  // Engine geometry primitives (the canonical copy; the UI barrel re-exports a
  // parallel set under the same names, which is why this is a named re-export).
  perimeterPoint,
  sideOf,
  sideNormal,
  segmentIntersectsRect,
  segmentsIntersect,
  simplifyPath,
  type Side,
} from './engine/index.js';

/* ── UI helper surface ────────────────────────────────────────────────────────
   Pure UI helpers from the `./ui` barrel: alignment/distribution, the SVG
   renderer, and shape/connector geometry. `Diagram`, `LocalDiagramEngine`, and
   `PropertiesPanel` are already exported above; geometry names shared with the
   engine barrel are intentionally NOT re-exported here to avoid collisions. */
export {
  alignShapes,
  distributeShapes,
  computeSnap,
  type AlignEdge,
  type DistributeAxis,
} from './ui/align.js';

export {
  shapeGeometry,
  connectorPath,
  arrowMarker,
  defaultShapeSize,
  type ShapeGeometry,
} from './ui/shapes.js';

export {
  buildSvgLayers,
  renderScene,
  renderShape,
  renderConnector,
  renderSwimlane,
  type RenderState,
  type ViewTransform,
  type SnapLine,
} from './ui/renderer.js';

export {
  serializeSvg,
  svgToPngDataUrl,
  pngDataUrlToPdf,
  documentToJson,
  downloadBlob,
} from './ui/export.js';
