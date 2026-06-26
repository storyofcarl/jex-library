# vue-scheduler-minimal

A minimal Vue 3 app that uses a **single** Jects component in isolation.

It depends on exactly two Jects packages:

- `@jects/vue` — but imported only through its per-component subpath `@jects/vue/scheduler`
- `@jects/scheduler` — the scheduler engine (its stylesheet imported via `@jects/scheduler/style.css`)

It does **not** depend on (or import) any sibling engine such as `@jects/gantt`,
`@jects/grid`, `@jects/calendar`, etc. Because `@jects/vue/scheduler` resolves to
`dist/scheduler.js` — which imports only `@jects/scheduler` plus the shared `factory.js`
chunk — a bundler building this app never resolves any other engine.

```ts
import { JectsScheduler } from '@jects/vue/scheduler';
import { Scheduler } from '@jects/scheduler';
import '@jects/scheduler/style.css';
```

This is the payoff of the per-component subpath exports: installing/using one
component pulls in only that component's engine.

> Standalone example: it is intentionally **not** part of the pnpm workspace, so it
> models how a downstream consumer would install just the packages it needs.
