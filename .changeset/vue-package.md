---
"@jects/vue": minor
---

Add `@jects/vue`, a thin typed Vue 3 wrapper over the framework-agnostic `@jects/*`
engines. One generic `createComponent(Ctor)` factory over the uniform Widget
contract, plus 18 per-component typed exports (JectsGrid, JectsGantt, …) with config
props in, `on<Event>` handlers out, and the live engine instance exposed via
`expose()` for imperative use.
