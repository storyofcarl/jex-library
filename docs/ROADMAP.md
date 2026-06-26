# Jects UI — Commercial Readiness Roadmap

> The v1 **feature build** (original Waves 0–6, see `PLAN.md` for locked architecture) is essentially
> complete: all ~18 packages are implemented, themed, tested, and deployed to the live gallery
> (<https://jexlibrary.vercel.app>). This roadmap is the next chapter — turning a credible codebase into
> a **credible commercial product**. It supersedes the old build plan as the active roadmap.

## Positioning (the north star)

Jects UI is **a framework-agnostic enterprise planning & data UI suite** — grids, scheduling, Gantt,
dashboards, diagrams, spreadsheets, forms, and productivity workflows, built on one engine, one design
system, one theming model, with clean TypeScript APIs, accessible defaults, and no framework lock-in.

We **do not** frame the product as derivative of any competitor. Competitor names appear only inside
controlled feature-comparison matrices.

## The core problem (from the audit)

The **code is ahead of the public product.** The implementation depth is real; the gap is
**positioning, proof, documentation, demos at scale, security formalization, and integration storytelling.**
Most per-module "feature upgrades" the audit asked for already exist in source — so this roadmap is
weighted toward **proving and presenting**, not re-building.

## How we execute

- **Orchestrator + workflows.** I (the orchestrator) keep context lean and run the fleet. **Use the
  Workflow tool wherever the work fans out** (per-package / per-surface / per-demo); use single subagents
  for one-off cohesive tasks. I personally handle only **auditing, setup, and menial tasks**.
- **Raw-verify everything.** Workflow/agent self-reports are not trusted — every output is independently
  gated (tsc 0 · capped tests · build · live Playwright check) before it's "done." (Agents have twice
  reported "done" on broken/incomplete work this program.)
- **Deploy per cohesive batch** to the live gallery and re-verify live.
- **Wrappers are LAST.** No `@jects/react|vue|angular|elements` work until the **core is finished**
  (Phases 1–2 complete and gated). Building wrappers over a still-moving API wastes effort.

**Legend** — Owner: `[WF]` workflow fan-out · `[AGENT]` single subagent · `[ORCH]` orchestrator does it.
Status: ✅ done · 🟡 partial · ⬜ todo.

---

## Phase 1 — Trust, Positioning & Hygiene  *(fast, prerequisite-free, no feature work)*

| # | Task | Owner | Status | Acceptance |
|---|------|-------|--------|-----------|
| 1.1 | **Enterprise-suite positioning** — README hero + identity statement; all package `description` fields (incl. root); gallery/landing copy; CI gate forbidding derivative framing. | `[ORCH]` | ✅ | No derivative framing in repo or deploy; identity consistent; CI grep gate enforces it. |
| 1.2 | **Generated capability matrix** — a script that scans every package for features × {demo, unit test, browser test, a11y test, doc} and emits `docs/MATRIX.md`. Replaces the rot-prone `PARITY.md`. | `[ORCH]` author script · `[AGENT]` fill gaps | ✅ | `pnpm matrix` regenerates; no stale "missing" rows for shipped features. |
| 1.3 | **Correct `.mpp` wording** — code comments + gantt docs state MSPDI-XML-in-OLE2 round-trip honestly (not native binary parsing). | `[AGENT]` | ✅ | No overstated `.mpp` claims anywhere. |
| 1.4 | **Deploy/site hygiene** — strip dev comments from `deploy/index.html`; add favicon + app icons; self-host or system-stack fonts; **lazy-load gallery modules by route** (stop importing all 14 packages upfront). | `[AGENT]` | ✅ | No dev comments/CDN-font dependency; favicon present; route loads only its module. |
| 1.5 | **Per-module docs** (Overview/Install/Integration/Features/Quickstart/Config/Methods/Events/Examples/Theming). | `[WF]` | ✅ | 18 docs + index under `docs/modules/` (done this session). |
| 1.6 | **Security spec** — author the `text` (always escaped) vs `html`/`TrustedHtml` (explicit, sanitized) API contract + the surface inventory to harden. | `[ORCH]` | ✅ | Spec doc that Phase 2.5 implements against. |

**Gate 1:** positioning clean across repo + deploy; matrix generates and is accurate; `.mpp` honest;
deploy hygiene shipped; security spec written.

---

## Phase 2 — Prove & Polish the CORE  *("finishing the core")*

Mostly **workflows** (fan-out per module / surface / scenario).

| # | Task | Owner | Status | Acceptance |
|---|------|-------|--------|-----------|
| 2.1 | **Docs/product site shell** — replace the gallery harness with a real docs site: global search, grouped sidebar, and per-component tabs (Overview · Live demo · Code · API · Events · Theming · A11y · Perf · Recipes). Vanilla-first; framework code tabs stubbed until wrappers exist. | `[AGENT]` shell · `[WF]` per-component pages from the 18 docs | ✅ | Every component has a tabbed page with a live demo + API table + recipe; search works. |

> **2.1 build approach (decided):** (a) FIRST modularize the gallery — extract each section's `build()` into its own `preview/sections/<id>.js` lazily imported by the router (keeps current behavior, unlocks parallel per-component work without `gallery.js` collisions). Blocked while the large-data-demos agent owns `gallery.js`; run right after it lands. (b) Then `[AGENT]` builds the tabbed shell (sidebar + search + the per-component page template wiring the existing demo into the **Demo** tab and the `docs/modules/*.md` into **Overview/API/Events/Theming**). (c) Then `[WF]` fans out per component to fill **Code/Recipes/Perf** tabs (each its own section file → no collision).
| 2.2 | **Large-data demos** — 100k-row grid · 1k-task/2k-dep gantt · 100-resource/2k-event scheduler · 100k-record pivot · 10k-cell spreadsheet · 200-node diagram · 500-card kanban. Lazy "load big dataset" mode. | `[WF]` one agent per module | ✅ | Each renders smoothly (perf smoke); visible from the component page. |
| 2.3 | **Integrated cross-module demos** — Gantt↔Scheduler↔Grid↔Calendar; Pivot→Chart dashboard; Kanban→Gantt; Spreadsheet budget→Gantt cost; Calendar→Scheduler. The "one coherent suite" differentiator. | `[WF]` one agent per scenario | ✅ | Each integrated demo is live and shows two+ modules sharing a model. |
| 2.4 | **Visual/density polish** of heavy modules — diagram contrast, scheduler/gantt enterprise look, compact density mode. | `[WF]` per module | 🟡 | Headless visual review; "looks like a real app," not a harness. |
X25X — implement the 1.6 contract: sanitizer + consistent `text`/`html` APIs + a dedicated XSS test suite across grid renderers, richtext paste/import, tooltips/templates, diagram labels, kanban/todo comments, spreadsheet cells. | `[WF]` per surface | 🟡 | XSS suite green; no unsanitized user-HTML path. (Spot-verified XSS-safe earlier; needs formal suite.) |
| 2.6 | **Real subpath exports** — per package, split feature/renderer/editor entry points with build config so imports tree-shake. | `[WF]` per package | 🟡 | **Honest interim done:** removed grid's misleading `./features` entry (it re-pointed to the main bundle; unused). The ESM main entry is tree-shakeable by modern bundlers. **Full multi-entry splitting deferred to a post-v1 enhancement** — high build-system effort/risk, low visibility vs the product-facing Gate-2 items; tracked, not blocking "core finished." |
| 2.7 | **Generated bundle-size + a11y matrices** (published on the site). | `[AGENT]`/script | 🟡 | Auto-generated tables; sizes + axe status per package. |
X28X as a first-class docs feature (exists as `apps/customizer` skeleton) — live token editing → `theme.css` export. | `[AGENT]` | 🟡 | Customizer recolors every component live and exports valid CSS. |
| 2.9 | **Correctness fixtures** — recurrence/timezone tests, MSPDI round-trip gallery, XLSX import/export compat fixtures. | `[WF]` per area | ✅ | Fixture suites green and shown as proof. |
| 2.10 | **CI + public badges** — `install --frozen-lockfile → typecheck → lint → test → build → test:browser → test:a11y`. | `[ORCH]`/`[AGENT]` | ✅ | Green pipeline + badges in README. |
| 2.11 | **Real-time provider demo** (kanban/scheduler over a mock WS) to beat static demos. | `[AGENT]` | ✅ | Live updates visible across two sessions/tabs. |

**Gate 2 ("core finished"):** positioning + matrix + CI green; docs site live with every component
(tabs + live demo + API); large-data and integrated demos live; security suite green; exports
tree-shakeable; customizer first-class. **Only when Gate 2 passes do we open Phase 3.**

---

## Phase 3 — Framework Wrappers  *(blocked on Gate 2 — "core finished")*

| # | Task | Owner | Status | Acceptance |
|---|------|-------|--------|-----------|
| 3.1 | **Component manifest** — typed names/props/events/methods for every component, from the now-stable APIs (drives codegen). | `[ORCH]`/`[AGENT]` | ✅ | Manifest covers the full surface. |
| 3.2 | **`@jects/react`** (priority) — memoized engine instance, props/events bridged via refs. | `[WF]` codegen + finish | ✅ | Wraps every component; smoke suite green. |
| 3.3 | **`@jects/vue`** (shallowRef/markRaw), **`@jects/angular`** (engine outside NgZone; signal I/O), **`@jects/elements`** (light-DOM custom elements for simple widgets). | `[WF]` per framework | ✅ | Each wraps the full set; smoke suite green. |
| 3.4 | **Docs site framework code tabs** — fill the React/Vue/Angular tabs stubbed in 2.1. | `[WF]` per component | ✅ | Every component page shows working code in all frameworks. |

**Gate 3 (v1 commercial-ready):** Playwright smoke suites mount every wrapper in React/Vue/Angular;
prop→engine + event→output verified; honest comparison pages published.

---

## Sequencing summary

1. **Phase 1** (now) — trust/positioning/hygiene. Quick wins; unblocks everything; safe.
2. **Phase 2** — prove & polish the core (docs site, scale demos, integrated demos, security, exports, CI). This is "finishing the core."
3. **Phase 3** — wrappers, **only after Gate 2**.

Cross-cutting every phase: deploy per batch + live re-verify; raw-verify all agent output; keep `docs/MATRIX.md` regenerated so docs never go stale.

---

## Round-2 hardening (post second evaluation, 2026-06-26)

Second-evaluation verdict: "credible enterprise-suite candidate, not yet superior." Remaining
blockers are packaging reliability, doc truth, security consistency, proof quality, polish.

### E1 — Trust & truth (fast)
| # | Task | Owner | Status |
|---|------|-------|--------|
| E1.1 | Remove ALL derivative language (root `package.json`, `PLAN.md`, `modules/README.md`) + CI grep gate | `[ORCH]` | ✅ |
| E1.2 | Delete stale `docs/PARITY.md`; make ROADMAP status-accurate; MATRIX is the single source of truth | `[ORCH]` | ✅ |
| E1.3 | Fix `EVALUATION.md` `</content>` artifact; exclude internal `REVISION-NOTES.md` from the shared zip | `[ORCH]` | ⬜ |
| E1.4 | `gen-matrix` falls back to `deploy/packages/*/dist` when source `dist` absent (never silently blanks) | `[ORCH]` | ⬜ |

### E2 — Packaging & security
| # | Task | Owner | Status |
|---|------|-------|--------|
| E2.1 | Per-component wrapper subpaths (`@jects/react/grid`, `@jects/vue/gantt`, …) so installing one component doesn't pull all + `examples/*-minimal` apps | `[WF]` per wrapper | ⬜ |
| E2.2 | Real subpath exports for grid/gantt/scheduler/spreadsheet/widgets (features/renderers/editors) | `[WF]` per package | ⬜ |
| E2.3 | Enforce `text` vs `TrustedHtml` across remaining raw-`innerHTML` paths (data-view, tab-panel, layout, splitter, panel) + XSS tests | `[WF]` | ⬜ |

### E3 — Proof & premium polish
| # | Task | Owner | Status |
|---|------|-------|--------|
| E3.1 | Route-level CSS lazy-load in deploy | `[AGENT]` | ⬜ |
| E3.2 | Split monolithic gallery into `preview/routes/*` + `docs/` + `workflows/` | `[AGENT]` | ⬜ |
| E3.3 | Measured performance-proof panels + repeatable bench scripts (grid 100k, gantt 1k/10k, pivot 100k, …) | `[WF]` | ⬜ |
| E3.4 | Server-side data demos (remote paging/sort/filter/group, lazy tree, remote scheduler events, gantt save/load) | `[WF]` | ⬜ |
| E3.5 | Flagship hero demos + honest comparison pages (vs Bryntum / vs DHTMLX) + adoption-funnel landing | `[WF]` | ⬜ |
