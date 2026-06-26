# Jects UI — How it compares

> **Read this first — methodology & honesty.** This page positions Jects UI against the
> established category leaders so you can make an informed build-vs-buy decision. It is a
> *controlled comparison*, written to be fair, not flattering:
>
> - **Dates matter.** Competitor capabilities below reflect each vendor's **publicly
>   documented** feature set **as of 2026-06**. Mature products ship fast — *verify the
>   current vendor docs before you rely on any single cell.*
> - **The incumbents are excellent.** AG Grid, Bryntum, DHTMLX, Handsontable, FullCalendar,
>   Highcharts, GoJS and yFiles are battle-tested, widely deployed, and in several areas
>   deeper than Jects on a given single component. We do not claim otherwise.
> - **Where we differentiate is architecture and breadth-on-one-core**, not "we have a
>   feature they lack." Most leaders have most features. The question this page answers is
>   *what is it like to adopt and live with each approach.*
> - **The Jects column is verifiable** from this repository — every capability maps to
>   shipped code, tests, and a live demo (see [`docs/MATRIX.md`](./MATRIX.md) and
>   <https://jexlibrary.vercel.app>). The competitor columns are not ours to verify; treat
>   them as a starting map, not gospel.

---

## 1. The architectural comparison (the part that actually differs)

This is the honest core of the comparison. Individual components across vendors converge on
similar feature lists; the durable differences are structural.

| Dimension | Jects UI | Typical incumbent suite | Typical single-component vendor |
| --- | --- | --- | --- |
| **One engine across all modules** | ✅ Every module (grid, gantt, scheduler, spreadsheet, charts, diagram, …) is built on a single zero-dependency `@jects/core` (Widget base, Store/TreeStore, signals, virtualization, factory). | Often multiple internal engines acquired/merged over time; shared theming varies. | N/A — one component only. |
| **Framework posture** | ✅ Framework-agnostic light-DOM classes; thin official React/Vue/Angular/Web-Component wrappers over the **same** imperative API. | Mixed: some are framework-first (e.g. React-only) with ports; some are framework-agnostic. | Frequently framework-specific. |
| **Theming** | ✅ One 3-tier **OKLCH** token system (primitive → semantic → component) as plain CSS custom properties; one live customizer themes the entire suite; `exportThemeCss()`. | Per-product theme systems; SCSS/CSS-var mixes; cross-product visual unity varies. | Component-scoped theming. |
| **Runtime dependencies** | ✅ Zero runtime deps in the core; components avoid heavy third-party graphs. | Varies; some pull large dependency trees. | Varies. |
| **Packaging** | ✅ Stable imperative API (`new Ctor(host, cfg)` · `.on/.update/.destroy`); per-component **subpath exports** so you install only what you import. | Varies; some monolithic bundles. | Single package. |
| **Licensing posture** | One suite, one source tree (see repo license). | Often per-developer/per-domain commercial licensing per product. | Per-component commercial licensing common. |

**Takeaway:** if you need *several* of these surfaces and want them to look, theme, and behave
as one system with one mental model and one dependency story, the single-core suite is the
differentiator. If you need the single deepest grid (or gantt, or chart) on the market and
nothing else, a specialist incumbent may still win on that one axis — and that's a fair call.

---

## 2. Per-category map

Legend: **✅** shipped in Jects (verifiable in this repo) · **◑** partial / edition-dependent ·
**▢** not a focus. Competitor cells summarize *publicly documented* capability as of 2026-06 and
are intentionally coarse — consult vendor docs for specifics.

### Data grid
We benchmark against **AG Grid**, **Bryntum Grid**, **DHTMLX Grid**, **Handsontable**.

| Capability | Jects Grid | Notes |
| --- | --- | --- |
| Virtualized rows + columns | ✅ | Core virtualization; see `#performance` (100k rows). |
| Typed columns, sort, multi-filter | ✅ | |
| Grouping / aggregation | ✅ | |
| Inline editing + editors | ✅ | |
| Master-detail, tree data | ✅ | |
| Selection (cell/row/range) | ✅ | |
| CSV / Excel / PDF export | ✅ | |
| Server-side data source | ✅ | Infinite-load hook + see `#server-data` demo. |
| Pivot mode | ◑ | Dedicated `@jects/pivot` module. |
| Integrated charting from grid | ◑ | Via `@jects/charts`. |

*All four incumbents are strong here; AG Grid in particular is exceptionally deep (Enterprise
pivot, integrated charts, server-side row model). Jects's edge is the shared core + theming with
the rest of the suite, not out-grid-ing AG Grid on grid-only depth.*

### Gantt & project scheduling
We benchmark against **Bryntum Gantt**, **DHTMLX Gantt**, **Syncfusion Gantt**.

| Capability | Jects Gantt | Notes |
| --- | --- | --- |
| Task tree + dependencies | ✅ | |
| Baselines, critical path | ✅ | |
| Resource histogram | ✅ | |
| Undo/redo | ✅ | |
| Scheduling engine (constraints, calendars) | ✅ | `@jects/gantt/engine`. |
| Export: PDF/PNG/CSV/XLSX/ICS | ✅ | |
| **MS-Project (MSPDI) import/export** | ✅ | `@jects/gantt/io`. |
| Effort-driven / split tasks | ◑ | Tracked (see roadmap). |

*Bryntum Gantt is the depth leader and sets the bar. Jects covers the enterprise spine
(dependencies, baselines, critical path, MSPDI) on the shared core.*

### Resource scheduling
We benchmark against **Bryntum Scheduler**, **DHTMLX Scheduler**.

| Capability | Jects Scheduler | Notes |
| --- | --- | --- |
| Multi-resource time grid | ✅ | |
| Time ranges, recurrence | ✅ | `@jects/scheduler/recurrence`. |
| Travel-time / buffers (Pro) | ✅ | `@jects/scheduler/pro`. |
| Pan / infinite scroll | ✅ | |
| Export | ✅ | |
| Event nesting / external drag | ◑ | Tracked. |

### Calendar
We benchmark against **FullCalendar**.

| Capability | Jects Calendar | Notes |
| --- | --- | --- |
| Day/week/month/year/agenda/resource/timeline | ✅ | |
| RRULE recurrence, timezones | ✅ | |
| Modal event editor, undo/redo | ✅ | |
| ICS / Excel / print export | ✅ | |

### Spreadsheet
We benchmark against **Handsontable**, **Univer**, plus **SheetJS** (IO only).

| Capability | Jects Spreadsheet | Notes |
| --- | --- | --- |
| Formula engine | ✅ | `@jects/spreadsheet/engine`. |
| Validation + dropdowns | ✅ | |
| Conditional formatting | ✅ | |
| Named ranges, comments, protection | ✅ | |
| Embedded charts, fill-handle | ✅ | |
| XLSX import/export | ✅ | `@jects/spreadsheet/io`. |
| Multi-sheet workbook | ✅ | |

### Pivot
We benchmark against **Flexmonster**, **WebDataRocks**.

| Capability | Jects Pivot | Notes |
| --- | --- | --- |
| Dimensions / measures / aggregations | ✅ | |
| Conditional formatting | ✅ | |
| Collapsible headers | ✅ | |
| OOXML XLSX export | ✅ | |

### Boards & tasks
We benchmark against **Bryntum TaskBoard** (and Trello-style boards) for kanban, and
**Asana / ClickUp / Monday / Jira**-class tools for the task manager.

| Capability | Jects Kanban / Todo | Notes |
| --- | --- | --- |
| Columns + swimlanes, WIP limits | ✅ | Kanban. |
| Rich cards, drag-and-drop, undo/redo | ✅ | Kanban. |
| List/Board/Calendar/Timeline/Table views | ✅ | Todo. |
| Workflow statuses, dependencies, subtasks | ✅ | Todo. |
| Comments, time tracking, recurrence | ✅ | Todo. |
| Import/export | ✅ | |

### Charts
We benchmark against **Highcharts**, **ECharts**, **Chart.js**.

| Capability | Jects Charts | Notes |
| --- | --- | --- |
| Line/bar/area/pie/scatter/bubble (+more) | ✅ | |
| Numeric/time/category axes | ✅ | |
| Zoom/pan, crosshair, annotations | ✅ | |
| Data labels, streaming | ✅ | |
| Export | ✅ | |

*Highcharts/ECharts have a wider exotic-chart catalog. Jects covers the mainstream business
chart set integrated with the suite's theming and data stores.*

### Diagramming
We benchmark against **GoJS**, **yFiles**, **draw.io / mxGraph**, **JointJS**.

| Capability | Jects Diagram | Notes |
| --- | --- | --- |
| Built-in/custom/HTML/image shapes | ✅ | |
| A*-routed connectors | ✅ | |
| Auto-layout (orthogonal/radial) | ✅ | |
| Swimlanes, groups | ✅ | |
| Undo/redo | ✅ | |
| JSON/PNG/PDF export | ✅ | |

*yFiles is the depth leader for large-graph layout. Jects targets the common
flowchart/org/mind/PERT diagramming needs integrated with the suite.*

---

## 3. When to choose what (honest guidance)

**Choose Jects UI when** you need *several* of these surfaces, want one design language and one
theming/token system across all of them, value a framework-agnostic imperative API with thin
official wrappers, and want a single zero-dependency core and one source tree.

**Choose a specialist incumbent when** you need the single deepest component on one axis (the
absolute deepest grid, the deepest large-graph diagram layout, the widest exotic-chart catalog)
and don't need cross-suite unification — those products have years of focused depth and that is a
legitimate reason to pick them.

**Verify before you commit:** run our `#performance` route on your own hardware, read
[`docs/MATRIX.md`](./MATRIX.md) (generated from the repo, not hand-maintained), and check each
incumbent's *current* docs for the cells above. We would rather you adopt with eyes open than be
oversold.
