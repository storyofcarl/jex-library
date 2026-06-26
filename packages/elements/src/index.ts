/**
 * `@jects/elements` — light-DOM Web Components for the Jects UI suite.
 *
 * Every element is generated from the shared {@link createComponent} factory over the
 * uniform `@jects/core` `Widget` contract, so they all behave identically: set engine
 * config via the `config` property (or attributes), subscribe with `addEventListener`
 * (engine events arrive as `CustomEvent`s), and reach the live engine instance through
 * the element's `.instance` property.
 *
 * This root barrel re-exports EVERY per-component entry, so importing it pulls all
 * engines — a convenience for "give me everything". To install a single component
 * WITHOUT its siblings, import the matching subpath instead, e.g.
 * `@jects/elements/grid` (pulls only `@jects/grid`). Each subpath also ships its own
 * `register*` helper; this barrel's {@link register} defines every tag at once.
 */
import { defineElements, type JectsElementDefinition } from './shared.js';

import { gridElementDefinition } from './grid.js';
import { ganttElementDefinition } from './gantt.js';
import { schedulerElementDefinition } from './scheduler.js';
import { calendarElementDefinition } from './calendar.js';
import { kanbanElementDefinition } from './kanban.js';
import { todoElementDefinition } from './todo.js';
import { chartElementDefinition } from './charts.js';
import { diagramElementDefinition } from './diagram.js';
import { spreadsheetElementDefinition } from './spreadsheet.js';
import { pivotElementDefinition } from './pivot.js';
import { bookingElementDefinition } from './booking.js';
import { chatbotElementDefinition } from './chatbot.js';
import { buttonElementDefinition } from './button.js';
import { formElementDefinition } from './form.js';
import { windowElementDefinition } from './window.js';
import { textFieldElementDefinition } from './textfield.js';
import { selectElementDefinition } from './select.js';
import { richTextElementDefinition } from './richtext.js';

// --- shared factory surface (engine-free) ----------------------------------
export { createComponent, defineElements } from './shared.js';
export type {
  WidgetCtor,
  JectsElement,
  JectsElementConstructor,
  CreateComponentOptions,
  JectsElementDefinition,
} from './shared.js';

// --- per-component element classes, register* helpers, definitions & types --
// Re-exported from each subpath entry so the root barrel is back-compat-complete.
export {
  JectsGridElement,
  registerGrid,
  gridElementDefinition,
  type GridOptions,
  type GridEvents,
} from './grid.js';
export {
  JectsGanttElement,
  registerGantt,
  ganttElementDefinition,
  type GanttOptions,
  type GanttEvents,
} from './gantt.js';
export {
  JectsSchedulerElement,
  registerScheduler,
  schedulerElementDefinition,
  type SchedulerConfig,
  type SchedulerEvents,
} from './scheduler.js';
export {
  JectsCalendarElement,
  registerCalendar,
  calendarElementDefinition,
  type CalendarConfig,
  type CalendarEvents,
} from './calendar.js';
export {
  JectsKanbanElement,
  registerKanban,
  kanbanElementDefinition,
  type TaskBoardConfig,
  type TaskBoardEvents,
} from './kanban.js';
export {
  JectsTodoElement,
  registerTodo,
  todoElementDefinition,
  type TodoListConfig,
  type TodoListEvents,
} from './todo.js';
export {
  JectsChartElement,
  registerChart,
  chartElementDefinition,
  type ChartConfig,
  type ChartEvents,
} from './charts.js';
export {
  JectsDiagramElement,
  registerDiagram,
  diagramElementDefinition,
  type DiagramConfig,
  type DiagramEvents,
} from './diagram.js';
export {
  JectsSpreadsheetElement,
  registerSpreadsheet,
  spreadsheetElementDefinition,
  type SpreadsheetConfig,
  type SpreadsheetEvents,
} from './spreadsheet.js';
export {
  JectsPivotElement,
  registerPivot,
  pivotElementDefinition,
  type PivotTableConfig,
  type PivotTableEvents,
} from './pivot.js';
export {
  JectsBookingElement,
  registerBooking,
  bookingElementDefinition,
  type BookingConfig,
  type BookingEvents,
} from './booking.js';
export {
  JectsChatbotElement,
  registerChatbot,
  chatbotElementDefinition,
  type ChatbotConfig,
  type ChatbotEvents,
} from './chatbot.js';
export {
  JectsButtonElement,
  registerButton,
  buttonElementDefinition,
  type ButtonConfig,
  type ButtonEvents,
} from './button.js';
export {
  JectsFormElement,
  registerForm,
  formElementDefinition,
  type FormConfig,
  type FormEvents,
} from './form.js';
export {
  JectsWindowElement,
  registerWindow,
  windowElementDefinition,
  type WindowConfig,
  type WindowEvents,
} from './window.js';
export {
  JectsTextFieldElement,
  registerTextField,
  textFieldElementDefinition,
  type TextFieldConfig,
  type TextFieldEvents,
} from './textfield.js';
export {
  JectsSelectElement,
  registerSelect,
  selectElementDefinition,
  type SelectConfig,
  type SelectEvents,
} from './select.js';
export {
  JectsRichTextElement,
  registerRichText,
  richTextElementDefinition,
  type RichTextConfig,
  type RichTextEvents,
} from './richtext.js';

/**
 * Every `<jects-*>` tag and its element class, in a stable order. The list is the
 * single source of truth {@link register} iterates over.
 */
export const elementDefinitions: readonly JectsElementDefinition[] = [
  gridElementDefinition,
  ganttElementDefinition,
  schedulerElementDefinition,
  calendarElementDefinition,
  kanbanElementDefinition,
  todoElementDefinition,
  chartElementDefinition,
  diagramElementDefinition,
  spreadsheetElementDefinition,
  pivotElementDefinition,
  bookingElementDefinition,
  chatbotElementDefinition,
  buttonElementDefinition,
  formElementDefinition,
  windowElementDefinition,
  textFieldElementDefinition,
  selectElementDefinition,
  richTextElementDefinition,
] as const;

/**
 * Define every `<jects-*>` custom element. Idempotent: a tag already present in the
 * target registry is skipped, so calling `register()` more than once is safe.
 *
 * @param target Registry to define into. Defaults to the global `customElements`.
 */
export function register(target: CustomElementRegistry = customElements): void {
  defineElements(elementDefinitions, target);
}
