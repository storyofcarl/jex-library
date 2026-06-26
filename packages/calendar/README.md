# @jects/calendar — a full event calendar with day/week/month/year/agenda/resource/timeline views

## What it is

`@jects/calendar` is a complete scheduling calendar for showing and editing events across day, week, month, year, agenda, resource and timeline views. It supports RFC-5545 RRULE recurrence, IANA timezone projection, categories and resources, drag-to-create/move/resize, a modal event editor, undo/redo, load-on-demand, and ICS/CSV/print export. Like every Jects module it is framework-free: it renders into a light-DOM host you own, exposes an imperative class API (`new Calendar(host, config)`), and themes entirely through `--jects-*` CSS custom properties.

## Install

```sh
pnpm add @jects/calendar @jects/core @jects/widgets @jects/theme
```

All three peers are required: `@jects/core` (widget runtime + store), `@jects/widgets` (the editor reuses the shared `Window`, fields and other controls), and `@jects/theme` (the token base). The package is ESM and side-effect-free except for its CSS, so the many helper exports (recurrence, ICS, date math) are only bundled when you import them.

## CSS

```ts
import '@jects/calendar/style.css';
```

The package ships `dist/style.css` (exposed as the `./style.css` export). Import it once; it is side-effecting.

## Minimal example

```ts
import { Calendar } from '@jects/calendar';
import '@jects/calendar/style.css';
import { applyTheme } from '@jects/theme';

applyTheme(); // installs the --jects-* token base on :root

const cal = new Calendar(document.getElementById('cal')!, {
  view: 'week',
  events: [
    { id: 1, title: 'Standup', start: new Date(), end: new Date(Date.now() + 36e5) },
  ],
});

// later, on teardown:
cal.destroy();
```

The host can be an `HTMLElement` or a CSS selector string. Give it an explicit height — the calendar fills its host.

## Subpath exports

Single primary entry (`.`) plus the stylesheet:

- `@jects/calendar/style.css` — the calendar's compiled stylesheet (`dist/style.css`); import once.

No other subpaths are exported; the entire public API (`Calendar`, `EventStore`, recurrence/timezone/export/date helpers, and types) ships from the main entry.

## Common recipes

**Categories, resources and recurrence**

```ts
import { Calendar } from '@jects/calendar';

const cal = new Calendar('#cal', {
  view: 'week',
  weekStart: 1,
  timeZone: 'America/New_York',
  categories: [
    { id: 'work', name: 'Work', color: 'data-1' },
    { id: 'health', name: 'Health', color: 'data-4' },
  ],
  resources: [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
  ],
  events: [
    // RFC-5545 RRULE string (Mon/Wed/Fri)
    { id: 1, title: 'Team standup', start: new Date(2026, 5, 1, 9), end: new Date(2026, 5, 1, 9, 30),
      categoryId: 'work', resourceId: 'a', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
    // recurrence-object rule (every other day, 6 times)
    { id: 2, title: 'Gym', start: new Date(2026, 5, 1, 18), end: new Date(2026, 5, 1, 19),
      categoryId: 'health', resourceId: 'a', recurrence: { freq: 'daily', interval: 2, count: 6 } },
  ],
});
```

**Navigation and view switching**

```ts
cal.setView('month');
cal.goToDate(new Date(2026, 11, 25));
cal.next();   // forward one view period
cal.prev();   // back one period
cal.today();  // jump to today
```

**Export (ICS / CSV / print)**

```ts
cal.exportICS('my-calendar.ics');   // RFC-5545 ICS download
cal.exportExcel('my-calendar.xls'); // CSV download
cal.print();                        // print dialog for the current view

// Or use the standalone serializers without a Calendar instance:
import { toIcs, toCsv } from '@jects/calendar';
const ics = toIcs(events, { calendarName: 'Team' });
const csv = toCsv(events);
```

**Load-on-demand + undo/redo**

```ts
const cal = new Calendar('#cal', {
  view: 'month',
  loadEvents: async (start, end) => {
    const res = await fetch(`/api/events?from=${start.toISOString()}&to=${end.toISOString()}`);
    return res.json();
  },
});

if (cal.canUndo()) cal.undo(); // also bound to Ctrl+Z / Ctrl+Y
```

## Events

Subscribe with `cal.on(name, handler)`; payloads come from the `CalendarEvents` map. Key events:

- `viewChange` `{ view }` — the active view changed.
- `dateChange` `{ date }` — the anchor/focused date changed (navigation).
- `dateClick` `{ date, allDay }` — an empty date cell was clicked.
- `eventClick` `{ event, occurrence }` — an event/occurrence was clicked.
- `beforeEventCreate` `{ draft }` — vetoable: a drag-create is about to commit.
- `eventCreate` `{ event }` — a new event was created.
- `beforeEventUpdate` `{ event, start, end }` — vetoable: a move/resize is about to commit.
- `eventUpdate` `{ event, start, end }` — an event was moved/resized/edited.
- `beforeEventDelete` `{ event }` — vetoable: an event is about to be deleted.
- `eventDelete` `{ event }` — an event was deleted.
- `rangeSelect` `{ start, end, allDay }` — a selection range was made.
- `filterChange` `{ categoryFilter, resourceFilter }` — the category/resource filter changed.

Return `false` from a `before*` handler to veto the action.

## Theming

Styled entirely with `--jects-*` CSS custom properties — install the token base via `@jects/theme` (`applyTheme()`) and override any token on the host or an ancestor (e.g. `--jects-primary`, `--jects-radius-md`, the `--jects-data-1 … --jects-data-8` ramp used for category colors). Category colors are token *names* you supply per category (e.g. `color: 'data-1'`). See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

The calendar is keyboard-operable (e.g. Ctrl+Z / Ctrl+Y for undo/redo) and the modal event editor is built on the shared `@jects/widgets` `Window`; the package is tested with `axe-core` in the browser test suite.

## Stability & support

**Beta.** The package has both unit and browser (Playwright/axe) test coverage and a stable imperative API. Part of the Jects UI suite — see the [live demo](https://jexlibrary.vercel.app) and the [repository](https://github.com/storyofcarl/jex-library). Commercial terms: see LICENSE.md.
