---
'@jects/scheduler': minor
---

Add `@jects/scheduler`: a framework-free resource scheduler built entirely on
`@jects/timeline-core` (time axis / zoom / bars / drag), reusing `@jects/grid` row
geometry for the locked resource columns, `@jects/core` `Store`/virtualization for the
data layer, and `@jects/widgets` (`Window`, `ContextMenu`) for editors.

- `ResourceStore` / `EventStore` / `AssignmentStore` over `@jects/core` `Store`.
- **Horizontal + vertical** orientations; **pack / stack / overlap** event layout.
- Drag **move / resize / drag-create** of events (snap-to-grid, vetoable), an event
  **edit popup** (reuses `Window`) + **context menu**, and a hover **tooltip**.
- **Dependencies** drawn as orthogonal connectors for all four precedence types
  (FS / SS / FF / SF) via the shared `OrthogonalDependencyRouter`.
- **Recurring events** (RRULE subset: `FREQ`/`INTERVAL`/`COUNT`/`UNTIL`/`BYDAY`),
  expanded per visible window.
- **View presets + zoom** along the timeline-core preset ladder; non-working-time
  shading and a "now" marker.
- **Scheduler PRO** (`@jects/scheduler` → `./pro`): a constraint **scheduling engine**
  (auto forward/backward scheduling on dependency change, FS/SS/FF/SF + lag, six
  constraint types, multi-level working-time calendars) plus **Resource Histogram**
  and **Resource Utilization** views.
- Token-pure CSS in `@layer jects.components`; `role=application` + keyboard support;
  axe-clean (zero serious/critical). Registered with the factory as type `'scheduler'`
  (PRO views as `'resourcehistogram'` / `'resourceutilization'`).
