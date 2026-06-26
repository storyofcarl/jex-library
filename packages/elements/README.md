# @jects/elements — light-DOM Web Components for the Jects UI engines

## What it is

`@jects/elements` wraps the framework-agnostic `@jects/*` engines as native, light-DOM custom elements (`<jects-grid>`, `<jects-gantt>`, `<jects-form>`, …). Each tag takes its engine config via a `config` property or observed attributes, re-dispatches engine events as DOM `CustomEvent`s, and exposes the live engine through an `.instance` property for imperative access. A single generic factory (`createComponent`) produces every typed element class, so the runtime contract is identical across components.

## Install

```bash
pnpm add @jects/elements @jects/theme
```

`@jects/elements` ships only the custom-element shells; the engines are **optional peer dependencies**, so install just the ones you use. For example, `<jects-grid>` needs `@jects/grid`, `<jects-gantt>` needs `@jects/gantt`, and so on. `@jects/core` is a required peer (the shared widget contract every engine implements).

```bash
# only what you render
pnpm add @jects/core @jects/grid @jects/gantt
```

## CSS

This package ships no stylesheet of its own (no `./style.css` export, no shadow DOM). Components render into the light DOM, so they pick up the page's tokens and each engine's own CSS. Import the relevant engine stylesheet(s) and the theme — see each engine's README and [Theming](#theming).

## Minimal example

```ts
import { register } from '@jects/elements';

// Define every <jects-*> custom element once (idempotent).
register();

const el = document.createElement('jects-grid');
el.config = {
  columns: [{ field: 'name', text: 'Name' }],
  data: [{ name: 'Ada' }, { name: 'Linus' }],
};
document.body.appendChild(el);

// Typed engine events arrive as CustomEvents:
el.addEventListener('cellClick', (ev) => console.log(ev.detail));

// Imperative access to the live engine:
el.instance?.update({ data: [{ name: 'Grace' }] });

// Cleanup tears down the engine via disconnectedCallback:
el.remove();
```

Prefer to register one tag only? Call its per-component helper instead of `register()`:

```ts
import { registerGrid } from '@jects/elements/grid';
registerGrid(); // defines just <jects-grid>
```

## Subpath exports

Each engine has a focused subpath exporting its element class, a `register*` helper, its `*ElementDefinition` (tag/ctor pair), and the engine's config/events types.

- `@jects/elements/grid` — `<jects-grid>`: `JectsGridElement`, `registerGrid`, `gridElementDefinition`, `GridOptions`, `GridEvents`.
- `@jects/elements/gantt` — `<jects-gantt>`: `JectsGanttElement`, `registerGantt`, `ganttElementDefinition`, `GanttOptions`, `GanttEvents`.
- `@jects/elements/scheduler` — `<jects-scheduler>`: `JectsSchedulerElement`, `registerScheduler`, `schedulerElementDefinition`, `SchedulerConfig`, `SchedulerEvents`.
- `@jects/elements/calendar` — `<jects-calendar>`: `JectsCalendarElement`, `registerCalendar`, `calendarElementDefinition`, `CalendarConfig`, `CalendarEvents`.
- `@jects/elements/booking` — `<jects-booking>`: `JectsBookingElement`, `registerBooking`, `bookingElementDefinition`, `BookingConfig`, `BookingEvents`.
- `@jects/elements/kanban` — `<jects-kanban>`: `JectsKanbanElement`, `registerKanban`, `kanbanElementDefinition`, `TaskBoardConfig`, `TaskBoardEvents`.
- `@jects/elements/todo` — `<jects-todo>`: `JectsTodoElement`, `registerTodo`, `todoElementDefinition`, `TodoListConfig`, `TodoListEvents`.
- `@jects/elements/charts` — `<jects-chart>`: `JectsChartElement`, `registerChart`, `chartElementDefinition`, `ChartConfig`, `ChartEvents`.
- `@jects/elements/diagram` — `<jects-diagram>`: `JectsDiagramElement`, `registerDiagram`, `diagramElementDefinition`, `DiagramConfig`, `DiagramEvents`.
- `@jects/elements/spreadsheet` — `<jects-spreadsheet>`: `JectsSpreadsheetElement`, `registerSpreadsheet`, `spreadsheetElementDefinition`, `SpreadsheetConfig`, `SpreadsheetEvents`.
- `@jects/elements/pivot` — `<jects-pivot>`: `JectsPivotElement`, `registerPivot`, `pivotElementDefinition`, `PivotTableConfig`, `PivotTableEvents`.
- `@jects/elements/chatbot` — `<jects-chatbot>`: `JectsChatbotElement`, `registerChatbot`, `chatbotElementDefinition`, `ChatbotConfig`, `ChatbotEvents`.
- `@jects/elements/button` — `<jects-button>`: `JectsButtonElement`, `registerButton`, `buttonElementDefinition`, `ButtonConfig`, `ButtonEvents`.
- `@jects/elements/form` — `<jects-form>`: `JectsFormElement`, `registerForm`, `formElementDefinition`, `FormConfig`, `FormEvents`.
- `@jects/elements/window` — `<jects-window>`: `JectsWindowElement`, `registerWindow`, `windowElementDefinition`, `WindowConfig`, `WindowEvents`.
- `@jects/elements/textfield` — `<jects-textfield>`: `JectsTextFieldElement`, `registerTextField`, `textFieldElementDefinition`, `TextFieldConfig`, `TextFieldEvents`.
- `@jects/elements/select` — `<jects-select>`: `JectsSelectElement`, `registerSelect`, `selectElementDefinition`, `SelectConfig`, `SelectEvents`.
- `@jects/elements/richtext` — `<jects-richtext>`: `JectsRichTextElement`, `registerRichText`, `richTextElementDefinition`, `RichTextConfig`, `RichTextEvents`.

The root `@jects/elements` entry re-exports all of the above plus `register` (defines every tag), the `elementDefinitions` list (the source-of-truth tag/ctor array), and the generic factory `createComponent` / `defineElements`.

## Common recipes

**Register only the tags you need.** Each subpath's `register*` helper is idempotent and defines a single element:

```ts
import { registerGantt } from '@jects/elements/gantt';
import { registerForm } from '@jects/elements/form';
registerGantt();
registerForm();
```

**Update config in place.** Setting the `config` property diffs against the live config and pushes the patch through the engine's `update()` — no remount unless a non-updatable key changes:

```ts
const grid = document.querySelector('jects-grid')!;
grid.config = { ...grid.config, data: nextRows };
```

**Wrap your own `@jects/*` engine.** `createComponent` turns any engine that follows the `new Ctor(host, config)` contract into a typed light-DOM element:

```ts
import { createComponent } from '@jects/elements';
import { MyWidget, type MyConfig, type MyEvents } from './my-widget';

const MyElement = createComponent<MyWidget, MyConfig, MyEvents>(MyWidget, {
  nonUpdatableKeys: ['mode'], // changing `mode` forces destroy + recreate
});
customElements.define('my-widget', MyElement);
```

**Read live engine state.** The `.instance` property is the engine itself (or `null` before connect / after disconnect):

```ts
const sched = document.querySelector('jects-scheduler')!;
sched.instance?.getConfig();
```

## Events

Every element re-dispatches its engine's events as DOM `CustomEvent`s, bound lazily the first time you add a listener for that type. The element's typed `addEventListener` overload keys off the component's `*Events` map, delivering the engine payload as `ev.detail`:

```ts
gridEl.addEventListener('rowSelect', (ev) => {
  // ev: CustomEvent<GridEvents['rowSelect']>
  console.log(ev.detail);
});
```

The exact event names are defined per engine by its `*Events` type (e.g. `GridEvents`, `GanttEvents`, `FormEvents`) — see each engine's documentation for the full set.

## Theming

All visuals come from CSS custom properties (`--jects-*`). Pull in `@jects/theme` (or an engine's exported theme CSS) to set the token palette; because elements render in light DOM they inherit those tokens directly. See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

Keyboard and ARIA behavior is provided by the underlying engines and is preserved unchanged — the custom element adds no shadow boundary and does not intercept focus or events. Refer to each engine's README for its specific keyboard map and ARIA roles.

## Stability & support

**Beta.** The factory and element contract are stable and consistent across the suite, but individual engines continue to evolve, so config/event surfaces may still shift.

Part of the Jects UI suite. Live demo: <https://jexlibrary.vercel.app>. Source: <https://github.com/storyofcarl/jex-library>. Commercial terms: see LICENSE.md.
