# Jects UI — Roadmap

A forward-looking view of where the suite is going. For exactly what ships today and at what maturity,
see [`STATUS.md`](./STATUS.md); for the generated capability matrix see [`MATRIX.md`](./MATRIX.md).

## Now (0.8.x)

The suite ships eighteen modules on one zero-dependency core, with React, Vue, Angular, and
Web-Component wrappers:

- **Data & grids** — Grid, Pivot, Spreadsheet
- **Scheduling & timelines** — Gantt, Scheduler, Calendar, Booking
- **Boards, tasks & visualization** — Kanban, Todo, Charts, Diagram
- **Widgets & chat** — Widgets (forms, overlays, rich text, …), Chatbot
- **Foundation** — Core, Tokens, Theme, Icons, Timeline-core

Also shipping: a token-driven theming system with a live customizer; a documentation site with
Demo / Docs / Code tabs; live performance benchmarks, a server-side-data demo, and a comparison page;
per-component subpath exports for the wrappers and the largest engines; an HTML-sanitization layer with
per-module XSS tests; and a generated, rot-proof capability matrix.

## Next

- **Packaging** — extend real subpath exports to the remaining engines (Diagram, Pivot, Charts,
  Calendar, Kanban, Booking, Todo); lean wrapper roots plus an `/all` convenience entry; more
  single-component example apps across React, Vue, Angular, and Web Components.
- **Security** — a branded `SafeHtml` type so user-provided strings cannot reach `innerHTML` by
  accident, enforced by a CI guard.
- **Proof** — a richer performance dashboard (p50/p95/p99 frame time, memory, interaction latency,
  per-module budgets) and a public accessibility status page; visual-regression coverage in CI.
- **Product experience** — a product landing page, flagship integrated application demos (planning
  control center, operations dispatch, analytics workspace, workflow delivery), and per-module visual
  polish toward an application-grade look.
- **Trust** — license, support, browser-support, release-policy, and production-checklist pages.

## Later

- **Per-module depth** — server-side grouping and lazy tree loading in Grid; the Scheduler Pro tail
  (split/nested events, external unplanned-work grid); a spreadsheet formula-compatibility reference;
  large-graph layout and SVG export in Diagram; worker-backed aggregation in Pivot.
- **1.0** — API stabilization across all modules, a published changelog and release cadence, and
  documented deprecation and support policies.
