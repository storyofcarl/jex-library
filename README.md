# Jects UI

> **A framework-agnostic enterprise planning & data UI suite.** Grids, scheduling, Gantt,
> dashboards, diagrams, spreadsheets, forms, and productivity workflows — built on one engine,
> one design system, and one theming model, with clean TypeScript APIs, accessible defaults,
> and no framework lock-in.

A unified suite of enterprise-grade components — data grids, Gantt, scheduler, calendar,
kanban, pivot, spreadsheet, charts, diagram, forms, and productivity modules — that share a
single zero-dependency core, a tokenized design system, and a stable imperative TypeScript API.
Use any module standalone or compose them into integrated planning and data workflows.

**Branding:** Product "Jects UI" · npm scope `@jects` · CSS class prefix `jects-` ·
CSS token prefix `--jects-` · custom elements `<jects-*>`.

## Architecture

- **One engine, many frameworks.** A zero-dependency vanilla TS core (`@jects/core`) is the
  source of truth. React / Angular / Vue wrappers are thin adapters.
- **Light-DOM, class-based engine.** No Shadow DOM — edit one stylesheet to restyle everything.
- **Imperative public API is the stable contract:** `new Button(el, opts); btn.on('click', fn); btn.destroy();`
- **Reactivity via a tiny signals lib** (`signal` / `computed` / `effect` / `batch`).
- **Theming = CSS custom properties only**, OKLCH channel-triplet tokens, three tiers, single `--jects-radius`.

Per-module developer docs live in [`docs/modules/`](docs/modules/README.md). See also the
[capability & readiness matrix](docs/MATRIX.md) (generated — `pnpm matrix`),
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the architectural decisions (D1–D12),
[`docs/STATUS.md`](docs/STATUS.md) for per-module maturity, [`docs/ROADMAP.md`](docs/ROADMAP.md)
for direction, [`docs/SECURITY.md`](docs/SECURITY.md) for the HTML/injection contract, and
[`docs/CONTRIBUTING-COMPONENTS.md`](docs/CONTRIBUTING-COMPONENTS.md) for the component-author brief.

## Monorepo layout

```
packages/
  # foundation
  core          @jects/core          — signals, Widget, Store/TreeStore, EventEmitter, DOM utils, virtualization, factory
  tokens        @jects/tokens        — OKLCH 3-tier design tokens → CSS vars + SCSS maps + TS types
  theme         @jects/theme         — generated themes (light/dark/contrast/branded) + applyTheme/setTheme
  icons         @jects/icons         — tree-shakeable SVG icon set + sprite
  timeline-core @jects/timeline-core — shared timeline engine (axis, viewport, virtualization) for Gantt/Scheduler
  # components
  widgets       @jects/widgets       — fields, forms, layout, nav, overlays, windows, rich text, tabs, data-views
  grid          @jects/grid          — virtualized data grid (sort/filter/group/edit/tree/master-detail/export)
  pivot         @jects/pivot         — pivot table (dimensions/measures, aggregations, XLSX)
  spreadsheet   @jects/spreadsheet   — formula workbook (validation, conditional formatting, XLSX)
  gantt         @jects/gantt         — Gantt (dependencies, baselines, critical path, resource histogram, exports)
  scheduler     @jects/scheduler     — resource scheduler (time ranges, recurrence, travel-time/buffers, export)
  calendar      @jects/calendar      — full calendar (day…timeline views, RRULE, timezones, ICS/Excel/print)
  booking       @jects/booking       — appointment scheduling (services, availability, capacity, timezones, ICS)
  kanban        @jects/kanban        — task board (swimlanes, WIP, rich cards, DnD, export)
  todo          @jects/todo          — enterprise task manager (list/board/calendar/timeline/table, workflow)
  charts        @jects/charts        — charting (line/bar/area/pie/scatter/…, zoom/pan, streaming, export)
  diagram       @jects/diagram       — diagramming (shapes, A*-routing, auto-layout, swimlanes, export)
  chatbot       @jects/chatbot       — LLM-agnostic chat UI (streaming, markdown, provider-agnostic onSend)
tooling/
  vite-config   @jects/vite-config   — shared Vite library preset
apps/
  customizer    @jects/customizer    — live theme builder, exports theme.css
  docs          @jects/docs-app      — docs shell
```

## Develop

```bash
pnpm install
pnpm build        # turbo run build (topological, ^build)
pnpm test         # vitest across packages
pnpm typecheck
pnpm customizer   # run the theme customizer app
pnpm docs         # run the docs shell
```

## Tech stack

pnpm workspaces · Turborepo · Vite (library mode) · TypeScript (strict) · Vitest (+ browser mode) ·
Changesets. Node ≥ 20.17, pnpm 10.24.

## License

Commercial. © Composition Media. All rights reserved.
