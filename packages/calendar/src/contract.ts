/**
 * @jects/calendar — frozen public contract (types & interfaces only).
 *
 * Contract-first: the Calendar widget, its EventStore, the view renderers, and
 * the recurrence engine all code against these shapes. Nothing here imports DOM
 * or runtime logic; it only re-uses framework-free types from `@jects/core`.
 */

import type { Model, RecordId, WidgetConfig, WidgetEvents } from '@jects/core';
import type { Weekday } from './date-utils.js';
import type { EventStore } from './event-store.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. EVENTS (the data model)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Recurrence frequency for a repeating event. */
export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * A recurrence rule (a small, RRULE-inspired subset). The base event's
 * `start`/`end` define the first occurrence; the rule generates the rest.
 */
export interface RecurrenceRule {
  /** How often the event repeats. */
  freq: RecurrenceFreq;
  /** Repeat every N periods (default 1). e.g. `freq:'weekly', interval:2`. */
  interval?: number | undefined;
  /** For weekly rules: which weekdays (0=Sun..6=Sat). Defaults to the start's weekday. */
  byWeekday?: Weekday[] | undefined;
  /** Stop generating after this many occurrences (inclusive of the first). */
  count?: number | undefined;
  /** Stop generating on/after this date (inclusive day). */
  until?: Date | undefined;
  /** Occurrence start times to skip (exception dates), matched by day. */
  exDates?: Date[] | undefined;
}

/**
 * A calendar event record. Stored in the `EventStore` (a core `Store`). Times
 * are native `Date`s. All-day and multi-day events are supported.
 */
export interface CalendarEvent extends Model {
  /** Stable id. Auto-assigned by the store if omitted. */
  id: RecordId;
  /** Event title. */
  title: string;
  /** Inclusive start instant. */
  start: Date;
  /** Exclusive end instant. Must be >= start. */
  end: Date;
  /** True for all-day / date-only events (rendered in the all-day rail). */
  allDay?: boolean | undefined;
  /** Optional longer description. */
  description?: string | undefined;
  /** Optional location text. */
  location?: string | undefined;
  /** Category id (drives color + filtering). */
  categoryId?: string | undefined;
  /** Resource id (drives the Resource view + filtering). */
  resourceId?: string | undefined;
  /** Recurrence rule; when present this event is a recurring series master. */
  recurrence?: RecurrenceRule | undefined;
  /**
   * RRULE string interop (RFC-5545 subset, e.g. `FREQ=WEEKLY;BYDAY=MO,WE`).
   * When present and `recurrence` is absent, the store parses it into
   * `recurrence` on normalization, so events can carry either shape.
   */
  rrule?: string | undefined;
  /** Disable user drag/resize/edit for this event. */
  readOnly?: boolean | undefined;
}

/**
 * A concrete, materialized occurrence of an event for a specific time range.
 * Recurring masters expand into many occurrences; one-off events yield one.
 */
export interface EventOccurrence {
  /** The originating event record. */
  event: CalendarEvent;
  /** Occurrence start (may differ from `event.start` for recurring series). */
  start: Date;
  /** Occurrence end. */
  end: Date;
  /** Stable per-occurrence key: `${event.id}@${start ISO}`. */
  occurrenceKey: string;
  /** True when this came from a recurrence expansion (not the master itself). */
  isRecurring: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. CATEGORIES & RESOURCES
   ═══════════════════════════════════════════════════════════════════════════ */

/** A color category. `color` is a `--jects-*` token NAME (e.g. `data-1`). */
export interface CalendarCategory {
  id: string;
  name: string;
  /** Token name (without the `--jects-` prefix), e.g. `data-1`, `cmyk-cyan`. */
  color: string;
}

/** A schedulable resource (room, person, machine) for the Resource view. */
export interface CalendarResource {
  id: string;
  name: string;
  /** Optional token color name for the resource column header. */
  color?: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. VIEWS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Built-in calendar views. */
export type CalendarViewType =
  | 'day'
  | 'week'
  | 'month'
  | 'year'
  | 'agenda'
  | 'resource'
  | 'timeline';

/* ═══════════════════════════════════════════════════════════════════════════
   4. CONFIG
   ═══════════════════════════════════════════════════════════════════════════ */

/** Data source for the calendar: raw events or an existing EventStore. */
export type CalendarDataSource = CalendarEvent[] | EventStore;

/** Top-level Calendar configuration. */
export interface CalendarConfig extends WidgetConfig {
  /** Initial events, or an EventStore instance. */
  events?: CalendarDataSource;
  /** Initial active view. Default `'month'`. */
  view?: CalendarViewType;
  /** Which views the toolbar offers. Default all six. */
  views?: CalendarViewType[];
  /** The focused/anchor date. Default today. */
  date?: Date;
  /** First day of the week (0=Sun..6=Sat). Default 0. */
  weekStart?: Weekday;
  /** Categories (color + filter). */
  categories?: CalendarCategory[];
  /** Resources (for the Resource view + filter). */
  resources?: CalendarResource[];
  /** Allow drag-create / move / resize. Default `true`. */
  editable?: boolean;
  /** Show the mini-calendar date navigator in the sidebar. Default `true`. */
  miniCalendar?: boolean;
  /** Show the built-in toolbar (nav + view switcher). Default `true`. */
  toolbar?: boolean;
  /** First visible hour (0..23) in Day/Week. Default 0. */
  dayStartHour?: number;
  /** Last visible hour (1..24) in Day/Week. Default 24. */
  dayEndHour?: number;
  /** Pixel height of one hour row in Day/Week. Default 48. */
  hourHeight?: number;
  /** Drag/resize snap granularity in minutes. Default 15. */
  snapMinutes?: number;
  /** Active category filter (ids). Empty/undefined = show all. */
  categoryFilter?: string[];
  /** Active resource filter (ids). Empty/undefined = show all. */
  resourceFilter?: string[];
  /** Locale for Intl date formatting. Default the runtime default. */
  locale?: string;
  /**
   * IANA timezone (e.g. `'America/New_York'`) the calendar renders in. Events are
   * stored as instants; when set, occurrences are projected to this zone's
   * wall-clock for layout/labels. Default: the runtime's local zone.
   */
  timeZone?: string;
  /**
   * Lazy data source. When provided, the calendar calls this for the visible
   * window of each view (load-on-demand) instead of requiring the whole dataset
   * up front; returned events are merged into the store. May be async.
   */
  loadEvents?: (start: Date, end: Date) => CalendarEvent[] | Promise<CalendarEvent[]>;
  /** Enable the undo/redo history (Ctrl+Z / Ctrl+Y). Default `true`. */
  history?: boolean;
  /** Use the built-in Window-based event editor on create/edit. Default `true`. */
  editor?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. EVENTS (the widget event map; house veto convention)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A pending drag-create draft (before commit). */
export interface DraftRange {
  start: Date;
  end: Date;
  allDay: boolean;
  resourceId?: string | undefined;
}

export interface CalendarEvents extends WidgetEvents {
  /** The active view changed. */
  viewChange: { view: CalendarViewType };
  /** The anchor/focused date changed (navigation). */
  dateChange: { date: Date };
  /** A date cell was clicked (empty space). */
  dateClick: { date: Date; allDay: boolean };
  /** An event/occurrence was clicked. */
  eventClick: { event: CalendarEvent; occurrence: EventOccurrence };
  /** Vetoable: a drag-create is about to commit a new event. */
  beforeEventCreate: { draft: DraftRange };
  /** A new event was created (after editor commit). */
  eventCreate: { event: CalendarEvent };
  /** Vetoable: an event drag-move/resize is about to commit. */
  beforeEventUpdate: { event: CalendarEvent; start: Date; end: Date };
  /** An event was updated (moved/resized/edited). */
  eventUpdate: { event: CalendarEvent; start: Date; end: Date };
  /** Vetoable: an event is about to be deleted. */
  beforeEventDelete: { event: CalendarEvent };
  /** An event was deleted. */
  eventDelete: { event: CalendarEvent };
  /** A selection range was made (e.g. via drag in empty space). */
  rangeSelect: { start: Date; end: Date; allDay: boolean };
  /** Category/resource filter changed. */
  filterChange: { categoryFilter: string[]; resourceFilter: string[] };
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. VIEW RENDERER PLUGIN INTERFACE
   ═══════════════════════════════════════════════════════════════════════════ */

/** Read-only services a view renderer receives from the Calendar host. */
export interface CalendarViewContext {
  /** The host element the view paints into (owned by the Calendar). */
  readonly el: HTMLElement;
  /** Current anchor date. */
  readonly date: Date;
  /** Week start. */
  readonly weekStart: Weekday;
  /** Resolved config (read-only). */
  readonly config: Readonly<CalendarConfig>;
  /** Occurrences visible in this view's date range (already filtered). */
  occurrencesInRange(start: Date, end: Date): EventOccurrence[];
  /** Look up a category by id. */
  getCategory(id: string | undefined): CalendarCategory | undefined;
  /** Resolved category color token (with `--jects-` prefix) or a default. */
  colorVar(ev: CalendarEvent): string;
  /** Resources (filtered). */
  resources(): CalendarResource[];
  /** Emit a host event (typed via the Calendar event map). */
  emit<K extends keyof CalendarEvents>(event: K, payload: CalendarEvents[K]): boolean;
  /** Begin editing/creating an event (opens the editor if enabled). */
  requestEdit(occurrence: EventOccurrence | null, draft?: DraftRange): void;
  /** Whether drag interactions are enabled. */
  readonly editable: boolean;
}

/**
 * A pluggable calendar view. The Calendar instantiates one per `CalendarViewType`
 * and drives it through `mount`/`render`/`destroy`. Built-in views implement this.
 */
export interface CalendarView {
  /** The view type this renderer handles. */
  readonly type: CalendarViewType;
  /** Human range label for the toolbar (e.g. "June 2026"). */
  title(date: Date, ctx: CalendarViewContext): string;
  /** The inclusive [start,end) date range this view currently covers. */
  range(date: Date, ctx: CalendarViewContext): { start: Date; end: Date };
  /** Build static DOM once into `ctx.el`. */
  mount(ctx: CalendarViewContext): void;
  /** Paint/repaint for the current date + occurrences. */
  render(ctx: CalendarViewContext): void;
  /** Tear down listeners/DOM the view created. */
  destroy(): void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. PUBLIC CALENDAR TYPE SIGNATURE (implemented by the widget)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Public shape of the Calendar widget instance. */
export interface CalendarInstance {
  readonly id: string;
  readonly el: HTMLElement;
  update(patch: Partial<CalendarConfig>): this;
  getConfig(): Readonly<CalendarConfig>;
  /** Switch the active view. */
  setView(view: CalendarViewType): this;
  /** Navigate to a specific date. */
  goToDate(date: Date): this;
  /** Navigate forward one view period. */
  next(): this;
  /** Navigate back one view period. */
  prev(): this;
  /** Jump to today. */
  today(): this;
  /** Serialize all events to an RFC-5545 ICS string (and download in a browser). */
  exportICS(fileName?: string): string;
  /** Serialize all events to a CSV/Excel string (and download in a browser). */
  exportExcel(fileName?: string): string;
  /** Open a print-friendly window for the current view. */
  print(): void;
  /** Undo the last event mutation. Returns true when something was undone. */
  undo(): boolean;
  /** Redo the last undone mutation. Returns true when something was redone. */
  redo(): boolean;
  /** Whether there is anything to undo. */
  canUndo(): boolean;
  /** Whether there is anything to redo. */
  canRedo(): boolean;
  /** Load-on-demand: fetch + merge events for `[start, end)` via the data source. */
  loadRange(start: Date, end: Date): void;
  show(): this;
  hide(): this;
  readonly isDestroyed: boolean;
  destroy(): void;
}
