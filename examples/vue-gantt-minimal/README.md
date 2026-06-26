# vue-gantt-minimal

A minimal Vue 3 app that uses a **single** Jects component in isolation.

It depends on exactly two Jects packages:

- `@jects/vue` — but imported only through its per-component subpath `@jects/vue/gantt`
- `@jects/gantt` — the gantt engine (and its `@jects/gantt/style.css` stylesheet)

It does **not** depend on (or import) any sibling engine such as `@jects/grid`,
`@jects/scheduler`, `@jects/calendar`, etc. Because `@jects/vue/gantt` resolves to
`dist/gantt.js` — which imports only `@jects/gantt` plus the shared `factory.js`
chunk — a bundler building this app never resolves any other engine.

```ts
import { JectsGantt } from '@jects/vue/gantt';
import { Gantt } from '@jects/gantt';
import '@jects/gantt/style.css';
```

This is the payoff of the per-component subpath exports: installing/using one
component pulls in only that component's engine.

> Standalone example: it is intentionally **not** part of the pnpm workspace, so it
> models how a downstream consumer would install just the packages it needs.
