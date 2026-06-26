# Jects UI — Module Documentation

Per-module developer documentation for **Jects UI** — a commercial, framework-agnostic
**enterprise planning & data UI suite** (grids, scheduling, Gantt, dashboards, diagrams,
spreadsheets, forms, productivity; vanilla TS first, with React / Angular / Vue / Web-Component
wrappers). Every component is a light-DOM class with a stable **imperative API** and
**CSS-custom-property theming** (3-tier OKLCH tokens). Live gallery: <https://jexlibrary.vercel.app>.

Each module doc follows the same shape: **Overview · Installation · Integration
(vanilla + framework + theming) · Features · Quick start · Configuration · Methods ·
Events · Examples · Theming**. All APIs, config fields, methods, and events are taken
directly from each package's published type definitions (`dist/index.d.ts`).

## Foundation

| Module | Description |
| --- | --- |
| [@jects/core](./core.md) | Zero-dependency engine every component builds on: `Widget` base, `Store`/`TreeStore`, `EventEmitter`, signals, DOM utils, the component factory, and virtualization. |
| [@jects/tokens](./tokens.md) | The raw design-token definitions — 3-tier OKLCH color system (primitive → semantic → component), data/CMYK ramps, spacing, type, radius, shadow, z-index. |
| [@jects/theme](./theme.md) | Shippable CSS theme(s) + the runtime theming API (`setTheme`/`applyTheme`/`exportThemeCss`), light/dark/high-contrast variants, and token overrides. |
| [@jects/icons](./icons.md) | The icon set + `renderIcon` / `createIconEl` helpers (sizing, sprite). |
| [@jects/timeline-core](./timeline-core.md) | The shared timeline engine (time axis, row virtualization, viewport, dependency routing) powering Gantt and Scheduler. |

## Data & grids

| Module | Description |
| --- | --- |
| [@jects/grid](./grid.md) | Virtualized data grid (AG Grid / Bryntum Grid class): typed columns, sort/filter, grouping, selection, inline editing, master-detail, tree mode, CSV/Excel/PDF export. |
| [@jects/pivot](./pivot.md) | Pivot table: dimensions/measures, aggregations, conditional formatting, collapsible headers, OOXML XLSX export. |
| [@jects/spreadsheet](./spreadsheet.md) | Spreadsheet (Excel-online class): formulas, validation + dropdowns, conditional formatting, named ranges, sort/filter, comments, embedded charts, fill-handle, protection, XLSX import/export. |

## Scheduling & timelines

| Module | Description |
| --- | --- |
| [@jects/gantt](./gantt.md) | Gantt chart (Bryntum / DHTMLX Gantt class): task tree, dependencies, baselines, critical path, resource histogram, undo/redo, PDF/PNG/CSV/XLSX/ICS/MS-Project export. |
| [@jects/scheduler](./scheduler.md) | Resource scheduler (Bryntum / DHTMLX Scheduler class): resources/events, time ranges, recurrence, travel-time & buffers (Pro), pan/infinite-scroll, export. |
| [@jects/calendar](./calendar.md) | Full calendar (FullCalendar class): day/week/month/year/agenda/resource/timeline views, RRULE recurrence, timezones, modal event editor, undo/redo, ICS/Excel/print export. |
| [@jects/booking](./booking.md) | Appointment scheduling (Calendly / Acuity class): services, per-resource availability rules + blackouts, capacity + waitlist, DST timezones, recurring series, manage/reschedule/cancel, ICS + reminders. |

## Boards, tasks & visualization

| Module | Description |
| --- | --- |
| [@jects/kanban](./kanban.md) | Task board (Bryntum TaskBoard / Trello class): columns + swimlanes, WIP limits, rich cards, drag-and-drop, undo/redo, sort/filter, data provider, json/csv/png export. |
| [@jects/todo](./todo.md) | Enterprise task manager (Asana / ClickUp / Monday / Jira class): List/Board/Calendar/Timeline/Table views, workflow statuses, swimlanes, comments/@mentions, time tracking, dependencies, subtasks, recurrence, import/export. |
| [@jects/charts](./charts.md) | Charting (Chart.js / Highcharts class): line/bar/area/pie/scatter/bubble and more, numeric/time/category axes, zoom/pan, crosshair, annotations, data labels, streaming, PDF export. |
| [@jects/diagram](./diagram.md) | Diagramming (draw.io / yFiles class): built-in/custom/HTML/image shapes, A*-routed connectors, auto-layout, swimlanes, groups, undo/redo, JSON/PNG/PDF export. |

## Widgets & chat

| Module | Description |
| --- | --- |
| [@jects/widgets](./widgets.md) | The Suite-class widget kit: fields, choice, date/time, pickers, display, feedback, **Form**, layout, nav, overlays (**Window**/Dialog/Mask/Popup/Tooltip), **RichText**, tabs, data-views. |
| [@jects/chatbot](./chatbot.md) | LLM-agnostic chat UI: streaming responses, markdown rendering, suggestions, message roles, a provider-agnostic `onSend` hook. |

---

## Common integration pattern

Every component is a class instantiated against a host element, with `.destroy()` for
teardown — so framework integration is a thin wrapper over the imperative API:

```ts
import '@jects/theme/style.css';
import '@jects/grid/style.css';
import { Grid } from '@jects/grid';

const grid = new Grid(hostElement, { /* config */ });
// …use the imperative API…
grid.destroy(); // on teardown
```

```tsx
// React: mount in an effect against a ref, destroy on unmount.
function GridView({ data }: { data: Row[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const grid = new Grid(ref.current!, { data });
    return () => grid.destroy();
  }, []);
  return <div ref={ref} style={{ height: 480 }} />;
}
```

Theming is global via CSS custom properties — include `@jects/theme` (or your own
`theme.css` exported from `exportThemeCss`) and override `--jects-*` tokens. See
[@jects/theme](./theme.md) and [@jects/tokens](./tokens.md).
