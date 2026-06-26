/**
 * `@jects/vue` — typed Vue 3 bindings for the Jects UI suite.
 *
 * Every component is generated from the shared {@link createComponent} factory over
 * the uniform `@jects/core` `Widget` contract, so they all behave identically:
 * pass engine config as props, subscribe with `on<Event>` props (`@event` in templates),
 * and reach the live engine instance through the component's `expose()`d `instance`.
 *
 * This root module is the back-compat convenience barrel: it re-exports every
 * per-component entry. Importing from here pulls in ALL engines, so prefer the
 * per-component subpath (`@jects/vue/grid`, `@jects/vue/button`, …) when you only
 * need one component — those entries import only their own engine.
 */
export { createComponent } from './factory.js';
export type {
  WidgetCtor,
  JectsEventHandlers,
  JectsComponentProps,
  JectsVueComponent,
  CreateComponentOptions,
} from './factory.js';

// --- engines ----------------------------------------------------------------
export { JectsGrid, type GridOptions, type GridEvents } from './grid.js';
export { JectsGantt, type GanttOptions, type GanttEvents } from './gantt.js';
export { JectsScheduler, type SchedulerConfig, type SchedulerEvents } from './scheduler.js';
export { JectsCalendar, type CalendarConfig, type CalendarEvents } from './calendar.js';
export { JectsKanban, type TaskBoardConfig, type TaskBoardEvents } from './kanban.js';
export { JectsTodo, type TodoListConfig, type TodoListEvents } from './todo.js';
export { JectsChart, type ChartConfig, type ChartEvents } from './charts.js';
export { JectsDiagram, type DiagramConfig, type DiagramEvents } from './diagram.js';
export {
  JectsSpreadsheet,
  type SpreadsheetConfig,
  type SpreadsheetEvents,
} from './spreadsheet.js';
export { JectsPivot, type PivotTableConfig, type PivotTableEvents } from './pivot.js';
export { JectsBooking, type BookingConfig, type BookingEvents } from './booking.js';
export { JectsChatbot, type ChatbotConfig, type ChatbotEvents } from './chatbot.js';

// --- widgets ----------------------------------------------------------------
export { JectsButton, type ButtonConfig, type ButtonEvents } from './button.js';
export { JectsForm, type FormConfig, type FormEvents } from './form.js';
export { JectsWindow, type WindowConfig, type WindowEvents } from './window.js';
export { JectsTextField, type TextFieldConfig, type TextFieldEvents } from './textfield.js';
export { JectsSelect, type SelectConfig, type SelectEvents } from './select.js';
export { JectsRichText, type RichTextConfig, type RichTextEvents } from './richtext.js';
