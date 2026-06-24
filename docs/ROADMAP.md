# Jects UI — Roadmap & Orchestration Plan

How we build the v1 of the suite with a fleet of concurrent agents, while keeping a single coherent
architecture. Read `PLAN.md` first for the locked decisions and component inventory.

Time is measured in **waves** (a wave = a batch of agents running concurrently), not calendar dates,
since the work is AI-parallelized. Each wave ends with an **integration gate**: the orchestrator
(me) reviews, runs build/tests, resolves contract drift, and only then opens the next wave.

---

## Guiding Principles

1. **Contracts before components.** Nothing fans out until Wave 0 freezes the core APIs + token contract.
2. **One agent owns one package** (or one cohesive cluster). No two agents edit the same file.
3. **Every agent gets the same brief preamble:** the locked decisions (D1–D12), the `Widget`/`Store`/event
   contracts, the token list, the reference Button implementation, and the package/test conventions.
4. **Integration gate after each wave:** `pnpm build && pnpm typecheck && pnpm test` must be green;
   visual-regression snapshots reviewed; API drift reconciled before the next wave opens.
5. **Docs + tests are part of "done"** for every component, not a later phase.
6. **Orchestrator reserves context** — agents return concise structured summaries (files created, public
   API, deviations), not full file dumps.

---

## Wave 0 — Foundation (NOT parallelized; one coherent build) ★ blocking

Goal: a buildable monorepo where `Button` works, is themed, is tested, and documented — the template
every other component copies.

- **0.1 Monorepo scaffold:** pnpm workspaces, Turborepo, `tsconfig.base`, shared Vite lib preset,
  ESLint/Prettier, Changesets, CI skeleton, `exports`-map + CSS-layer conventions.
- **0.2 `@jects/core`:** signals/reactivity · `Widget` base + lifecycle · `Store` (DataCollection) ·
  `TreeStore` · typed `EventEmitter` + delegated DOM events · DOM utils (measure/focus/a11y/RTL) ·
  virtualization math (windowing + offset index) · factory/type registry.
- **0.3 `@jects/tokens`:** OKLCH 3-tier tokens, Style Dictionary build → CSS vars + SCSS + TS types.
- **0.4 `@jects/theme`:** `base.css`, `dark.css`, high-contrast, 1–2 branded presets; `@layer` structure.
- **0.5 `@jects/icons`:** icon set + delivery (SVG sprite / inline).
- **0.6 Reference component `Button`** (in `@jects/widgets`) end-to-end: imperative API, themed CSS using
  only tokens, Vitest browser test, Storybook/playground story, docs page.
- **0.7 App skeletons:** `apps/docs` shell, `apps/customizer` shell (reads the token contract live).
- **0.8 The "Component Author's Guide"** (`docs/CONTRIBUTING-COMPONENTS.md`) — the canonical brief handed
  to every Wave 1+ agent.

**Gate 0:** repo builds; Button renders, themes (light/dark), passes tests; customizer can recolor Button live.

---

## Wave 1 — Primitives & Form Controls (high parallelism — ~8 agents)

All extend `Widget`, theme via tokens, reuse Button patterns. Clustered so each agent owns a coherent set.

| Agent | Cluster |
|-------|---------|
| 1A | Text inputs: TextField, NumberField, TextArea, DisplayField, Label, Link |
| 1B | Choice: Select, ComboBox (autocomplete/multiselect), Checkbox(Group), Radio(Group), Toggle/Switch |
| 1C | Range/visual: Slider, RangeSlider, Rating, ProgressBar, Badge, Avatar, Spacer |
| 1D | Date/time: DatePicker, TimePicker, DateTimeField, Calendar (mini/date-picker) |
| 1E | ColorPicker, FilePicker/Vault (upload) |
| 1F | Overlays: Tooltip, Popup, Mask/Overlay |
| 1G | Message/Toast + alert/confirm/prompt dialogs |
| 1H | Tree, List (virtual), DataView (templated) — data-bound primitives on `Store`/`TreeStore` |

**Gate 1:** all primitives build/test/theme; added to docs + customizer preview grid.

---

## Wave 2 — Composites & Navigation (parallel — ~6 agents)

Depend on Wave 1 primitives.

| Agent | Component |
|-------|-----------|
| 2A | **Form** (builder + validation engine; composes all Wave-1 controls) |
| 2B | **Layout** (resizable/collapsible cells) + Splitter + Panel + Container |
| 2C | Nav family: Toolbar, Menu, ContextMenu, Sidebar, Ribbon (shared TreeStore core) |
| 2D | Tabbar/TabPanel + Pagination |
| 2E | **Window**/Dialog (movable/resizable/modal) |
| 2F | RichText editor (independent leaf) |

**Gate 2:** composites build/test/theme; a "kitchen-sink" demo page assembles them.

---

## Wave 3 — Data Keystone (Grid first, sub-divided; then dependents)

Grid is the largest single component — split across coordinated agents against a shared GridEngine spec
authored by the orchestrator at the start of the wave.

- **3-Grid (3 agents, tight coordination):**
  - 3A GridEngine + viewport + row/col virtualization + DOM-recycling renderer (pluggable renderer iface)
  - 3B Columns, typed cell renderers, cell/row editing, selection/range/clipboard, frozen/split regions, spans
  - 3C Features as plugins: sort/filter/filter-bar/group+summary/tree-grid mode/search/menus/export/state
- **Then (parallel, after Grid API freezes):**
  - 3D **TreeGrid** (increment on Grid) · 3E **Charts** (independent) · 3F **Pivot** · 3G **Spreadsheet** (formula engine)

**Gate 3:** Grid handles 50k rows at 60fps (Playwright perf gate); TreeGrid/Charts/Pivot/Spreadsheet green.

---

## Wave 4 — Scheduling Family (timeline-core first, then parallel)

- **4.0 `@jects/timeline-core`** (orchestrator-coordinated, blocking for this wave): time axis, view presets,
  zoom, virtualized rows, dependency-line rendering, bar drag/resize/create.
- **Then parallel:**
  - 4A **Scheduler** · 4B **Scheduler Pro** (scheduling engine: auto-schedule, constraints, calendars, histogram)
  - 4C **Gantt** + scheduling/critical-path engine (largest effort — may take 2 agents: engine vs UI)
  - 4D **Calendar (event)** multi-view · 4E **Kanban/TaskBoard**

**Gate 4:** scheduler/gantt render + interact on large datasets; gantt dependency solver + critical path verified.

---

## Wave 5 — Diagram & Extras (parallel — ~4 agents)

| Agent | Component |
|-------|-----------|
| 5A | **Diagram** (flowchart/org/mind/PERT, connector routing, auto-layout, no-code editor) |
| 5B | To Do List |
| 5C | Booking |
| 5D | Chatbot UI |

**Gate 5:** all extras build/test/theme.

---

## Wave 6 — Framework Adapters (parallel, codegen-driven)

After imperative APIs are stable. Build a typed **component manifest** (names, props, events) and codegen
the bulk of each wrapper.

| Agent | Adapter |
|-------|---------|
| 6A | `@jects/react` (memoized engine instance, props/events bridged via refs — the priority wrapper) |
| 6B | `@jects/vue` (shallowRef/markRaw for large data) |
| 6C | `@jects/angular` (engine outside NgZone; signal inputs/outputs) |
| 6D | `@jects/elements` (optional light-DOM custom elements for simple widgets) |

**Gate 6:** React + Vue + Angular smoke suites (Playwright) mount every wrapper; prop→engine + event→output verified.

---

## Cross-Cutting (continuous, runs every wave)

- **Docs site** grows per component (live playgrounds, vanilla-first + framework tabs).
- **Customizer** gains every new component's preview automatically.
- **Visual-regression** snapshots per component × theme (light/dark/contrast).
- **A11y** (axe) + **perf** gates on data components.
- **Changesets** version bumps per package.

---

## v1 "Definition of Done"

**Scope decision: FULL surface in v1** (Waves 0–6, everything in the inventory — no deferrals).
- Foundation + all primitives + composites + **Grid/TreeGrid + Pivot + Spreadsheet + Charts**
  + **Gantt + Scheduler + Scheduler Pro + Kanban + event Calendar** + **Diagram** + **RichText, ToDo, Booking, Chatbot**
  — every component building, themed (all shipped themes), tested (unit + browser + a11y), documented, in the customizer.
- React + Angular + Vue wrappers for the **full** set (React prioritized).

---

## Orchestration Mechanics (how I run the fleet)

1. I author/maintain `docs/CONTRIBUTING-COMPONENTS.md` (the shared brief) and the per-wave specs.
2. Each wave, I launch its agents **concurrently in one message**, each with: the shared brief, its package
   scope, its public-API spec, and a "return a concise summary, not file dumps" instruction.
3. Agents work in the monorepo; isolation by package boundary (worktree isolation only if two must touch
   shared files — generally avoided by design).
4. I run the integration gate, reconcile drift, update the manifest/contracts, then open the next wave.
5. I keep context lean by delegating; agents return structured summaries only.
