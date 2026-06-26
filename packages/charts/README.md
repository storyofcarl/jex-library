# @jects/charts — a framework-free charting widget for the Jects UI suite

## What it is

`@jects/charts` provides a single imperative `Chart` widget covering thirteen chart types (line, spline, bar, horizontal bar, area, spline area, pie, donut, radar, scatter, treemap, heatmap, bubble) plus combination and dual-axis charts. It supports numeric / time / category / log axes, interactive zoom/pan, a snapping crosshair, target-line annotations, per-point data labels, gradients, real-time streaming, and SVG/PNG/PDF export. Like the rest of Jects UI it is framework-free: it renders into a host element (SVG by default, or canvas) and is themed through `--jects-*` CSS custom properties.

## Install

```sh
pnpm add @jects/charts @jects/core
```

`@jects/core` is the only peer dependency. `@jects/theme` is recommended for the design tokens the chart reads (notably the categorical data ramp). The package ships ESM (plus a UMD build) and is tree-shakeable.

## CSS

The package ships a side-effect stylesheet for chart chrome (plot, legend, tooltip, crosshair). Import it once, ideally alongside the `@jects/theme` base tokens:

```ts
import '@jects/theme/style.css'; // base design tokens (--jects-* incl. the data ramp)
import '@jects/charts/style.css'; // chart chrome
```

## Minimal example

```ts
import '@jects/theme/style.css';
import '@jects/charts/style.css';
import { Chart } from '@jects/charts';

const chart = new Chart('#chart', {
  type: 'line',
  height: 320,
  categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
  series: [
    { name: 'Revenue', data: [12, 19, 15, 22, 18, 25] },
    { name: 'Cost', data: [8, 11, 9, 13, 12, 15] },
  ],
  legend: { show: true, position: 'bottom' },
  tooltip: { show: true },
});

// later, on teardown
chart.destroy();
```

The first argument is a host element or a CSS selector string.

## Subpath exports

This package exposes a single public entry point (`.`) plus its stylesheet (`./style.css`). Everything documented below — the `Chart` widget, configuration/event types, scales, geometry helpers, renderers, the color palette, and data-aggregation utilities — is re-exported from the root `@jects/charts` import. No additional code subpaths exist; subpaths beyond the stylesheet are not currently planned.

## Common recipes

### Time axis with a live streaming feed

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

### Interactive: zoom, pan, crosshair, target line, data labels

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

const blob = await chart.pdf(); // single-page PDF Blob
```

### Combination & dual axes

```ts
const chart = new Chart('#combo', {
  categories: ['Q1', 'Q2', 'Q3', 'Q4'],
  yAxis: [{ title: 'Units' }, { title: 'Rate %', side: 'right' }],
  series: [
    { name: 'Units', type: 'bar', data: [120, 150, 130, 170], axis: 'left' },
    { name: 'Rate', type: 'line', data: [4, 6, 5, 8], axis: 'right' },
  ],
});
```

## Events

Subscribe with `chart.on(name, handler)` (also `once` / `off`). The `ChartEvents` surface includes:

- `draw` — `{ chart }`: after a render pass completes.
- `pointerOver` — `{ context: TooltipContext }`: pointer enters a data point/slice.
- `pointerOut` — `{}`: pointer leaves all data.
- `pointClick` — `{ context: TooltipContext }`: a data point/slice is clicked.
- `legendToggle` — `{ seriesIndex, hidden }`: a legend item is toggled.
- `zoom` — `{ x, y }` as `[number, number] | null` per axis: the zoom/pan window changes (`null` = axis fully reset).

`TooltipContext` carries `{ seriesIndex, seriesName, pointIndex, category, value, color }`.

## Theming

The chart is themed entirely through `--jects-*` CSS custom properties — most importantly the categorical data ramp `--jects-data-1 … --jects-data-8` (series cycle through it by index unless a per-series `color` is set), plus the base surface/text/border tokens for axes, grid, legend and tooltip chrome. Include `@jects/theme` (`@jects/theme/style.css`) for the default token values. See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

The chart renders as a `role="img"` graphic with a resolved `aria-label` / `aria-describedby` (from `title` / `ariaLabel` / `description`), and exposes a visually-hidden, keyboard-reachable data table mirroring the plotted values for assistive technology.

## Stability & support

Beta. The `Chart` widget is broad and exercised by unit and browser tests (including axe-core accessibility checks), but the API may still change.

Part of the Jects UI suite. Repository: <https://github.com/storyofcarl/jex-library>. Live demo: <https://jexlibrary.vercel.app>. Commercial terms: see LICENSE.md.
