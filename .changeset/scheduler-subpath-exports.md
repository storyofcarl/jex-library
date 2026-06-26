---
'@jects/scheduler': minor
---

Add real additive subpath exports to `@jects/scheduler`. The package now ships
finer-grained entry points alongside the unchanged, tree-shakeable main entry
(`.`), each compiled as its own self-contained build chunk that imports only its
own area (verified: none pull in the main `scheduler.js` bundle or the `view/`
widget):

- `@jects/scheduler/recurrence` — RRULE parsing + occurrence expansion (zero
  local deps; a single standalone chunk).
- `@jects/scheduler/model` — the pure, framework-free model layer (event lane
  layout, recurrence, dependency-link projection, time-range projection,
  infinite-scroll planning, assignment resolution); no view code.
- `@jects/scheduler/export` — PDF / PNG / Excel / ICS export surface.
- `@jects/scheduler/pro` — the PRO tier (scheduling engine, histogram +
  utilization views, travel-time, buffers).

The main entry `.` is unchanged: same `dist/scheduler.js` (ESM) + `dist/scheduler.umd.cjs`
(UMD) outputs, same symbols. The build is now ES-only multi-entry (with a UMD
second pass for the `.` `require` field); shared model code is hoisted into a
single `_shared/` chunk referenced by both the main entry and the subpaths, so
nothing is duplicated.
