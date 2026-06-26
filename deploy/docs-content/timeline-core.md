# @jects/timeline-core
> The framework-free timeline engine — time axis, viewport, row virtualization, event/dependency positioning — that Scheduler and Gantt render on.

## Overview
`@jects/timeline-core` is the shared, headless foundation that powers both `@jects/scheduler` and `@jects/gantt`. It owns the hard parts of any timeline UI: the time ⇄ pixel projection (`TimeAxis`), the scroll/viewport surface, row virtualization, per-row event-bar layout (overlap resolution), and orthogonal dependency-line routing — all as pure geometry with no DOM coupling. It is framework-free (light-DOM, imperative API) and themed entirely through `--jects-*` CSS variables, mirroring the engine layer that sits beneath enterprise suites like Bryntum's and DHTMLX's timeline products.

The package exposes its full contract as TypeScript interfaces (`TimeAxis`, `RowVirtualizer`, `EventLayout`, `DependencyRouter`, `TimelineApi`, `Timeline`, …) plus concrete default implementations of the axis, viewport, virtualizer, and routing/interaction primitives. Consumers normally get it transitively through Scheduler/Gantt, but can use the primitives directly to build a custom timeline view.

## Installation

```bash
pnpm add @jects/timeline-core @jects/core @jects/theme
```

- ESM-only, tree-shakeable, framework-free (no React/Vue/Angular dependency).
- Peer dependencies: `@jects/core` and `@jects/theme`.
- Usually a **transitive dependency** of `@jects/gantt` / `@jects/scheduler` — you rarely install it on its own. Install it directly only when building a custom timeline view from its exported primitives.

## Integration

Import the side-effect stylesheet once (alongside your `@jects/theme` base tokens):

```ts
import '@jects/theme/style.css';        // base --jects-* design tokens
import '@jects/timeline-core/style.css'; // timeline chrome
```

This package is primarily **consumed programmatically** — you import its exported primitives and helpers rather than instantiating a single widget. The contract type `Timeline` / `TimelineCtor` describes a full widget surface (`new Timeline(host, options)`), and `TimelineApi` is the extension seam every feature builds against, but the building blocks you reach for directly are the axis, virtualizer, viewport, layout, and routing helpers below.

### Vanilla TS — build a time axis

```ts
import { DefaultTimeAxis, WEEK_AND_DAY } from '@jects/timeline-core';

const axis = new DefaultTimeAxis({
  range: { start: Date.UTC(2026, 5, 1), end: Date.UTC(2026, 6, 1) },
  preset: WEEK_AND_DAY,
  zoom: 1,
});

const x = axis.toX(Date.UTC(2026, 5, 15)); // time → pixel
const box = axis.spanToBox({ start: Date.UTC(2026, 5, 3), end: Date.UTC(2026, 5, 8) });
const ticks = axis.ticksInRange(0, 800); // gridline/label ticks for a pixel window
```

### Framework wrappers (React / Angular / Vue)

When you wrap a higher-level view (Scheduler/Gantt) that is built on this engine, use the standard thin-wrapper pattern: instantiate in the mount effect and tear down on unmount.

```tsx
import { useEffect, useRef } from 'react';
import { Scheduler } from '@jects/scheduler'; // built on timeline-core

function TimelineView(props) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const inst = new Scheduler(hostRef.current!, props.config);
    return () => inst.destroy();
  }, []);
  return <div ref={hostRef} style={{ height: 480 }} />;
}
```

### Theming

All visuals derive from `--jects-*` tokens supplied by `@jects/theme` (`--jects-foreground`, `--jects-background`, `--jects-border`, `--jects-muted`, `--jects-ring`, the `--jects-space-*` / `--jects-radius-*` scales, and the CMYK accent set). Override any token on an ancestor element to retheme the timeline.

## Features

- **Time axis (`TimeAxis` / `DefaultTimeAxis`)** — pure time⇄pixel projection for a preset + zoom over a bounded `range`: `toX` / `toTime` / `spanToBox` / `durationToWidth` / `ticksInRange` / `snap` / `setView` / `setRange`.
- **View presets & zoom ladder** — built-in presets `HOUR_AND_DAY`, `WEEK_AND_DAY`, `MONTH_AND_WEEK`, `YEAR_AND_MONTH`, `YEAR_AND_QUARTER`, the `PRESET_LADDER` / `BUILT_IN_PRESETS` registry, and `DEFAULT_ZOOM_LEVELS`; helpers `getPreset`, `finestBand`, `clampZoom`, `zoomInStep`, `zoomOutStep`.
- **Time-unit math** — `isFixedUnit`, `fixedUnitMs`, `floorToUnit`, `addUnits`, `daysInMonth`, `unitSpanMs`, `unitCount`, `weekday`.
- **Viewport / scroll** — `TimelineViewport` / `DefaultTimelineViewport`: read-only scroll geometry (`scrollTop`/`scrollLeft`/`visibleSpan`/`rowWindow`) plus `scrollToTime` / `scrollToRow` / `scrollTo`.
- **Row virtualization** — `RowVirtualizer` / `DefaultRowVirtualizer`: windowed rendering of large row sets (`computeWindow`, `offsetOf`, `heightOf`, `indexAt`, `rowAt`), with variable row heights.
- **Event layout** — `EventLayout` with overlap strategies `'stack' | 'overlap' | 'pack'` (`EventOverlapStrategy`), producing `EventBar` boxes per row.
- **Dependency routing** — `OrthogonalDependencyRouter` + `routeWaypoints` / `toPath` / `arrowheadPath` produce SVG-path connectors (`DependencyLine`) between event terminals (`'start' | 'end'`).
- **Drag interactions** — `BarDragController` / `startBarDrag` (move/resize) and `DragCreateController` / `startDragCreate` (drag-to-create), plus geometry helpers `spanBox`, `barBox`, `terminalPoint`, `zoneAtX`, `barContains`, `barAtPoint`, `timeAtX`, `sweepSpan`.
- **Time ranges & non-working time** — `projectTimeRanges`, `computeNonWorkingSpans`, `projectNonWorkingSpans`, `mergeSpans`, `computeColumnLines` for shaded bands, holidays, and column gridlines (`WorkingTimeCalendar`).
- **Tooltip** — `TimelineTooltip` with placement/content options.
- **Shared utilities** — `Disposers`, `addListener`, `clamp`, `snapTime`, `spanDuration`, `shiftSpan`, `pxToDelta`, `spansEqual`.
- **Renderer seam** — `TimelineRenderer` / `TimelineRendererFactory` (DOM-recycling default; canvas-pluggable) driven solely through `TimelineApi`.

## Quick start

Project a set of events onto a row using the default axis and event layout:

```ts
import {
  DefaultTimeAxis,
  WEEK_AND_DAY,
  type EventLayout,
  type TimelineEvent,
} from '@jects/timeline-core';
import '@jects/theme/style.css';
import '@jects/timeline-core/style.css';

const axis = new DefaultTimeAxis({
  range: { start: Date.UTC(2026, 5, 1), end: Date.UTC(2026, 6, 1) },
  preset: WEEK_AND_DAY,
});

// Map a span to a pixel box you can position a bar with.
const box = axis.spanToBox({
  start: Date.UTC(2026, 5, 8),
  end: Date.UTC(2026, 5, 12),
});
// → { x, width } in axis content pixels

// Switch zoom / preset and re-project everything downstream.
axis.setView({ zoom: 2 });
```

## Configuration

`TimelineOptions` (the full-widget config consumed by `Timeline`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `rows` | `Store<R> \| R[]` | — (required) | Row data source (resources/tasks). |
| `events` | `Store<E> \| E[]` | — (required) | Event/bar data source. |
| `dependencies` | `DependencyLink[]` | — | Dependency links between events. |
| `preset` | `ViewPreset` | — (required) | The view preset to start in. |
| `presets` | `ViewPreset[]` | `[preset]` | Ordered preset ladder for zoom in/out. |
| `zoom` | `number` | `1` | Initial zoom multiplier. |
| `range` | `TimeSpan` | events' min/max | Time range to cover. |
| `rowHeight` | `number` | — | Default row height in px. |
| `eventRowField` | `keyof E` | — | Field on an event yielding its `rowId`. |
| `eventStartField` | `keyof E` | — | Field yielding the event start. |
| `eventEndField` | `keyof E` | — | Field yielding the event end. |
| `overlap` | `EventOverlapStrategy` | — | `'stack' \| 'overlap' \| 'pack'` for events sharing a row. |
| `virtualization` | `TimelineVirtualizationOptions` | — | `{ enabled?, overscan?, variableRowHeight? }`. |
| `renderer` | `TimelineRendererFactory<E>` | DOM recycler | Override the rendering backend. |
| `plugins` | `TimelineFeature<R, E>[]` | — | Features/overlays to install at construction. |
| `emptyText` | `string` | — | Empty-state text. |

`ViewPreset` shape: `{ id, label?, headers: TimeHeaderBand[], tickUnit, tickIncrement?, pxPerUnit, zoomLevels? }`.

## Methods

Key members of `TimelineApi` (also exposed by a `Timeline` instance):

- `setView(view: { preset?; zoom? }): void` — switch preset and/or zoom.
- `zoomIn(): void` / `zoomOut(): void` — step along the preset ladder.
- `setRange(range: TimeSpan): void` — widen/narrow the covered range.
- `getRow(rowIndex): TimelineRow | undefined` / `getRowById(id)` — row lookups.
- `getEventsForRow(rowId): readonly TimelineEvent[]` / `getEventById(id)` — event lookups.
- `getDependenciesFor(eventId): readonly DependencyLink[]` — links touching an event.
- `updateEventSpan(eventId, span): boolean` — move/resize an event (fires `beforeEventChange`/`eventChange`).
- `addDependency(link): DependencyLink | undefined` / `removeDependency(linkId)` — link mutation.
- `refresh(): void` / `refreshEvent(eventId): void` / `invalidateLayout(): void` — repaint / relayout.
- `use(feature): TimelineFeature` / `removeFeature(name)` — feature lifecycle.
- `on/once/off/emit` — typed event subscription (`emit` returns `false` if a vetoable `beforeX` was cancelled).
- `track(disposer): void` — register a disposer run on `destroy()`.

`DefaultTimeAxis` (geometry): `toX`, `toTime`, `spanToBox`, `durationToWidth`, `ticksInRange`, `snap`, `setView`, `setRange`.

`DefaultRowVirtualizer`: `computeWindow`, `offsetOf`, `heightOf`, `indexAt`, `rowAt`.

## Events

`TimelineWidgetEvents` (vetoable `beforeX` handlers return `false` to cancel):

| Event | Payload | Fires when |
| --- | --- | --- |
| `eventClick` | `{ event, row, native }` | An event bar is clicked. |
| `eventDblClick` | `{ event, row, native }` | An event bar is double-clicked. |
| `beforeEventChange` | `{ event, from, to }` | Vetoable — before an event move/resize. |
| `eventChange` | `{ event, from, to }` | An event's span changed (committed). |
| `beforeDependencyCreate` | `{ link }` | Vetoable — before a link is created. |
| `dependencyCreate` | `{ link }` | A dependency link was created. |
| `viewChange` | `{ preset, zoom }` | Active preset/zoom changed. |
| `rowToggle` | `{ row, expanded }` | A tree row expanded/collapsed. |
| `scroll` | `{ scrollTop, scrollLeft, visibleSpan }` | The viewport scrolled. |
| `windowChange` | `{ window }` | The painted window changed. |

## Examples

### Generate ticks and project bars for the visible window

```ts
import { DefaultTimeAxis, HOUR_AND_DAY } from '@jects/timeline-core';

const axis = new DefaultTimeAxis({
  range: { start: Date.UTC(2026, 5, 22), end: Date.UTC(2026, 5, 25) },
  preset: HOUR_AND_DAY,
});

// Gridlines/labels for the on-screen pixel window:
for (const tick of axis.ticksInRange(0, axis.contentWidth)) {
  // tick.x, tick.width, tick.span, tick.major
}
```

### Route a dependency connector between two bars

```ts
import {
  OrthogonalDependencyRouter,
  type EventBar,
  type DependencyLink,
} from '@jects/timeline-core';

const router = new OrthogonalDependencyRouter();
const lines = router.route({ links, bars, axis });
// each line.path is an SVG `d` string; line.from/to/waypoints are pixel points
```

### Wire a move/resize drag on a bar

```ts
import { startBarDrag } from '@jects/timeline-core';

el.addEventListener('pointerdown', (ev) => {
  startBarDrag({ /* BarDragOptions: axis, mode, callbacks, … */ });
});
```

## Theming

The timeline renders entirely from `@jects/theme` design tokens — there are no hard-coded colors. Common tokens it reads:

- Surfaces / text: `--jects-background`, `--jects-foreground`, `--jects-card`, `--jects-card-foreground`, `--jects-muted`, `--jects-muted-foreground`.
- Structure: `--jects-border`, `--jects-ring`, the `--jects-space-*` scale, `--jects-radius-sm` / `--jects-radius-md`.
- Typography: `--jects-font-family`, `--jects-font-size-xs` / `--jects-font-size-sm`, `--jects-font-weight-medium`.
- Accents (event/category coloring): the CMYK set `--jects-cmyk-cyan`, `--jects-cmyk-magenta`, `--jects-cmyk-key`, plus `--jects-primary` / `--jects-accent`.
- Layering: `--jects-z-sticky` for sticky header bands.

Override any of these on an ancestor element (or via `@jects/theme` colorways) to retheme; no component-level CSS edits are required.
