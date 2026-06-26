/**
 * @jects/timeline-core — shared timeline engine (D10).
 *
 * Importing this module pulls in the package's side-effect CSS.
 * Side-effect CSS: `import '@jects/timeline-core/style.css'`.
 */

import './styles.css';

/* ── Frozen public contract (types only) ─────────────────────────────────
   The shared timeline API surface the engine build agent implements and the
   @jects/scheduler + @jects/gantt packages render on. See contract.ts. */
export type {
  // Time primitives
  TimeMs,
  DurationMs,
  TimeUnit,
  TimeSpan,
  // View presets & ticks
  TimeHeaderBand,
  ViewPreset,
  TimeTick,
  // Axis
  TimeAxis,
  // Viewport
  TimelineViewport,
  // Rows & virtualization
  TimelineRow,
  RowWindow,
  RowVirtualizer,
  // Event bars
  TimelineEvent,
  EventBar,
  EventOverlapStrategy,
  EventLayout,
  // Dependency lines
  DependencyTerminal,
  DependencyLink,
  DependencyLine,
  DependencyRouter,
  // Rendering
  TimelinePaintWindow,
  TimelineRenderer,
  TimelineRendererFactory,
  // Options
  TimelineVirtualizationOptions,
  TimelineOptions,
  // Events
  TimelineWidgetEvents,
  // Features / plugins
  TimelineFeature,
  TimelineFeatureCtor,
  // Public surfaces
  TimelineApi,
  Timeline,
  TimelineCtor,
} from './contract.js';

/* ── Axis area ───────────────────────────────────────────────────────────
   Horizontal time ⇄ pixel projection: time-unit calendar arithmetic, the
   built-in view presets + zoom ladder, the DefaultTimeAxis, the
   DefaultRowVirtualizer (vertical virtualization seam over core
   computeWindow/OffsetIndex), the DefaultTimelineViewport, and the
   time-range / non-working-time / column-line backdrop geometry. */
export * from './axis/index.js';

/* ── Interactions area ───────────────────────────────────────────────────
   Framework-free interaction primitives over the frozen contract: event/bar
   positioning + hit-testing, pointer drag / resize / drag-create gestures
   with tick snapping, orthogonal dependency-line routing (FS/SS/FF/SF), and
   the tooltip controller. */
export * from './interactions/index.js';
