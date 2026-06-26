# @jects/timeline-core — the headless time-axis, viewport, and layout engine behind Gantt and Scheduler

## What it is

`@jects/timeline-core` is the shared, framework-free engine that powers `@jects/gantt` and `@jects/scheduler`. It owns the hard geometry of any timeline UI — the time⇄pixel projection (`TimeAxis`), the scroll/viewport surface, row virtualization, per-row event-bar layout with overlap resolution, and orthogonal dependency-line routing — all as pure geometry with no framework coupling. You usually get it transitively through Gantt or Scheduler, but its primitives are exported directly so you can compose a custom timeline view.

## Install

```bash
pnpm add @jects/timeline-core @jects/core @jects/theme
```

`@jects/core` and `@jects/theme` are peer dependencies. In practice this package is a transitive dependency of `@jects/gantt` / `@jects/scheduler` — install it on its own only when building a custom timeline from its primitives.

## CSS

```ts
import '@jects/timeline-core/style.css';
```

The package ships `dist/style.css` (exported as `./style.css`). Import it once, alongside your `@jects/theme` base tokens.

## Minimal example

The package is consumed programmatically — you reach for its primitives rather than instantiating one widget. The most common entry point is the time axis:

```ts
import { DefaultTimeAxis, WEEK_AND_DAY } from '@jects/timeline-core';
import '@jects/theme/style.css';
import '@jects/timeline-core/style.css';

const axis = new DefaultTimeAxis({
  range: { start: Date.UTC(2026, 5, 1), end: Date.UTC(2026, 6, 1) },
  preset: WEEK_AND_DAY,
  zoom: 1,
});

const x = axis.toX(Date.UTC(2026, 5, 15));            // time → pixel
const box = axis.spanToBox({                           // span → { x, width }
  start: Date.UTC(2026, 5, 3),
  end: Date.UTC(2026, 5, 8),
});
const ticks = axis.ticksInRange(0, 800);               // gridline/label ticks

axis.setView({ zoom: 2 });                             // re-project downstream
```

The contract also describes a full widget surface — `new Timeline(host, options)` with `.destroy()` (see `Timeline` / `TimelineCtor` / `TimelineApi` in the type definitions) — which is the seam Gantt and Scheduler build on.

## Subpath exports

This package exposes a single public entry point (`.`) plus its stylesheet (`./style.css`). There are no additional subpaths — the entire contract and all default implementations are re-exported from the root entry:

- `@jects/timeline-core` — the full surface: contract types (`TimeAxis`, `RowVirtualizer`, `EventLayout`, `DependencyRouter`, `TimelineApi`, `Timeline`, …) plus concrete defaults for the axis, viewport, virtualizer, routing, and interaction primitives.

Additional subpaths are planned but not yet shipped.

## Common recipes

### Build and re-project a time axis

```ts
import { DefaultTimeAxis, HOUR_AND_DAY } from '@jects/timeline-core';

const axis = new DefaultTimeAxis({
  range: { start: Date.UTC(2026, 5, 22), end: Date.UTC(2026, 5, 25) },
  preset: HOUR_AND_DAY,
});

for (const tick of axis.ticksInRange(0, axis.contentWidth)) {
  // tick.x, tick.width, tick.span, tick.major → draw gridlines / labels
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
// each line.path is an SVG `d` string; line.from / line.to / line.waypoints are pixel points
```

### Virtualize a large row set

```ts
import { DefaultRowVirtualizer } from '@jects/timeline-core';

const virt = new DefaultRowVirtualizer(/* rows, options */);
const window = virt.computeWindow(/* scrollTop, viewportHeight */);
const top = virt.offsetOf(window.startIndex); // pixel offset of the first visible row
```

### Wire a move/resize drag on a bar

```ts
import { startBarDrag } from '@jects/timeline-core';

el.addEventListener('pointerdown', (ev) => {
  startBarDrag({ /* axis, mode, callbacks, … */ });
});
```

## Events

A `Timeline` / `TimelineApi` instance exposes typed pub/sub via `on` / `once` / `off` / `emit` (the `TimelineWidgetEvents` map). Vetoable `beforeX` handlers return `false` to cancel, and `emit` returns `false` when a `beforeX` was cancelled. Key events:

| Event | Fires when |
| --- | --- |
| `eventClick` / `eventDblClick` | An event bar is clicked / double-clicked. |
| `beforeEventChange` | Vetoable — before an event move/resize. |
| `eventChange` | An event's span changed (committed). |
| `beforeDependencyCreate` | Vetoable — before a link is created. |
| `dependencyCreate` | A dependency link was created. |
| `viewChange` | Active preset/zoom changed. |
| `rowToggle` | A tree row expanded/collapsed. |
| `scroll` | The viewport scrolled. |
| `windowChange` | The painted window changed. |

## Theming

All visuals derive from `--jects-*` CSS custom properties supplied by `@jects/theme` (surfaces, borders, the `--jects-space-*` / `--jects-radius-*` scales, and the CMYK accent set) — there are no hard-coded colors. Override any token on an ancestor element to retheme. See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

The engine is headless geometry; keyboard and ARIA semantics are owned by the views built on it (`@jects/gantt`, `@jects/scheduler`). Interaction primitives (`startBarDrag`, `startDragCreate`) are pointer-driven helpers that those views wire into their own accessible surfaces.

## Stability & support

**Beta.** The contract is broad and exercised by unit and browser (Playwright + axe-core) tests through Gantt and Scheduler, but the API may still change.

Part of the Jects UI suite. Commercial terms: see LICENSE.md.

---

Repository: <https://github.com/storyofcarl/jex-library> · Live demo: <https://jexlibrary.vercel.app>
