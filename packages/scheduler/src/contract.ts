/**
 * @jects/scheduler — FROZEN PUBLIC CONTRACT (types & interfaces only).
 *
 * The resource scheduler renders on top of `@jects/timeline-core` (the shared
 * time-axis / row-virtualization / bar-positioning engine, decision D10) and
 * reuses `@jects/grid` for the locked resource columns on the left and
 * `@jects/widgets` (Window / Form / fields / Menu / Popup) for editors.
 *
 * This module mirrors the discipline of `packages/grid/src/contract.ts` and
 * `packages/timeline-core/src/contract.ts`: it imports ONLY framework-free types
 * and declares the data models, configuration, and event surface the runtime
 * implements. Nothing here builds DOM or holds runtime logic.
 *
 * Time is epoch milliseconds (UTC) throughout, matching timeline-core.
 */

import type { Model, RecordId, WidgetConfig, WidgetEvents, EventMap, Store } from '@jects/core';
import type {
  TimeMs,
  DurationMs,
  TimeSpan,
  ViewPreset,
  EventOverlapStrategy,
  DependencyTerminal,
  WorkingTimeCalendar,
} from '@jects/timeline-core';
import type { TimeRangeConfig, ResourceTimeRangeConfig } from './model/time-ranges.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. DATA MODELS
   ═══════════════════════════════════════════════════════════════════════════ */

/** A schedulable lane — a person, machine, room, vehicle, ... */
export interface ResourceModel extends Model {
  /** Stable id. */
  id: RecordId;
  /** Display name (shown in the locked left columns). */
  name: string;
  /** Optional parent for tree/grouped resources. */
  parentId?: RecordId | null;
  /** Optional explicit row height in px (defaults to the scheduler `rowHeight`). */
  rowHeight?: number;
  /** Optional per-resource working-time calendar id (PRO multi-calendar). */
  calendarId?: string;
  /** Optional capacity used by the Resource Histogram / Utilization views. */
  capacity?: number;
}

/** A scheduled event/booking placed on a resource lane. */
export interface EventModel extends Model {
  /** Stable id. */
  id: RecordId;
  /** The resource lane this event sits in. */
  resourceId: RecordId;
  /** Event name/title. */
  name?: string;
  /** Start time (epoch ms, UTC). */
  startDate: TimeMs;
  /** End time (epoch ms, UTC), exclusive. */
  endDate: TimeMs;
  /** Optional explicit duration (ms); `endDate` wins when both present. */
  duration?: DurationMs;
  /** 0..1 progress fill. */
  percentDone?: number;
  /** Whether the user may drag/resize this event. Default true. */
  draggable?: boolean;
  /** CSS modifier / category key for colouring. */
  eventColor?: string;
  /** Recurrence rule (subset of RFC-5545 RRULE). When set, the event repeats. */
  recurrenceRule?: string;
  /** When set, this event is one materialized occurrence of a recurring master. */
  recurringMasterId?: RecordId;
  /** Scheduling constraint kind (PRO). */
  constraintType?: ConstraintType;
  /** Scheduling constraint date (PRO). */
  constraintDate?: TimeMs;
  /** Pre-travel margin (ms) before `startDate` — time to reach the event (PRO). */
  preTravelTime?: DurationMs;
  /** Post-travel margin (ms) after `endDate` — time to leave the event (PRO). */
  postTravelTime?: DurationMs;
}

/** A many-to-many assignment of an event to a resource (multi-assignment mode). */
export interface AssignmentModel extends Model {
  /** Stable id. */
  id: RecordId;
  /** The assigned event. */
  eventId: RecordId;
  /** The resource it is assigned to. */
  resourceId: RecordId;
  /** Optional units (0..1+) of the resource the assignment consumes. Default 1. */
  units?: number;
}

/** The four classic precedence dependency types. */
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

/** A directed dependency between two events. */
export interface DependencyModel extends Model {
  /** Stable id. */
  id: RecordId;
  /** Predecessor event id. */
  fromId: RecordId;
  /** Successor event id. */
  toId: RecordId;
  /** Precedence type. Default `'FS'`. */
  type?: DependencyType;
  /** Lag (ms) applied between the linked terminals (PRO scheduling). */
  lag?: DurationMs;
  /** CSS modifier / category key. */
  styleKey?: string;
}

/** Scheduling-constraint kinds honoured by the PRO scheduling engine. */
export type ConstraintType =
  | 'startnoearlierthan'
  | 'startnolaterthan'
  | 'finishnoearlierthan'
  | 'finishnolaterthan'
  | 'muststarton'
  | 'mustfinishon';

/* ═══════════════════════════════════════════════════════════════════════════
   2. ORIENTATION / LAYOUT
   ═══════════════════════════════════════════════════════════════════════════ */

/** Scheduler orientation. `horizontal`: resources are rows, time flows right.
 *  `vertical`: resources are columns, time flows down. */
export type SchedulerOrientation = 'horizontal' | 'vertical';

/** A column shown in the locked resource grid on the left (horizontal mode). */
export interface ResourceColumnConfig {
  /** Field on the resource record to read. */
  field: keyof ResourceModel & string;
  /** Header text. */
  text?: string;
  /** Fixed width in px. Default 140. */
  width?: number;
  /** Optional cell renderer returning text/HTML. */
  renderer?: (resource: ResourceModel) => string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. CONFIG
   ═══════════════════════════════════════════════════════════════════════════ */

/** Top-level scheduler configuration. */
export interface SchedulerConfig extends WidgetConfig {
  /** Resource lanes. Required. */
  resources: Store<ResourceModel> | ResourceModel[];
  /** Events. Required. */
  events: Store<EventModel> | EventModel[];
  /** Many-to-many assignments (optional; single-assignment via `resourceId` otherwise). */
  assignments?: Store<AssignmentModel> | AssignmentModel[];
  /**
   * Dependencies between events. Accepts either a live `Store<DependencyModel>`
   * or a plain `DependencyModel[]` (coerced into a reactive store internally, so
   * links can be added/removed/edited at runtime and the view repaints). Mirrors
   * the `resources` / `events` / `assignments` store-or-array config form.
   */
  dependencies?: Store<DependencyModel> | DependencyModel[];
  /** Orientation. Default `'horizontal'`. */
  orientation?: SchedulerOrientation;
  /** Active view preset. Defaults to the week/day preset. */
  preset?: ViewPreset;
  /** Ordered preset ladder for zoom. Defaults to the built-in ladder. */
  presets?: ViewPreset[];
  /** Initial zoom multiplier. Default 1. */
  zoom?: number;
  /** Time range to cover. Defaults to the events' min/max span (padded). */
  range?: TimeSpan;
  /** Default row height (horizontal) / column width (vertical) in px. Default 48. */
  rowHeight?: number;
  /** Tick width override (px per finest tick). */
  tickSize?: number;
  /** Locked resource columns (horizontal). Defaults to a single name column. */
  columns?: ResourceColumnConfig[];
  /** Overlap strategy for events sharing a lane. Default `'stack'`. */
  overlap?: EventOverlapStrategy;
  /** Bar height in px within a lane (single-lane). Default derived from rowHeight. */
  barMargin?: number;
  /** Working-time calendar for non-working shading. */
  calendar?: WorkingTimeCalendar;
  /** Show non-working-time shading. Default true. */
  showNonWorkingTime?: boolean;
  /**
   * Global named time ranges shaded/lined across the WHOLE timeline, independent
   * of resources (e.g. "lunch", a highlighted window, a deadline marker). Each
   * `{ id, startDate, endDate, name?, cls?, style? }`; a zero-width range
   * (`endDate <= startDate`) paints as a marker line.
   */
  timeRanges?: TimeRangeConfig[];
  /**
   * Named time ranges scoped to a single resource row (e.g. a person's PTO, a
   * machine's maintenance window). Shaded only within that resource's row band.
   */
  resourceTimeRanges?: ResourceTimeRangeConfig[];
  /** Show a "now" marker line. Default true. */
  showNowMarker?: boolean;
  /**
   * Enable drag-to-pan: dragging empty timeline background (not an event bar)
   * scrolls the schedule horizontally and vertically. Default false.
   */
  panEnabled?: boolean;
  /**
   * Enable infinite scroll: as the viewport nears either temporal edge the axis
   * range is extended and the grid re-rendered, so horizontal scrolling never
   * hits a hard wall. Default false.
   */
  infiniteScroll?: boolean;
  /** Allow drag-move of events. Default true. */
  draggable?: boolean;
  /** Allow resize of events. Default true. */
  resizable?: boolean;
  /** Allow drag-create of new events on empty lane space. Default false. */
  creatable?: boolean;
  /** Allow editing events via the edit popup on double-click. Default true. */
  editable?: boolean;
  /** Allow drawing dependencies between events. Default false. */
  dependenciesEditable?: boolean;
  /** Snap drags to the tick grid. Default true. */
  snap?: boolean;
  /** Overscan rows for virtualization. Default 5. */
  overscan?: number;
  /** Tooltip content resolver; return null to suppress. */
  eventTooltip?: (event: EventModel) => string | null;
  /** Empty-state text. */
  emptyText?: string;
  /**
   * Optional document title. Forwarded to exports (PDF info dict / header
   * banner) and used as the default file title when exporting.
   */
  title?: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. EVENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Typed scheduler event map (house veto convention: `beforeX` is vetoable). */
export interface SchedulerEvents extends WidgetEvents, EventMap {
  /** An event bar was clicked. */
  eventClick: { event: EventModel; resource: ResourceModel | undefined; native: MouseEvent };
  /** An event bar was double-clicked. */
  eventDblClick: { event: EventModel; resource: ResourceModel | undefined; native: MouseEvent };
  /** Vetoable: an event is about to move/resize. */
  beforeEventChange: { event: EventModel; from: TimeSpan; to: TimeSpan };
  /** An event's span changed (committed). */
  eventChange: { event: EventModel; from: TimeSpan; to: TimeSpan };
  /** Vetoable: a new event is about to be created via drag-create. */
  beforeEventCreate: { resourceId: RecordId; span: TimeSpan };
  /** A new event was created. */
  eventCreate: { event: EventModel };
  /** Vetoable: an event is about to be deleted. */
  beforeEventDelete: { event: EventModel };
  /** An event was deleted. */
  eventDelete: { event: EventModel };
  /** Vetoable: a dependency is about to be created. */
  beforeDependencyCreate: { dependency: Omit<DependencyModel, 'id'> };
  /** A dependency was created. */
  dependencyCreate: { dependency: DependencyModel };
  /** Vetoable: a dependency is about to be deleted (drawing/editing UI). */
  beforeDependencyDelete: { dependency: DependencyModel };
  /** A dependency was deleted (drawing/editing UI). */
  dependencyDelete: { dependency: DependencyModel };
  /** The active view (preset/zoom) changed. */
  viewChange: { preset: ViewPreset; zoom: number };
  /** The viewport scrolled. */
  scroll: { scrollTop: number; scrollLeft: number; visibleSpan: TimeSpan };
  /** A resource lane was selected. */
  resourceSelect: { resource: ResourceModel };
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. RUNTIME-PRODUCED GEOMETRY (read-only views the renderer paints)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Re-export the dependency terminal type for convenience. */
export type { DependencyTerminal };

/** Re-export the time-range config models for convenience. */
export type { TimeRangeConfig, ResourceTimeRangeConfig };
