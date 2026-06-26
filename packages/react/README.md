# @jects/react

Typed **React** bindings for the [Jects UI](../../README.md) suite.

Every Jects component is a framework-agnostic engine that follows one uniform
imperative contract (`new Ctor(host, config)` extending the `@jects/core` `Widget`:
`.on()` / `.off()` / `.update()` / `.getConfig()` / `.destroy()` / `.el`). This
package wraps that contract in a single generic factory and ships a typed React
component per engine — props in, `on<Event>` callbacks out, and a `ref` to the live
engine instance for imperative calls.

## Install

```bash
pnpm add @jects/react react react-dom
# plus the engines you use:
pnpm add @jects/grid @jects/gantt @jects/widgets
```

`react`, `react-dom`, and every `@jects/*` engine are **peer dependencies** — the host
app owns those versions. Import each engine's stylesheet once (e.g.
`import '@jects/grid/style.css'`).

## How wrappers behave

- **Config in via props.** Any prop that isn't `className`, `style`, or an
  `on<Event>` handler is treated as engine config. On change it is shallow-diffed and
  pushed through `inst.update(patch)` — there is **no remount on every render**. A
  remount happens only when a key you mark `nonUpdatableKeys` changes.
- **Events out via `on<Event>` props.** `onClick` wires `inst.on('click', …)`,
  `onSelectionChange` wires `inst.on('selectionChange', …)`, etc. Handlers are kept
  current through refs, so swapping a handler never remounts or rebinds.
- **`ref` is the engine.** The forwarded ref resolves to the live engine instance, so
  you can call any imperative method.
- **Cleanup + SSR.** `inst.destroy()` runs on unmount; no DOM is touched during render.

## Grid example

```tsx
import { useRef } from 'react';
import { JectsGrid } from '@jects/react';
import type { Grid } from '@jects/grid';
import '@jects/grid/style.css';

export function People() {
  const gridRef = useRef<Grid>(null);

  return (
    <JectsGrid
      ref={gridRef}
      style={{ height: 400 }}
      data={[
        { id: 1, name: 'Ada Lovelace' },
        { id: 2, name: 'Grace Hopper' },
      ]}
      columns={[
        { field: 'name', header: 'Name', flex: 1 },
      ]}
      selection="row"
      onSelectionChange={(e) => console.log('selected', e.selectedIds)}
    />
  );
}

// Imperative access: gridRef.current?.update({ ... }) / .getConfig() / etc.
```

## Gantt example

```tsx
import { JectsGantt } from '@jects/react';
import '@jects/gantt/style.css';

export function Plan() {
  return (
    <JectsGantt
      style={{ height: 500 }}
      tasks={[
        { id: 1, name: 'Design', percentDone: 0.5 },
        { id: 2, name: 'Build', parentId: 1 },
      ]}
      onTaskClick={(e) => console.log('task', e)}
    />
  );
}
```

## Components

Engines: `JectsGrid`, `JectsGantt`, `JectsScheduler`, `JectsCalendar`, `JectsKanban`,
`JectsTodo`, `JectsChart`, `JectsDiagram`, `JectsSpreadsheet`, `JectsPivot`,
`JectsBooking`, `JectsChatbot`.

Widgets: `JectsButton`, `JectsForm`, `JectsWindow`, `JectsTextField`, `JectsSelect`,
`JectsRichText`.

## Wrap any other engine

```tsx
import { createComponent } from '@jects/react';
import { SomeWidget, type SomeConfig, type SomeEvents } from '@jects/somewhere';

export const JectsSomeWidget = createComponent<SomeWidget, SomeConfig, SomeEvents>(
  SomeWidget,
  { nonUpdatableKeys: ['renderer'] }, // optional: keys that force a remount
);
```
