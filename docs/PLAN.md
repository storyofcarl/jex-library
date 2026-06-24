# Jects UI — Master Plan

> A framework-agnostic, commercially-licensed JavaScript UI component suite that replicates the
> combined surface area of **Bryntum** and **DHTMLX**, with a clean, modern, fully-customizable
> (shadcn-style) design system. Vanilla JS first; **React, Angular, and Vue** wrappers on the roadmap.

**Status:** Planning / Foundation
**Working name:** Jects UI · npm scope `@jects/*` (placeholder — confirm branding)
**Date:** 2026-06-24

---

## 1. Product Vision

A single, coherent component library that covers everything Bryntum and DHTMLX sell, unified under one
architecture, one data layer, one event system, and one theming contract. Sold as a SaaS/commercial
product with:

- **One engine, many frameworks.** Vanilla TS core is the source of truth. React, Angular & Vue are thin wrappers.
- **shadcn-style theming.** Every color, radius, padding, and spacing value is a CSS custom property.
  Re-theme the entire suite at runtime by swapping a class or editing one stylesheet — no rebuild.
- **A live customizer web app** that writes the same CSS-variable contract and exports a `theme.css`.
- **Enterprise-grade data components** (virtualized grid, gantt, scheduler) alongside a full kit of
  basic widgets (forms, layout, menus, dialogs).

---

## 2. Locked Architectural Decisions

These are settled (backed by research on AG Grid / Bryntum / DHTMLX internals). They are the contracts
every build agent must honor.

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Light-DOM, class-based engine. No Shadow DOM for data components.** | Shadow DOM breaks "edit a stylesheet to restyle everything," hurts perf at scale, complicates a11y/focus/SSR. This is what AG Grid, Bryntum, DHTMLX all do. |
| D2 | **Imperative public API is the stable contract.** `const g = new DataGrid(el, opts); g.on('cellEdit', fn); g.destroy();` | Every framework wrapper wraps this. Design + version it carefully. |
| D3 | **Reactivity via a tiny signals lib** (~100 LOC, `@vue/reactivity`/preact-signals model). Not a whole-tree vdom. | Fine-grained updates ("only restyle this header") are what virtualized grids need. |
| D4 | **Monorepo: pnpm workspaces + Turborepo + Vite (lib mode) + TypeScript (strict) + Changesets.** | Best-in-class for a 30+ package commercial library. |
| D5 | **`@jects/core` is zero-dependency and framework-free.** | Importable by every component and every adapter. |
| D6 | **Theming = CSS custom properties only (runtime).** Optional SCSS for authoring, never in the contract. | Runtime theming, the customizer, and stylesheet-editing are impossible with compile-time SASS vars. |
| D7 | **OKLCH channel-triplet tokens**, three tiers (primitive → semantic → component), single `--radius`. | Perceptually uniform; predictable tints/contrast; alpha via `oklch(var(--x) / .5)`. |
| D8 | **Ship per package: ESM + UMD/IIFE (CDN) + `.d.ts` + unbundled CSS.** Core externalized, not inlined. | Consumer using grid+gantt ships core once. |
| D9 | **Grid renderer is pluggable** (DOM-recycling default; canvas as a later high-end mode). | Don't paint into a corner; canvas later without API break. |
| D10 | **Shared `@jects/timeline-core`** factored out before Gantt/Scheduler. | They share ~70% of the hardest code (time axis, zoom, dependency lines, bar drag/resize). |
| D11 | **Wrappers are thin + partly codegen'd** from a typed component manifest. **React** wrapper memoizes the engine + bridges props/events via refs (no re-instantiate on render); engine runs **outside Angular's zone**; **Vue** uses `shallowRef`/`markRaw` for large data. | ~80–90% of code stays in vanilla packages. |
| D12 | **Testing: Vitest (browser mode for DOM) + Playwright (E2E, visual-regression, a11y, perf).** | jsdom fakes layout and will lie about virtualization. |

---

## 3. Token / Theming System (shadcn-style)

Three tiers, JSON source of truth in `@jects/tokens`, compiled (Style Dictionary) → CSS vars + SCSS maps + TS types.

```
Tier 1  Primitive   --color-blue-500, --space-4, --font-size-sm        (the raw palette/scale)
          ↓ aliased
Tier 2  Semantic    --background --foreground --primary --primary-foreground
                    --muted --accent --destructive --border --input --ring
                    --card --popover --radius                          (components consume THESE)
          ↓ consumed
Tier 3  Component   --jects-grid-header-bg: var(--muted);                (surgical per-component knobs,
                    --jects-grid-row-height: ...                          always default to a semantic token)
```

- Light theme on `:root`; `.dark` + named themes (`.theme-corporate`) override Tier-2 vars. Switch = class swap.
- Single `--radius` cascades into all component radii via `calc()`.
- Runtime API: `applyTheme(el, { primary, radius })` sets inline CSS custom properties on a scope element.
- `@layer` for predictable consumer override priority.
### House style — "Jects: Cool Zinc + Calm CMYK" (locked default)
The single default colorway for all components. shadcn's **zinc** look, but the neutral is nudged
**cooler** (OKLCH neutral hue **H≈272** vs zinc's ~286 — leaning blue, short of slate's ~257, so it
reads as a refined cool gray, uniquely ours), low chroma with a faint cool cast. Core UI chrome stays
**monochrome** (primary = dark cool neutral, shadcn-zinc style). A separate **calm CMYK** accent group
(`--jects-cmyk-cyan/magenta/yellow/key`, muted/restrained chroma + soft tints + a `--jects-data-1…8`
categorical ramp) drives charts, tags, badges, kanban labels, highlights — never the chrome. Exact OKLCH
values live in `@jects/tokens`; documented in `docs/CONTRIBUTING-COMPONENTS.md`.

- Shipped themes (v1): **Light** (house default), **Dark**, **Light High-Contrast**, **Dark High-Contrast** —
  all on the Cool-Zinc + Calm-CMYK identity. The customizer's default preset is this house style.

---

## 4. Unified Component Inventory

Merged surface of both vendors, de-duplicated. `[B]`=Bryntum origin, `[D]`=DHTMLX origin, `[★]`=keystone.

### 4.0 Foundation (packages, not user-facing widgets)
- `@jects/core` — signals/reactivity · `Widget` base (lifecycle: init→render→update→destroy) · `Store`
  (DataCollection: load/parse/CRUD/sort/filter/group/serialize) · `TreeStore` (TreeCollection) ·
  typed `EventEmitter` + delegated DOM event manager · DOM utils (measure, focus, a11y, RTL) ·
  virtualization math (windowing, offset-index/Fenwick) · factory/type registry (`{type:'button'}`)
- `@jects/tokens` · `@jects/theme` · `@jects/icons`

### 4.1 Primitives & Form Controls `[D][B]`
Button, ButtonGroup, Toggle/Switch, TextField, NumberField, TextArea, Select, **ComboBox** (autocomplete/multiselect),
Checkbox, CheckboxGroup, Radio/RadioGroup, Slider/RangeSlider, ColorPicker, DatePicker, TimePicker,
DateTimeField, FilePicker/**Vault** (file upload), Rating, DisplayField, Label, Link, Badge, ProgressBar, Avatar, Spacer.

### 4.2 Composites & Navigation `[D][B]`
**Form** (builder + validation engine), **Layout** (resizable/collapsible cells) + Splitter + Panel + Container,
Toolbar, Menu, ContextMenu, Sidebar, **Ribbon**, Tabbar/TabPanel, Pagination, **Window**/Dialog, Popup,
Tooltip, **Message**/Toast (+ alert/confirm/prompt), Mask/Overlay.

### 4.3 Data Display `[D][B]`
**Tree**, List (virtual), DataView (templated cards), Calendar (date-picker calendar / mini-calendar).

### 4.4 Data Components (the heavy hitters)
- **Grid** `[★][D][B]` — virtualized (row+col), typed columns, sort (multi), filter (+ filter bar), group + summaries,
  cell/row editing, frozen/split regions, merged cells (spans), selection/range/clipboard, tree-grid mode,
  master-detail, search, context/header menus, export (Excel/PDF/CSV/print), state persistence.
- **TreeGrid** `[D][B]` — Grid `type:"tree"` increment.
- **Pivot** `[D]` — aggregation engine + config panel (rows/cols/values/filters), tree mode, totals, export.
- **Spreadsheet** `[D]` — formula engine (170+ fns, dynamic arrays, cross-sheet), multi-sheet, XLSX import/export.
- **Charts** `[D]` — line/spline/bar/area/pie/donut/radar/scatter/treemap/heatmap, axes/scales, legend, export.

### 4.5 Scheduling Family (share `@jects/timeline-core`)
- **Scheduler** `[B][D]` — time axis + view presets/zoom, resources, event bars, drag/resize/create,
  dependencies (visual), recurrence (RRULE), tooltips/menus, export.
- **Scheduler Pro** `[B]` — + scheduling engine (auto-schedule, constraints, multi-level calendars,
  nested/split events, resource histogram + utilization).
- **Gantt** `[★][B][D]` — task tree/WBS, dependency solver, constraints (ASAP/ALAP/8 types), baselines,
  critical path, progress, calendars, resource assignment + histogram, MS-Project import/export, export.
- **Calendar (event)** `[B][D]` — multi-view (day/week/month/year/agenda/resource/timeline), recurring events, editor.
- **TaskBoard / Kanban** `[B][D]` — columns + swimlanes, WIP limits, card templates, drag (multi), editor, REST/WS.

### 4.6 Diagram Family
- **Diagram** `[D]` — modes: flowchart/UML/network, Org Chart, Mind Map, PERT; 30+ shapes, connectors
  (straight/elbow, routing), swimlanes, auto-layout (orthogonal/radial), no-code editor, export (PDF/PNG/JSON).

### 4.7 Extras
- **RichText** editor `[D]`, **To Do List** `[D]`, **Booking** `[D]`, **Chatbot** UI `[D]`.

### 4.8 Adapters & Apps
- `@jects/react`, `@jects/angular`, `@jects/vue`, `@jects/elements` (optional light-DOM custom-element shells for simple widgets).
- `apps/docs` (VitePress/Astro + live playgrounds), `apps/customizer` (theme builder → exports stylesheet),
  `apps/sandbox` (internal dev).

---

## 5. Dependency / Build-Order Graph

```
Foundation: core (signals, Widget, Store, TreeStore, events, dom, virtualization) + tokens + theme + icons
   │
   ├── Primitives (form controls, badges, progress, tooltip, popup, message)   ← reused as Grid editors & Form controls
   │       │
   │       ├── Composites (Form, Layout, nav family, Window, Tabbar, Pagination, Tree, List, DataView, Calendar)
   │       │
   │       └── Grid [★] ── TreeGrid ── Pivot / Spreadsheet (reuse grid render)
   │                    └─ Charts (independent, render-heavy)
   │
   └── timeline-core ── Scheduler ── Scheduler Pro
                     └─ Gantt (+ scheduling engine)
                     └─ Calendar(event) / Kanban   (share event+resource models)

Diagram, RichText, ToDo, Booking, Chatbot — independent leaves.
Adapters (Angular/Vue/WC) — after each component's imperative API stabilizes (codegen from manifest).
```

**Build-effort ranking (cheapest → most expensive):** primitives → nav family → Tree/List/DataView/Calendar →
Form → Charts → Kanban → Scheduler → Pivot → Spreadsheet → Diagram → **Grid** → Scheduler Pro → **Gantt**.

---

## 6. Why Foundation Must Come First (orchestration constraint)

Component agents **cannot** run in parallel until the foundation defines:
1. The `Widget` base class + lifecycle every component extends.
2. `Store` / `TreeStore` data-layer API every data component binds to.
3. The typed `EventEmitter` + `on/off/emit` convention + before/after cancel semantics.
4. The token/theme CSS-variable contract every stylesheet references.
5. The build/test/package conventions (tsconfig, vite preset, exports map, CSS layering).
6. One **reference component** (Button) end-to-end as the canonical pattern to copy.

Foundation is therefore built as **one coherent effort (Wave 0)**, then construction fans out. See `ROADMAP.md`.
