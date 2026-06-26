---
'@jects/calendar': minor
---

Add `@jects/calendar`: an event calendar built on `@jects/core` (Widget + a recurrence-aware
`EventStore` extending `Store`) that reuses `@jects/widgets` `Window` for the modal event editor.

- Switchable **Day / Week / Month / Year / Agenda / Resource** views.
- Drag **create / move / resize** of timed events on the Day/Week/Resource time grids (snap-to-grid).
- **Recurring** events (daily / weekly with `byWeekday` / monthly / yearly, with `interval`,
  `count`, `until`, and `exDates`), expanded by a pure recurrence engine.
- **Multi-day** and **all-day** events (all-day rail in time views).
- **Mini-calendar** date navigator, today + selection, and **category + resource** filtering.
- Token-pure CSS in `@layer jects.components`; grid roles + full keyboard navigation; axe-clean
  across all six views. Registered with the factory as type `'calendar'`.
