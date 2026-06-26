# @jects/vue — typed Vue 3 bindings for the Jects UI suite

## What it is

`@jects/vue` provides thin, fully typed Vue 3 components over the framework-agnostic `@jects/*` engines. Every component is generated from one shared factory over the uniform `@jects/core` `Widget` contract, so they all behave identically: pass engine config as props, subscribe with `on<Event>` handlers (`@event` in templates), and reach the live engine instance through the component's `expose()`d `instance`. The Vue layer adds no rendering of its own — it mounts the engine into a wrapper element, diffs config into in-place `update()` calls, and cleans up on unmount.

## Install

```bash
pnpm add @jects/vue vue
```

`vue` (`>=3.4`) is a peer dependency. Each component binds a corresponding engine that is an **optional** peer dependency — install only the engines you use. For example, `@jects/vue/grid` needs `@jects/grid`, `@jects/vue/gantt` needs `@jects/gantt`, and so on:

```bash
# only what you use
pnpm add @jects/grid          # for @jects/vue/grid
pnpm add @jects/gantt         # for @jects/vue/gantt
```

## CSS

This is a wrapper package and ships no stylesheet — there is no `@jects/vue/style.css`. Import the CSS from each underlying engine (and `@jects/theme` for tokens) per that engine's README.

## Minimal example

Prefer the per-component subpath so you pull in only one engine. Each export is a ready-to-use Vue component:

```vue
<script setup lang="ts">
import { JectsGrid } from '@jects/vue/grid'
import type { GridOptions } from '@jects/vue/grid'

const columns = [
  { field: 'name', text: 'Name' },
  { field: 'role', text: 'Role' },
]
const data = [
  { id: 1, name: 'Ada', role: 'Engineer' },
  { id: 2, name: 'Grace', role: 'Admiral' },
]

function onSelectionChange(payload: unknown) {
  console.log('selection', payload)
}
</script>

<template>
  <JectsGrid :columns="columns" :data="data" @selection-change="onSelectionChange" />
</template>
```

Mounting, in-place config updates, event binding, and teardown (`instance.destroy()`) are all handled by the component's lifecycle — you never manage the engine instance manually unless you want to.

## Subpath exports

Each subpath imports only its own engine. Prefer these over the root barrel.

- `@jects/vue/factory` — `createComponent()` and the generic types (`WidgetCtor`, `JectsEventHandlers`, `JectsComponentProps`, `JectsVueComponent`, `CreateComponentOptions`) for wrapping any `@jects/*` engine yourself.
- `@jects/vue/grid` — `JectsGrid` plus `GridOptions` / `GridEvents`.
- `@jects/vue/gantt` — `JectsGantt` plus `GanttOptions` / `GanttEvents`.
- `@jects/vue/scheduler` — `JectsScheduler` plus `SchedulerConfig` / `SchedulerEvents`.
- `@jects/vue/calendar` — `JectsCalendar` plus `CalendarConfig` / `CalendarEvents`.
- `@jects/vue/booking` — `JectsBooking` plus `BookingConfig` / `BookingEvents`.
- `@jects/vue/kanban` — `JectsKanban` plus `TaskBoardConfig` / `TaskBoardEvents`.
- `@jects/vue/todo` — `JectsTodo` plus `TodoListConfig` / `TodoListEvents`.
- `@jects/vue/charts` — `JectsChart` plus `ChartConfig` / `ChartEvents`.
- `@jects/vue/diagram` — `JectsDiagram` plus `DiagramConfig` / `DiagramEvents`.
- `@jects/vue/spreadsheet` — `JectsSpreadsheet` plus `SpreadsheetConfig` / `SpreadsheetEvents`.
- `@jects/vue/pivot` — `JectsPivot` plus `PivotTableConfig` / `PivotTableEvents`.
- `@jects/vue/chatbot` — `JectsChatbot` plus `ChatbotConfig` / `ChatbotEvents`.
- `@jects/vue/button` — `JectsButton` plus `ButtonConfig` / `ButtonEvents`.
- `@jects/vue/form` — `JectsForm` plus `FormConfig` / `FormEvents`.
- `@jects/vue/window` — `JectsWindow` plus `WindowConfig` / `WindowEvents`.
- `@jects/vue/textfield` — `JectsTextField` plus `TextFieldConfig` / `TextFieldEvents`.
- `@jects/vue/select` — `JectsSelect` plus `SelectConfig` / `SelectEvents`.
- `@jects/vue/richtext` — `JectsRichText` plus `RichTextConfig` / `RichTextEvents`.

The root entry (`@jects/vue`) is a convenience barrel that re-exports every component above; importing from it pulls in **all** engines, so prefer the subpaths in production code.

## Common recipes

**Reactive config (in-place updates, no remount).** Bind reactive props directly; the factory shallow-diffs incoming attrs and pushes a patch through `instance.update()` rather than remounting.

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { JectsGrid } from '@jects/vue/grid'

const data = ref([{ id: 1, name: 'Ada' }])
function add() {
  data.value = [...data.value, { id: data.value.length + 1, name: 'New' }]
}
</script>

<template>
  <button @click="add">Add row</button>
  <JectsGrid :columns="[{ field: 'name', text: 'Name' }]" :data="data" />
</template>
```

**Imperative access via the exposed instance.** Each component exposes the live engine as `instance` (available after mount) for calling methods the props don't cover.

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { JectsGrid } from '@jects/vue/grid'

const gridRef = ref<{ instance: unknown } | null>(null)
onMounted(() => {
  // gridRef.value.instance is the live @jects/grid engine
  console.log(gridRef.value?.instance)
})
</script>

<template>
  <JectsGrid ref="gridRef" :columns="[]" :data="[]" />
</template>
```

**Wrap your own engine.** Use the factory to bind any `@jects/*` constructor (`new Ctor(host, config)`):

```ts
import { createComponent } from '@jects/vue/factory'
import { Grid } from '@jects/grid'

const MyGrid = createComponent(Grid, {
  displayName: 'MyGrid',
  // keys that force a full recreate instead of an in-place update()
  nonUpdatableKeys: [],
})
```

## Events

Engine events are surfaced as `on<Event>` props derived from each component's typed `Events` map: `selectionChange` becomes `onSelectionChange` (`@selection-change` in templates), `click` becomes `onClick`, and so on. The factory binds each handler to `instance.on(event, …)` through a live reference, so swapping a handler never remounts or rebinds. The available events per component are typed by the corresponding `*Events` export (e.g. `GridEvents`, `GanttEvents`, `SchedulerEvents`).

## Theming

All visuals are driven by CSS custom properties (`--jects-*`); include `@jects/theme` (or the theme CSS shipped by the underlying engine) and override the properties to restyle. See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

Keyboard navigation and ARIA semantics are provided by the underlying `@jects/*` engines, not the Vue layer — the wrapper preserves them unchanged. Refer to each engine's README for its specific keyboard and ARIA support.

## Stability & support

**Beta.** The factory and component surface are typed and stable in shape; individual engine APIs may still change. Part of the Jects UI suite. Live demo: <https://jexlibrary.vercel.app>. Source: <https://github.com/storyofcarl/jex-library>. Commercial terms: see LICENSE.md.
