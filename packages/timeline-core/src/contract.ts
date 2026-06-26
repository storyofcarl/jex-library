/**
 * @jects/timeline-core — FROZEN TIMELINE CONTRACT (types & interfaces only; no implementation).
 *
 * The shared, framework-free timeline engine factored out before Gantt and
 * Scheduler (decision D10). Both `@jects/scheduler` and `@jects/gantt` render on
 * top of THIS contract: they consume the `TimeAxis` projection, the row
 * virtualization seam, the `EventBar`/`DependencyLine` positioning models, and
 * the `Timeline` Widget surface; they extend behavior purely through the
 * `TimelineApi` (the "TimelineApi extension model", see notes at the bottom).
 *
 * Rules of the contract (same discipline as packages/grid/src/contract.ts):
 *   - Nothing here imports DOM-building or runtime logic; it only re-uses the
 *     framework-free types from `@jects/core` (`Store`, `Model`, `RecordId`,
 *     `WidgetConfig`, `WidgetEvents`, `EventMap`, `ReadonlySignal`).
 *   - The `Timeline` Widget class itself is implemented by the engine build
 *     agent; here we declare ONLY its public type signature (`TimelineCtor` +
 *     the `Timeline` interface shape).
 *   - Features/overlays never reach into engine internals — they extend
 *     behavior through the `TimelineApi` handed to `TimelineFeature.init(api)`.
 *
 * Time is modelled in epoch milliseconds (UTC) throughout. Calendar-aware
 * (working-time) projection is layered on by consumers (e.g. the Gantt
 * scheduling engine) — this core stays calendar-agnostic.
 */

import type {
  Store,
  Model,
  RecordId,
  WidgetConfig,
  WidgetEvents,
  EventMap,
  ReadonlySignal,
} from '@jects/core';

/* ═══════════════════════════════════════════════════════════════════════════
   1. TIME PRIMITIVES
   ═══════════════════════════════════════════════════════════════════════════ */

/** A point in time, epoch milliseconds (UTC). */
export type TimeMs = number;

/** A duration in milliseconds. */
export type DurationMs = number;

/** The granularity of a single tick/header band. */
export type TimeUnit =
  | 'millisecond'
  | 'second'
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year';

/** A half-open time interval `[start, end)`. */
export interface TimeSpan {
  /** Inclusive start, epoch ms. */
  start: TimeMs;
  /** Exclusive end, epoch ms. */
  end: TimeMs;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. VIEW PRESETS & TICK MODEL (hour/day/week/month/year + zoom)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One header band of a preset (presets stack bands top→bottom, coarse→fine).
 * e.g. a "week/day" preset has a top `week` band and a bottom `day` band.
 */
export interface TimeHeaderBand {
  /** The unit each cell of this band spans. */
  unit: TimeUnit;
  /** How many `unit`s each cell spans (e.g. `2` hours). Default `1`. */
  increment?: number;
  /** Formatter key/pattern resolved by the renderer to label each cell. */
  format?: string;
  /** Optional alignment hint for the band's cell labels. */
  align?: 'start' | 'center' | 'end';
}

/**
 * A named zoom level / view configuration: the band stack plus the base
 * pixels-per-`tickUnit` that fixes horizontal scale. Zooming swaps presets
 * (and/or scales `pxPerUnit`) along an ordered `zoomLevels` ladder.
 */
export interface ViewPreset {
  /** Stable id (e.g. `'weekAndDay'`, `'hourAndDay'`, `'monthAndYear'`). */
  id: string;
  /** Human label for preset pickers. */
  label?: string;
  /** Header bands, coarse (top) → fine (bottom). */
  headers: TimeHeaderBand[];
  /** The unit the bottom (finest) tick lane is measured in. */
  tickUnit: TimeUnit;
  /** How many `tickUnit`s per finest tick. Default `1`. */
  tickIncrement?: number;
  /** Base width in px of one `tickUnit` at this preset's neutral zoom. */
  pxPerUnit: number;
  /** Discrete zoom multipliers selectable for this preset (1 = neutral). */
  zoomLevels?: number[];
}

/**
 * A single rendered tick on the finest lane (one cell of the bottom band).
 * The axis emits these for the renderer to paint gridlines/labels.
 */
export interface TimeTick {
  /** Tick index from the axis origin. */
  index: number;
  /** The tick's time span. */
  span: TimeSpan;
  /** Left pixel offset of the tick within the axis content. */
  x: number;
  /** Pixel width of the tick. */
  width: number;
  /** Whether this tick begins a coarser band boundary (major gridline). */
  major: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. TIME AXIS (time ⇄ pixel projection)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The horizontal projection engine: maps time ⇄ pixels for the active preset &
 * zoom over a bounded `range`. Pure geometry — no DOM. This is the seam both
 * Scheduler and Gantt share for positioning every bar, line, and gridline.
 */
export interface TimeAxis {
  /** Total time range the axis covers. */
  readonly range: TimeSpan;
  /** Active view preset. */
  readonly preset: ViewPreset;
  /** Active zoom multiplier (from the preset's `zoomLevels`). */
  readonly zoom: number;
  /** Total horizontal content width in px for the whole range. */
  readonly contentWidth: number;

  /** Project a time → pixel x within axis content. */
  toX(time: TimeMs): number;
  /** Project a pixel x → time within axis content. */
  toTime(x: number): TimeMs;
  /** Project a span → `{ x, width }` box. */
  spanToBox(span: TimeSpan): { x: number; width: number };
  /** Width in px of a duration at the current scale. */
  durationToWidth(duration: DurationMs): number;

  /** Generate the finest-lane ticks intersecting a pixel window. */
  ticksInRange(xStart: number, xEnd: number): TimeTick[];
  /** Snap a time to the nearest tick boundary (for drag/resize). */
  snap(time: TimeMs): TimeMs;

  /** Switch preset and/or zoom (re-projects everything downstream). */
  setView(view: { preset?: ViewPreset; zoom?: number }): void;
  /** Widen/narrow the covered time range. */
  setRange(range: TimeSpan): void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. VIEWPORT (scroll surface; both axes)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Read-only viewport/scroll surface exposed to features. The engine owns it;
 * features query geometry and request scrolls but never mutate it directly.
 * Horizontal axis is time (via `TimeAxis`); vertical axis is rows.
 */
export interface TimelineViewport {
  /** Vertical scroll in px. */
  readonly scrollTop: number;
  /** Horizontal scroll in px. */
  readonly scrollLeft: number;
  /** Visible viewport height in px. */
  readonly height: number;
  /** Visible viewport width in px. */
  readonly width: number;
  /** The time span currently visible horizontally (derived from scroll). */
  readonly visibleSpan: TimeSpan;
  /** The current row window (vertical virtualization result). */
  readonly rowWindow: RowWindow;

  /** Scroll a time into horizontal view. */
  scrollToTime(time: TimeMs): void;
  /** Scroll a row into vertical view. */
  scrollToRow(rowIndex: number): void;
  /** Set raw scroll position. */
  scrollTo(opts: { top?: number; left?: number }): void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. ROW MODEL & ROW-VIRTUALIZATION SEAM
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A horizontal lane in the timeline (a resource in Scheduler, a task in Gantt).
 * Rows are supplied by a core `Store`; the engine assigns geometry.
 */
export interface TimelineRow<R extends Model = Model> {
  /** Stable row id (the store record id). */
  id: RecordId;
  /** The backing record. */
  record: R;
  /** Resolved row height in px (variable heights allowed). */
  height: number;
  /** Depth for tree/nested rows (0 = root). */
  depth?: number;
  /** Whether the row is currently expanded (tree rows). */
  expanded?: boolean;
}

/**
 * The vertical-virtualization result: the contiguous block of rows the renderer
 * must paint, with pixel geometry. Maps onto core `computeWindow`/`OffsetIndex`.
 */
export interface RowWindow<R extends Model = Model> {
  /** First painted row index (inclusive), incl. overscan. */
  startIndex: number;
  /** Last painted row index (exclusive), incl. overscan. */
  endIndex: number;
  /** translateY offset in px for the first painted row. */
  offset: number;
  /** Total scrollable height of all rows in px. */
  totalSize: number;
  /** The resolved rows in `[startIndex, endIndex)`, with geometry. */
  rows: ReadonlyArray<TimelineRow<R>>;
}

/**
 * The row-virtualization seam. The engine implements a default backed by the
 * core virtualization math; features and the renderer consume it read-only.
 * Decoupling this lets Scheduler (resource rows) and Gantt (task-tree rows)
 * supply different row providers without changing the paint loop.
 */
export interface RowVirtualizer<R extends Model = Model> {
  /** Total row count in the current (filtered/expanded) view. */
  readonly count: number;
  /** Top pixel offset of a row. */
  offsetOf(rowIndex: number): number;
  /** Height in px of a row. */
  heightOf(rowIndex: number): number;
  /** Row index spanning a vertical pixel. */
  indexAt(y: number): number;
  /** The row model at an index. */
  rowAt(rowIndex: number): TimelineRow<R> | undefined;
  /** Compute the window for a scroll/viewport state. */
  computeWindow(input: { scrollTop: number; viewportHeight: number; overscan?: number }): RowWindow<R>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. EVENT BARS (positioned items on the time grid)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A schedulable item placed on the time grid (an event in Scheduler, a task bar
 * in Gantt). `rowId` ties it to a lane; `span` ties it to the axis.
 */
export interface TimelineEvent<E extends Model = Model> {
  /** Stable event id. */
  id: RecordId;
  /** The lane this event belongs to. */
  rowId: RecordId;
  /** The event's time span. */
  span: TimeSpan;
  /** The backing record (task, booking, reservation, ...). */
  record: E;
  /** 0..1 progress fill (Gantt percentDone, etc.). */
  progress?: number;
  /** Whether the user may drag/resize this event. */
  editable?: boolean;
  /** Optional CSS modifier / category key for styling. */
  styleKey?: string;
}

/**
 * The computed pixel box of one event within its row, after axis projection and
 * intra-row stacking (overlap resolution). Produced by an `EventLayout`.
 */
export interface EventBar<E extends Model = Model> {
  /** The source event. */
  event: TimelineEvent<E>;
  /** Left px within axis content. */
  x: number;
  /** Width px. */
  width: number;
  /** Top px within the row (for stacked/overlapping events). */
  y: number;
  /** Height px of the bar. */
  height: number;
  /** Stack lane index within the row (0-based) when events overlap. */
  lane: number;
}

/** How overlapping events in one row are arranged. */
export type EventOverlapStrategy = 'stack' | 'overlap' | 'pack';

/**
 * Per-row event positioning model. Given the row's events and the axis, returns
 * laid-out bars plus the row's intrinsic content height (for variable heights).
 */
export interface EventLayout<E extends Model = Model> {
  /** Overlap-resolution strategy. */
  readonly strategy: EventOverlapStrategy;
  /** Lay out one row's events into bars. */
  layoutRow(input: {
    rowId: RecordId;
    events: ReadonlyArray<TimelineEvent<E>>;
    axis: TimeAxis;
    rowHeight: number;
  }): { bars: EventBar<E>[]; contentHeight: number };
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. DEPENDENCY LINES
   ═══════════════════════════════════════════════════════════════════════════ */

/** Which terminal of an event a dependency line attaches to. */
export type DependencyTerminal = 'start' | 'end';

/**
 * A directed link between two events, drawn as a connector. The semantic type
 * (FS/SS/FF/SF) lives in the consuming engine (e.g. Gantt's `DependencyModel`);
 * this core only needs the from/to terminals to route the line.
 */
export interface DependencyLink {
  /** Stable link id. */
  id: RecordId;
  /** Source event id. */
  fromId: RecordId;
  /** Target event id. */
  toId: RecordId;
  /** Terminal on the source event. Default `'end'`. */
  fromSide?: DependencyTerminal;
  /** Terminal on the target event. Default `'start'`. */
  toSide?: DependencyTerminal;
  /** Optional CSS modifier / category key. */
  styleKey?: string;
}

/**
 * The routed pixel geometry of a dependency connector, ready to paint (as an
 * SVG path or segmented polyline). Produced by a `DependencyRouter`.
 */
export interface DependencyLine {
  /** The source link. */
  link: DependencyLink;
  /** Start point (px, axis/row content coordinates). */
  from: { x: number; y: number };
  /** End point (px). */
  to: { x: number; y: number };
  /** Ordered waypoints between `from` and `to` (orthogonal routing). */
  waypoints: ReadonlyArray<{ x: number; y: number }>;
  /** A ready-to-use SVG path `d` string for the connector. */
  path: string;
}

/**
 * Routes dependency links to pixel connectors given laid-out bars and the axis.
 * Implemented by the engine; consumers may swap routers for different styles.
 */
export interface DependencyRouter<E extends Model = Model> {
  /** Route all visible links against the current bar layout. */
  route(input: {
    links: ReadonlyArray<DependencyLink>;
    bars: ReadonlyMap<RecordId, EventBar<E>>;
    axis: TimeAxis;
  }): DependencyLine[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. PLUGGABLE RENDERER (D9 parity with grid)
   ═══════════════════════════════════════════════════════════════════════════ */

/** The window the renderer must paint, derived from viewport + axis + rows. */
export interface TimelinePaintWindow<E extends Model = Model> {
  /** Vertical row window. */
  rows: RowWindow;
  /** Visible finest-lane ticks for the time-grid backdrop. */
  ticks: ReadonlyArray<TimeTick>;
  /** Laid-out event bars keyed by event id. */
  bars: ReadonlyMap<RecordId, EventBar<E>>;
  /** Routed dependency connectors. */
  dependencies: ReadonlyArray<DependencyLine>;
  /** Current scroll position. */
  scrollTop: number;
  scrollLeft: number;
}

/**
 * Pluggable rendering backend (DOM-recycling default; canvas later — D9). The
 * engine drives it ONLY through this interface, so Scheduler/Gantt can share or
 * override the paint strategy without touching the engine.
 */
export interface TimelineRenderer<E extends Model = Model> {
  /** Build static chrome (header bands, body, scrollers) and attach. */
  mount(host: HTMLElement, api: TimelineApi<E>): void;
  /** Paint/repaint the given window. */
  renderWindow(window: TimelinePaintWindow<E>): void;
  /** Surgically repaint one event bar (e.g. after a drag commit). */
  updateEvent(eventId: RecordId): void;
  /** Tear down all DOM/listeners the renderer created. */
  destroy(): void;
}

/** Factory the engine uses to construct the active renderer. */
export type TimelineRendererFactory<E extends Model = Model> = (
  api: TimelineApi<E>,
) => TimelineRenderer<E>;

/* ═══════════════════════════════════════════════════════════════════════════
   9. OPTIONS (top-level config)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Tuning for row/event virtualization. */
export interface TimelineVirtualizationOptions {
  /** Enable row virtualization. Default `true`. */
  enabled?: boolean;
  /** Extra rows rendered above/below the viewport. */
  overscan?: number;
  /** Allow variable row heights (backed by core `OffsetIndex`). */
  variableRowHeight?: boolean;
}

/**
 * Top-level timeline configuration. Extends `WidgetConfig` so the `Timeline`
 * widget inherits `cls`/`style`/`hidden`/`disabled` and the standard lifecycle.
 */
export interface TimelineOptions<R extends Model = Model, E extends Model = Model>
  extends WidgetConfig {
  /** Row data source (resources/tasks). Required. */
  rows: Store<R> | R[];
  /** Event data source (bars). Required. */
  events: Store<E> | E[];
  /** Dependency links between events. */
  dependencies?: DependencyLink[];
  /** The view preset to start in. Required. */
  preset: ViewPreset;
  /** Ordered preset ladder for zoom in/out. Defaults to `[preset]`. */
  presets?: ViewPreset[];
  /** Initial zoom multiplier. Default `1`. */
  zoom?: number;
  /** Time range to cover. Defaults to the events' min/max span. */
  range?: TimeSpan;
  /** Default row height in px. */
  rowHeight?: number;
  /** Field on an event record that yields its `rowId`. */
  eventRowField?: keyof E & string;
  /** Field(s) on an event record that yield its start/end. */
  eventStartField?: keyof E & string;
  eventEndField?: keyof E & string;
  /** Overlap-resolution strategy for events sharing a row. */
  overlap?: EventOverlapStrategy;
  /** Virtualization tuning. */
  virtualization?: TimelineVirtualizationOptions;
  /** Override the rendering backend (D9; default DOM recycler). */
  renderer?: TimelineRendererFactory<E>;
  /** Features/overlays to install at construction. */
  plugins?: TimelineFeature<R, E>[];
  /** Empty-state text. */
  emptyText?: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   10. EVENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Typed timeline event map. Follows the house veto convention: `beforeX` events
 * are vetoable (a handler returning `false` cancels); plain events notify.
 */
export interface TimelineWidgetEvents<R extends Model = Model, E extends Model = Model>
  extends WidgetEvents,
    EventMap {
  /** An event bar was clicked. */
  eventClick: { event: TimelineEvent<E>; row: TimelineRow<R>; native: MouseEvent };
  /** An event bar was double-clicked. */
  eventDblClick: { event: TimelineEvent<E>; row: TimelineRow<R>; native: MouseEvent };
  /** Vetoable: an event is about to be moved/resized via drag. */
  beforeEventChange: { event: TimelineEvent<E>; from: TimeSpan; to: TimeSpan };
  /** An event's span changed (drag/resize committed). */
  eventChange: { event: TimelineEvent<E>; from: TimeSpan; to: TimeSpan };
  /** Vetoable: a dependency link is about to be created by the user. */
  beforeDependencyCreate: { link: Omit<DependencyLink, 'id'> };
  /** A dependency link was created. */
  dependencyCreate: { link: DependencyLink };
  /** The active view (preset/zoom) changed. */
  viewChange: { preset: ViewPreset; zoom: number };
  /** A tree row expanded/collapsed. */
  rowToggle: { row: TimelineRow<R>; expanded: boolean };
  /** The viewport scrolled. */
  scroll: { scrollTop: number; scrollLeft: number; visibleSpan: TimeSpan };
  /** The painted window changed. */
  windowChange: { window: TimelinePaintWindow<E> };
}

/* ═══════════════════════════════════════════════════════════════════════════
   11. FEATURE / PLUGIN INTERFACE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A timeline feature/overlay/plugin. Features receive the `TimelineApi` in
 * `init` and MUST confine all interaction to that surface (no reaching into
 * engine internals). `destroy` releases every listener/effect/DOM it created.
 * Scheduler's resource-assignment overlays and Gantt's scheduling-engine bridge
 * are both authored as features over this seam.
 */
export interface TimelineFeature<R extends Model = Model, E extends Model = Model> {
  /** Unique feature name (registry key on `TimelineApi.features`). */
  readonly name: string;
  /** Called once on install; wire up via the API here. */
  init(api: TimelineApi<R, E>): void;
  /** Called on teardown; release everything. */
  destroy(): void;
}

/** Constructor form, for features that take config at construction. */
export type TimelineFeatureCtor<R extends Model = Model, E extends Model = Model> = new (
  config?: Record<string, unknown>,
) => TimelineFeature<R, E>;

/* ═══════════════════════════════════════════════════════════════════════════
   12. TIMELINE API (the engine extension seam)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The public service surface the `Timeline` engine exposes to features/plugins
 * and to the Scheduler/Gantt packages that render on top of it. This is the
 * extension seam: everything downstream builds entirely against `TimelineApi`.
 * The engine implements it.
 */
export interface TimelineApi<R extends Model = Model, E extends Model = Model> {
  /** The backing row store. */
  readonly rowStore: Store<R>;
  /** The backing event store. */
  readonly eventStore: Store<E>;
  /** The time ⇄ pixel projection. */
  readonly axis: TimeAxis;
  /** The viewport/scroll surface. */
  readonly viewport: TimelineViewport;
  /** The row virtualizer. */
  readonly rows: RowVirtualizer<R>;
  /** The active per-row event layout. */
  readonly eventLayout: EventLayout<E>;
  /** The active dependency router. */
  readonly dependencyRouter: DependencyRouter<E>;
  /** The active rendering backend. */
  readonly renderer: TimelineRenderer<E>;
  /** The timeline root element. */
  readonly el: HTMLElement;
  /** Installed features, keyed by `feature.name`. */
  readonly features: ReadonlyMap<string, TimelineFeature<R, E>>;

  /* ── reactive state (signals features can subscribe to) ───────────────── */
  /** The current view (preset + zoom), reactive. */
  readonly view: ReadonlySignal<{ preset: ViewPreset; zoom: number }>;
  /** The current paint window, reactive. */
  readonly window: ReadonlySignal<TimelinePaintWindow<E>>;

  /* ── data / row access ─────────────────────────────────────────────── */
  /** Row at a view index. */
  getRow(rowIndex: number): TimelineRow<R> | undefined;
  /** Row by id. */
  getRowById(id: RecordId): TimelineRow<R> | undefined;
  /** Events belonging to a row. */
  getEventsForRow(rowId: RecordId): ReadonlyArray<TimelineEvent<E>>;
  /** Event by id. */
  getEventById(id: RecordId): TimelineEvent<E> | undefined;
  /** Dependency links touching an event. */
  getDependenciesFor(eventId: RecordId): ReadonlyArray<DependencyLink>;

  /* ── view / projection control ─────────────────────────────────────── */
  /** Switch preset and/or zoom. */
  setView(view: { preset?: ViewPreset; zoom?: number }): void;
  /** Zoom in/out one step along the preset ladder. */
  zoomIn(): void;
  zoomOut(): void;
  /** Widen/narrow the covered range. */
  setRange(range: TimeSpan): void;

  /* ── mutation (proxied to the stores with veto events) ─────────────── */
  /** Move/resize an event (fires `beforeEventChange`/`eventChange`). */
  updateEventSpan(eventId: RecordId, span: TimeSpan): boolean;
  /** Add a dependency link (fires `beforeDependencyCreate`/`dependencyCreate`). */
  addDependency(link: Omit<DependencyLink, 'id'>): DependencyLink | undefined;
  /** Remove a dependency link. */
  removeDependency(linkId: RecordId): void;

  /* ── rendering ─────────────────────────────────────────────────────── */
  /** Recompute window + repaint everything. */
  refresh(): void;
  /** Repaint a single event bar. */
  refreshEvent(eventId: RecordId): void;
  /** Recompute axis/row geometry. */
  invalidateLayout(): void;

  /* ── feature lifecycle ─────────────────────────────────────────────── */
  /** Install a feature/plugin (calls `feature.init(this)`); returns it. */
  use(feature: TimelineFeature<R, E>): TimelineFeature<R, E>;
  /** Remove a feature by name (calls its `destroy`). */
  removeFeature(name: string): void;

  /* ── events ────────────────────────────────────────────────────────── */
  on<K extends keyof TimelineWidgetEvents<R, E>>(
    event: K,
    fn: (payload: TimelineWidgetEvents<R, E>[K]) => unknown,
  ): () => void;
  once<K extends keyof TimelineWidgetEvents<R, E>>(
    event: K,
    fn: (payload: TimelineWidgetEvents<R, E>[K]) => unknown,
  ): () => void;
  off<K extends keyof TimelineWidgetEvents<R, E>>(
    event: K,
    fn?: (payload: TimelineWidgetEvents<R, E>[K]) => unknown,
  ): void;
  /** Emit; returns `false` if a vetoable `beforeX` was cancelled. */
  emit<K extends keyof TimelineWidgetEvents<R, E>>(
    event: K,
    payload: TimelineWidgetEvents<R, E>[K],
  ): boolean;

  /* ── disposal registration for features ────────────────────────────── */
  /** Register a disposer the engine runs on `destroy()` (leak-safe). */
  track(disposer: () => void): void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   13. TIMELINE WIDGET — PUBLIC TYPE SIGNATURE ONLY (implemented by engine)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Public shape of the `Timeline` Widget instance. The concrete class extends
 * `Widget<TimelineOptions, TimelineWidgetEvents>` from `@jects/core` and is
 * authored by the engine agent; only its public type signature is frozen here.
 *
 * `Timeline` IS-A `TimelineApi` (it exposes the same surface to consumers), plus
 * the standard Widget lifecycle.
 */
export interface Timeline<R extends Model = Model, E extends Model = Model>
  extends TimelineApi<R, E> {
  /** Stable instance id (from Widget). */
  readonly id: string;
  /** The timeline root element (from Widget). */
  readonly el: HTMLElement;
  /** Merge options and re-render. */
  update(patch: Partial<TimelineOptions<R, E>>): this;
  /** Current resolved options (read-only). */
  getConfig(): Readonly<TimelineOptions<R, E>>;
  /** Show/hide the root. */
  show(): this;
  hide(): this;
  /** Whether the instance has been destroyed. */
  readonly isDestroyed: boolean;
  /** Vetoable teardown (`beforeDestroy`); disposes renderer, features, wiring. */
  destroy(): void;
}

/**
 * Constructor signature of the `Timeline` Widget class (implemented by the
 * engine). Mirrors `new Timeline(host, options)` and `register('timeline', ...)`.
 */
export interface TimelineCtor {
  new <R extends Model = Model, E extends Model = Model>(
    host: HTMLElement | string,
    options: TimelineOptions<R, E>,
  ): Timeline<R, E>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   14. NOTES — THE "TimelineApi EXTENSION MODEL"
   ═══════════════════════════════════════════════════════════════════════════

   timeline-core ships the keystone runtime: the `Timeline` Widget, the `TimeAxis`
   projection, the default `RowVirtualizer`, `EventLayout`, `DependencyRouter`,
   and the DOM-recycling `TimelineRenderer`. Everything else — including the two
   downstream packages — extends behaviour ONLY through `TimelineApi`:

     • Scheduler and Gantt do NOT subclass the engine. They each compose a
       `Timeline` and install `TimelineFeature`s (e.g. a resource-row provider,
       an assignment-drag overlay, or — for Gantt — a bridge that forwards
       `beforeEventChange`/`eventChange` into its `SchedulingEngine` and writes
       recomputed spans back via `api.updateEventSpan`).
     • Features touch the grid of bars/lines purely via `api.axis` (projection),
       `api.rows` (virtualization), `api.getEventsForRow`, `api.updateEventSpan`,
       and `api.addDependency`/`removeDependency`. They never reach into the
       renderer's DOM; they request repaints via `refresh`/`refreshEvent`.
     • The vetoable `beforeX` events are the cancellation seam (house veto
       convention): a Gantt scheduling-constraint feature can veto an illegal
       `beforeEventChange`, and a Scheduler capacity rule can veto an overbooking.
     • `api.view`/`api.window` are reactive signals, so overlays recompute their
       own geometry from the same projection the renderer uses — guaranteeing
       pixel-perfect alignment between core bars and feature-drawn decorations.

   This mirrors the grid's GridApi extension model exactly, satisfying D10:
   one shared timeline engine, two thin product packages on top. */
