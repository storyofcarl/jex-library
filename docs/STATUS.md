# Jects UI — Status

Current shipping status and maturity for each package. Maturity reflects API stability and test depth:

- **Stable** — API is settled; broad unit + browser/a11y coverage; safe to build on.
- **Beta** — feature-complete and tested, but API details may still change before 1.0.
- **Experimental** — usable and tested, but the surface is still evolving.

See [`MATRIX.md`](./MATRIX.md) for generated test/export/bundle metrics and [`ARCHITECTURE.md`](./ARCHITECTURE.md)
for the design contracts.

## Foundation

| Package | Maturity | Notes |
| --- | --- | --- |
| `@jects/core` | Stable | The versioned base contract: Widget, Store/TreeStore, signals, events, DOM utils, virtualization, sanitizer. |
| `@jects/tokens` | Stable | OKLCH 3-tier token source of truth. |
| `@jects/theme` | Stable | Shipped themes + runtime theming API. |
| `@jects/icons` | Stable | Icon set + render helpers. |
| `@jects/timeline-core` | Beta | Shared headless time-axis engine behind Gantt and Scheduler. |

## Modules

| Package | Maturity | Notes |
| --- | --- | --- |
| `@jects/grid` | Stable | Virtualized grid; deep feature set; server-side data demo; subpath exports. |
| `@jects/gantt` | Beta | Task tree, dependencies, baselines, critical path, MSPDI IO; subpath exports. |
| `@jects/scheduler` | Beta | Multi-resource scheduling + Pro features; subpath exports. |
| `@jects/calendar` | Beta | Multi-view calendar with recurrence and timezones. |
| `@jects/booking` | Beta | Appointment scheduling with availability, capacity, timezones. |
| `@jects/kanban` | Beta | Task board with swimlanes, WIP limits, data provider. |
| `@jects/todo` | Beta | Task manager with list/board/calendar/timeline/table views. |
| `@jects/spreadsheet` | Beta | Formula engine, multi-sheet, XLSX IO; subpath exports. |
| `@jects/pivot` | Beta | Aggregation, conditional formatting, XLSX export. |
| `@jects/charts` | Beta | Mainstream business chart set with axes, annotations, export. |
| `@jects/diagram` | Beta | Shapes, A*-routed connectors, auto-layout, export. |
| `@jects/widgets` | Stable | Forms, overlays, rich text, fields, nav, layout; subpath exports. |
| `@jects/chatbot` | Experimental | LLM-agnostic chat UI; focused surface still evolving. |

## Wrappers

| Package | Maturity | Notes |
| --- | --- | --- |
| `@jects/react` | Beta | Per-component subpaths; smoke-tested. |
| `@jects/vue` | Beta | Per-component subpaths; smoke-tested. |
| `@jects/elements` | Beta | Custom-element wrappers; smoke-tested. |
| `@jects/angular` | Beta | Per-component subpaths; type-level + build verified. |
