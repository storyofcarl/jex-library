# @jects/scheduler
> Multi-resource time-grid scheduler — resources × events on a shared timeline engine, with recurrence, dependencies, time ranges, pan/infinite-scroll, and PDF/PNG/Excel/ICS export.

## Overview
`@jects/scheduler` is a resource scheduler: rows are resources (people, machines, rooms, vehicles) and bars are events/bookings placed against time. It targets full parity with the category leaders — **Bryntum Scheduler** and **DHTMLX Scheduler** — covering global and per-resource time ranges, RFC-5545 recurrence, visual dependencies, drag-to-pan, infinite time-axis scroll, undo/redo, and multi-format export, plus a PRO tier (scheduling engine, working-time calendars, resource histogram/utilization, travel-time and buffer-time).

It is built on `@jects/timeline-core` and reuses `@jects/grid` (locked resource columns) and `@jects/widgets` (the event editor). The widget is framework-free (light-DOM, imperative API) and themed entirely through `--jects-*` CSS variables.

## Installation

```bash
pnpm add @jects/scheduler @jects/core @jects/timeline-core @jects/grid @jects/widgets @jects/theme
```

- ESM-only, tree-shakeable, framework-free.
- Peer dependencies: `@jects/core`, `@jects/timeline-core`, `@jects/grid`, `@jects/widgets`, `@jects/theme`.

## Integration

Import the side-effect stylesheet once, after the `@jects/theme` base tokens:

```ts
import '@jects/theme/style.css';      // base --jects-* tokens
import '@jects/scheduler/style.css';  // scheduler chrome
```

### Vanilla TS

```ts
import { Scheduler } from '@jects/scheduler';
import { HOUR_AND_DAY } from '@jects/timeline-core';

const scheduler = new Scheduler(document.getElementById('app')!, {
  resources: [{ id: 'r1', name: 'Alice' }],
  events: [
    { id: 'e1', resourceId: 'r1', name: 'Kickoff',
      startDate: Date.UTC(2026, 5, 22, 9), endDate: Date.UTC(2026, 5, 22, 12) },
  ],
  preset: HOUR_AND_DAY,
});
```

`new Scheduler(host, config)` — `host` is an `HTMLElement` or a selector string.

### Framework wrappers (React / Angular / Vue)

Use a thin wrapper over the imperative API: instantiate in the mount effect, `destroy()` on unmount.

```tsx
import { useEffect, useRef } from 'react';
import { Scheduler } from '@jects/scheduler';
import '@jects/scheduler/style.css';

function SchedulerView({ config }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const inst = new Scheduler(hostRef.current!, config);
    return () => inst.destroy();
  }, []);
  return <div ref={hostRef} style={{ height: 520 }} />;
}
```

For Angular/Vue the pattern is identical: create in `ngAfterViewInit` / `onMounted`, call `.destroy()` in `ngOnDestroy` / `onUnmounted`.

### Theming

All visuals derive from `--jects-*` tokens; override them on an ancestor (or swap a `@jects/theme` colorway) to retheme.

## Features

- **Resources & events** — resource lanes (`ResourceModel`) and scheduled events/bookings (`EventModel`); single-assignment via `event.resourceId` or many-to-many `AssignmentModel`s.
- **Orientation** — `horizontal` (resources as rows, time →) or `vertical` (resources as columns, time ↓).
- **View presets & zoom** — preset ladder with `zoomIn` / `zoomOut` and `setView`; uses the shared timeline presets.
- **Locked resource columns** — configurable `ResourceColumnConfig[]` rendered with `@jects/grid` (field/text/width/renderer).
- **Time ranges** — global `timeRanges` shaded/lined across the whole timeline, and per-resource `resourceTimeRanges` (PTO, maintenance windows); zero-width ranges render as marker lines.
- **Recurrence** — RFC-5545 `RRULE` subset on events (`recurrenceRule`), expanded into read-only occurrences within the visible window (`parseRRule`, `expandOccurrences`).
- **Dependencies** — FS/SS/FF/SF links between events, drawn as orthogonal connectors; optional interactive dependency drawing/editing (`dependenciesEditable`).
- **Drag interactions** — move, resize, drag-create, snap-to-tick; drag-to-pan over empty background (`panEnabled`); infinite time-axis scroll (`infiniteScroll`).
- **Event editing** — double-click edit popup (reusing `@jects/widgets` Window) via `editEvent`; programmatic `deleteEvent`.
- **Overlap strategies** — `stack` / `overlap` / `pack` for events sharing a lane.
- **Working-time** — non-working-time shading from a `WorkingTimeCalendar` (`showNonWorkingTime`), plus a "now" marker (`showNowMarker`).
- **Tooltips** — `eventTooltip` resolver.
- **Undo/redo** — `SchedulerStm` state-tracking manager + `UndoRedoController` / `installUndoRedo`.
- **Export** — PDF (`exportSchedulePdf`), PNG (`exportSchedulePng`), Excel (`SchedulerExcelExporter`), iCalendar (`IcsExporter` / `toIcs`, plus `IcsImporter`); wired into a live instance via `SchedulerExporter` / `installExport`, with optional raster + ICS toolbars.
- **PRO — scheduling engine** — auto forward/backward `schedule()` on dependency change, constraints, multi-level working-time calendars (`WorkingCalendar`).
- **PRO — resource analytics** — `computeHistograms` / `HistogramView` and `computeUtilization` / `UtilizationView`.
- **PRO — travel time** — pre/post travel margins flanking an event (`travelMargins`, `packWithTravel`, `renderTravelZones`).
- **PRO — buffer time** — required gaps between events (`bufferMargins`, `findBufferViolations`, `renderBufferZones`).

## Quick start

Adapted from the gallery demo — resources × events with a dependency, recurrence, travel time, global + per-resource time ranges, pan and infinite scroll:

```ts
import { Scheduler } from '@jects/scheduler';
import { HOUR_AND_DAY } from '@jects/timeline-core';
import '@jects/theme/style.css';
import '@jects/scheduler/style.css';

const HOUR = 3_600_000, DAY = 24 * HOUR;
const base = Date.UTC(2026, 5, 22); // Monday

new Scheduler(document.getElementById('app')!, {
  resources: [
    { id: 'r1', name: 'Alice', capacity: 1 },
    { id: 'r2', name: 'Bob', capacity: 1 },
    { id: 'r3', name: 'Carol', capacity: 2 },
  ],
  events: [
    { id: 'e1', resourceId: 'r1', name: 'Design review',
      startDate: base + HOUR * 9, endDate: base + HOUR * 12 },
    { id: 'e2', resourceId: 'r1', name: 'Build',
      startDate: base + HOUR * 13, endDate: base + HOUR * 17, eventColor: 'cyan' },
    // Travel time: 1h pre + 1h post flanking an on-site QA pass.
    { id: 'e3', resourceId: 'r2', name: 'QA pass (on-site)',
      startDate: base + DAY + HOUR * 9, endDate: base + DAY + HOUR * 15,
      eventColor: 'magenta', preTravelTime: HOUR, postTravelTime: HOUR },
    { id: 'e4', resourceId: 'r3', name: 'Standup',
      startDate: base + HOUR * 9, endDate: base + HOUR * 10,
      recurrenceRule: 'FREQ=DAILY;COUNT=5' },
  ],
  dependencies: [{ id: 'd1', fromId: 'e1', toId: 'e2', type: 'FS' }],
  timeRanges: [
    { id: 'tr1', startDate: base + HOUR * 12, endDate: base + HOUR * 13, name: 'Lunch' },
    { id: 'tr2', startDate: base + DAY + HOUR * 15, endDate: base + DAY + HOUR * 17, name: 'Sprint review' },
  ],
  resourceTimeRanges: [
    { id: 'rtr1', resourceId: 'r2', startDate: base + HOUR * 9, endDate: base + HOUR * 18, name: 'PTO' },
  ],
  preset: HOUR_AND_DAY,
  range: { start: base, end: base + DAY * 3 },
  creatable: true,
  panEnabled: true,
  infiniteScroll: true,
  eventTooltip: (e) => e.name ?? null,
});
```

## Configuration

`SchedulerConfig` (extends `WidgetConfig`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `resources` | `Store<ResourceModel> \| ResourceModel[]` | — (required) | Resource lanes. |
| `events` | `Store<EventModel> \| EventModel[]` | — (required) | Events/bookings. |
| `assignments` | `Store<AssignmentModel> \| AssignmentModel[]` | — | Many-to-many assignments (else single-assignment via `resourceId`). |
| `dependencies` | `Store<DependencyModel> \| DependencyModel[]` | — | Links between events (coerced to a reactive store). |
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | Resources as rows (time →) or columns (time ↓). |
| `preset` | `ViewPreset` | week/day | Active view preset. |
| `presets` | `ViewPreset[]` | built-in ladder | Ordered preset ladder for zoom. |
| `zoom` | `number` | `1` | Initial zoom multiplier. |
| `range` | `TimeSpan` | events' padded span | Time range to cover. |
| `rowHeight` | `number` | `48` | Row height (horizontal) / column width (vertical) in px. |
| `tickSize` | `number` | — | Tick width override (px per finest tick). |
| `columns` | `ResourceColumnConfig[]` | single name column | Locked resource columns (horizontal). |
| `overlap` | `EventOverlapStrategy` | `'stack'` | Lane overlap strategy (`stack`/`overlap`/`pack`). |
| `barMargin` | `number` | derived | Bar height within a lane (single-lane). |
| `calendar` | `WorkingTimeCalendar` | — | Working-time calendar for non-working shading. |
| `showNonWorkingTime` | `boolean` | `true` | Show non-working-time shading. |
| `timeRanges` | `TimeRangeConfig[]` | — | Global named ranges/markers across the timeline. |
| `resourceTimeRanges` | `ResourceTimeRangeConfig[]` | — | Per-resource named ranges (PTO, maintenance). |
| `showNowMarker` | `boolean` | `true` | Show a "now" marker line. |
| `panEnabled` | `boolean` | `false` | Drag empty background to pan. |
| `infiniteScroll` | `boolean` | `false` | Extend range as the viewport nears an edge. |
| `draggable` | `boolean` | `true` | Allow drag-move of events. |
| `resizable` | `boolean` | `true` | Allow event resize. |
| `creatable` | `boolean` | `false` | Allow drag-create of new events. |
| `editable` | `boolean` | `true` | Allow the double-click edit popup. |
| `dependenciesEditable` | `boolean` | `false` | Allow drawing dependencies between events. |
| `snap` | `boolean` | `true` | Snap drags to the tick grid. |
| `overscan` | `number` | `5` | Overscan rows for virtualization. |
| `eventTooltip` | `(event) => string \| null` | — | Tooltip resolver; `null` suppresses. |
| `emptyText` | `string` | — | Empty-state text. |
| `title` | `string` | — | Document title forwarded to exports. |

`EventModel` notable fields: `resourceId`, `startDate`, `endDate`, `duration?`, `percentDone?`, `draggable?`, `eventColor?`, `recurrenceRule?`, `recurringMasterId?`, plus PRO fields `constraintType?`, `constraintDate?`, `preTravelTime?`, `postTravelTime?`.

## Methods

Public methods on the `Scheduler` instance:

- `setView(view: { preset?; zoom? }): this` — switch active preset/zoom.
- `zoomIn(): this` / `zoomOut(): this` — step one level along the preset ladder.
- `setRange(range: TimeSpan): this` — extend/replace the covered time range (drives infinite-scroll programmatically).
- `scrollToTime(time: number): this` — scroll a time into horizontal view.
- `editEvent(record: EventModel): void` — open the event editor popup.
- `deleteEvent(record: EventModel): void` — delete an event (with veto + emit).
- `getAxis(): TimeAxis` — the current time⇄pixel projection.
- `getResourceStore()` / `getEventStore()` / `getDependencyStore()` — backing reactive stores.
- `getDependencyEditor(): DependencyEditController | null` — dependency drawing controller (when `dependenciesEditable`), exposing `select` / `deleteSelected` / `createDependency`.
- `update(patch: Partial<SchedulerConfig>): this` — merge config and re-render.
- `destroy(): void` — teardown (disposes gestures, observers, listeners).

Plus the inherited `@jects/core` Widget surface (`on` / `once` / `off` / `emit`, `show` / `hide`, etc.).

## Events

`SchedulerEvents` (vetoable `beforeX` handlers return `false` to cancel):

| Event | Payload | Fires when |
| --- | --- | --- |
| `eventClick` | `{ event, resource, native }` | An event bar is clicked. |
| `eventDblClick` | `{ event, resource, native }` | An event bar is double-clicked. |
| `beforeEventChange` | `{ event, from, to }` | Vetoable — before a move/resize. |
| `eventChange` | `{ event, from, to }` | An event's span changed (committed). |
| `beforeEventCreate` | `{ resourceId, span }` | Vetoable — before drag-create. |
| `eventCreate` | `{ event }` | A new event was created. |
| `beforeEventDelete` | `{ event }` | Vetoable — before deletion. |
| `eventDelete` | `{ event }` | An event was deleted. |
| `beforeDependencyCreate` | `{ dependency }` | Vetoable — before a link is created. |
| `dependencyCreate` | `{ dependency }` | A dependency was created. |
| `beforeDependencyDelete` | `{ dependency }` | Vetoable — before a link is deleted. |
| `dependencyDelete` | `{ dependency }` | A dependency was deleted. |
| `viewChange` | `{ preset, zoom }` | Active preset/zoom changed. |
| `scroll` | `{ scrollTop, scrollLeft, visibleSpan }` | The viewport scrolled. |
| `resourceSelect` | `{ resource }` | A resource lane was selected. |

## Examples

### Recurring events + dependency

```ts
import { Scheduler } from '@jects/scheduler';
import { WEEK_AND_DAY } from '@jects/timeline-core';

const day = Date.UTC(2026, 5, 22);
const s = new Scheduler('#app', {
  resources: [{ id: 'r1', name: 'Standup room' }],
  events: [
    { id: 'a', resourceId: 'r1', name: 'Daily standup',
      startDate: day + 9 * 3_600_000, endDate: day + 9.5 * 3_600_000,
      recurrenceRule: 'FREQ=DAILY;COUNT=10' },
  ],
  dependencies: [],
  preset: WEEK_AND_DAY,
  dependenciesEditable: true,
});

s.on('eventClick', ({ event }) => console.log('clicked', event.name));
```

### Veto a move outside business hours

```ts
scheduler.on('beforeEventChange', ({ to }) => {
  const startHour = new Date(to.start).getUTCHours();
  if (startHour < 8 || startHour >= 18) return false; // cancel the drag
});
```

### Export the schedule to PDF / Excel

```ts
import { installExport } from '@jects/scheduler';

const exporter = installExport(scheduler); // grafts export methods
await exporter.exportPdf?.({ /* PdfExportConfig: paper size, orientation, … */ });
```

(For PNG use `exportSchedulePng`, for spreadsheets `SchedulerExcelExporter`, and for calendars `IcsExporter` / `toIcs` — all exported from the package root.)

## Theming

The scheduler reads `@jects/theme` design tokens only — no hard-coded colors:

- Surfaces / text: `--jects-background`, `--jects-foreground`, `--jects-card`, `--jects-muted`, `--jects-muted-foreground`, `--jects-accent`, `--jects-accent-foreground`.
- Structure: `--jects-border`, `--jects-ring`, the `--jects-space-*` scale, `--jects-radius-sm` / `--jects-radius-md`.
- Typography: `--jects-font-family`, `--jects-font-size-xs` / `--jects-font-size-sm`, `--jects-font-weight-medium` / `--jects-font-weight-semibold`.
- Status / accents: `--jects-primary`, `--jects-warning`, `--jects-destructive`, and the CMYK event-category set (`eventColor: 'cyan' | 'magenta' | …` maps to `--jects-cmyk-*`).
- Motion / depth: `--jects-duration-fast`, `--jects-shadow-sm` / `--jects-shadow-md`; layering via `--jects-z-sticky`.

Override these tokens on an ancestor element to retheme; no component CSS edits are needed.
