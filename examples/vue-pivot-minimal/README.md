# vue-pivot-minimal

A minimal Vue 3 app that uses a **single** Jects component in isolation.

It depends on exactly two Jects packages:

- `@jects/vue` — but imported only through its per-component subpath `@jects/vue/pivot`
- `@jects/pivot` — the pivot engine

It does **not** depend on (or import) any sibling engine such as `@jects/gantt`,
`@jects/scheduler`, `@jects/calendar`, etc. Because `@jects/vue/pivot` resolves to
`dist/pivot.js` — which imports only `@jects/pivot` plus the shared `factory.js`
chunk — a bundler building this app never resolves any other engine.

```ts
import { JectsPivot } from '@jects/vue/pivot';
import { PivotTable } from '@jects/pivot';
import '@jects/pivot/style.css';
```

This is the payoff of the per-component subpath exports: installing/using one
component pulls in only that component's engine.

> Standalone example: it is intentionally **not** part of the pnpm workspace, so it
> models how a downstream consumer would install just the packages it needs.
