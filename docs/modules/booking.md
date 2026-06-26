# @jects/booking

> An enterprise appointment-scheduling widget — multiple services, per-resource availability, group capacity + waitlist, DST-correct timezones, recurring series, manage/reschedule, undo/redo and ICS export.

## Overview

`@jects/booking` is a self-service scheduling widget for picking a service, a staff member, a day, and an open time slot. It matches the category leaders — Calendly, Acuity, and the Bryntum booking experience — with multiple bookable services (each with its own duration, price, buffers, advance-notice and horizon), per-resource availability rules with blackout dates, group capacity with a waitlist, DST-correct timezone display, recurring series, a month/week overview, a manage panel (reschedule/cancel), undo/redo with multi-select, ICS export and reminders. Like every Jects module it is framework-free: it renders into a light-DOM host you own, exposes an imperative class API (`new Booking(host, config)`), and themes through `--jects-*` CSS custom properties.

## Installation

```sh
pnpm add @jects/booking @jects/core @jects/widgets @jects/theme
```

The three peers are required: `@jects/core` (widget runtime + store), `@jects/widgets` (the reservation form and calendar overview reuse the shared `Form`, fields and other controls), and `@jects/theme` (the token base). The package is ESM, side-effect-free except for its CSS, and tree-shakeable — the rich helper exports (slot math, availability rules, timezone math, capacity, recurrence, ICS, data provider, i18n) are only bundled when imported.

## Integration

**1. Import the stylesheet once** (it is side-effecting) and apply the theme base:

```ts
import '@jects/booking/style.css';
import { applyTheme } from '@jects/theme';

applyTheme(); // installs the --jects-* token base on :root
```

**2. Vanilla TS** — instantiate against a host element:

```ts
import { Booking } from '@jects/booking';

const booking = new Booking(document.getElementById('book')!, {
  services: [{ id: 'consult', name: 'Consultation', duration: 30 }],
  onBook: (result) => console.log('booked', result),
});
```

The host can be an `HTMLElement` or a CSS selector string.

**3. Frameworks (React / Angular / Vue)** — wrap with a thin mount effect that constructs on mount and calls `.destroy()` on unmount. React example:

```tsx
import { useEffect, useRef } from 'react';
import { Booking } from '@jects/booking';
import '@jects/booking/style.css';

function BookingWidget({ config }: { config: BookingConfig }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const b = new Booking(host.current!, config);
    return () => b.destroy();
  }, []);
  return <div ref={host} />;
}
```

For Angular construct in `ngAfterViewInit` and `destroy()` in `ngOnDestroy`; for Vue use `onMounted` / `onUnmounted`.

**4. Theming** is pure CSS variables — override any `--jects-*` token on the host (or a parent). See [Theming](#theming).

## Features

**Multiple services** — `services: BookingService[]`, each with `name`, `duration`, optional `price` + `currency`, `bufferBefore` / `bufferAfter`, `minNotice`, `maxHorizonDays`, `capacity`, `waitlist`, `description`, and per-service intake `fields`. When present, a service selector renders and the selected service's constraints override the top-level ones.

**Resources (staff)** — `resources: BookingResource[]` adds a second availability axis (e.g. staff or rooms), each with an optional `slotDuration` override; a resource selector renders.

**Rich availability rules** — `availability: AvailabilityRules` replaces the flat `workingHours`: per-weekday `weekly` ranges (supporting split shifts), specific-date `overrides`, `blackouts` (single days or spans, win over everything), and `perResource` schedules that fully replace the base for a given resource. Precedence: blackout → override → weekly. Helpers: `resolveAvailableRanges`, `isBlackout`, `rulesFromWorkingHours`.

**Slot engine** — generates the day's slots honoring duration, `slotGap`, existing `bookings`, buffers, minimum notice (`tooSoon`), booking horizon (`tooFar`), past slots, and capacity. Each `Slot` reports `available`, `booked`, `past`, and (when capacity is set) `seatsTotal` / `seatsBooked` / `seatsRemaining`. Helpers: `generateSlots`, `formatHM`, `formatHM12`, `parseHM`.

**Group capacity + waitlist** — set `capacity` (per service or top-level) for class/group slots; full slots show seats-remaining and, when `waitlist: true`, offer a waitlist. The FIFO `WaitlistManager` promotes the next entry to a confirmed booking when a seat opens after a cancel.

**DST-correct timezones** — `timeZone` is the business/native zone slots are defined in; `timezones: string[]` shows a display-timezone selector. Slots are anchored to real UTC instants and converted DST-correctly via `Intl`. Helpers: `slotInstant`, `instantToZoned`, `wallTimeToInstant`, `offsetLabel`, `commonTimeZones`.

**Recurring series** — preview and book a repeating series: `previewSeries(rule, time?, start?)` validates each occurrence against current availability + capacity; `bookSeries(rule, details, time?, start?)` books only the available occurrences. Helpers: `parseRRule`, `toRRule`, `expandRecurrence`, `generateSeries`, `validateSeries`, `describeRule`.

**Calendar overview** — `showCalendarView: true` mounts a compact month/week `BookingCalendarView` below the slots that summarizes bookings per day.

**Manage / reschedule / cancel** — `manageable: true` shows a manage panel listing bookings with reschedule and cancel actions; `toolbar: true` adds undo/redo + manage controls. Programmatic equivalents: `cancelBooking`, `rescheduleBooking`, `beginReschedule`, `setBookingStatus`. The `BookingManager` class manages booking lifecycle (`pending` / `confirmed` / `cancelled`).

**Undo / redo + multi-select** — every book/cancel/reschedule is an undoable command (`undo` / `redo` / `canUndo` / `canRedo`); a `SelectionModel` supports multi-select with `selectAllBookings` and `deleteSelected`. Exposed via `getCommandStack()` and `getSelection()`.

**ICS export + reminders** — `icsExport: true` shows an "Add to calendar" action after booking; `exportIcs(id?)` returns ICS text. `reminderLeadMinutes: number[]` schedules reminders via the `ReminderScheduler` (emits a `reminder` event at each lead time). Helpers: `bookingToIcs`, `downloadIcs`.

**Data provider** — `AjaxBookingDataProvider` (REST + optional WebSocket) implements `BookingDataProvider` to load availability + bookings for a window on demand, create/cancel bookings, and subscribe to remote changes.

**i18n** — every user-facing string flows through a `BookingMessages` catalog; pass `messages` (partial) to override, or use `defaultMessages` / `resolveMessages` / `formatMessage`. `locale` drives price/label formatting; `timeFormat` is `'12h'` or `'24h'`.

## Quick start

A rich scheduling widget with three services, two staff, per-resource availability + blackout, a timezone selector, capacity/waitlist, manage panel and overview (adapted from the gallery demo):

```ts
import { Booking } from '@jects/booking';
import '@jects/booking/style.css';
import { applyTheme } from '@jects/theme';

applyTheme();

const today = new Date(2026, 5, 25);
const day = new Date(2026, 5, 29); // a future weekday → slots open

new Booking('#booking', {
  date: day,
  minDate: today,
  timeFormat: '12h',
  locale: 'en-US',
  slotsHeading: 'Choose a time',
  services: [
    { id: 'consult', name: 'Intro consultation', duration: 30, price: 0,
      description: 'Free 30-minute intro call', bufferAfter: 10, minNotice: 120 },
    { id: 'demo', name: 'Product demo', duration: 60, price: 150, currency: 'USD',
      description: 'Guided 1:1 walkthrough', bufferBefore: 5, bufferAfter: 10 },
    { id: 'workshop', name: 'Group workshop', duration: 90, price: 75, currency: 'USD',
      description: 'Hands-on class — up to 6 seats', capacity: 6, waitlist: true },
  ],
  resources: [
    { id: 'alex', name: 'Alex Rivera' },
    { id: 'sam', name: 'Sam Chen' },
  ],
  availability: {
    weekly: {
      1: [{ start: '09:00', end: '17:00' }],
      2: [{ start: '09:00', end: '17:00' }],
      3: [{ start: '09:00', end: '13:00' }],
      4: [{ start: '09:00', end: '17:00' }],
      5: [{ start: '10:00', end: '15:00' }],
    },
    blackouts: ['2026-07-03'],
    perResource: {
      sam: { weekly: { 1: [{ start: '12:00', end: '18:00' }], 4: [{ start: '12:00', end: '18:00' }] } },
    },
  },
  timeZone: 'America/New_York',
  timezones: ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo'],
  waitlist: true,
  reminderLeadMinutes: [1440, 60],
  icsExport: true,
  manageable: true,
  toolbar: true,
  showCalendarView: true,
  bookings: [
    { date: '2026-06-25', time: '10:00' },
    { date: '2026-06-25', time: '13:30' },
  ],
  onBook: (result) => console.log('booked:', result),
});
```

## Configuration

`BookingConfig` (extends `WidgetConfig`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `date` | `Date \| null` | today | Day shown / selected initially. |
| `minDate` | `Date \| null` | — | Earliest selectable day (inclusive). |
| `maxDate` | `Date \| null` | — | Latest selectable day (inclusive). |
| `workingHours` | `WorkingHours` | `{ start: '09:00', end: '17:00' }` | Flat hours window (replaced by `availability`). |
| `slotDuration` | `number` (min) | `30` | Slot length. |
| `slotGap` | `number` (min) | `0` | Gap between consecutive slots. |
| `bookings` | `ExistingBooking[]` | — | Existing bookings that block slots. |
| `resources` | `BookingResource[]` | — | Bookable resources/staff (shows a selector). |
| `resourceId` | `string` | first | Initially-selected resource. |
| `timeFormat` | `'12h' \| '24h'` | `'24h'` | Slot label format. |
| `slotsHeading` | `string` | `'Select a time'` | Heading above the slot grid. |
| `ariaLabel` | `string` | `'Book an appointment'` | Accessible widget name. |
| `confirmText` | `string` | `'Confirm booking'` | Confirm button text. |
| `hidePastSlots` | `boolean` | `false` | Hide past slots instead of disabling them. |
| `disableUnavailable` | `boolean` | `true` | Disable booked/past slots (false = read-only). |
| `extraFields` | `BookingFieldSchema[]` | — | Extra reservation-form fields (after name/email/notes). |
| `onBook` | `(result: BookingResult) => void` | — | Convenience handler (also `.on('book', …)`). |
| `availability` | `AvailabilityRules` | — | Rich ruleset; replaces `workingHours` when set. |
| `services` | `BookingService[]` | — | Bookable services (shows a selector). |
| `serviceId` | `string` | first | Initially-selected service. |
| `bufferBefore` / `bufferAfter` | `number` (min) | `0` | Padding around bookings (overridden by a service). |
| `minNotice` | `number` (min) | — | Minimum advance notice (overridden by a service). |
| `maxHorizonDays` | `number` | — | Max booking horizon in days (overridden by a service). |
| `capacity` | `number` | `1` | Seats per slot (overridden by a service). |
| `waitlist` | `boolean` | `false` | Offer a waitlist when a slot is full. |
| `timeZone` | `string` (IANA) | host zone | Native zone slots are defined in. |
| `timezones` | `string[]` | — | Zones offered in the display selector (presence shows it). |
| `reminderLeadMinutes` | `number[]` | — | Reminder lead times (minutes before the appointment). |
| `toolbar` | `boolean` | `true` | Show the undo/redo/manage toolbar. |
| `manageable` | `boolean` | `true` | Show the manage-bookings panel. |
| `icsExport` | `boolean` | `true` | Show the "Add to calendar" (.ics) action after booking. |
| `showCalendarView` | `boolean` | `false` | Mount the month/week overview below the slots. |
| `locale` | `string` | runtime | BCP-47 locale for price/label formatting. |
| `messages` | `Partial<BookingMessages>` | — | i18n message-catalog overrides. |

**`BookingService`**: `id`, `name`, `duration`, `price?`, `currency?`, `bufferBefore?`, `bufferAfter?`, `minNotice?`, `maxHorizonDays?`, `capacity?`, `waitlist?`, `description?`, `fields?`.

**`AvailabilityRules`**: `weekly?` (per-weekday `TimeRange[]`), `overrides?: DateOverride[]`, `blackouts?: Array<string | BlackoutDate>`, `perResource?: Record<string, AvailabilitySchedule>`.

## Methods

| Method | Description |
| --- | --- |
| `setDate(date: Date): this` | Set the selected day. |
| `selectResource(id: string): this` / `selectService(id: string): this` | Select a resource / service. |
| `setTimeZone(tz: string): this` | Change the display timezone (slots re-render converted). |
| `selectSlot(time: string): this` | Select a `HH:MM` slot (opens the reservation form, or waitlist if full). |
| `computeSlots(): Slot[]` | Compute slots for the current day/resource/service. |
| `getBookings(): ExistingBooking[]` | All bookings currently held. |
| `getManagedBookings(): BookingRecord[]` | Active bookings with full managed shape (id/status/details). |
| `getSelectedDate()` / `getSelectedTime()` / `getSelectedResource()` / `getSelectedService()` / `getDisplayTimeZone()` | Current selection getters. |
| `beginReschedule(id): this` | Start a reschedule; the next slot pick moves the booking. |
| `cancelBooking(id): boolean` | Soft-cancel a booking (promotes a waitlist entry). |
| `rescheduleBooking(id, date, time): boolean` | Reschedule a booking directly. |
| `setBookingStatus(id, status): boolean` | Set an explicit lifecycle status. |
| `previewSeries(rule, time?, start?): SeriesSlotValidation[]` | Validate each occurrence of a recurring series. |
| `bookSeries(rule, details, time?, start?): BookingResult[]` | Book the available occurrences of a series. |
| `undo(): this` / `redo(): this` / `canUndo()` / `canRedo()` | Undo/redo book/cancel/reschedule. |
| `selectAllBookings(): this` / `deleteSelected(): this` | Multi-select bulk operations. |
| `exportIcs(id?: string): string` | ICS text for one booking (or all active bookings). |
| `getSelection()` / `getCommandStack()` / `getWaitlist()` / `getReminders()` | Headless access to the selection, command stack, waitlist and reminders. |
| `update(patch: Partial<BookingConfig>): this` / `destroy(): void` | Patch config / teardown. |

## Events

Subscribe with `booking.on(name, handler)`. Every payload also carries the `booking` instance. From `BookingEvents`:

| Event | Payload | Fires when |
| --- | --- | --- |
| `dateSelect` | `{ date, iso, booking }` | A day is selected. |
| `slotSelect` | `{ date, time, slot, booking }` | A slot is selected. |
| `resourceSelect` | `{ resourceId, booking }` | A resource is selected. |
| `serviceSelect` | `{ serviceId, booking }` | A service is selected. |
| `timezoneChange` | `{ timeZone, booking }` | The display timezone changes. |
| `beforeBook` | `{ result, booking }` | Vetoable: return `false` to cancel confirming. |
| `book` | `{ result, record, booking }` | A booking is confirmed and stored. |
| `bookingConflict` | `{ date, time, resourceId?, booking }` | A confirm is rejected — slot taken (double-booking prevented). |
| `waitlist` | `{ date, time, resourceId?, entryId, booking }` | A full slot is joined on the waitlist. |
| `waitlistPromote` | `{ record, entryId, booking }` | A waitlist entry is promoted after a cancel. |
| `cancel` | `{ id, record, booking }` | A booking is cancelled. |
| `reschedule` | `{ id, from, to, booking }` | A booking is rescheduled. |
| `statusChange` | `{ id, status, booking }` | A booking's status changes. |
| `selectionChange` | `{ selected, booking }` | The multi-selection changes. |
| `bulkDelete` | `{ ids, booking }` | Selected bookings are bulk-deleted. |

## Examples

**Services with prices, buffers and notice:**

```ts
new Booking('#book', {
  timeFormat: '12h',
  services: [
    { id: 'haircut', name: 'Haircut', duration: 45, price: 40, currency: 'USD', bufferAfter: 15 },
    { id: 'color', name: 'Color & style', duration: 120, price: 160, currency: 'USD',
      minNotice: 1440, maxHorizonDays: 60 },
  ],
  onBook: (r) => console.log(`${r.serviceId} on ${r.date} at ${r.time}`),
});
```

**Per-resource availability + blackout dates:**

```ts
new Booking('#book', {
  resources: [{ id: 'dr-lee', name: 'Dr. Lee' }, { id: 'dr-ng', name: 'Dr. Ng' }],
  availability: {
    weekly: { 1: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }] }, // split shift
    overrides: [{ date: '2026-12-24', ranges: [{ start: '09:00', end: '12:00' }] }],
    blackouts: [{ date: '2026-12-25', endDate: '2027-01-01', reason: 'Holiday closure' }],
    perResource: { 'dr-ng': { weekly: { 3: [{ start: '14:00', end: '18:00' }] } } },
  },
});
```

**A booking flow — capacity, waitlist, reschedule and ICS:**

```ts
const booking = new Booking('#book', {
  services: [{ id: 'class', name: 'Yoga class', duration: 60, capacity: 8, waitlist: true }],
  waitlist: true,
  manageable: true,
});

booking.on('book', ({ record }) => {
  const ics = booking.exportIcs(String(record.id)); // RFC-5545 text for the booking
});
booking.on('waitlist', ({ entryId }) => console.log('joined waitlist', entryId));

// Programmatic manage:
booking.rescheduleBooking('b-123', '2026-07-02', '15:00');
booking.cancelBooking('b-124'); // promotes the next waitlist entry, if any
if (booking.canUndo()) booking.undo();
```

## Theming

The widget is styled entirely with `--jects-*` tokens (install the base with `@jects/theme` / `applyTheme()`), so it restyles with the active theme. Override tokens on the host or any ancestor:

```css
#booking {
  --jects-primary: 0.55 0.2 250;   /* oklch — selected slot / confirm button */
  --jects-radius-md: 10px;
  --jects-font-family: 'Inter', system-ui, sans-serif;
}
```

Tokens the widget consumes include surfaces (`--jects-background`, `--jects-card`, `--jects-border`, `--jects-muted`), text (`--jects-foreground`, `--jects-muted-foreground`), accent/focus (`--jects-primary`, `--jects-primary-foreground`, `--jects-accent`, `--jects-ring`), `--jects-destructive` (cancel actions), the spacing scale (`--jects-space-1` … `--jects-space-6`), radii (`--jects-radius-sm/md/lg/xl`), typography (`--jects-font-size-*`, `--jects-font-weight-*`) and `--jects-duration-fast`.

Structural class hooks under the `.jects-booking` root (e.g. `.jects-booking__slots`, `.jects-booking__service--selected`, `.jects-booking__resource--selected`, `.jects-booking__manage`, `.jects-booking-cal__day--today`) are available for finer overrides; prefer tokens first.
