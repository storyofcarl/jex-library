/**
 * @jects/diagram engine barrel — the headless DiagramEngine and its pure
 * algorithm modules (geometry, shapes, routing, layout, hit-test, swimlanes,
 * serialization). DOM-free; the UI layer imports from here.
 */

export {
  DiagramEngineImpl,
  createDiagramEngine,
  BUILTIN_SHAPE_COUNT,
} from './engine.js';

// Geometry primitives
export {
  EPS,
  clamp,
  dist,
  dist2,
  pointsEqual,
  shapeRect,
  rectCenter,
  rectContains,
  rectsIntersect,
  inflate,
  unionRects,
  perimeterPoint,
  sideOf,
  sideNormal,
  distToSegment,
  distToPolyline,
  segmentIntersectsRect,
  segmentsIntersect,
  simplifyPath,
  roundPoint,
  type Side,
} from './geometry.js';

// Shape catalog
export {
  getBuiltinShape,
  builtinShapeTypes,
  resolvePorts,
  portPoint,
  shapeOutline,
  cardinalPorts,
  type BuiltinShape,
} from './shapes.js';

// Routing
export {
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
} from './routing.js';

// Layout
export {
  OrthogonalLayout,
  RadialLayout,
  builtinLayouts,
  layoutForMode,
  isVertical,
} from './layout.js';

// Hit-testing
export { hitTest, HIT_TOLERANCE, type HitTestInput } from './hit-test.js';

// Swimlanes
export {
  laneRect,
  laneOf,
  shapesInLane,
  childLanes,
  rootLanes,
  clampToLane,
  shapeCenter,
} from './swimlanes.js';

// Serialization
export {
  toDocument,
  fromDocument,
  deepClonePlain,
  DOCUMENT_VERSION,
  type NormalizedDocument,
  type SerializeInput,
} from './serialize.js';
