# @jects/calendar

> A full event calendar — day, week, month, year, agenda, resource and timeline views with RRULE recurrence, timezones, drag editing, undo/redo and ICS/Excel/print export.

## Overview

`@jects/calendar` is a complete scheduling calendar for showing and editing events across multiple view types. It matches the category leaders — FullCalendar and the calendar side of DHTMLX Scheduler — covering day/week/month/year/agenda/resource/timeline layouts, RFC-5545 RRULE recurrence, IANA timezone projection, categories and resources, drag-to-create/move/resize, a modal event editor, undo/redo, load-on-demand, and ICS/CSV/print export. Like every Jects module it is framework-free: it renders into a light-DOM host element you own, exposes an imperative class API (`new Calendar(host, config)`), and themes entirely through `--jects-*` CSS custom properties.

## Installation

```sh
pnpm add @jects/calendar @jects/core @jects/widgets @jects/theme
```

The three peers are required: `@jects/core` (widget runtime + store), `@jects/widgets` (the editor reuses the shared `Window`, fields and other controls), and `@jects/theme` (the token base). The package is ESM, side-effect-free except for its CSS, and tree-shakeable — the many helper exports (recurrence, ICS, date math) are only bundled if you import them.

## Integration

**1. Import the stylesheet once** (it is side-effecting) and apply the theme base:

```ts
import '@jects/calendar/style.css';
import { applyTheme } from '@jects/theme';

applyTheme(); // installs the --jects-* token base on :root
```

**2. Vanilla TS** — instantiate against a host element:

```ts
import { Calendar } from '@jects/calendar';

const cal = new Calendar(document.getElementById('cal')!, {
  view: 'week',
  events: [{ id: 1, title: 'Standup', start: new Date(), end: new Date(Date.now() + 36e5) }],
});
```

The host can be an `HTMLElement` or a CSS selector string. Give it an explicit height — the calendar fills its host.

**3. Frameworks (React / Angular / Vue)** — wrap with a thin mount effect that constructs on mount and calls `.destroy()` on unmount. React example:

```tsx
import { useEffect, useRef } from 'react';
import { Calendar } from '@jects/calendar';
import '@jects/calendar/style.css';

function CalendarView({ events }: { events: CalendarEvent[] }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cal = new Calendar(host.current!, { view: 'month', events });
    return () => cal.destroy();
  }, []);
  return <div ref={host} style={{ height: 640 }} />;
}
```

For Angular put the construction in `ngAfterViewInit` and `destroy()` in `ngOnDestroy`; for Vue use `onMounted` / `onUnmounted`.

**4. Theming** is pure CSS variables — override any `--jects-*` token on the host (or a parent) to restyle. See [Theming](#theming).

## Features

**Views** — seven built-in `CalendarViewType`s: `day`, `week`, `month`, `year`, `agenda`, `resource` (per-resource columns), and `timeline` (horizontal time-axis with a row band per resource). The toolbar exposes a view switcher (limit it with `views`).

**Events & store** — events are plain `CalendarEvent` records (`title`, native `Date` `start`/`end`, `allDay`, `description`, `location`, `categoryId`, `resourceId`, `readOnly`) held in a recurrence-aware `EventStore` (a `@jects/core` `Store`). Pass raw events or your own `EventStore` instance. All-day and multi-day events render in the all-day rail.

**Recurrence** — every event can carry a `recurrence` rule object (`freq` daily/weekly/monthly/yearly, `interval`, `byWeekday`, `count`, `until`, `exDates`) **or** an `rrule` RFC-5545 string (e.g. `FREQ=WEEKLY;BYDAY=MO,WE,FR`), which is parsed into a rule on normalization. Masters expand into materialized `EventOccurrence`s for the visible window. Helpers: `expandEvent`, `expandEvents`, `parseRRule`, `toRRule`, `describeRule`.

**Timezones** — set `timeZone` to any IANA zone (e.g. `'America/New_York'`); events are stored as instants and projected to that zone's wall-clock for layout and labels (DST-correct, via `Intl`). Helpers: `zonedTime`, `timeZoneOffsetMinutes`, `formatClock`.

**Categories & resources** — `categories` give events a color (a `--jects-*` token name like `data-1`) and drive filtering; `resources` power the resource/timeline views and filtering. The sidebar renders category and resource filter rows; `categoryFilter` / `resourceFilter` set the active filter.

**Drag editing** — when `editable` (default `true`): drag in empty space to create, drag an event to move, drag its edge to resize, with `snapMinutes` granularity. Day/Week honor `dayStartHour`, `dayEndHour`, `hourHeight`.

**Modal event editor** — `editor: true` (default) opens a `Window`-based editor (title, time range, all-day, description, location, category, resource, and advanced recurrence inputs) on create/edit. Exposed standalone as `openEventEditor`.

**Undo / redo** — `history: true` (default) wraps the store with a transaction history; `undo()` / `redo()` / `canUndo()` / `canRedo()`, plus Ctrl+Z / Ctrl+Y. The `CalendarHistory` class is exported.

**Export** — `exportICS()` writes an RFC-5545 ICS document (one VEVENT per event, including RRULE), `exportExcel()` writes CSV, `print()` opens a print-friendly window of the current view. Standalone helpers: `toIcs`, `toCsv`, `eventToVEvent`, `printElement`, `downloadFile`.

**Load-on-demand** — pass `loadEvents(start, end)` (sync or async) and the calendar fetches + merges only the visible window per view; each window is fetched at most once. Trigger manually with `loadRange(start, end)`.

**Locale & navigation** — `locale` drives `Intl` date formatting (weekday/month labels, clock); `weekStart` sets the first weekday; `miniCalendar` toggles the sidebar date navigator. Navigate with `setView`, `goToDate`, `next`, `prev`, `today`.

## Quick start

A live week calendar with categories, resources, an RRULE recurring event, a recurrence-object event, and an all-day event (adapted from the gallery demo):

```ts
import { Calendar } from '@jects/calendar';
import '@jects/calendar/style.css';
import { applyTheme } from '@jects/theme';

applyTheme();

const today = new Date();
const Y = today.getFullYear(), M = today.getMonth(), D = today.getDate();
const at = (off: number, hr: number, mn = 0) => new Date(Y, M, D + off, hr, mn);

const cal = new Calendar('#calendar', {
  date: today,
  view: 'week',
  weekStart: 1,
  dayStartHour: 7,
  dayEndHour: 20,
  timeZone: 'America/New_York',
  locale: 'en-US',
  categories: [
    { id: 'work', name: 'Work', color: 'data-1' },
    { id: 'personal', name: 'Personal', color: 'data-2' },
    { id: 'health', name: 'Health', color: 'data-4' },
  ],
  resources: [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
  ],
  events: [
    // RRULE string recurrence (Mon/Wed/Fri)
    { id: 1, title: 'Team standup', start: at(0, 9, 0), end: at(0, 9, 30),
      categoryId: 'work', resourceId: 'a', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
    { id: 2, title: 'Design review', start: at(0, 11, 0), end: at(0, 12, 30),
      categoryId: 'work', resourceId: 'b' },
    // recurrence-object recurrence (every other day, 6 times)
    { id: 5, title: 'Gym', start: at(0, 18, 0), end: at(0, 19, 0), categoryId: 'health',
      resourceId: 'a', recurrence: { freq: 'daily', interval: 2, count: 6 } },
    { id: 6, title: 'Conference', start: at(3, 0, 0), end: at(4, 23, 59),
      categoryId: 'travel', resourceId: 'b', allDay: true },
  ],
});

cal.on('eventClick', ({ event }) => console.log('clicked', event.title));
```

## Configuration

`CalendarConfig` (extends `WidgetConfig`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `events` | `CalendarEvent[] \| EventStore` | `[]` | Initial events, or an existing store instance. |
| `view` | `'day'\|'week'\|'month'\|'year'\|'agenda'\|'resource'\|'timeline'` | `'month'` | Initial active view. |
| `views` | `CalendarViewType[]` | all | Which views the toolbar switcher offers. |
| `date` | `Date` | today | The focused / anchor date. |
| `weekStart` | `0..6` (Weekday) | `0` | First day of the week (0 = Sunday). |
| `categories` | `CalendarCategory[]` | — | Color + filter categories (`color` is a token name, e.g. `data-1`). |
| `resources` | `CalendarResource[]` | — | Resources for the resource/timeline views + filter. |
| `editable` | `boolean` | `true` | Allow drag-create / move / resize. |
| `miniCalendar` | `boolean` | `true` | Show the sidebar mini-calendar navigator. |
| `toolbar` | `boolean` | `true` | Show the built-in toolbar (nav + view switcher). |
| `dayStartHour` | `number` (0–23) | `0` | First visible hour in Day/Week. |
| `dayEndHour` | `number` (1–24) | `24` | Last visible hour in Day/Week. |
| `hourHeight` | `number` (px) | `48` | Pixel height of one hour row. |
| `snapMinutes` | `number` | `15` | Drag/resize snap granularity. |
| `categoryFilter` | `string[]` | all | Active category-id filter (empty = show all). |
| `resourceFilter` | `string[]` | all | Active resource-id filter (empty = show all). |
| `locale` | `string` | runtime | BCP-47 locale for `Intl` date formatting. |
| `timeZone` | `string` (IANA) | local | Display timezone occurrences are projected to. |
| `loadEvents` | `(start, end) => CalendarEvent[] \| Promise<...>` | — | Load-on-demand data source for the visible window. |
| `history` | `boolean` | `true` | Enable the undo/redo history (Ctrl+Z / Ctrl+Y). |
| `editor` | `boolean` | `true` | Use the built-in Window event editor on create/edit. |

**`CalendarEvent`** fields: `id`, `title`, `start: Date`, `end: Date`, `allDay?`, `description?`, `location?`, `categoryId?`, `resourceId?`, `recurrence?: RecurrenceRule`, `rrule?: string`, `readOnly?`.

**`RecurrenceRule`** fields: `freq` (`'daily'|'weekly'|'monthly'|'yearly'`), `interval?`, `byWeekday?: Weekday[]`, `count?`, `until?: Date`, `exDates?: Date[]`.

## Methods

| Method | Description |
| --- | --- |
| `setView(view: CalendarViewType): this` | Switch the active view. |
| `goToDate(date: Date): this` | Navigate to a specific date. |
| `next(): this` / `prev(): this` | Move forward / back one view period. |
| `today(): this` | Jump to today. |
| `update(patch: Partial<CalendarConfig>): this` | Patch config and re-render. |
| `getConfig(): Readonly<CalendarConfig>` | Read the resolved config. |
| `exportICS(fileName?: string): string` | Serialize all events to an ICS string (downloads in a browser). |
| `exportExcel(fileName?: string): string` | Serialize all events to CSV (downloads in a browser). |
| `print(): void` | Open a print-friendly window for the current view. |
| `undo(): boolean` / `redo(): boolean` | Undo / redo the last event mutation. |
| `canUndo(): boolean` / `canRedo(): boolean` | Whether undo / redo is available. |
| `loadRange(start: Date, end: Date): void` | Fetch + merge events for a window via `loadEvents`. |
| `deleteEvent(ev: CalendarEvent): boolean` | Delete an event (vetoable via `beforeEventDelete`). |
| `weekNumber(): number` | ISO week of the anchor date. |
| `show(): this` / `hide(): this` / `destroy(): void` | Visibility + teardown. |

The backing `store: EventStore` is public and offers `addEvent`, `moveEvent`, `resizeEvent`, `occurrencesInRange`.

## Events

Subscribe with `cal.on(name, handler)`. Payloads come from `CalendarEvents`:

| Event | Payload | Fires when |
| --- | --- | --- |
| `viewChange` | `{ view }` | The active view changes. |
| `dateChange` | `{ date }` | The anchor/focused date changes (navigation). |
| `dateClick` | `{ date, allDay }` | An empty date cell is clicked. |
| `eventClick` | `{ event, occurrence }` | An event/occurrence is clicked. |
| `beforeEventCreate` | `{ draft }` | Vetoable: a drag-create is about to commit. |
| `eventCreate` | `{ event }` | A new event is created (after editor commit). |
| `beforeEventUpdate` | `{ event, start, end }` | Vetoable: a move/resize is about to commit. |
| `eventUpdate` | `{ event, start, end }` | An event is moved/resized/edited. |
| `beforeEventDelete` | `{ event }` | Vetoable: an event is about to be deleted. |
| `eventDelete` | `{ event }` | An event is deleted. |
| `rangeSelect` | `{ start, end, allDay }` | A selection range is made (drag in empty space). |
| `filterChange` | `{ categoryFilter, resourceFilter }` | Category/resource filter changes. |

Return `false` from a `before*` handler to veto the action.

## Examples

**Events + RRULE recurrence:**

```ts
const cal = new Calendar('#cal', {
  view: 'week',
  events: [
    { id: 1, title: 'Daily sync', start: new Date(2026, 5, 1, 9), end: new Date(2026, 5, 1, 9, 15),
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
    { id: 2, title: 'Biweekly 1:1', start: new Date(2026, 5, 2, 14), end: new Date(2026, 5, 2, 15),
      recurrence: { freq: 'weekly', interval: 2, byWeekday: [2], count: 8 } },
  ],
});
```

**ICS / Excel / print export:**

```ts
cal.exportICS('my-calendar.ics');   // RFC-5545 ICS download
cal.exportExcel('my-calendar.xls'); // CSV download
cal.print();                        // print dialog for the current view

// Or use the standalone serializers without a Calendar instance:
import { toIcs, toCsv } from '@jects/calendar';
const ics = toIcs(events, { calendarName: 'Team' });
const csv = toCsv(events);
```

**Load-on-demand + undo/redo:**

```ts
const cal = new Calendar('#cal', {
  view: 'month',
  loadEvents: async (start, end) => {
    const res = await fetch(`/api/events?from=${start.toISOString()}&to=${end.toISOString()}`);
    return res.json();
  },
});

// after a drag edit:
if (cal.canUndo()) cal.undo();
```

## Theming

The calendar is styled entirely with `--jects-*` tokens (install the base with `@jects/theme` / `applyTheme()`), so it restyles with the active theme. Set tokens on the host or any ancestor to override:

```css
#calendar {
  --jects-primary: 0.55 0.2 250;     /* oklch — accent for today / selection */
  --jects-radius-md: 10px;
  --jects-font-family: 'Inter', system-ui, sans-serif;
}
```

Relevant token groups: surfaces (`--jects-background`, `--jects-card`, `--jects-border`, `--jects-muted`), text (`--jects-foreground`, `--jects-muted-foreground`), accent/focus (`--jects-primary`, `--jects-ring`), the data ramp (`--jects-data-1` … `--jects-data-8`) used for category colors, plus spacing/radius/typography scales. Category colors are token *names* you supply per category (e.g. `color: 'data-1'`, `color: 'cmyk-cyan'`).

Structural class hooks under the `.jects-cal` root (e.g. `.jects-cal__event`, `.jects-cal__event--timed`, `.jects-cal__agenda-row`, `.jects-cal__filter`) are available for finer overrides; prefer tokens first.
