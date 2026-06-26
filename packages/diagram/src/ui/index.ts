/**
 * @jects/diagram UI barrel (area "diagram-ui").
 *
 * Exposes the `Diagram` Widget (the runtime implementation of the frozen
 * `DiagramCtor`/`Diagram` contract) plus the supporting UI pieces: the local
 * self-contained engine used when no engine is injected, the properties panel,
 * and the pure geometry / shape / alignment / export helpers. Importing the
 * `Diagram` module registers `register('diagram', Diagram)` with the factory and
 * pulls in the token-pure component CSS as a side effect.
 *
 * The UI codes strictly against the `DiagramEngine` interface from
 * `contract.ts`; the production engine (built in parallel in the "diagram-engine"
 * area) can be swapped in via `DiagramConfig.engine` / `engineFactory` without
 * touching anything here.
 */
export { Diagram } from './diagram.js';

export { LocalDiagramEngine, createLocalEngine } from './local-engine.js';

export {
  PropertiesPanel,
  type PropertiesPanelConfig,
  type PropertiesPanelEvents,
  type PanelTarget,
} from './properties-panel.js';

export {
  shapeGeometry,
  connectorPath,
  arrowMarker,
  defaultShapeSize,
  type ShapeGeometry,
} from './shapes.js';

export {
  alignShapes,
  distributeShapes,
  computeSnap,
  type AlignEdge,
  type DistributeAxis,
} from './align.js';

export {
  serializeSvg,
  svgToPngDataUrl,
  pngDataUrlToPdf,
  documentToJson,
  downloadBlob,
} from './export.js';

export {
  shapeRect,
  rectCenter,
  pointInRect,
  rectsIntersect,
  rectContainsRect,
  unionRects,
  normalizeRect,
  distToSegment,
  distToPolyline,
  snapScalar,
  snapPoint,
  clamp,
  round,
  resizeRect,
  RESIZE_HANDLES,
  type ResizeHandle,
} from './geometry.js';

export {
  buildSvgLayers,
  renderScene,
  renderShape,
  renderConnector,
  renderSwimlane,
  type RenderState,
  type ViewTransform,
  type SnapLine,
} from './renderer.js';
