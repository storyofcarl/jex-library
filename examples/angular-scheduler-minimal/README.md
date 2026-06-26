# angular-scheduler-minimal

A minimal Angular app that uses **only the scheduler** from Jects UI, to demonstrate the
per-component subpath exports of `@jects/angular`.

## What it shows

This app depends on exactly two Jects packages:

```jsonc
"dependencies": {
  "@jects/angular": "*",
  "@jects/scheduler": "*"
}
```

and imports the wrapper from the **scheduler subpath**, not the root entry:

```ts
import { JectsScheduler } from '@jects/angular/scheduler'; // -> @jects/angular/dist/scheduler.js
import type { SchedulerConfig } from '@jects/scheduler';
import '@jects/scheduler/style.css';
```

`@jects/angular/scheduler` resolves (via the package `exports` map) to `dist/scheduler.js`, whose
only `@jects/*` import is `@jects/scheduler`:

```js
import { createComponent } from './factory.js';
import { Scheduler } from '@jects/scheduler';
```

So a bundler building this app never has to resolve any **sibling** engine
(`@jects/grid`, `@jects/gantt`, `@jects/calendar`, `@jects/widgets`, …). Those
packages are not installed here and are never pulled in.

## Contrast: the root entry

```ts
import { JectsScheduler } from '@jects/angular'; // -> dist/index.js, re-exports EVERYTHING
```

The root `@jects/angular` entry re-exports every wrapper as a back-compat convenience,
which makes the bundler resolve all `@jects/*` engines. Use the per-component subpath
(`@jects/angular/scheduler`) when you want only one component.

## Isolation proof

From the repo root, after `pnpm --filter @jects/angular build`:

```sh
grep "@jects/" packages/angular/dist/scheduler.js
# import { Scheduler } from '@jects/scheduler';   <- only the scheduler engine, no siblings
```
