# angular-grid-minimal

A minimal Angular app that uses **only the grid** from Jects UI, to demonstrate the
per-component subpath exports of `@jects/angular`.

## What it shows

This app depends on exactly two Jects packages:

```jsonc
"dependencies": {
  "@jects/angular": "*",
  "@jects/grid": "*"
}
```

and imports the wrapper from the **grid subpath**, not the root entry:

```ts
import { JectsGrid } from '@jects/angular/grid'; // -> @jects/angular/dist/grid.js
import type { GridOptions } from '@jects/grid';
```

`@jects/angular/grid` resolves (via the package `exports` map) to `dist/grid.js`, whose
only `@jects/*` import is `@jects/grid`:

```js
import { createComponent } from './factory.js';
import { Grid } from '@jects/grid';
```

So a bundler building this app never has to resolve any **sibling** engine
(`@jects/gantt`, `@jects/scheduler`, `@jects/calendar`, `@jects/widgets`, …). Those
packages are not installed here and are never pulled in.

## Contrast: the root entry

```ts
import { JectsGrid } from '@jects/angular'; // -> dist/index.js, re-exports EVERYTHING
```

The root `@jects/angular` entry re-exports every wrapper as a back-compat convenience,
which makes the bundler resolve all `@jects/*` engines. Use the per-component subpath
(`@jects/angular/grid`) when you want only one component.

## Isolation proof

From the repo root, after `pnpm --filter @jects/angular build`:

```sh
grep "@jects/" packages/angular/dist/grid.js
# import { Grid } from '@jects/grid';   <- only the grid engine, no siblings
```
