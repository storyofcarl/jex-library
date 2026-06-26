---
'@jects/angular': minor
---

Add `@jects/angular`: typed Angular 17+ standalone bindings for the Jects UI suite,
mirroring `@jects/react`.

- One generic `createComponent(Ctor)` factory over the uniform `@jects/core` `Widget`
  contract (`new Ctor(host, config)` + `.on/.off/.update/.getConfig/.destroy/.el`).
- The SAME 18 per-component typed exports as the React wrapper: `JectsGrid`,
  `JectsGantt`, `JectsScheduler`, `JectsCalendar`, `JectsKanban`, `JectsTodo`,
  `JectsChart`, `JectsDiagram`, `JectsSpreadsheet`, `JectsPivot`, `JectsBooking`,
  `JectsChatbot`, `JectsButton`, `JectsForm`, `JectsWindow`, `JectsTextField`,
  `JectsSelect`, `JectsRichText` — each typed from its package Config + Events.
- Engines are constructed with `NgZone.runOutsideAngular` to avoid change-detection
  thrash; config arrives via a signal `[config]` input (diffed → `update()`, or recreate
  on `nonUpdatableKeys`); events are forwarded to a typed `(jectsEvent)` output,
  re-entering the zone only to emit; teardown via `ngOnDestroy → inst.destroy()`.
