# @jects/booking — self-service appointment scheduling widget

## What it is

`@jects/booking` is a framework-free appointment-scheduling widget for picking a service, a staff member, a day, and an open time slot. It supports multiple bookable services (each with its own duration, price, buffers, advance-notice and horizon), per-resource availability rules with blackout dates, group capacity with a FIFO waitlist, DST-correct timezone display, recurring series, a month/week overview, a manage panel (reschedule/cancel), undo/redo with multi-select, and ICS export. Like every Jects module it renders into a light-DOM host you own and exposes an imperative class API (`new Booking(host, config)`), themed entirely through `--jects-*` CSS custom properties.

## Install

```sh
pnpm add @jects/booking @jects/core @jects/widgets @jects/theme
```

All three peers are required: `@jects/core` (widget runtime + store), `@jects/widgets` (the reservation form and calendar overview reuse the shared `Form`, fields and other controls), and `@jects/theme` (the token base). The package is ESM and side-effect-free except for its CSS.

## CSS

```ts
import '@jects/booking/style.css';
```

The stylesheet is side-effecting; import it once for your app.

## Minimal example

```ts
import { Booking } from '@jects/booking';
import '@jects/booking/style.css';
import { applyTheme } from '@jects/theme';

applyTheme(); // installs the --jects-* token base on :root

const booking = new Booking(document.getElementById('book')!, {
  services: [{ id: 'consult', name: 'Consultation', duration: 30 }],
  onBook: (result) => console.log('booked', result),
});

// later, on teardown:
booking.destroy();
```

The host can be an `HTMLElement` or a CSS selector string.

## Subpath exports

- `@jects/booking/style.css` — the widget stylesheet (side-effecting; import once).

The public API ships from the single `.` entry; helper modules (slot math, availability rules, timezone math, capacity, recurrence, ICS, data provider, i18n) are all re-exported from `@jects/booking` and tree-shaken when unused. Additional subpaths are not currently published.

## Common recipes

**Services with prices, buffers and notice**

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

**Per-resource availability + blackout dates**

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

**Capacity, waitlist, reschedule and ICS export**

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

**Recurring series**

```ts
const preview = booking.previewSeries(rule, '10:00'); // validate each occurrence
const results = booking.bookSeries(rule, details, '10:00'); // book the available ones
```

## Events

Subscribe with `booking.on(name, handler)`. Every payload also carries the `booking` instance. Key events from `BookingEvents`:

| Event | Fires when |
| --- | --- |
| `dateSelect` | A day is selected. |
| `slotSelect` | A slot is selected. |
| `resourceSelect` / `serviceSelect` | A resource / service is selected. |
| `timezoneChange` | The display timezone changes. |
| `beforeBook` | Vetoable — return `false` to cancel confirming. |
| `book` | A booking is confirmed and stored. |
| `bookingConflict` | A confirm is rejected — slot already taken. |
| `waitlist` | A full slot is joined on the waitlist. |
| `waitlistPromote` | A waitlist entry is promoted after a cancel. |
| `cancel` | A booking is cancelled. |
| `reschedule` | A booking is rescheduled. |
| `statusChange` | A booking's status changes. |
| `selectionChange` / `bulkDelete` | Multi-selection changes / selected bookings bulk-deleted. |

## Theming

The widget is styled entirely with `--jects-*` CSS custom properties — install the base with `@jects/theme` (`applyTheme()`), then override any token on the host or an ancestor (e.g. `--jects-primary`, `--jects-radius-md`, `--jects-font-family`). See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

Interactive controls are keyboard-operable, the widget carries an accessible name (`ariaLabel`, default `'Book an appointment'`), and the reservation form, slot grid and selectors expose ARIA roles/state. The package is tested with `axe-core` in a real browser.

## Stability & support

**Beta.** The API surface is broad and covered by unit and browser (Playwright + axe) tests, but is still settling. Part of the Jects UI suite ([repo](https://github.com/storyofcarl/jex-library), [live demo](https://jexlibrary.vercel.app)). Commercial terms: see LICENSE.md.
