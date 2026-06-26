# Jects UI — Architecture

> A framework-agnostic, commercially-licensed JavaScript **enterprise planning & data UI suite** —
> grids, scheduling, Gantt, dashboards, diagrams, spreadsheets, forms, and productivity modules on one
> clean, fully-customizable design system. Vanilla TypeScript first, with **React, Angular, Vue, and
> Web-Component** wrappers over the same imperative API.

This document records the durable architectural decisions behind the suite. For current shipping
status see [`STATUS.md`](./STATUS.md); for the capability matrix see [`MATRIX.md`](./MATRIX.md).

---

## 1. Product principles

A single, coherent component library spanning grids, scheduling, analytics, diagramming, and
productivity — unified under one architecture, one data layer, one event system, and one theming
contract, so a team can build a whole enterprise application without stitching together several
independent UI stacks.

- **One engine, many frameworks.** The vanilla-TS core is the source of truth; React, Angular, Vue,
  and Web-Component wrappers are thin bridges over the same imperative API.
- **Token-driven theming.** Every color, radius, padding, and spacing value is a CSS custom property.
  Re-theme the entire suite at runtime by swapping a class or editing one stylesheet — no rebuild.
- **A live customizer** that writes the same CSS-variable contract and exports a `theme.css`.
- **Enterprise-grade data components** (virtualized grid, Gantt, scheduler, spreadsheet, pivot)
  alongside a full kit of primitives (forms, layout, menus, dialogs, overlays).

---

## 2. Locked architectural decisions

These are the contracts every package honors.

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Light-DOM, class-based engine. No Shadow DOM for data components.** | Shadow DOM breaks "edit one stylesheet to restyle everything," hurts performance at scale, and complicates a11y/focus/SSR. Light DOM is the standard approach for high-performance data components. |
| D2 | **The imperative public API is the stable contract.** `const g = new Grid(el, opts); g.on('cellEdit', fn); g.destroy();` | Every framework wrapper wraps this; it is designed and versioned carefully. |
| D3 | **Reactivity via a tiny signals primitive** (~100 LOC, fine-grained, no whole-tree vdom). | Fine-grained updates ("only restyle this header") are what virtualized grids need. |
| D4 | **Monorepo: pnpm workspaces + Turborepo + Vite (lib mode) + TypeScript (strict) + Changesets.** | Best-in-class tooling for a multi-package commercial library. |
| D5 | **`@jects/core` is zero-dependency and framework-free.** | Importable by every component and every wrapper. |
| D6 | **Theming = CSS custom properties only (runtime).** Optional SCSS for authoring, never in the contract. | Runtime theming, the customizer, and stylesheet-editing are impossible with compile-time SASS vars. |
| D7 | **OKLCH channel-triplet tokens**, three tiers (primitive → semantic → component), single `--radius`. | Perceptually uniform; predictable tints/contrast; alpha via `oklch(var(--x) / .5)`. |
| D8 | **Ship per package: ESM + UMD/IIFE (CDN) + `.d.ts` + unbundled CSS.** Core externalized, not inlined. | A consumer using grid + gantt ships core once. |
| D9 | **The grid renderer is pluggable** (DOM-recycling default; canvas as a later high-end mode). | Avoids painting into a corner; a canvas renderer can land later without an API break. |
| D10 | **Shared `@jects/timeline-core`** is factored out before Gantt/Scheduler. | They share the hardest code (time axis, zoom, dependency routing, bar drag/resize). |
| D11 | **Wrappers are thin and partly codegen'd** from a typed component manifest. React memoizes the engine and bridges props/events via refs (no re-instantiate on render); the engine runs outside Angular's zone; Vue uses `shallowRef`/`markRaw` for large data. | The vast majority of code stays in the vanilla packages. |
| D12 | **Testing: Vitest (browser mode for real DOM) + Playwright (E2E, visual-regression, a11y, perf).** | jsdom fakes layout and misrepresents virtualization. |

---

## 3. Token / theming system

Three tiers, with the JSON source of truth in `@jects/tokens`, compiled to CSS variables + SCSS maps + TS types.

```
Tier 1  Primitive   --color-blue-500, --space-4, --font-size-sm        (raw palette/scale)
          ↓ aliased
Tier 2  Semantic    --background --foreground --primary --primary-foreground
                    --muted --accent --destructive --border --input --ring
                    --card --popover --radius                          (components consume THESE)
          ↓ consumed
Tier 3  Component   --jects-grid-header-bg: var(--muted)                 (surgical per-component knobs,
                    --jects-grid-row-height: ...                          always defaulting to a semantic token)
```

- Light theme on `:root`; `.dark` and named themes override Tier-2 vars. Switching a theme = a class swap.
- A single `--radius` cascades into all component radii via `calc()`.
- Runtime API: `applyTheme(el, { primary, radius })` sets inline CSS custom properties on a scope element.
- `@layer` gives predictable consumer-override priority.

### House style — "Cool Zinc + Calm CMYK" (locked default)

The default colorway for all components: a refined cool gray neutral (OKLCH neutral hue ≈ 272 — a
faint cool cast, low chroma) for the UI chrome, plus a separate **calm CMYK** accent group
(`--jects-cmyk-cyan/magenta/yellow/key` + a `--jects-data-1…8` categorical ramp) for charts, tags,
badges, kanban labels and highlights — never the chrome. Exact OKLCH values live in `@jects/tokens`.

Shipped themes (v1): **Light** (default), **Dark**, **Light High-Contrast**, **Dark High-Contrast**.

---

## 4. Component inventory

### 4.0 Foundation (packages, not user-facing widgets)
- `@jects/core` — signals/reactivity · `Widget` base (init→render→update→destroy) · `Store`
  (load/parse/CRUD/sort/filter/group/serialize) · `TreeStore` · typed `EventEmitter` + delegated DOM
  event manager · DOM utils (measure, focus, a11y, RTL) · virtualization math · factory/type registry.
- `@jects/tokens` · `@jects/theme` · `@jects/icons` · `@jects/timeline-core`.

### 4.1 Primitives & form controls
Button, ButtonGroup, Toggle/Switch, TextField, NumberField, TextArea, Select, ComboBox,
Checkbox(Group), Radio(Group), Slider/RangeSlider, ColorPicker, DatePicker, TimePicker, DateTimeField,
FilePicker, Rating, DisplayField, Label, Link, Badge, ProgressBar, Avatar.

### 4.2 Composites & navigation
Form (builder + validation), Layout (resizable/collapsible cells) + Splitter + Panel + Container,
Toolbar, Menu, ContextMenu, Sidebar, Ribbon, Tabbar/TabPanel, Pagination, Window/Dialog, Popup,
Tooltip, Message/Toast (+ alert/confirm/prompt), Mask/Overlay.

### 4.3 Data display
Tree, List (virtual), DataView (templated cards), mini-calendar.

### 4.4 Data components
- **Grid** — virtualized (row + col), typed columns, multi-sort, filtering + filter bar, grouping +
  summaries, cell/row editing, frozen/split regions, merged cells, selection/range/clipboard,
  tree-grid mode, master-detail, search, context/header menus, export (Excel/PDF/CSV/print), state.
- **Pivot** — aggregation engine + config panel, totals, conditional formatting, XLSX export.
- **Spreadsheet** — formula engine, multi-sheet, validation, conditional formatting, XLSX import/export.
- **Charts** — line/bar/area/pie/scatter/bubble and more, axes/scales, legend, annotations, export.

### 4.5 Scheduling family (share `@jects/timeline-core`)
- **Scheduler** — time axis + view presets/zoom, resources, event bars, drag/resize/create, visual
  dependencies, recurrence (RRULE), export; **Scheduler Pro** adds the scheduling engine
  (constraints, calendars, travel-time/buffers, histogram + utilization).
- **Gantt** — task tree/WBS, dependency solver, constraints, baselines, critical path, progress,
  calendars, resource assignment + histogram, MS-Project (MSPDI) import/export, export.
- **Calendar** — day/week/month/year/agenda/resource/timeline views, recurrence, editor.
- **Kanban / TaskBoard** — columns + swimlanes, WIP limits, card templates, drag, editor, data provider.

### 4.6 Diagram
- **Diagram** — flowchart/org/mind/PERT modes; built-in/custom/HTML/image shapes; A*-routed connectors;
  swimlanes; auto-layout (orthogonal/radial); no-code editor; export (PDF/PNG/JSON).

### 4.7 Productivity
- **RichText** editor, **Todo** task manager, **Booking** appointment scheduling, **Chatbot** UI.

### 4.8 Wrappers
- `@jects/react`, `@jects/angular`, `@jects/vue`, `@jects/elements` — thin wrappers over the imperative API.

---

## 5. Dependency / build-order graph

```
Foundation: core (signals, Widget, Store, TreeStore, events, dom, virtualization) + tokens + theme + icons
   │
   ├── Primitives (form controls, badges, progress, tooltip, popup, message)   ← reused as Grid editors & Form controls
   │       │
   │       ├── Composites (Form, Layout, nav family, Window, Tabbar, Pagination, Tree, List, DataView, Calendar)
   │       │
   │       └── Grid ── TreeGrid ── Pivot / Spreadsheet (reuse grid render)
   │                └─ Charts (independent, render-heavy)
   │
   └── timeline-core ── Scheduler ── Scheduler Pro
                     └─ Gantt (+ scheduling engine)
                     └─ Calendar / Kanban   (share event + resource models)

Diagram, RichText, Todo, Booking, Chatbot — independent leaves.
Wrappers (React/Vue/Angular/Web Components) — over each component's stable imperative API.
```

---

## 6. Why the foundation comes first

Component work depends on the foundation first defining: the `Widget` base + lifecycle; the
`Store`/`TreeStore` data layer; the typed `EventEmitter` (`on`/`off`/`emit` + before/after cancel
semantics); the token/theme CSS-variable contract; the build/test/package conventions; and one
reference component end-to-end as the canonical pattern. The foundation is therefore built as one
coherent effort, after which the components fan out.
