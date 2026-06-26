# @jects/react — typed React bindings for the Jects UI suite

## What it is

`@jects/react` ships a typed React component for every framework-agnostic `@jects/*` engine. Each engine follows one uniform imperative contract (`new Ctor(host, config)` extending the `@jects/core` `Widget`: `.on()` / `.off()` / `.update()` / `.getConfig()` / `.destroy()` / `.el`), and this package wraps that contract in a single generic factory — props in, `on<Event>` callbacks out, and a `ref` to the live engine instance for imperative calls. Per-component subpaths let you import only the one engine each wrapper needs, keeping bundles lean.

## Install

```bash
pnpm add @jects/react @jects/theme react react-dom
```

`react` and `react-dom` (`>=18`) are required peers. The `@jects/*` engines are **optional** peers — install only those a wrapper needs, since the host app owns those versions. For example, `@jects/react/grid` needs `@jects/grid`, `@jects/react/gantt` needs `@jects/gantt`, and the widget wrappers (button, form, window, textfield, select, richtext) need `@jects/widgets`:

```bash
pnpm add @jects/grid          # to use @jects/react/grid
pnpm add @jects/widgets       # to use @jects/react/button, /form, /window, ...
```

## CSS

This package ships **no stylesheet** of its own. Import each engine's stylesheet once in your app, e.g.:

```ts
import '@jects/grid/style.css';
import '@jects/gantt/style.css';
```

## Minimal example

A wrapper takes the engine's config as props and forwards a `ref` to the live engine instance:

```tsx
import { useRef } from 'react';
import { JectsGrid } from '@jects/react/grid';
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
      columns={[{ field: 'name', header: 'Name', flex: 1 }]}
      selection="row"
      onSelectionChange={(e) => console.log('selected', e)}
    />
  );
}

// Imperative access: gridRef.current?.update({ ... }) / .getConfig() / .destroy()
```

The factory mounts `new Grid(host, config)` into a wrapper element in a layout effect, shallow-diffs prop changes and pushes them through `inst.update(patch)` (no remount per render), bridges `on*` props to `inst.on(...)`, exposes the engine via the forwarded ref, and calls `inst.destroy()` on unmount. It is SSR-safe — no DOM is touched during render.

## Subpath exports

Import a single wrapper from its subpath to pull in only its engine:

- `@jects/react/grid` — `JectsGrid` (`GridOptions`, `GridEvents`); wraps `@jects/grid`.
- `@jects/react/gantt` — `JectsGantt` (`GanttOptions`, `GanttEvents`); wraps `@jects/gantt`.
- `@jects/react/scheduler` — `JectsScheduler` (`SchedulerConfig`, `SchedulerEvents`); wraps `@jects/scheduler`.
- `@jects/react/calendar` — `JectsCalendar` (`CalendarConfig`, `CalendarEvents`); wraps `@jects/calendar`.
- `@jects/react/booking` — `JectsBooking` (`BookingConfig`, `BookingEvents`); wraps `@jects/booking`.
- `@jects/react/kanban` — `JectsKanban` (`TaskBoardConfig`, `TaskBoardEvents`); wraps `@jects/kanban`.
- `@jects/react/todo` — `JectsTodo` (`TodoListConfig`, `TodoListEvents`); wraps `@jects/todo`.
- `@jects/react/charts` — `JectsChart` (`ChartConfig`, `ChartEvents`); wraps `@jects/charts`.
- `@jects/react/diagram` — `JectsDiagram` (`DiagramConfig`, `DiagramEvents`); wraps `@jects/diagram`.
- `@jects/react/spreadsheet` — `JectsSpreadsheet` (`SpreadsheetConfig`, `SpreadsheetEvents`); wraps `@jects/spreadsheet`.
- `@jects/react/pivot` — `JectsPivot` (`PivotTableConfig`, `PivotTableEvents`); wraps `@jects/pivot`.
- `@jects/react/chatbot` — `JectsChatbot` (`ChatbotConfig`, `ChatbotEvents`); wraps `@jects/chatbot`.
- `@jects/react/button` — `JectsButton` (`ButtonConfig`, `ButtonEvents`); wraps the `@jects/widgets` Button.
- `@jects/react/form` — `JectsForm` (`FormConfig`, `FormEvents`); wraps the `@jects/widgets` Form.
- `@jects/react/window` — `JectsWindow` (`WindowConfig`, `WindowEvents`); wraps the `@jects/widgets` Window.
- `@jects/react/textfield` — `JectsTextField` (`TextFieldConfig`, `TextFieldEvents`); wraps the `@jects/widgets` TextField.
- `@jects/react/select` — `JectsSelect` (`SelectConfig`, `SelectEvents`); wraps the `@jects/widgets` Select.
- `@jects/react/richtext` — `JectsRichText` (`RichTextConfig`, `RichTextEvents`); wraps the `@jects/widgets` RichText editor.

The root entry (`@jects/react`) re-exports every wrapper plus `createComponent` for convenience, but pulls all sibling engines into your dependency graph — prefer subpaths for production bundles.

## Common recipes

**Imperative access via `ref`.** The forwarded ref resolves to the live engine, so any method on the engine is available:

```tsx
import { useRef, useEffect } from 'react';
import { JectsScheduler } from '@jects/react/scheduler';

function Board() {
  const ref = useRef(null);
  useEffect(() => {
    // ref.current is the live @jects/scheduler engine
    console.log(ref.current?.getConfig());
  }, []);
  return <JectsScheduler ref={ref} /* ...SchedulerConfig props */ />;
}
```

**Wrap any other engine** with the same factory the shipped wrappers use:

```tsx
import { createComponent } from '@jects/react';
import { SomeWidget, type SomeConfig, type SomeEvents } from '@jects/somewhere';

export const JectsSomeWidget = createComponent<SomeWidget, SomeConfig, SomeEvents>(
  SomeWidget,
  { nonUpdatableKeys: ['renderer'] }, // optional: keys that force destroy + recreate
);
```

`createComponent(Ctor, opts?)` returns a `forwardRef` component. `CreateComponentOptions` accepts `nonUpdatableKeys` (config keys the engine cannot apply via `update()`, so a change triggers a full remount instead of an in-place patch) and `displayName` (React devtools name).

**Swap handlers freely.** `on*` handlers are kept current through refs, so changing a handler never remounts or rebinds the engine listener:

```tsx
import { JectsKanban } from '@jects/react/kanban';

<JectsKanban onTaskMove={(e) => save(e)} onTaskClick={(e) => open(e)} />;
```

## Events

Each wrapper maps its engine's events to `on<Event>` props, typed by `JectsEventHandlers<Events>`: a `selectionChange` event becomes the `onSelectionChange` prop, `click` becomes `onClick`, and so on. Each handler receives the engine's typed event payload. The available events per component are defined by that wrapper's `*Events` type (e.g. `GridEvents`, `SchedulerEvents`, `KanbanEvents`); consult the underlying engine for its full event surface.

## Theming

Components inherit the Jects design system via CSS custom properties (`--jects-*`). Install `@jects/theme` to provide the token defaults. See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

Keyboard navigation and ARIA semantics are provided by the underlying `@jects/*` engines; these React bindings forward configuration and `ref` access through to them without altering their interactive behavior.

## Stability & support

**Beta.** The factory and the per-component bindings are typed and covered by the package test suite, but the API may still evolve.

Part of the Jects UI suite. Commercial terms: see LICENSE.md.

---

- Repository: https://github.com/storyofcarl/jex-library
- Live demo: https://jexlibrary.vercel.app
