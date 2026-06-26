# @jects/angular — typed Angular (17+) bindings for the Jects UI suite

## What it is

`@jects/angular` provides thin, fully typed Angular standalone components over the framework-agnostic `@jects/*` engines. Every wrapper is generated from one shared factory and behaves identically: you pass engine config through a `[config]` signal input, name the engine events you want on `[events]` and receive them on a single typed `(jectsEvent)` output, and reach the live engine instance through the component's `instance` getter for imperative access. Engines are constructed outside the Angular zone so their internal DOM churn never thrashes change detection.

## Install

```bash
pnpm add @jects/angular @jects/theme
```

`@jects/angular` is a wrapper. Each component needs its matching engine peer installed alongside it — for example `@jects/angular/grid` needs `@jects/grid`, `@jects/angular/gantt` needs `@jects/gantt`, and so on. `@jects/core` and `@angular/core` (`>=17.1.0`) are also peers. The engine peers are declared optional, so install only the ones whose components you actually use.

```bash
# example: just the grid
pnpm add @jects/angular @jects/grid @jects/core @jects/theme
```

## CSS

This package ships no stylesheet of its own (there is no `@jects/angular/style.css` export). Component visuals come from the underlying engine packages — import the engine's stylesheet where it provides one, and pull theming tokens from `@jects/theme`.

## Minimal example

Each subpath exports a standalone component. Import the one you need, drop it in a template, and bind `[config]`, `[events]`, and `(jectsEvent)`:

```ts
import { Component } from '@angular/core';
import { JectsGrid, type GridEvents } from '@jects/angular/grid';
import type { JectsEventOf } from '@jects/angular';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [JectsGrid],
  template: `
    <jects-grid
      [config]="gridConfig"
      [events]="['selectionChange']"
      (jectsEvent)="onEvent($event)"
    ></jects-grid>
  `,
})
export class AppComponent {
  gridConfig = {
    columns: [{ field: 'name', text: 'Name' }],
    data: [{ id: 1, name: 'Ada' }],
  };

  onEvent(e: JectsEventOf<GridEvents>) {
    // e is a discriminated union: narrow on e.type to type e.payload
    if (e.type === 'selectionChange') {
      console.log(e.payload);
    }
  }
}
```

The component constructs the engine into its own host element on init and calls `instance.destroy()` automatically in `ngOnDestroy` — no manual teardown required.

## Subpath exports

Each per-component subpath pulls in only the shared factory plus that one engine, so your bundle stays lean. Importing the root `.` re-exports everything and will resolve every `@jects/*` engine — prefer subpaths in app code.

- `@jects/angular/grid` — `JectsGrid` standalone component (data grid; needs `@jects/grid`)
- `@jects/angular/gantt` — `JectsGantt` standalone component (Gantt chart; needs `@jects/gantt`)
- `@jects/angular/scheduler` — `JectsScheduler` standalone component (resource scheduler; needs `@jects/scheduler`)
- `@jects/angular/calendar` — `JectsCalendar` standalone component (calendar; needs `@jects/calendar`)
- `@jects/angular/booking` — `JectsBooking` standalone component (booking view; needs `@jects/booking`)
- `@jects/angular/kanban` — `JectsKanban` standalone component (task board; needs `@jects/kanban`)
- `@jects/angular/todo` — `JectsTodo` standalone component (todo list; needs `@jects/todo`)
- `@jects/angular/charts` — `JectsChart` standalone component (charts; needs `@jects/charts`)
- `@jects/angular/diagram` — `JectsDiagram` standalone component (diagram; needs `@jects/diagram`)
- `@jects/angular/spreadsheet` — `JectsSpreadsheet` standalone component (spreadsheet; needs `@jects/spreadsheet`)
- `@jects/angular/pivot` — `JectsPivot` standalone component (pivot table; needs `@jects/pivot`)
- `@jects/angular/chatbot` — `JectsChatbot` standalone component (chatbot; needs `@jects/chatbot`)
- `@jects/angular/button` — `JectsButton` standalone component (button; from `@jects/widgets`)
- `@jects/angular/form` — `JectsForm` standalone component (form; from `@jects/widgets`)
- `@jects/angular/window` — `JectsWindow` standalone component (window; from `@jects/widgets`)
- `@jects/angular/textfield` — `JectsTextField` standalone component (text field; from `@jects/widgets`)
- `@jects/angular/select` — `JectsSelect` standalone component (select; from `@jects/widgets`)
- `@jects/angular/richtext` — `JectsRichText` standalone component (rich text editor; from `@jects/widgets`)

## Common recipes

**Reach the engine imperatively via `@ViewChild`.** The `instance` getter returns the live engine (or `null` before init / after destroy):

```ts
import { Component, ViewChild } from '@angular/core';
import { JectsGrid } from '@jects/angular/grid';

@Component({
  standalone: true,
  imports: [JectsGrid],
  template: `<jects-grid [config]="cfg"></jects-grid>`,
})
export class GridHost {
  @ViewChild(JectsGrid) grid!: JectsGrid;
  cfg = { columns: [], data: [] };

  refresh() {
    this.grid.instance?.update({ data: this.nextRows() });
  }

  nextRows() {
    return [{ id: 1, name: 'Ada' }];
  }
}
```

**Update config reactively.** Changing the `[config]` input shallow-diffs and pushes a patch through `instance.update(patch)` rather than recreating the engine — bind it to a component field and update that field to drive the engine.

**Forward several events.** List every engine event name you care about on `[events]`; they all arrive on the one `(jectsEvent)` output as `{ type, payload }`, where `type` is the event name and `payload` is fully typed:

```html
<jects-scheduler
  [config]="cfg"
  [events]="['eventClick', 'eventDrop']"
  (jectsEvent)="handle($event)"
></jects-scheduler>
```

**Build a wrapper for a custom engine.** `createComponent(Ctor, opts?)` generates a typed standalone component from any engine that follows the `new Ctor(host, config)` contract. Use `opts.nonUpdatableKeys` to force a destroy-and-recreate when those config keys change, and `opts.selector` to set the element selector.

## Events

Engine events are not subscribed individually. You declare the event names on the `[events]` input and consume them through the single `(jectsEvent)` output. Its value is a discriminated union, `JectsEventOf<Events>` — `{ type: K; payload: Events[K] }` keyed by event name — so narrowing on `type` gives you a fully typed `payload`. The available event names per component come from each engine's typed events map (e.g. `GridEvents`, `SchedulerEvents`, `CalendarEvents`), all re-exported from this package.

## Theming

Components are themed with CSS custom properties (`--jects-*`). Install `@jects/theme` for the token set and default themes. See [docs/modules/theme.md](https://github.com/storyofcarl/jex-library/blob/main/docs/modules/theme.md).

## Accessibility

Keyboard and ARIA behavior is provided by the underlying `@jects/*` engines; the Angular wrapper forwards host, config, and events without altering it. Refer to each engine package for its accessibility coverage.

## Stability & support

Beta. The wrapper layer is a thin, uniform binding over the engines and is type-checked across all components; individual engine maturity varies by module.

Part of the Jects UI suite. Live demo: https://jexlibrary.vercel.app. Source: https://github.com/storyofcarl/jex-library. Commercial terms: see LICENSE.md.
