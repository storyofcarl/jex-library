# @jects/angular

Typed **Angular (17+)** standalone bindings for the [Jects UI](../../README.md) suite.

Every Jects component is a framework-agnostic engine that follows one uniform
imperative contract (`new Ctor(host, config)` extending the `@jects/core` `Widget`:
`.on()` / `.off()` / `.update()` / `.getConfig()` / `.destroy()` / `.el`). This
package wraps that contract in a single generic factory and ships a typed standalone
component per engine — config in via a signal `[config]` input, events out via a typed
`(jectsEvent)` output, and the live engine instance via the `instance` getter.

## Install

```bash
pnpm add @jects/angular @angular/core
# plus the engines you use:
pnpm add @jects/grid @jects/gantt @jects/widgets
```

`@angular/core` and every `@jects/*` engine are **peer dependencies** — the host app
owns those versions. Import each engine's stylesheet once (e.g.
`import '@jects/grid/style.css'`).

## How wrappers behave

- **Config in via `[config]`.** A signal `input<Partial<Config>>()`. On change it is
  shallow-diffed and pushed through `inst.update(patch)` — there is **no recreate on
  every change**. A recreate happens only when a key you mark `nonUpdatableKeys`
  changes.
- **Outside the Angular zone.** The engine is constructed with
  `NgZone.runOutsideAngular(...)`, so the engine's internal DOM churn never thrashes
  Angular change detection. `update()`/recreate also run outside the zone.
- **Events out via `(jectsEvent)`.** List the engine event names you want on the
  `[events]` input; each is forwarded to the single typed `(jectsEvent)` output as a
  discriminated `{ type, payload }` union. The zone is re-entered (`NgZone.run`) only to
  emit. The bound set is reconciled when `[events]` changes.
- **`instance` is the engine.** The `instance` getter resolves to the live engine, so
  you can call any imperative method (reach it via `@ViewChild`).
- **Cleanup.** `inst.destroy()` runs in `ngOnDestroy`.

## Grid example

```ts
import { Component, ViewChild } from '@angular/core';
import { JectsGrid, type GridEvents } from '@jects/angular';
import type { Grid } from '@jects/grid';
import '@jects/grid/style.css';

@Component({
  selector: 'app-people',
  standalone: true,
  imports: [JectsGrid],
  template: `
    <jects-grid
      [config]="{
        data: [
          { id: 1, name: 'Ada Lovelace' },
          { id: 2, name: 'Grace Hopper' }
        ],
        columns: [{ field: 'name', header: 'Name', flex: 1 }],
        selection: 'row'
      }"
      [events]="['selectionChange']"
      (jectsEvent)="onEvent($event)"
      style="display:block;height:400px"
    ></jects-grid>
  `,
})
export class PeopleComponent {
  @ViewChild(JectsGrid) grid?: JectsGrid;

  onEvent(e: { type: keyof GridEvents; payload: GridEvents[keyof GridEvents] }) {
    if (e.type === 'selectionChange') console.log('selected', e.payload);
  }

  // Imperative access: this.grid?.instance?.update({ ... }) / .getConfig() / etc.
}
```

## Components

Engines: `JectsGrid`, `JectsGantt`, `JectsScheduler`, `JectsCalendar`, `JectsKanban`,
`JectsTodo`, `JectsChart`, `JectsDiagram`, `JectsSpreadsheet`, `JectsPivot`,
`JectsBooking`, `JectsChatbot`.

Widgets: `JectsButton`, `JectsForm`, `JectsWindow`, `JectsTextField`, `JectsSelect`,
`JectsRichText`.

## Wrap any other engine

```ts
import { createComponent } from '@jects/angular';
import { SomeWidget, type SomeConfig, type SomeEvents } from '@jects/somewhere';

export const JectsSomeWidget = createComponent<SomeWidget, SomeConfig, SomeEvents>(
  SomeWidget,
  { selector: 'jects-some-widget', nonUpdatableKeys: ['renderer'] },
);
```

## Build & test

- `pnpm --filter @jects/angular run build` — `tsc` emits ESM JS + `.d.ts` into `dist/`.
  The wrappers are emitted as standard decorated classes and are AOT-compatible in a
  consuming Angular app.
- `pnpm --filter @jects/angular exec tsc --noEmit` — strict type-check of the source.
- `pnpm --filter @jects/angular run test` — type-level smoke verification of the
  wrappers + spec.
- `pnpm --filter @jects/angular run test:runtime` — Angular TestBed smoke suite under
  jsdom via `@analogjs/vite-plugin-angular`. See the package notes: this currently
  needs a vitest/vite alignment beyond the repo's pinned versions.
