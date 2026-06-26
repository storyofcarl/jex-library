/**
 * @jects/timeline-core — interactions layer.
 *
 * Framework-free interaction primitives that operate purely against the FROZEN
 * timeline contract (`../contract.ts`): event/bar positioning + hit-testing on
 * the axis, pointer-driven drag / resize / drag-create gestures with tick
 * snapping and vetoable hooks, orthogonal dependency-line routing (SVG paths +
 * arrowheads for the four FS/SS/FF/SF link types), and a tooltip controller.
 *
 * Nothing here mutates a store, the renderer's DOM, or engine internals — the
 * gestures report proposed `TimeSpan`s through callbacks so the engine decides
 * what to apply (via `api.updateEventSpan` / `api.addDependency`). This keeps the
 * primitives reusable by both @jects/scheduler and @jects/gantt.
 *
 * Importing this module pulls in the interactions side-effect CSS.
 */

import './interactions.css';

// Shared utilities
export {
  Disposers,
  addListener,
  clamp,
  snapTime,
  spanDuration,
  shiftSpan,
  pxToDelta,
  spansEqual,
} from './shared.js';

// Positioning / hit-testing
export {
  spanBox,
  barBox,
  terminalPoint,
  zoneAtX,
  barContains,
  barAtPoint,
  timeAtX,
  sweepSpan,
  type Box,
  type Point,
  type BarZone,
} from './positioning.js';

// Drag / resize / drag-create primitives
export {
  startBarDrag,
  BarDragController,
  startDragCreate,
  DragCreateController,
  type DragMode,
  type DragState,
  type BarDragOptions,
  type DragCreateState,
  type DragCreateOptions,
} from './bar-drag.js';

// Dependency-line routing
export {
  OrthogonalDependencyRouter,
  routeWaypoints,
  toPath,
  arrowheadPath,
  type OrthogonalRouterOptions,
} from './dependency-router.js';

// Tooltip
export {
  TimelineTooltip,
  type TooltipPlacement,
  type TooltipOptions,
  type TooltipContent,
} from './tooltip.js';
