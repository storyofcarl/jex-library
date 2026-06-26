# angular-gantt-minimal

A minimal Angular app that uses **only the gantt** from Jects UI, to demonstrate the
per-component subpath exports of `@jects/angular`.

## What it shows

This app depends on exactly two Jects packages:

```jsonc
"dependencies": {
  "@jects/angular": "*",
  "@jects/gantt": "*"
}
```

and imports the wrapper from the **gantt subpath**, not the root entry:

```ts
import { JectsGantt } from '@jects/angular/gantt'; // -> @jects/angular/dist/gantt.js
import type { GanttOptions } from '@jects/gantt';
import '@jects/gantt/style.css';
```

`@jects/angular/gantt` resolves (via the package `exports` map) to `dist/gantt.js`, whose
only `@jects/*` import is `@jects/gantt`:

```js
import { createComponent } from './factory.js';
import { Gantt } from '@jects/gantt';
```

So a bundler building this app never has to resolve any **sibling** engine
(`@jects/grid`, `@jects/scheduler`, `@jects/calendar`, `@jects/widgets`, …). Those
packages are not installed here and are never pulled in.

## Contrast: the root entry

```ts
import { JectsGantt } from '@jects/angular'; // -> dist/index.js, re-exports EVERYTHING
```

The root `@jects/angular` entry re-exports every wrapper as a back-compat convenience,
which makes the bundler resolve all `@jects/*` engines. Use the per-component subpath
(`@jects/angular/gantt`) when you want only one component.

## Isolation proof

From the repo root, after `pnpm --filter @jects/angular build`:

```sh
grep "@jects/" packages/angular/dist/gantt.js
# import { Gantt } from '@jects/gantt';   <- only the gantt engine, no siblings
```
