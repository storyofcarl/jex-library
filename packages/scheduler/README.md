# @jects/scheduler — multi-resource time-grid scheduler

## What it is

`@jects/scheduler` places events and bookings against resources (people, machines, rooms, vehicles) on a shared time axis: resources are lanes and events are bars. It covers global and per-resource time ranges, RFC-5545 recurrence, visual dependencies, drag interactions, drag-to-pan, infinite time-axis scroll, undo/redo, and multi-format export, with a PRO tier for the scheduling engine, working-time calendars, resource analytics, and travel/buffer time. The widget is framework-free (light-DOM, imperative API) and themed entirely through `--jects-*` CSS variables.

## Install

```bash
pnpm add @jects/scheduler @jects/core @jects/timeline-core @jects/grid @jects/widgets @jects/theme
```

All six are peer dependencies. The package is ESM-only and tree-shakeable.

## CSS

```ts
import '@jects/theme/style.css';      // base --jects-* tokens (load first)
import '@jects/scheduler/style.css';  // scheduler chrome
```

## Minimal example

```ts
import { Scheduler } from '@jects/scheduler';
import { HOUR_AND_DAY } from '@jects/timeline-core';

const scheduler = new Scheduler(document.getElementById('app')!, {
  resources: [{ id: 'r1', name: 'Alice' }],
  events: [
    {
      id: 'e1',
      resourceId: 'r1',
      name: 'Kickoff',
      startDate: Date.UTC(2026, 5, 22, 9),
      endDate: Date.UTC(2026, 5, 22, 12),
    },
  ],
  preset: HOUR_AND_DAY,
});

// later
scheduler.destroy();
```

`new Scheduler(host, config)` — `host` is an `HTMLElement` or a selector string.

## Subpath exports

- `@jects/scheduler/export` — PDF/PNG/Excel/iCalendar export surface: `exportSchedulePdf`, `exportSchedulePng`, `SchedulerExcelExporter`, `IcsExporter` / `IcsImporter` / `toIcs`, plus the live-instance seam `SchedulerExporter` / `installExport` and raster/ICS toolbars.
- `@jects/scheduler/pro` — PRO features: the `schedule()` engine, `WorkingCalendar`, resource analytics (`computeHistograms` / `HistogramView`, `computeUtilization` / `UtilizationView`), travel-time (`travelMargins`, `packWithTravel`, `renderTravelZones`), and buffer-time (`bufferMargins`, `findBufferViolations`, `renderBufferZones`).
- `@jects/scheduler/model` — the pure, headless model layer (no view/DOM): `layoutLane`, `parseRRule` / `expandOccurrences`, dependency projection, time-range projection, infinite-scroll planning, and assignment resolution.
- `@jects/scheduler/recurrence` — the smallest model slice: RRULE parsing and occurrence expansion (`parseRRule`, `expandOccurrences`).

All four subpaths are additive — their symbols are also re-exported from the package root.

## Common recipes

### Resources, events, dependency, recurrence, and time ranges

```ts
import { Scheduler } from '@jects/scheduler';
import { HOUR_AND_DAY } from '@jects/timeline-core';

const HOUR = 3_600_000, DAY = 24 * HOUR;
const base = Date.UTC(2026, 5, 22);

const scheduler = new Scheduler('#app', {
  resources: [
    { id: 'r1', name: 'Alice' },
    { id: 'r2', name: 'Bob' },
  ],
  events: [
    { id: 'e1', resourceId: 'r1', name: 'Design review', startDate: base + HOUR * 9, endDate: base + HOUR * 12 },
    { id: 'e2', resourceId: 'r1', name: 'Build', startDate: base + HOUR * 13, endDate: base + HOUR * 17 },
    { id: 'e3', resourceId: 'r2', name: 'Standup', startDate: base + HOUR * 9, endDate: base + HOUR * 10, recurrenceRule: 'FREQ=DAILY;COUNT=5' },
  ],
  dependencies: [{ id: 'd1', fromId: 'e1', toId: 'e2', type: 'FS' }],
  timeRanges: [{ id: 'tr1', startDate: base + HOUR * 12, endDate: base + HOUR * 13, name: 'Lunch' }],
  resourceTimeRanges: [{ id: 'rtr1', resourceId: 'r2', startDate: base + HOUR * 9, endDate: base + HOUR * 18, name: 'PTO' }],
  preset: HOUR_AND_DAY,
  creatable: true,
  panEnabled: true,
  infiniteScroll: true,
});
```

### Veto a move outside business hours

```ts
scheduler.on('beforeEventChange', ({ to }) => {
  const startHour = new Date(to.start).getUTCHours();
  if (startHour < 8 || startHour >= 18) return false; // cancel the drag
});
```

### Navigate the timeline

```ts
scheduler.zoomIn();
scheduler.setRange({ start: base, end: base + DAY * 7 });
scheduler.scrollToTime(base + HOUR * 9);
```

### Export the schedule

```ts
import { installExport } from '@jects/scheduler/export';

const exporter = installExport(scheduler); // grafts export methods onto the live instance
await exporter.exportPdf?.({ /* PdfExportConfig: paper size, orientation, … */ });
```

For PNG use `exportSchedulePng`, for spreadsheets `SchedulerExcelExporter`, and for calendars `IcsExporter` / `toIcs`.

## Events

Subscribe with the inherited `@jects/core` Widget surface (`on` / `once` / `off`). Vetoable `beforeX` handlers cancel by returning `false`.

- `eventClick` / `eventDblClick` — `{ event, resource, native }`
- `beforeEventChange` (vetoable) / `eventChange` — `{ event, from, to }`
- `beforeEventCreate` (vetoable) — `{ resourceId, span }`; `eventCreate` — `{ event }`
- `beforeEventDelete` (vetoable) / `eventDelete` — `{ event }`
- `beforeDependencyCreate` (vetoable) / `dependencyCreate` — `{ dependency }`
- `beforeDependencyDelete` (vetoable) / `dependencyDelete` — `{ dependency }`
- `viewChange` — `{ preset, zoom }`
- `scroll` — `{ scrollTop, scrollLeft, visibleSpan }`
- `resourceSelect` — `{ resource }`

## Theming

All visuals derive from `@jects/theme` design tokens (`--jects-*` CSS custom properties) — surfaces, borders, spacing, typography, status colors, and the CMYK event-category set (`eventColor: 'cyan' | 'magenta' | …`). Override the tokens on an ancestor element or swap a `@jects/theme` colorway to retheme; no component CSS edits are needed. See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

The scheduler is an interactive widget with keyboard-driven navigation and ARIA roles on the grid, lanes, and event bars; the browser test suite includes `axe-core` checks.

## Stability & support

**Beta.** The public API is exercised by node and browser (Playwright + axe-core) test suites covering layout, recurrence, dependencies, time ranges, infinite scroll, undo/redo, export, and the PRO engine, but APIs may still change.

Part of the Jects UI suite. Commercial terms: see LICENSE.md.

Repository: <https://github.com/storyofcarl/jex-library> · Live demo: <https://jexlibrary.vercel.app>
