/**
 * Booking — an appointment-booking widget.
 *
 * Composes three stages into one flow:
 *   1. a date picker (reuses @jects/widgets MiniCalendar via the factory),
 *   2. a time-slot grid showing available / booked slots for the chosen day
 *      (configurable working hours, slot duration, existing bookings, and an
 *      optional resource/service selector), then
 *   3. a reservation FORM (reuses @jects/widgets Form: name / email / notes) to
 *      confirm the selected slot.
 *
 * Follows the reference Button pattern: extends `Widget<Config, Events>`,
 * `defaults()` supplies component defaults, `buildEl()` builds the single root
 * once and wires listeners with bound methods (NOT class-field arrows, because
 * `super()` runs `buildEl()` before subclass field initializers), and `render()`
 * idempotently syncs the DOM to config.
 *
 * Existing bookings live in a core `Store`; confirming a slot adds a record and
 * emits a vetoable `beforeBook` then `book`.
 *
 * CSS lives in `booking.css`, references only `--jects-*` tokens, in
 * `@layer jects.components`.
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  type RecordId,
  Store,
  createEl,
  register,
  create,
} from '@jects/core';
import {
  type ExistingBooking,
  type WorkingHours,
  type Slot,
  type GenerateSlotsOptions,
  generateSlots,
  formatHM,
  formatHM12,
} from './slots.js';
import {
  type AvailabilityRules,
  resolveAvailableRanges,
} from './availability-rules.js';
import {
  type BookingService,
  findService,
  serviceConstraints,
  formatPrice,
} from './services.js';
import {
  localTimeZone,
  slotInstant,
  instantToZoned,
  offsetLabel,
} from './timezone.js';
import { WaitlistManager, type SlotKey } from './capacity.js';
import { CommandStack, SelectionModel, command } from './commands.js';
import type { BookingStatus } from './booking-manager.js';
import {
  type RecurrenceRule,
  generateSeries,
  validateSeries,
  type SeriesSlotValidation,
} from './recurring.js';
import { bookingToIcs, downloadIcs, type IcsEvent } from './ics.js';
import {
  formatConfirmation,
  formatWaitlisted,
  ReminderScheduler,
} from './notifications.js';
import {
  resolveMessages,
  formatMessage,
  type BookingMessages,
} from './i18n.js';

/** A selectable resource or service (optional second axis of availability). */
export interface BookingResource {
  /** Stable id; written onto created bookings + used to scope availability. */
  id: string;
  /** Visible label. */
  name: string;
  /** Optional per-resource slot duration override (minutes). */
  slotDuration?: number;
}

/** The captured reservation details from the form stage. */
export interface ReservationDetails {
  name: string;
  email: string;
  notes?: string;
  /** Any extra fields contributed by `extraFields`. */
  [key: string]: unknown;
}

/** Payload describing a confirmed (or about-to-be-confirmed) booking. */
export interface BookingResult {
  /** `YYYY-MM-DD` day. */
  date: string;
  /** `HH:MM` 24h start time. */
  time: string;
  /** Slot duration in minutes. */
  duration: number;
  /** Selected resource id (when resources are configured). */
  resourceId?: string;
  /** Selected service id (when services are configured). */
  serviceId?: string;
  /** UTC instant (epoch ms) of the slot in the native timezone. */
  instant?: number;
  /** The display timezone in effect when booked. */
  timeZone?: string;
  /** Reservation form values. */
  details: ReservationDetails;
}

/** Hour display format for slot labels. */
export type TimeFormat = '12h' | '24h';

export interface BookingConfig extends WidgetConfig {
  /** Day shown / selected initially. Defaults to today. */
  date?: Date | null;
  /** Earliest selectable day (inclusive). */
  minDate?: Date | null;
  /** Latest selectable day (inclusive). */
  maxDate?: Date | null;
  /** Working-hours window. Default `{ start: '09:00', end: '17:00' }`. */
  workingHours?: WorkingHours;
  /** Slot length in minutes. Default 30. */
  slotDuration?: number;
  /** Gap (minutes) between consecutive slots. Default 0. */
  slotGap?: number;
  /** Existing bookings that block slots. */
  bookings?: ExistingBooking[];
  /** Optional resources/services. When present, a selector is shown. */
  resources?: BookingResource[];
  /** Initially-selected resource id. Defaults to the first resource. */
  resourceId?: string;
  /** Slot label format. Default `'24h'`. */
  timeFormat?: TimeFormat;
  /** Heading shown above the slot grid. Default `'Select a time'`. */
  slotsHeading?: string;
  /** Accessible name for the whole widget. Default `'Book an appointment'`. */
  ariaLabel?: string;
  /** Confirm button text in the reservation form. Default `'Confirm booking'`. */
  confirmText?: string;
  /** Hide the past slots entirely instead of showing them disabled. */
  hidePastSlots?: boolean;
  /** Mark booked/past slots disabled (default true) — false renders read-only. */
  disableUnavailable?: boolean;
  /** Extra reservation form fields, appended after name/email/notes. */
  extraFields?: BookingFieldSchema[];
  /** Convenience handler, also available via `.on('book', ...)`. */
  onBook?: (result: BookingResult) => void;

  /* ── parity features (all optional; absent ⇒ legacy behaviour) ────────── */

  /**
   * Rich availability ruleset (per-weekday hours, date overrides, blackouts,
   * per-resource). When present it REPLACES the flat `workingHours` window.
   */
  availability?: AvailabilityRules;
  /** Bookable services / event types. When present, a service selector shows. */
  services?: BookingService[];
  /** Initially-selected service id. Defaults to the first service. */
  serviceId?: string;
  /** Padding (minutes) reserved before each booking (overridden by a service). */
  bufferBefore?: number;
  /** Padding (minutes) reserved after each booking (overridden by a service). */
  bufferAfter?: number;
  /** Minimum advance notice in minutes (overridden by a service). */
  minNotice?: number;
  /** Maximum booking horizon in days (overridden by a service). */
  maxHorizonDays?: number;
  /** Seats per slot for group bookings (overridden by a service). */
  capacity?: number;
  /** Offer a waitlist when a slot is full. */
  waitlist?: boolean;
  /** The business/native timezone slots are defined in. Default host zone. */
  timeZone?: string;
  /** Timezones offered in the display selector. Presence shows the selector. */
  timezones?: string[];
  /** Reminder lead times (minutes before the appointment) to emit. */
  reminderLeadMinutes?: number[];
  /** Show the undo/redo/manage toolbar. Default true. */
  toolbar?: boolean;
  /** Show the manage-bookings panel (list/cancel/reschedule). Default true. */
  manageable?: boolean;
  /** Show an "Add to calendar" (.ics) action after a booking. Default true. */
  icsExport?: boolean;
  /** Mount the month/week booking calendar overview below the slots. */
  showCalendarView?: boolean;
  /** BCP-47 locale (used for price/label formatting). */
  locale?: string;
  /** Message-catalog overrides (i18n). */
  messages?: Partial<BookingMessages>;
}

/** A pass-through field schema for the reservation form (mirrors Form's). */
export interface BookingFieldSchema {
  name: string;
  control: string;
  label?: string;
  value?: unknown;
  rules?: Record<string, unknown>;
  props?: Record<string, unknown>;
  colSpan?: number;
}

export interface BookingEvents extends WidgetEvents {
  /** A day was selected in the date picker. */
  dateSelect: { date: Date; iso: string; booking: Booking };
  /** A slot was selected in the slot grid. */
  slotSelect: { date: string; time: string; slot: Slot; booking: Booking };
  /** A resource/service was selected. */
  resourceSelect: { resourceId: string; booking: Booking };
  /** Vetoable: return `false` from a handler to cancel confirming the booking. */
  beforeBook: { result: BookingResult; booking: Booking };
  /** Fired after a booking is confirmed and added to the store. */
  book: { result: BookingResult; record: ExistingBooking; booking: Booking };
  /**
   * Fired when a confirm attempt is rejected because the selected slot is no
   * longer available (the store mutated after selection — a double-booking was
   * prevented). The selection is cleared and the grid re-rendered.
   */
  bookingConflict: { date: string; time: string; resourceId?: string; booking: Booking };
  /** A service/event-type was selected. */
  serviceSelect: { serviceId: string; booking: Booking };
  /** The display timezone changed. */
  timezoneChange: { timeZone: string; booking: Booking };
  /** A full slot was joined on the waitlist instead of booked. */
  waitlist: { date: string; time: string; resourceId?: string; entryId: string; booking: Booking };
  /** A waitlist entry was promoted to a confirmed booking after a cancel. */
  waitlistPromote: { record: ExistingBooking; entryId: string; booking: Booking };
  /** An existing booking was cancelled. */
  cancel: { id: string; record: ExistingBooking; booking: Booking };
  /** An existing booking was rescheduled. */
  reschedule: { id: string; from: ExistingBooking; to: ExistingBooking; booking: Booking };
  /** A booking's status changed. */
  statusChange: { id: string; status: BookingStatus; booking: Booking };
  /** The selection (multi-select) changed. */
  selectionChange: { selected: string[]; booking: Booking };
  /** Selected bookings were bulk-deleted. */
  bulkDelete: { ids: string[]; booking: Booking };
}

/* ── small local date helpers (timezone-naive, local time) ──────────────── */

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function toISO(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
/** Escape a string for safe use inside a CSS attribute selector value. */
function cssEscape(value: string): string {
  const fn = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS?.escape;
  if (fn) return fn(value);
  return value.replace(/["\\]/g, '\\$&');
}
/**
 * Store row shape — an existing booking plus its store id. The index signature
 * makes it satisfy core's `Model` constraint (`Record<string, unknown>`).
 */
interface BookingRecord extends ExistingBooking {
  id: RecordId;
  /** Lifecycle status (defaults to `confirmed`). */
  status?: BookingStatus;
  serviceId?: string;
  instant?: number;
  timeZone?: string;
  details?: ReservationDetails;
  [key: string]: unknown;
}

/** Minimal shape of the MiniCalendar instance we drive via the factory. */
interface CalendarLike {
  on(event: string, fn: (payload: unknown) => unknown): () => void;
  update(patch: Record<string, unknown>): unknown;
  destroy(): void;
  el: HTMLElement;
}

/** Minimal shape of the Form instance we drive via the factory. */
interface FormLike {
  on(event: string, fn: (payload: unknown) => unknown): () => void;
  getValue(): Record<string, unknown>;
  reset(): unknown;
  destroy(): void;
  el: HTMLElement;
}

let bookingSeq = 0;

export class Booking extends Widget<BookingConfig, BookingEvents> {
  /** Store of existing bookings (drives slot availability + receives new ones). */
  private declare store: Store<BookingRecord>;
  /** Currently selected day (local midnight). */
  private declare selectedDate: Date;
  /** Currently selected resource id (or '' when none configured). */
  private declare selectedResourceId: string;
  /** Currently selected slot start `HH:MM`, or null. */
  private declare selectedTime: string | null;
  /** Child widgets (mounted via factory) — disposed on destroy/teardown. */
  private declare calendar: CalendarLike | null;
  private declare form: FormLike | null;
  /** Stable id prefix for this instance. */
  private declare uid: string;
  /** Currently selected service id (or '' when none configured). */
  private declare selectedServiceId: string;
  /** Active display timezone. */
  private declare displayTimeZone: string;
  /** Whether the currently-selected slot is being joined on the waitlist. */
  private declare waitlistMode: boolean;
  /** When set, the next slot pick reschedules this existing booking id. */
  private declare rescheduleId: string | null;
  /** Waitlist store. */
  private declare waitlist: WaitlistManager;
  /** Undo/redo command stack. */
  private declare commands: CommandStack;
  /** Multi-select model over booking ids. */
  private declare selection: SelectionModel<string>;
  /** Reminder scheduler. */
  private declare reminders: ReminderScheduler;
  /** Resolved message catalog. */
  private declare messages: BookingMessages;
  /** Last confirmation banner text (cleared on next interaction). */
  private declare banner: string | null;
  /** Optional mounted calendar-overview widget. */
  private declare overview: { update(p: Record<string, unknown>): unknown; destroy(): void; el: HTMLElement } | null;

  protected override defaults(): Partial<BookingConfig> {
    return {
      date: null,
      minDate: null,
      maxDate: null,
      workingHours: { start: '09:00', end: '17:00' },
      slotDuration: 30,
      slotGap: 0,
      bookings: [],
      timeFormat: '24h',
      slotsHeading: 'Select a time',
      ariaLabel: 'Book an appointment',
      confirmText: 'Confirm booking',
      hidePastSlots: false,
      disableUnavailable: true,
      toolbar: true,
      manageable: true,
      icsExport: true,
      waitlist: false,
      showCalendarView: false,
    };
  }

  protected buildEl(): HTMLElement {
    // Field-initializer substitutes (super() runs buildEl() before subclass
    // field initializers, so we cannot use class-field assignments).
    this.uid = `jects-booking-${++bookingSeq}`;
    this.calendar = null;
    this.form = null;
    this.overview = null;
    this.selectedTime = null;
    this.waitlistMode = false;
    this.rescheduleId = null;
    this.banner = null;
    this.waitlist = new WaitlistManager();
    this.commands = new CommandStack();
    this.selection = new SelectionModel<string>();
    this.reminders = new ReminderScheduler();

    const cfg = this.config;
    this.messages = resolveMessages(cfg.messages);
    this.store = new Store<BookingRecord>({
      data: (cfg.bookings ?? []).map((b, i): BookingRecord => ({
        ...b,
        id: `seed-${i}`,
        status: 'confirmed',
      })),
      idField: 'id',
    });

    this.selectedDate = startOfDay(cfg.date ?? new Date());
    this.selectedResourceId = cfg.resourceId ?? cfg.resources?.[0]?.id ?? '';
    this.selectedServiceId = cfg.serviceId ?? cfg.services?.[0]?.id ?? '';
    this.displayTimeZone = cfg.timeZone ?? localTimeZone();

    const el = createEl('div', { className: 'jects-booking' });
    // Delegated click for slot buttons + resource buttons (bound method).
    el.addEventListener('click', (e) => this.handleClick(e));
    return el;
  }

  /* ── lifecycle: render ──────────────────────────────────────────────── */

  protected override render(): void {
    const cfg = this.config;
    this.el.className = ['jects-booking', cfg.cls ?? ''].filter(Boolean).join(' ');
    this.el.setAttribute('role', 'group');
    if (cfg.ariaLabel) this.el.setAttribute('aria-label', cfg.ariaLabel);

    // Rebuild structure from scratch each render (we dispose children first so
    // listeners/DOM never leak). Stages: [calendar][resources?][slots][form].
    this.teardownChildren();
    this.el.replaceChildren();

    // Stage 1 — date picker (left column).
    const dateCol = createEl('div', { className: 'jects-booking__date' });
    const calHost = createEl('div', { className: 'jects-booking__calendar' });
    dateCol.append(calHost);
    this.el.append(dateCol);

    // Stage 2 + 3 — slots + form (right column).
    const main = createEl('div', { className: 'jects-booking__main' });

    // Toolbar (undo/redo + bulk delete) — universal, additive at the top.
    if (cfg.toolbar !== false) main.append(this.buildToolbar());

    // Confirmation / waitlist banner (shown after a successful action).
    if (this.banner) main.append(this.buildBanner(this.banner));

    // Service selector (event types) — when configured.
    if (cfg.services && cfg.services.length > 0) {
      main.append(this.buildServiceBar(cfg.services));
    }

    // Resource selector.
    if (cfg.resources && cfg.resources.length > 0) {
      main.append(this.buildResourceBar(cfg.resources));
    }

    // Timezone selector — when configured.
    if (cfg.timezones && cfg.timezones.length > 0) {
      main.append(this.buildTimezoneSelector(cfg.timezones));
    }

    const slotsSection = createEl('div', {
      className: 'jects-booking__slots-section',
    });
    const heading = createEl('h3', {
      className: 'jects-booking__heading',
      attrs: { id: `${this.uid}-slots-label` },
    });
    const headBase = cfg.slotsHeading ?? this.messages.selectTime;
    heading.textContent = `${headBase} — ${this.formatDayLabel(this.selectedDate)}`;
    if (this.rescheduleId) heading.textContent += ` (${this.messages.reschedule})`;
    slotsSection.append(heading);
    slotsSection.append(this.buildSlotGrid());
    main.append(slotsSection);

    // Reservation form host (populated once a slot is chosen).
    const formSection = createEl('div', { className: 'jects-booking__form-section' });
    formSection.hidden = this.selectedTime == null;
    const formHost = createEl('div', { className: 'jects-booking__form' });
    formSection.append(formHost);
    main.append(formSection);

    // Manage-bookings panel — when there are bookings to manage.
    if (cfg.manageable !== false) {
      const panel = this.buildManagePanel();
      if (panel) main.append(panel);
    }

    this.el.append(main);

    // Optional month/week booking overview, mounted below the columns. A heading
    // labels it so the month grid is not mistaken for a stray table on the right.
    if (cfg.showCalendarView) {
      const overviewSection = createEl('div', { className: 'jects-booking__overview' });
      const overviewHeading = createEl('h4', {
        className: 'jects-booking__overview-heading',
        attrs: { id: `${this.uid}-overview-label` },
      });
      overviewHeading.textContent = this.messages.overviewHeading;
      overviewSection.append(overviewHeading);
      const overviewHost = createEl('div', { className: 'jects-booking__overview-grid' });
      overviewSection.append(overviewHost);
      this.el.append(overviewSection);
      this.overview = create(
        {
          type: 'bookingcalendar',
          date: this.selectedDate,
          mode: 'month',
          bookings: this.activeBookings(),
          ariaLabel: this.messages.overviewHeading,
          ...(cfg.locale ? { locale: cfg.locale } : {}),
        },
        overviewHost,
      ) as unknown as { update(p: Record<string, unknown>): unknown; destroy(): void; el: HTMLElement };
    }

    // Mount the reusable MiniCalendar via the factory.
    this.calendar = create(
      {
        type: 'minicalendar',
        value: this.selectedDate,
        min: cfg.minDate ?? null,
        max: cfg.maxDate ?? null,
      },
      calHost,
    ) as unknown as CalendarLike;
    this.calendar.on('change', (payload) => {
      const value = (payload as { value: Date }).value;
      this.handleDateChange(value);
    });

    // If a slot is already selected, (re)mount the reservation form.
    if (this.selectedTime != null) this.mountForm(formHost);
  }

  /** A short human label for the slot-grid heading. */
  private formatDayLabel(d: Date): string {
    return d.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }

  /* ── resource selector ──────────────────────────────────────────────── */

  private buildResourceBar(resources: BookingResource[]): HTMLElement {
    const bar = createEl('div', {
      className: 'jects-booking__resources',
      attrs: { role: 'radiogroup', 'aria-label': 'Select a service' },
    });
    // a11y: implement the WAI-ARIA radiogroup keyboard pattern — Arrow keys move
    // focus AND selection between radios (with wrap), Home/End jump to ends, and
    // Space/Enter selects the focused radio. Roving tabindex keeps exactly one
    // radio in the Tab sequence.
    bar.addEventListener('keydown', (e) => this.handleResourceKeydown(e));
    for (const r of resources) {
      const selected = r.id === this.selectedResourceId;
      const btn = createEl('button', {
        className: [
          'jects-booking__resource',
          selected ? 'jects-booking__resource--selected' : '',
        ]
          .filter(Boolean)
          .join(' '),
        attrs: {
          type: 'button',
          role: 'radio',
          'aria-checked': selected ? 'true' : 'false',
          'data-resource': r.id,
          tabindex: selected ? '0' : '-1',
        },
      });
      btn.textContent = r.name;
      bar.append(btn);
    }
    return bar;
  }

  /**
   * WAI-ARIA radiogroup keyboard handler. Left/Up -> previous, Right/Down ->
   * next (both wrap), Home -> first, End -> last, moving focus + selection
   * together; Space/Enter selects the currently-focused radio.
   */
  private handleResourceKeydown(e: KeyboardEvent): void {
    const cfg = this.config;
    const resources = cfg.resources ?? [];
    if (resources.length === 0) return;

    const ids = resources.map((r) => r.id);
    const current = Math.max(0, ids.indexOf(this.selectedResourceId));
    let next = current;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (current + 1) % ids.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (current - 1 + ids.length) % ids.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = ids.length - 1;
        break;
      case ' ':
      case 'Enter':
        // Select the focused radio (no-op if already selected).
        e.preventDefault();
        this.selectResource(ids[current] ?? this.selectedResourceId);
        this.focusSelectedResource();
        return;
      default:
        return;
    }

    e.preventDefault();
    const targetId = ids[next];
    if (targetId == null) return;
    // selectResource() re-renders; arrow keys move selection AND focus.
    this.selectResource(targetId);
    this.focusSelectedResource();
  }

  /** Move DOM focus to the currently-selected resource radio (post-render). */
  private focusSelectedResource(): void {
    const el = this.el.querySelector<HTMLElement>(
      `.jects-booking__resource[data-resource="${cssEscape(this.selectedResourceId)}"]`,
    );
    el?.focus();
  }

  /* ── slot grid ──────────────────────────────────────────────────────── */

  /** The currently-selected service, if services are configured. */
  private effectiveService(): BookingService | undefined {
    return findService(this.config.services, this.selectedServiceId || undefined);
  }

  /** The effective slot duration (resource override ▸ service ▸ config). */
  private effectiveSlotDuration(): number {
    const cfg = this.config;
    const res = cfg.resources?.find((r) => r.id === this.selectedResourceId);
    if (res?.slotDuration != null) return res.slotDuration;
    const svc = this.effectiveService();
    if (svc) return svc.duration;
    return cfg.slotDuration ?? 30;
  }

  /** Active (non-cancelled) bookings as plain `ExistingBooking` rows. */
  private activeBookings(): ExistingBooking[] {
    return this.store.toArray().filter((b) => b.status !== 'cancelled');
  }

  /** Compute slots for the current day/resource/service, honouring constraints. */
  computeSlots(): Slot[] {
    const cfg = this.config;
    const dateISO = toISO(this.selectedDate);
    const resourceId = this.selectedResourceId || undefined;
    const svc = this.effectiveService();
    const constraints = svc ? serviceConstraints(svc) : undefined;

    const opts: GenerateSlotsOptions = {
      date: dateISO,
      hours: cfg.workingHours ?? { start: '09:00', end: '17:00' },
      slotDuration: this.effectiveSlotDuration(),
      slotGap: cfg.slotGap ?? 0,
      bookings: this.activeBookings(),
      ...(resourceId ? { resourceId } : {}),
    };

    // Availability rules replace the flat working-hours window.
    if (cfg.availability) {
      opts.ranges = resolveAvailableRanges(cfg.availability, dateISO, resourceId).map((r) => ({
        start: r.start,
        end: r.end,
      }));
    }

    // Buffers / notice / horizon / capacity — service wins, then config.
    const bufferBefore = constraints?.bufferBefore ?? cfg.bufferBefore;
    if (bufferBefore != null) opts.bufferBefore = bufferBefore;
    const bufferAfter = constraints?.bufferAfter ?? cfg.bufferAfter;
    if (bufferAfter != null) opts.bufferAfter = bufferAfter;
    const minNotice = constraints?.minNotice ?? cfg.minNotice;
    if (minNotice != null) opts.minNotice = minNotice;
    const maxHorizonDays = constraints?.maxHorizonDays ?? cfg.maxHorizonDays;
    if (maxHorizonDays != null) opts.maxHorizonDays = maxHorizonDays;
    const capacity = constraints?.capacity ?? cfg.capacity;
    if (capacity != null) opts.capacity = capacity;

    return generateSlots(opts);
  }

  /** Whether a waitlist is offered for full slots (service ▸ config). */
  private waitlistEnabled(): boolean {
    const svc = this.effectiveService();
    return svc?.waitlist ?? this.config.waitlist ?? false;
  }

  /**
   * Label for a slot. When a display timezone differs from the native zone, the
   * slot's wall-clock is converted DST-correctly for display.
   */
  private slotLabel(slot: Slot): string {
    const cfg = this.config;
    const fmt = cfg.timeFormat === '12h' ? formatHM12 : formatHM;
    const nativeZone = cfg.timeZone ?? null;
    if (nativeZone && this.displayTimeZone && this.displayTimeZone !== nativeZone) {
      const instant = slotInstant(toISO(this.selectedDate), slot.time, nativeZone);
      const zoned = instantToZoned(instant, this.displayTimeZone);
      const m = /^(\d{2}):(\d{2})$/.exec(zoned.time);
      if (m) return fmt(Number(m[1]) * 60 + Number(m[2]));
    }
    return fmt(slot.startMinutes);
  }

  private buildSlotGrid(): HTMLElement {
    const cfg = this.config;
    const slots = this.computeSlots();
    // a11y: slots are a GROUP of native toggle buttons (each `<button>` is
    // independently tabbable, Enter/Space activates it natively, and selection
    // is conveyed via `aria-pressed`). We deliberately do NOT use
    // role=listbox/option here: nesting interactive <button>s inside role=option
    // is an ARIA antipattern, and a listbox would advertise managed
    // single-selection we'd then have to implement with roving focus. A group of
    // toggle buttons is the correct, inherently-keyboard-operable choice.
    const grid = createEl('div', {
      className: 'jects-booking__slots',
      attrs: {
        role: 'group',
        'aria-labelledby': `${this.uid}-slots-label`,
      },
    });

    const visible = cfg.hidePastSlots ? slots.filter((s) => !s.past) : slots;
    if (visible.length === 0) {
      const empty = createEl('p', { className: 'jects-booking__empty' });
      empty.textContent = this.messages.noTimes;
      grid.setAttribute('aria-label', this.messages.noTimesShort);
      grid.append(empty);
      return grid;
    }

    const waitlistOn = this.waitlistEnabled();
    for (const slot of visible) {
      const selected = this.selectedTime === slot.time;
      const full = slot.booked && !slot.past && slot.seatsRemaining === 0;
      // A full slot with a waitlist is a selectable "join waitlist" action.
      const waitlistable = waitlistOn && full;
      const unavailable = !slot.available && !waitlistable;
      const disable = unavailable && (cfg.disableUnavailable ?? true);
      const label = this.slotLabel(slot);
      const classes = [
        'jects-booking__slot',
        slot.booked ? 'jects-booking__slot--booked' : '',
        slot.past ? 'jects-booking__slot--past' : '',
        slot.tooSoon ? 'jects-booking__slot--too-soon' : '',
        slot.tooFar ? 'jects-booking__slot--too-far' : '',
        selected ? 'jects-booking__slot--selected' : '',
        waitlistable ? 'jects-booking__slot--waitlist' : '',
        unavailable ? 'jects-booking__slot--unavailable' : 'jects-booking__slot--available',
      ]
        .filter(Boolean)
        .join(' ');
      const stateWord = waitlistable
        ? this.messages.stateFull
        : slot.booked
          ? this.messages.stateBooked
          : slot.available
            ? this.messages.stateAvailable
            : this.messages.stateUnavailable;
      const btn = createEl('button', {
        className: classes,
        attrs: {
          type: 'button',
          'data-time': slot.time,
          'aria-pressed': selected ? 'true' : 'false',
          'aria-label': `${label}, ${stateWord}`,
        },
      });
      if (disable) {
        btn.setAttribute('disabled', '');
        btn.setAttribute('aria-disabled', 'true');
      }
      const timeEl = createEl('span', { className: 'jects-booking__slot-time' });
      timeEl.textContent = label;
      btn.append(timeEl);
      // Seat counter (capacity configured) or waitlist affordance.
      if (waitlistable) {
        const wl = createEl('span', { className: 'jects-booking__slot-seats' });
        wl.textContent = this.messages.joinWaitlist;
        btn.append(wl);
      } else if (slot.seatsRemaining != null && !slot.past) {
        const seats = createEl('span', { className: 'jects-booking__slot-seats' });
        seats.textContent =
          slot.seatsRemaining === 1
            ? this.messages.seatLeftOne
            : formatMessage(this.messages.seatsLeft, { n: slot.seatsRemaining });
        btn.append(seats);
      }
      grid.append(btn);
    }
    return grid;
  }

  /* ── reservation form ───────────────────────────────────────────────── */

  private mountForm(host: HTMLElement): void {
    const cfg = this.config;
    const svc = this.effectiveService();
    const fields = [
      { name: 'name', control: 'text', label: this.messages.fieldName, rules: { required: true } },
      {
        name: 'email',
        control: 'text',
        label: this.messages.fieldEmail,
        rules: { required: true, email: true },
      },
      { name: 'notes', control: 'textarea', label: this.messages.fieldNotes },
      // Per-service intake fields, then global extra fields.
      ...(svc?.fields ?? []),
      ...(cfg.extraFields ?? []),
    ];
    const submitText = this.waitlistMode
      ? this.messages.joinWaitlist
      : (cfg.confirmText ?? this.messages.confirmBooking);
    this.form = create(
      {
        type: 'form',
        ariaLabel: this.messages.reservationDetails,
        fields,
        submitText,
        validateOnChange: false,
      },
      host,
    ) as unknown as FormLike;
    this.form.on('submit', (payload) => {
      const values = (payload as { values: Record<string, unknown> }).values;
      this.confirmBooking(values);
    });
  }

  /* ── interaction ────────────────────────────────────────────────────── */

  private handleClick(e: Event): void {
    const target = e.target as HTMLElement;

    // Toolbar / manage actions (data-action) take priority.
    const actionBtn = target.closest<HTMLElement>('[data-action]');
    if (actionBtn && this.el.contains(actionBtn)) {
      this.handleAction(actionBtn.getAttribute('data-action') ?? '', actionBtn);
      return;
    }

    const svcBtn = target.closest<HTMLElement>('[data-service]');
    if (svcBtn && this.el.contains(svcBtn)) {
      this.selectService(svcBtn.getAttribute('data-service') ?? '');
      return;
    }

    const resBtn = target.closest<HTMLElement>('[data-resource]');
    if (resBtn && this.el.contains(resBtn)) {
      this.selectResource(resBtn.getAttribute('data-resource') ?? '');
      return;
    }

    const slotBtn = target.closest<HTMLElement>('.jects-booking__slot');
    if (slotBtn && this.el.contains(slotBtn)) {
      if (slotBtn.hasAttribute('disabled')) return;
      const time = slotBtn.getAttribute('data-time');
      if (time) this.selectSlot(time);
    }
  }

  /** Dispatch a toolbar/manage data-action click. */
  private handleAction(action: string, btn: HTMLElement): void {
    switch (action) {
      case 'undo':
        this.undo();
        break;
      case 'redo':
        this.redo();
        break;
      case 'bulk-delete':
        this.deleteSelected();
        break;
      case 'select-all':
        this.selectAllBookings();
        break;
      case 'export-ics':
        this.exportLastIcs(btn.getAttribute('data-id'));
        break;
      case 'cancel-booking': {
        const id = btn.getAttribute('data-id');
        if (id) this.cancelBooking(id);
        break;
      }
      case 'reschedule-booking': {
        const id = btn.getAttribute('data-id');
        if (id) this.beginReschedule(id);
        break;
      }
      case 'toggle-select': {
        const id = btn.getAttribute('data-id');
        if (id) {
          this.selection.toggle(id);
          this.emit('selectionChange', { selected: this.selection.all(), booking: this });
          this.render();
        }
        break;
      }
      default:
        break;
    }
  }

  private handleDateChange(value: Date): void {
    this.selectedDate = startOfDay(value);
    this.selectedTime = null; // changing the day clears the slot selection
    this.render();
    this.emit('dateSelect', {
      date: this.selectedDate,
      iso: toISO(this.selectedDate),
      booking: this,
    });
  }

  /** Programmatically set the selected day. */
  setDate(date: Date): this {
    this.selectedDate = startOfDay(date);
    this.selectedTime = null;
    this.render();
    return this;
  }

  /** Select a resource/service by id. */
  selectResource(resourceId: string): this {
    if (!resourceId || resourceId === this.selectedResourceId) return this;
    this.selectedResourceId = resourceId;
    this.selectedTime = null; // availability differs per resource
    this.render();
    this.emit('resourceSelect', { resourceId, booking: this });
    return this;
  }

  /**
   * Select a time slot by `HH:MM` start. Available slots open the reservation
   * form; a FULL slot (when a waitlist is enabled) opens the form in waitlist
   * mode. No-op for otherwise-unavailable slots.
   */
  selectSlot(time: string): this {
    const slot = this.computeSlots().find((s) => s.time === time);
    if (!slot) return this;
    const full = slot.booked && !slot.past && slot.seatsRemaining === 0;
    const waitlistable = this.waitlistEnabled() && full;
    if (!slot.available && !waitlistable) return this;
    this.waitlistMode = !slot.available && waitlistable;
    this.banner = null;
    this.selectedTime = time;
    this.render();
    // Move focus into the reservation form's first field for keyboard users.
    const firstField = this.el.querySelector<HTMLElement>(
      '.jects-booking__form input, .jects-booking__form textarea',
    );
    firstField?.focus();
    this.emit('slotSelect', {
      date: toISO(this.selectedDate),
      time,
      slot,
      booking: this,
    });
    return this;
  }

  /**
   * Re-compute slots from the CURRENT store state and report whether the
   * currently-selected time still maps to an available slot. The single source
   * of truth for the double-booking invariant at confirm time.
   */
  private isSelectedSlotBookable(): boolean {
    if (this.selectedTime == null) return false;
    const slot = this.computeSlots().find((s) => s.time === this.selectedTime);
    return slot != null && slot.available;
  }

  /**
   * A confirm attempt hit an already-taken slot. Clear the stale selection,
   * re-render (so the slot now shows as unavailable + the form is hidden), and
   * emit `bookingConflict` so hosts can surface a message.
   */
  private handleBookingConflict(): void {
    const conflict = {
      date: toISO(this.selectedDate),
      time: this.selectedTime ?? '',
      ...(this.selectedResourceId ? { resourceId: this.selectedResourceId } : {}),
      booking: this,
    };
    this.selectedTime = null;
    this.render();
    this.emit('bookingConflict', conflict);
  }

  /** Confirm the current selection with the given reservation details. */
  private confirmBooking(values: Record<string, unknown>): boolean {
    if (this.selectedTime == null) return false;
    const cfg = this.config;

    const details: ReservationDetails = {
      ...values,
      name: String(values.name ?? ''),
      email: String(values.email ?? ''),
      ...(values.notes == null ? {} : { notes: String(values.notes) }),
    };

    // Waitlist branch — the slot is full; record an entry instead of a booking.
    if (this.waitlistMode) {
      const key: SlotKey = {
        date: toISO(this.selectedDate),
        time: this.selectedTime,
        ...(this.selectedResourceId ? { resourceId: this.selectedResourceId } : {}),
      };
      const entry = this.waitlist.add(key, details);
      this.banner = formatWaitlisted({ date: key.date, time: key.time }, this.messages);
      this.emit('waitlist', {
        date: key.date,
        time: key.time,
        ...(this.selectedResourceId ? { resourceId: this.selectedResourceId } : {}),
        entryId: entry.id,
        booking: this,
      });
      this.selectedTime = null;
      this.waitlistMode = false;
      this.render();
      return true;
    }

    // TOCTOU guard #1 — Form submit is async (validation), so the store may have
    // mutated between selectSlot() and this submit landing (a re-seed via
    // update({bookings}), another beforeBook handler adding a record, or a
    // resource change altering the effective duration). Re-validate that the
    // selected slot is still available BEFORE doing any work; bail (and surface a
    // conflict) if it is gone or no longer bookable.
    if (!this.isSelectedSlotBookable()) {
      this.handleBookingConflict();
      return false;
    }

    // Reschedule branch — move an existing booking onto the new slot.
    if (this.rescheduleId) {
      return this.completeReschedule(this.rescheduleId, details);
    }

    const nativeZone = cfg.timeZone ?? null;
    const instant = nativeZone
      ? slotInstant(toISO(this.selectedDate), this.selectedTime, nativeZone).getTime()
      : undefined;
    const result: BookingResult = {
      date: toISO(this.selectedDate),
      time: this.selectedTime,
      duration: this.effectiveSlotDuration(),
      ...(this.selectedResourceId ? { resourceId: this.selectedResourceId } : {}),
      ...(this.selectedServiceId ? { serviceId: this.selectedServiceId } : {}),
      ...(instant != null ? { instant } : {}),
      ...(nativeZone ? { timeZone: this.displayTimeZone } : {}),
      details,
    };

    if (this.emit('beforeBook', { result, booking: this }) === false) return false;

    // TOCTOU guard #2 — beforeBook handlers may have mutated the store (e.g.
    // added a competing record). Re-check IMMEDIATELY before store.add() so we
    // never write a second overlapping record onto an already-booked slot.
    if (!this.isSelectedSlotBookable()) {
      this.handleBookingConflict();
      return false;
    }

    const record: BookingRecord = {
      id: `bk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: result.date,
      time: result.time,
      duration: result.duration,
      status: 'confirmed',
      ...(result.resourceId ? { resourceId: result.resourceId } : {}),
      ...(result.serviceId ? { serviceId: result.serviceId } : {}),
      ...(instant != null ? { instant } : {}),
      ...(nativeZone ? { timeZone: this.displayTimeZone } : {}),
      details,
    };
    this.store.add(record);

    // Record an undoable command (already applied — push without re-running do()).
    this.commands.push(
      command(
        'Book appointment',
        () => {
          this.store.add(record);
        },
        () => {
          this.store.remove(record.id);
        },
      ),
    );

    // Schedule reminders if lead times were configured + we have an instant.
    if (cfg.reminderLeadMinutes && cfg.reminderLeadMinutes.length > 0 && instant != null) {
      this.reminders.schedule(instant, cfg.reminderLeadMinutes, { record, result });
    }

    this.banner = formatConfirmation(result, this.messages);
    cfg.onBook?.(result);
    this.emit('book', { result, record, booking: this });

    // Reset the flow: clear the slot selection so the freshly-booked slot now
    // renders as unavailable.
    this.selectedTime = null;
    this.render();
    return true;
  }

  /** Finish a reschedule: move the target booking onto the selected slot. */
  private completeReschedule(id: string, details: ReservationDetails): boolean {
    const existing = this.store.getById(id);
    if (!existing || this.selectedTime == null) {
      this.rescheduleId = null;
      this.render();
      return false;
    }
    const from: ExistingBooking = {
      date: existing.date,
      time: existing.time,
      ...(existing.duration != null ? { duration: existing.duration } : {}),
      ...(existing.resourceId != null ? { resourceId: existing.resourceId } : {}),
    };
    const toDate = toISO(this.selectedDate);
    const toTime = this.selectedTime;
    const before = { date: existing.date, time: existing.time };
    this.store.update(id, { date: toDate, time: toTime, details });
    this.commands.push(
      command(
        'Reschedule',
        () => {
          this.store.update(id, { date: toDate, time: toTime });
        },
        () => {
          this.store.update(id, { date: before.date, time: before.time });
        },
      ),
    );
    const to: ExistingBooking = {
      date: toDate,
      time: toTime,
      ...(existing.duration != null ? { duration: existing.duration } : {}),
      ...(existing.resourceId != null ? { resourceId: existing.resourceId } : {}),
    };
    this.emit('reschedule', { id, from, to, booking: this });
    this.rescheduleId = null;
    this.selectedTime = null;
    this.render();
    return true;
  }

  /* ── data access ────────────────────────────────────────────────────── */

  /** All bookings currently held (seed + confirmed). */
  getBookings(): ExistingBooking[] {
    return this.store.toArray().map(({ ...b }) => {
      const out = { ...b } as Partial<ExistingBooking & { id?: RecordId }>;
      delete out.id;
      return out as ExistingBooking;
    });
  }

  /** The currently selected day (local midnight). */
  getSelectedDate(): Date {
    return new Date(this.selectedDate.getFullYear(), this.selectedDate.getMonth(), this.selectedDate.getDate());
  }

  /** The currently selected slot start `HH:MM`, or null. */
  getSelectedTime(): string | null {
    return this.selectedTime;
  }

  /** The currently selected resource id, or '' when none configured. */
  getSelectedResource(): string {
    return this.selectedResourceId;
  }

  /** The currently selected service id, or '' when none configured. */
  getSelectedService(): string {
    return this.selectedServiceId;
  }

  /** The active display timezone. */
  getDisplayTimeZone(): string {
    return this.displayTimeZone;
  }

  /* ── services / timezone ────────────────────────────────────────────── */

  /** Select a service/event type by id. */
  selectService(serviceId: string): this {
    if (!serviceId || serviceId === this.selectedServiceId) return this;
    this.selectedServiceId = serviceId;
    this.selectedTime = null; // availability + duration differ per service
    this.render();
    this.emit('serviceSelect', { serviceId, booking: this });
    return this;
  }

  /** Change the display timezone (slots re-render converted to the new zone). */
  setTimeZone(timeZone: string): this {
    if (!timeZone || timeZone === this.displayTimeZone) return this;
    this.displayTimeZone = timeZone;
    this.render();
    this.emit('timezoneChange', { timeZone, booking: this });
    return this;
  }

  private buildServiceBar(services: BookingService[]): HTMLElement {
    const bar = createEl('div', {
      className: 'jects-booking__services',
      attrs: { role: 'radiogroup', 'aria-label': this.messages.selectService },
    });
    for (const s of services) {
      const selected = s.id === this.selectedServiceId;
      const btn = createEl('button', {
        className: [
          'jects-booking__service',
          selected ? 'jects-booking__service--selected' : '',
        ]
          .filter(Boolean)
          .join(' '),
        attrs: {
          type: 'button',
          role: 'radio',
          'aria-checked': selected ? 'true' : 'false',
          'data-service': s.id,
          tabindex: selected ? '0' : '-1',
        },
      });
      const name = createEl('span', { className: 'jects-booking__service-name' });
      name.textContent = s.name;
      btn.append(name);
      const meta: string[] = [`${s.duration} min`];
      if (s.price != null) meta.push(formatPrice(s.price, s.currency ?? 'USD', this.config.locale));
      const metaEl = createEl('span', { className: 'jects-booking__service-meta' });
      metaEl.textContent = meta.join(' · ');
      btn.append(metaEl);
      bar.append(btn);
    }
    return bar;
  }

  private buildTimezoneSelector(zones: string[]): HTMLElement {
    const wrap = createEl('label', { className: 'jects-booking__tz' });
    const text = createEl('span', { className: 'jects-booking__tz-label' });
    text.textContent = this.messages.timezone;
    const select = createEl('select', {
      className: 'jects-booking__tz-select',
      attrs: { 'aria-label': this.messages.timezone },
    }) as HTMLSelectElement;
    for (const z of zones) {
      const opt = createEl('option') as HTMLOptionElement;
      opt.value = z;
      opt.textContent = `${z} (${offsetLabel(z)})`;
      if (z === this.displayTimeZone) opt.selected = true;
      select.append(opt);
    }
    select.addEventListener('change', () => this.setTimeZone(select.value));
    wrap.append(text, select);
    return wrap;
  }

  /* ── toolbar / banner ───────────────────────────────────────────────── */

  private buildToolbar(): HTMLElement {
    const bar = createEl('div', {
      className: 'jects-booking__toolbar',
      attrs: { role: 'toolbar', 'aria-label': this.messages.manageHeading },
    });
    const mkBtn = (action: string, label: string, enabled: boolean): HTMLElement => {
      const btn = createEl('button', {
        className: 'jects-booking__tool',
        attrs: { type: 'button', 'data-action': action, 'aria-label': label, title: label },
      });
      btn.textContent = label;
      if (!enabled) {
        btn.setAttribute('disabled', '');
        btn.setAttribute('aria-disabled', 'true');
      }
      return btn;
    };
    bar.append(mkBtn('undo', this.messages.undo, this.commands.canUndo()));
    bar.append(mkBtn('redo', this.messages.redo, this.commands.canRedo()));
    if (this.selection.size > 0) {
      bar.append(mkBtn('bulk-delete', this.messages.deleteSelected, true));
    }
    return bar;
  }

  private buildBanner(text: string): HTMLElement {
    const banner = createEl('div', {
      className: 'jects-booking__banner',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    banner.textContent = text;
    return banner;
  }

  /* ── manage panel ───────────────────────────────────────────────────── */

  private buildManagePanel(): HTMLElement | null {
    const rows = this.store.toArray().filter((r) => r.status !== 'cancelled');
    if (rows.length === 0) return null;
    const panel = createEl('div', { className: 'jects-booking__manage' });
    const heading = createEl('h4', { className: 'jects-booking__manage-heading' });
    heading.textContent = this.messages.manageHeading;
    panel.append(heading);

    const list = createEl('ul', {
      className: 'jects-booking__manage-list',
      attrs: { role: 'list' },
    });
    const statusLabel: Record<BookingStatus, string> = {
      pending: this.messages.statusPending,
      confirmed: this.messages.statusConfirmed,
      cancelled: this.messages.statusCancelled,
    };
    for (const r of rows) {
      const id = String(r.id);
      const li = createEl('li', { className: 'jects-booking__manage-row' });

      const check = createEl('input', {
        className: 'jects-booking__manage-check',
        attrs: {
          type: 'checkbox',
          'data-action': 'toggle-select',
          'data-id': id,
          'aria-label': `Select ${r.date} ${r.time}`,
        },
      }) as HTMLInputElement;
      check.checked = this.selection.has(id);
      li.append(check);

      const info = createEl('span', { className: 'jects-booking__manage-info' });
      info.textContent = `${r.date} ${r.time} · ${statusLabel[r.status ?? 'confirmed']}`;
      li.append(info);

      const reschedule = createEl('button', {
        className: 'jects-booking__manage-action',
        attrs: { type: 'button', 'data-action': 'reschedule-booking', 'data-id': id },
      });
      reschedule.textContent = this.messages.reschedule;
      li.append(reschedule);

      const cancel = createEl('button', {
        className: 'jects-booking__manage-action',
        attrs: { type: 'button', 'data-action': 'cancel-booking', 'data-id': id },
      });
      cancel.textContent = this.messages.cancel;
      li.append(cancel);

      if (this.config.icsExport !== false) {
        const ics = createEl('button', {
          className: 'jects-booking__manage-action',
          attrs: { type: 'button', 'data-action': 'export-ics', 'data-id': id },
        });
        ics.textContent = this.messages.exportIcs;
        li.append(ics);
      }

      list.append(li);
    }
    panel.append(list);
    return panel;
  }

  /* ── manage / command operations ────────────────────────────────────── */

  /** Begin rescheduling a booking; the next slot pick moves it. */
  beginReschedule(id: string): this {
    if (!this.store.getById(id)) return this;
    this.rescheduleId = id;
    this.selectedTime = null;
    this.banner = null;
    this.render();
    return this;
  }

  /** Cancel a booking (soft: status → cancelled). Promotes a waitlist entry. */
  cancelBooking(id: string): boolean {
    const existing = this.store.getById(id);
    if (!existing) return false;
    const prevStatus = existing.status ?? 'confirmed';
    this.store.update(id, { status: 'cancelled' });
    this.commands.push(
      command(
        'Cancel booking',
        () => {
          this.store.update(id, { status: 'cancelled' });
        },
        () => {
          this.store.update(id, { status: prevStatus });
        },
      ),
    );
    const record: ExistingBooking = {
      date: existing.date,
      time: existing.time,
      ...(existing.duration != null ? { duration: existing.duration } : {}),
      ...(existing.resourceId != null ? { resourceId: existing.resourceId } : {}),
    };
    this.emit('cancel', { id, record, booking: this });
    this.emit('statusChange', { id, status: 'cancelled', booking: this });
    this.promoteWaitlist({
      date: existing.date,
      time: existing.time,
      ...(existing.resourceId != null ? { resourceId: existing.resourceId } : {}),
    });
    this.render();
    return true;
  }

  /** Reschedule a booking directly (no UI flow) to a new day/time. */
  rescheduleBooking(id: string, date: string, time: string): boolean {
    const existing = this.store.getById(id);
    if (!existing) return false;
    const before = { date: existing.date, time: existing.time };
    const from: ExistingBooking = {
      date: existing.date,
      time: existing.time,
      ...(existing.duration != null ? { duration: existing.duration } : {}),
      ...(existing.resourceId != null ? { resourceId: existing.resourceId } : {}),
    };
    this.store.update(id, { date, time });
    this.commands.push(
      command(
        'Reschedule',
        () => {
          this.store.update(id, { date, time });
        },
        () => {
          this.store.update(id, { date: before.date, time: before.time });
        },
      ),
    );
    const to: ExistingBooking = {
      date,
      time,
      ...(existing.duration != null ? { duration: existing.duration } : {}),
      ...(existing.resourceId != null ? { resourceId: existing.resourceId } : {}),
    };
    this.emit('reschedule', { id, from, to, booking: this });
    this.render();
    return true;
  }

  /** Set an explicit lifecycle status on a booking. */
  setBookingStatus(id: string, status: BookingStatus): boolean {
    if (!this.store.getById(id)) return false;
    this.store.update(id, { status });
    this.emit('statusChange', { id, status, booking: this });
    this.render();
    return true;
  }

  /** Promote the next waitlist entry for a slot into a confirmed booking. */
  private promoteWaitlist(key: SlotKey): void {
    const entry = this.waitlist.promoteNext(key);
    if (!entry) return;
    const record: BookingRecord = {
      id: `bk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: entry.date,
      time: entry.time,
      duration: this.effectiveSlotDuration(),
      status: 'confirmed',
      ...(entry.resourceId != null ? { resourceId: entry.resourceId } : {}),
      details: entry.details,
    };
    this.store.add(record);
    this.emit('waitlistPromote', { record, entryId: entry.id, booking: this });
  }

  /** Undo the most recent book/cancel/reschedule. */
  undo(): this {
    if (this.commands.undo()) this.render();
    return this;
  }

  /** Redo the most recently undone action. */
  redo(): this {
    if (this.commands.redo()) this.render();
    return this;
  }

  /** Whether an undo/redo is available. */
  canUndo(): boolean {
    return this.commands.canUndo();
  }
  canRedo(): boolean {
    return this.commands.canRedo();
  }

  /** Add every active booking id to the multi-selection. */
  selectAllBookings(): this {
    const ids = this.store
      .toArray()
      .filter((r) => r.status !== 'cancelled')
      .map((r) => String(r.id));
    this.selection.set_(ids);
    this.emit('selectionChange', { selected: this.selection.all(), booking: this });
    this.render();
    return this;
  }

  /** Bulk-delete (hard remove) the selected bookings as one undoable command. */
  deleteSelected(): this {
    const ids = this.selection.all();
    if (ids.length === 0) return this;
    const removed = ids
      .map((id) => this.store.getById(id))
      .filter((r): r is BookingRecord => r != null)
      .map((r) => ({ ...r }));
    this.commands.execute(
      command(
        'Delete bookings',
        () => {
          for (const r of removed) this.store.remove(r.id);
        },
        () => {
          for (const r of removed) this.store.add({ ...r });
        },
      ),
    );
    this.selection.clearSelection();
    this.emit('bulkDelete', { ids, booking: this });
    this.emit('selectionChange', { selected: [], booking: this });
    this.render();
    return this;
  }

  /** The multi-selection model (for headless control). */
  getSelection(): SelectionModel<string> {
    return this.selection;
  }
  /** The undo/redo command stack. */
  getCommandStack(): CommandStack {
    return this.commands;
  }
  /** The waitlist manager. */
  getWaitlist(): WaitlistManager {
    return this.waitlist;
  }
  /** The reminder scheduler. */
  getReminders(): ReminderScheduler {
    return this.reminders;
  }
  /** Active bookings with their full managed shape (id + status + details). */
  getManagedBookings(): BookingRecord[] {
    return this.store.toArray();
  }

  /* ── recurrence (series booking) ────────────────────────────────────── */

  /**
   * Preview a recurring series for the current selection (or an explicit start),
   * validating each occurrence against current availability + capacity.
   */
  previewSeries(rule: RecurrenceRule, time?: string, start?: string): SeriesSlotValidation[] {
    const t = time ?? this.selectedTime;
    if (t == null) return [];
    const startDate = start ?? toISO(this.selectedDate);
    const series = generateSeries(rule, startDate, t);
    return validateSeries(series, (slot) => {
      const slots = generateSlots(this.slotOptionsFor(slot.date));
      const s = slots.find((x) => x.time === slot.time);
      return s != null && s.available;
    });
  }

  /**
   * Book a recurring series with the given details. Only available occurrences
   * are booked; returns the list of created results.
   */
  bookSeries(rule: RecurrenceRule, details: ReservationDetails, time?: string, start?: string): BookingResult[] {
    const t = time ?? this.selectedTime;
    if (t == null) return [];
    const startDate = start ?? toISO(this.selectedDate);
    const out: BookingResult[] = [];
    for (const occ of generateSeries(rule, startDate, t)) {
      const slots = generateSlots(this.slotOptionsFor(occ.date));
      const s = slots.find((x) => x.time === occ.time);
      if (!s || !s.available) continue;
      const duration = this.effectiveSlotDuration();
      const record: BookingRecord = {
        id: `bk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        date: occ.date,
        time: occ.time,
        duration,
        status: 'confirmed',
        ...(this.selectedResourceId ? { resourceId: this.selectedResourceId } : {}),
        ...(this.selectedServiceId ? { serviceId: this.selectedServiceId } : {}),
        details,
      };
      this.store.add(record);
      const result: BookingResult = {
        date: occ.date,
        time: occ.time,
        duration,
        ...(this.selectedResourceId ? { resourceId: this.selectedResourceId } : {}),
        ...(this.selectedServiceId ? { serviceId: this.selectedServiceId } : {}),
        details,
      };
      out.push(result);
      this.emit('book', { result, record, booking: this });
    }
    this.render();
    return out;
  }

  /** Build slot-generation options for an arbitrary day (used by series checks). */
  private slotOptionsFor(date: string): GenerateSlotsOptions {
    const cfg = this.config;
    const resourceId = this.selectedResourceId || undefined;
    const svc = this.effectiveService();
    const constraints = svc ? serviceConstraints(svc) : undefined;
    const opts: GenerateSlotsOptions = {
      date,
      hours: cfg.workingHours ?? { start: '09:00', end: '17:00' },
      slotDuration: this.effectiveSlotDuration(),
      slotGap: cfg.slotGap ?? 0,
      bookings: this.activeBookings(),
      ...(resourceId ? { resourceId } : {}),
    };
    if (cfg.availability) {
      opts.ranges = resolveAvailableRanges(cfg.availability, date, resourceId).map((r) => ({
        start: r.start,
        end: r.end,
      }));
    }
    const capacity = constraints?.capacity ?? cfg.capacity;
    if (capacity != null) opts.capacity = capacity;
    return opts;
  }

  /* ── ICS export ─────────────────────────────────────────────────────── */

  /** Build an ICS `IcsEvent` from a stored booking record. */
  private recordToIcsEvent(r: BookingRecord): IcsEvent {
    const nativeZone = r.timeZone ?? this.config.timeZone ?? null;
    const start =
      r.instant != null
        ? new Date(r.instant)
        : nativeZone
          ? slotInstant(r.date, r.time, nativeZone)
          : new Date(`${r.date}T${r.time}:00`);
    const duration = r.duration ?? this.effectiveSlotDuration();
    const end = new Date(start.getTime() + duration * 60_000);
    const svc = findService(this.config.services, r.serviceId);
    const ev: IcsEvent = {
      uid: `${String(r.id)}@jects-booking`,
      start,
      end,
      summary: svc?.name ?? (this.config.ariaLabel ?? this.messages.widgetLabel),
    };
    const email = r.details?.email;
    if (typeof email === 'string' && email) ev.email = email;
    return ev;
  }

  /** Return the ICS text for a booking id (or all active bookings when omitted). */
  exportIcs(id?: string): string {
    const rows = id
      ? [this.store.getById(id)].filter((r): r is BookingRecord => r != null)
      : this.store.toArray().filter((r) => r.status !== 'cancelled');
    return bookingToIcs(rows.map((r) => this.recordToIcsEvent(r)));
  }

  /** Trigger a browser download of the ICS for a booking (toolbar/manage action). */
  private exportLastIcs(id: string | null): void {
    const ics = this.exportIcs(id ?? undefined);
    downloadIcs(ics, 'appointment.ics');
  }

  /* ── config updates ─────────────────────────────────────────────────── */

  override update(patch: Partial<BookingConfig>): this {
    const hadBookings = 'bookings' in patch;
    super.update(patch);
    if ('messages' in patch) this.messages = resolveMessages(this.config.messages);
    if (hadBookings) {
      // Re-seed the store from the new bookings list, but PRESERVE any rows the
      // user confirmed via confirmBooking() (`bk-...` ids). `store.parse()`
      // replaces ALL rows, so a host that re-renders with its own list would
      // otherwise silently drop confirmed appointments — reopening blocked slots
      // and inviting a later double-booking. We keep the seeds controlled by the
      // host and merge the user-added rows back on top.
      const userAdded = this.store
        .toArray()
        .filter((r) => !String(r.id).startsWith('seed-'));
      const seeds = (this.config.bookings ?? []).map(
        (b, i): BookingRecord => ({ ...b, id: `seed-${i}`, status: 'confirmed' as BookingStatus }),
      );
      this.store.parse([...seeds, ...userAdded]);
    }
    if ('date' in patch && patch.date) {
      this.selectedDate = startOfDay(patch.date);
      this.selectedTime = null;
    }
    if ('resourceId' in patch && patch.resourceId) {
      this.selectedResourceId = patch.resourceId;
      this.selectedTime = null;
    }
    if ('serviceId' in patch && patch.serviceId) {
      this.selectedServiceId = patch.serviceId;
      this.selectedTime = null;
    }
    if ('timeZone' in patch && patch.timeZone) {
      this.displayTimeZone = patch.timeZone;
    }
    this.render();
    return this;
  }

  /* ── teardown ───────────────────────────────────────────────────────── */

  private teardownChildren(): void {
    if (this.calendar) {
      try {
        this.calendar.destroy();
      } catch {
        /* ignore */
      }
      this.calendar = null;
    }
    if (this.form) {
      try {
        this.form.destroy();
      } catch {
        /* ignore */
      }
      this.form = null;
    }
    if (this.overview) {
      try {
        this.overview.destroy();
      } catch {
        /* ignore */
      }
      this.overview = null;
    }
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    this.teardownChildren();
    this.reminders.dispose();
    super.destroy();
  }
}

// Re-export pure helpers + types consumers may want.
export { generateSlots, formatHM, formatHM12 } from './slots.js';
export type { Slot, WorkingHours, ExistingBooking } from './slots.js';

register(
  'booking',
  Booking as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Booking,
);
