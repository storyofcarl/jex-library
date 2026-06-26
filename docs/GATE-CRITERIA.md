# Jects UI — Gate Criteria (machine-checkable success conditions)

These are the **conditions that must pass** for any wave to be considered done. Workflows enforce them
automatically (build stage → adversarial verify stage → integration gate → bounded remediation loop).
No wave advances until every condition below is GREEN.

## Per-component Definition of Done (each component must satisfy ALL)
- **C1 — Class contract:** `<component>.ts` exists, default-exports/exports a class extending `Widget`
  from `@jects/core`, and registers itself with the factory (`register('<type>', <Class>)`).
- **C2 — Typed surface:** a typed `Config` interface and a typed `Events` map; public methods typed.
- **C3 — Token-pure CSS:** `<component>.css` exists, all rules inside `@layer jects.components`, and uses
  **only** `--jects-*` tokens — **zero** hardcoded color literals. (Scan: no `#[0-9a-fA-F]{3,8}`, no
  `rgb(`/`rgba(`/`hsl(`/`hsla(`, and no raw `oklch(` except `oklch(var(--jects-...))`.)
- **C4 — Tested:** `<component>.test.ts` (jsdom) exists and passes; covers render + at least one
  interaction + at least one emitted event.
- **C5 — Accessible:** interactive components expose correct role/aria + keyboard support.
- **C6 — Story:** `<component>.stories.ts` exists.
- **C7 — Naming:** classes `.jects-<component>` / `__<part>` / `--<modifier>` (BEM-ish), prefix `jects-`.

## Per-wave Integration Gate (ALL must exit 0 / be empty)
- **G1 — Install:** `pnpm install` succeeds (new workspace packages/links resolve).
- **G2 — Build:** `pnpm build` exits 0; every package emits `dist/` (ESM + UMD + `.d.ts` + css).
- **G3 — Typecheck:** `pnpm typecheck` exits 0 (strict).
- **G4 — Test:** `pnpm test` exits 0; all suites pass.
- **G5 — Lint:** `pnpm lint` exits 0.
- **G6 — Token purity:** repo-wide scan of new `src/**/*.css` returns **no** hardcoded color literals
  (per C3). Command must produce empty output.
- **G7 — Completeness:** every component scoped for the wave is present, exported from its package
  barrel, and registered with the factory. The expected-component manifest matches the actual exports.
- **G8 — No orphan files / clean tree:** no leftover partial/`_dbg` files; `git status` reviewed.

## Quality Gate (runs after the Integration Gate is green — "Essential" tier)
A dedicated Quality phase; each is a hard gate (failures feed the remediation loop).
- **Q1 — Bug-hunt code review:** an adversarial reviewer agent reads each component's source and hunts
  *logic* defects (not conventions): undisposed `effect()`/signals, leaked DOM/event listeners not
  removed on `destroy()`, missing `super.destroy()`, stale closures, off-by-one in virtualization/index
  math, unhandled async in lazy loaders, focus-trap/escape leaks, re-entrancy/race on rapid `update()`,
  event emitted before/after state is consistent. Returns structured findings {file, severity, issue};
  **High/Critical findings must be fixed** before pass.
- **Q2 — Accessibility (axe-core):** each interactive component is mounted in the real-browser test
  context and asserted with **axe-core**; **zero serious/critical violations** allowed. Roles, names,
  keyboard operability, focus order verified.
- **Q3 — API consistency:** a checker verifies cross-component convention adherence — every component
  extends `Widget` + registers with the factory; config uses the shared vocabulary (`value`, `disabled`,
  `size`, `variant`, `readOnly`, `invalid`); events use consistent names (`change`/`input`/`focus`/
  `blur`); `destroy()` is idempotent and disposes everything it created; public API is fully typed.
  Divergences are findings to reconcile.
- *(Deferred to a later tier: visual-regression per theme, coverage thresholds.)*

## Remediation
If the gate fails, the workflow spawns targeted fix agents for the failing items and re-runs the gate,
up to **2** automatic attempts. If still failing, the workflow returns the failing conditions + logs for
orchestrator decision (no silent pass).
