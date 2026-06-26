/**
 * `@jects/angular` — typed Angular (17+) standalone bindings for the Jects UI suite.
 *
 * Every component is generated from the shared {@link createComponent} factory over
 * the uniform `@jects/core` `Widget` contract, so they all behave identically:
 * pass engine config via the `[config]` signal input, name the engine events you
 * want on `[events]` and receive them on `(jectsEvent)`, and reach the live engine
 * instance through the component's `instance` getter (e.g. via `@ViewChild`).
 *
 * Engines are constructed **outside the Angular zone** so their internal DOM churn
 * never thrashes change detection; the zone is re-entered only to emit an event.
 *
 * This root entry re-exports every wrapper as a back-compat convenience, which means
 * importing it makes the bundler resolve **all** `@jects/*` engines. If you use only
 * one (or a few) components, import the matching per-component subpath instead — e.g.
 * `import { JectsGrid } from '@jects/angular/grid'` — so your bundle pulls in only
 * `@jects/grid` and the shared factory, never the sibling engines.
 */
export { createComponent } from './factory.js';
export type {
  WidgetCtor,
  JectsEventOf,
  JectsWidgetComponent,
  CreateComponentOptions,
} from './factory.js';

// --- engines (each re-exported from its own per-component subpath module) ----
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

// --- widgets (each re-exported from its own per-component subpath module) -----
export { JectsButton, type ButtonConfig, type ButtonEvents } from './button.js';
export { JectsForm, type FormConfig, type FormEvents } from './form.js';
export { JectsWindow, type WindowConfig, type WindowEvents } from './window.js';
export { JectsTextField, type TextFieldConfig, type TextFieldEvents } from './textfield.js';
export { JectsSelect, type SelectConfig, type SelectEvents } from './select.js';
export { JectsRichText, type RichTextConfig, type RichTextEvents } from './richtext.js';
