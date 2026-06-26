# @jects/charts
> A framework-free data-visualization widget (`Chart`) — 13 chart types with zoom/pan, crosshair, annotations, streaming and PDF export, built on `@jects/core`.

## Overview
`@jects/charts` provides a single `Chart` widget covering thirteen chart types (line, spline, bar, horizontal bar, area, spline area, pie, donut, radar, scatter, treemap, heatmap, bubble) plus combination and dual-axis charts. It targets the feature surface of category leaders such as Chart.js and Highcharts — numeric/time/category/log axes, interactive zoom/pan, snapping crosshair, target-line annotations, per-point data labels, gradients, real-time streaming, and SVG/PNG/PDF export.

Like the rest of Jects UI it is framework-free: it renders into a host element in the light DOM (SVG by default, or canvas), is driven by an imperative API (`new Chart(host, config)` plus methods/events), and is themed through CSS custom properties (`--jects-*`) — notably the categorical data ramp.

## Installation
```sh
pnpm add @jects/charts @jects/core
```
`@jects/core` is the only peer dependency. (`@jects/theme` is recommended for the design tokens the chart reads.) The package ships ESM, is tree-shakeable, and has no framework dependency.

## Integration
Import the side-effect stylesheet once, alongside the `@jects/theme` base tokens:

```ts
import '@jects/theme/style.css';  // base design tokens (--jects-* incl. the data ramp)
import '@jects/charts/style.css'; // chart chrome (plot/legend/tooltip)
import { Chart } from '@jects/charts';
```

**Vanilla TS** — construct against a host element (or a CSS selector string):

```ts
const chart = new Chart('#chart', { type: 'line', categories, series });
```

**Framework wrappers (React / Angular / Vue)** — create the instance in a mount effect, keep it in a ref, and call `.destroy()` on unmount. React example:

```tsx
import { useEffect, useRef } from 'react';
import { Chart, type ChartConfig } from '@jects/charts';
import '@jects/theme/style.css';
import '@jects/charts/style.css';

export function ChartView(props: { config: ChartConfig }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const chart = new Chart(host.current!, props.config);
    return () => chart.destroy();
  }, []);
  return <div ref={host} style={{ height: 320 }} />;
}
```

**Theming** is done entirely via `--jects-*` custom properties — especially `--jects-data-1 … --jects-data-8`, the series color ramp; see [Theming](#theming).

## Features
- **13 chart types** — `line`, `spline`, `bar`, `horizontalBar`, `area`, `splineArea`, `pie`, `donut`, `radar`, `scatter`, `treemap`, `heatmap`, `bubble`.
- **Combination & dual axes** — per-series `type` (e.g. bars + a line overlay), and a `yAxis: [left, right]` pair with per-series `axis` binding.
- **Axes** — `linear`, `log`, `category` and `time` scales (`xAxis.type` / `yAxis.type`), forced `min`/`max`, tick counts, titles, value formatters, and hideable axes.
- **Numeric / time / bubble data** — series can supply explicit `points: { x, y, size? }` for true numeric/time positioning and bubble magnitude, instead of index-based categories.
- **Stacking** — `stacked` (chart-level) or per-series `stack` groups.
- **Interaction** — wheel + drag-rectangle `zoom` (`x` or `xy`), `pan`, and a snapping `crosshair`; a "reset zoom" affordance appears while a window is active.
- **Annotations** — target/plot lines drawn at a fixed value on either axis, with label, color and dash.
- **Data labels** — per-point value labels with a custom formatter.
- **Gradients** — per-series `gradient` fills (with global `fillGradient` fallback) for area/bar fills.
- **Legend & tooltip** — positionable legend with click-to-toggle series, and a customizable HTML tooltip.
- **Streaming** — `addPoint()` / `shiftData()` for real-time sliding-window feeds with a single redraw (no config rebuild).
- **Performance** — `downsample` (`average` / `minmax`) and `maxPoints` to thin dense series.
- **Export** — `svg()`, `png()` and single-page `pdf()` / `toPdf()`.
- **Accessibility** — `role="img"` graphic with resolved `aria-label` / `aria-describedby`, plus a visually-hidden, keyboard-reachable data table mirroring the plotted values.

## Quick start
A line chart with two series (adapted from the gallery demo):

```ts
import '@jects/theme/style.css';
import '@jects/charts/style.css';
import { Chart } from '@jects/charts';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

const chart = new Chart('#chart', {
  type: 'line',
  height: 320,
  categories: months,
  series: [
    { name: 'Revenue', data: [12, 19, 15, 22, 18, 25] },
    { name: 'Cost',    data: [8, 11, 9, 13, 12, 15] },
  ],
  legend: { show: true, position: 'bottom' },
  tooltip: { show: true },
});

chart.on('pointClick', ({ context }) =>
  console.log(`${context.seriesName} @ ${context.category} = ${context.value}`));
```

## Configuration
`ChartConfig` (extends the base `WidgetConfig`, so `cls` / `style` / `hidden` / `disabled` are also available).

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | `ChartType` | — | Default chart type for series without their own `type`. |
| `renderer` | `'svg' \| 'canvas'` | `'svg'` | Render backend. |
| `categories` | `Array<string \| number>` | — | X-axis category labels (cartesian) / slice labels (pie). |
| `series` | `SeriesConfig[]` | — | The data series. |
| `data` | `number[]` | — | Single-series convenience — equivalent to `series: [{ data }]`. |
| `width` | `number` | measured | Explicit pixel width (else measured from host). |
| `height` | `number` | `320` | Explicit pixel height. |
| `xAxis` | `AxisConfig` | — | X-axis config (`type`, `min`, `max`, `ticks`, `title`, `format`, `hidden`). |
| `yAxis` | `AxisConfig \| [AxisConfig, AxisConfig]` | — | Y-axis config — single, or `[left, right]` for dual axes. |
| `stacked` | `boolean` | `false` | Stack all series sharing an axis. |
| `legend` | `LegendConfig` | — | `{ show?, position?: 'top'\|'bottom'\|'left'\|'right' }`. |
| `tooltip` | `TooltipConfig` | — | `{ show?, format?(ctx) }` (custom HTML body). |
| `padding` | `Partial<Insets>` | — | Inner plot padding (px). |
| `maxPoints` | `number` | `0` (off) | Downsample series above this point count by averaging. |
| `innerRadius` | `number` | `0.6` (donut) | Donut inner-radius fraction `[0..1)`. |
| `downsample` | `'average' \| 'minmax'` | — | Downsampling strategy for dense cartesian series. |
| `zoom` | `ZoomConfig` | — | `{ type?: 'x'\|'xy', wheel?, drag? }` zoom interaction. |
| `pan` | `PanConfig` | — | `{ enabled? }` pan the zoomed window. |
| `crosshair` | `CrosshairConfig` | — | `{ x?, y?, snap? }` pointer guide lines. |
| `annotations` | `Annotation[]` | — | Target/plot lines at fixed axis values. |
| `dataLabels` | `DataLabelsConfig` | — | `{ show?, format?(ctx) }` per-point value labels. |
| `fillGradient` | `GradientFill` | — | Global area/bar fill gradient (per-series `gradient` wins). |
| `title` | `string` | — | Chart title, rendered above the plot. |
| `ariaLabel` | `string` | falls back to `title` | Accessible name for the graphic. |
| `description` | `string` | — | Longer accessible description (`aria-describedby`). |

**`SeriesConfig`** (selected fields): `name?`, `data: number[]`, `type?` (per-series for combination charts), `color?`, `axis?: 'left' \| 'right'`, `stack?`, `hidden?`, `matrix?: number[][]` (heatmap), `points?: ChartPoint[]` (explicit `{ x, y, size? }`), `gradient?: GradientFill`.

**`AxisConfig`**: `type?: 'linear' \| 'log' \| 'category' \| 'time'`, `min?`, `max?`, `ticks?` (default 5), `title?`, `hidden?`, `format?(value)`, `side?: 'left' \| 'right'`.

## Methods
Inherited from `Widget`: `update(patch)`, `getConfig()`, `show()`, `hide()`, `on(event, fn)`, `once()`, `off()`, `destroy()`, `isDestroyed`. Calling `update()` with new `series`/config re-renders.

| Method | Description |
| --- | --- |
| `addPoint(series, point, opts?)` | Append a point (Y value or `ChartPoint`) to a series (by index or name) and redraw; `{ shift: true }` drops the oldest point for a fixed-window feed. |
| `shiftData()` | Drop the oldest point from every series and redraw (sliding window). |
| `zoomTo({ x?, y? })` | Set the zoom window as domain fractions `[0..1]`; `null` resets that axis. |
| `resetZoom()` | Reset any zoom/pan window (show all data). |
| `panBy({ x?, y? })` | Pan the current window by a fraction of its span per axis. |
| `toggleSeries(index, hidden?)` | Toggle a series' visibility (as the legend does). |
| `svg()` | Serialize the current chart as an SVG string. |
| `png()` | Rasterize the chart to a PNG data URL (`Promise<string>`). |
| `pdf(pngDataUrl?)` / `toPdf(pngDataUrl?)` | Export a single-page PDF `Blob` (rasterizes via `png()` unless a data URL is supplied). |
| `destroy()` | Tear down the chart and its listeners. |

All synchronous mutators return `this` for chaining.

## Events
Subscribe with `chart.on(name, handler)`.

| Event | Payload | Fires when |
| --- | --- | --- |
| `draw` | `{ chart }` | After a render pass completes. |
| `pointerOver` | `{ context: TooltipContext }` | The pointer enters a data point/slice. |
| `pointerOut` | `{}` | The pointer leaves all data. |
| `pointClick` | `{ context: TooltipContext }` | A data point/slice is clicked. |
| `legendToggle` | `{ seriesIndex, hidden }` | A legend item is toggled. |
| `zoom` | `{ x: [number, number] \| null, y: [number, number] \| null }` | The zoom/pan window changes (`null` = axis fully reset). |

`TooltipContext` carries `{ seriesIndex, seriesName, pointIndex, category, value, color }`.

## Examples

### A time-axis line chart with a live streaming feed
```ts
import { Chart, type ChartPoint } from '@jects/charts';

const chart = new Chart('#live', {
  type: 'spline',
  height: 260,
  xAxis: { type: 'time', title: 'Time' },
  yAxis: { title: 'Throughput' },
  series: [{ name: 'Live', points: [] as ChartPoint[] }],
});

const WINDOW = 60;
let n = 0;
setInterval(() => {
  const value = 12 + 8 * Math.sin(Date.now() / 2000) + (Math.random() * 6 - 3);
  // Append an (x, y) point on the time axis; slide the window once full.
  chart.addPoint('Live', { x: Date.now(), y: value }, { shift: n >= WINDOW });
  if (n < WINDOW) n += 1;
}, 1000);
```

### Interactive chart: zoom, pan, crosshair, target line, labels
```ts
const chart = new Chart('#interactive', {
  type: 'line',
  categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
  series: [{ name: 'Revenue', data: [120, 190, 150, 220, 180, 250] }],
  zoom: { type: 'x', wheel: true, drag: true },
  pan: true,
  crosshair: { x: true, y: true, snap: true },
  annotations: [{ value: 200, axis: 'y', label: 'Target', color: '#e2477f' }],
  dataLabels: { show: true },
});

chart.on('zoom', ({ x }) => console.log('visible x window:', x));
```

### Bubble chart + PDF export
```ts
const chart = new Chart('#bubble', {
  type: 'bubble',
  xAxis: { type: 'linear', title: 'Latency (ms)' },
  yAxis: { title: 'Margin %' },
  series: [{
    name: 'Segments',
    points: [
      { x: 12, y: 8, size: 30 }, { x: 28, y: 22, size: 90 },
      { x: 62, y: 30, size: 120 }, { x: 95, y: 27, size: 40 },
    ],
  }],
});

document.querySelector('#export')!.addEventListener('click', async () => {
  const blob = await chart.pdf();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'chart.pdf' });
  a.click();
  URL.revokeObjectURL(url);
});
```

## Theming
The chart reads the standard Jects design tokens — set any `--jects-*` custom property on the host or an ancestor to retheme. Most relevant:

- **Series colors** — the categorical data ramp `--jects-data-1 … --jects-data-8` (8 stops). Series cycle through it by index unless a per-series `color` is given.
- **Chrome** — axes, grid lines, tooltip and legend use the base surface/text/border tokens (`--jects-background`, `--jects-foreground`, `--jects-muted-foreground`, `--jects-border`, etc.).

Chart parts are also class-addressable for finer styling — e.g. `.jects-chart`, `.jects-chart__plot`, `.jects-chart__legend`, `.jects-chart__legend-item`, `.jects-chart__tooltip`, `.jects-chart__crosshair`.

```css
#chart {
  --jects-data-1: oklch(0.62 0.19 255);
  --jects-data-2: oklch(0.70 0.17 25);
}
```

Per-series `color` and `gradient` always override the ramp; dark / high-contrast themes apply automatically when you switch the `@jects/theme` theme (e.g. via its `setTheme()` helper).
