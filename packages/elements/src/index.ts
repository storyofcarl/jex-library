/**
 * `@jects/elements` — light-DOM Web Components for the Jects UI suite.
 *
 * Every element is generated from the shared {@link createComponent} factory over the
 * uniform `@jects/core` `Widget` contract, so they all behave identically: set engine
 * config via the `config` property (or attributes), subscribe with `addEventListener`
 * (engine events arrive as `CustomEvent`s), and reach the live engine instance through
 * the element's `.instance` property.
 *
 * Call {@link register} once to define every `<jects-*>` tag, or define them
 * individually with `customElements.define(tag, ElementClass)`.
 */
import { createComponent, type JectsElementConstructor } from './factory.js';

// --- data + scheduling engines ---------------------------------------------
import { Grid, type GridOptions, type GridEvents } from '@jects/grid';
import { Gantt, type GanttOptions, type GanttEvents } from '@jects/gantt';
import { Scheduler, type SchedulerConfig, type SchedulerEvents } from '@jects/scheduler';
import { Calendar, type CalendarConfig, type CalendarEvents } from '@jects/calendar';
import { TaskBoard, type TaskBoardConfig, type TaskBoardEvents } from '@jects/kanban';
import { TodoList, type TodoListConfig, type TodoListEvents } from '@jects/todo';
import { Chart, type ChartConfig, type ChartEvents } from '@jects/charts';
import { Diagram, type DiagramConfig, type DiagramEvents } from '@jects/diagram';
import { Spreadsheet, type SpreadsheetConfig, type SpreadsheetEvents } from '@jects/spreadsheet';
import { PivotTable, type PivotTableConfig, type PivotTableEvents } from '@jects/pivot';
import { Booking, type BookingConfig, type BookingEvents } from '@jects/booking';
import { Chatbot, type ChatbotConfig, type ChatbotEvents } from '@jects/chatbot';

// --- key widgets ------------------------------------------------------------
import {
  Button,
  type ButtonConfig,
  type ButtonEvents,
  Form,
  type FormConfig,
  type FormEvents,
  Window,
  type WindowConfig,
  type WindowEvents,
  TextField,
  type TextFieldConfig,
  type TextFieldEvents,
  Select,
  type SelectConfig,
  type SelectEvents,
  RichText,
  type RichTextConfig,
  type RichTextEvents,
} from '@jects/widgets';

export { createComponent } from './factory.js';
export type {
  WidgetCtor,
  JectsElement,
  JectsElementConstructor,
  CreateComponentOptions,
} from './factory.js';

// --- engine elements --------------------------------------------------------
export const JectsGridElement = createComponent<Grid, GridOptions, GridEvents>(Grid);
export const JectsGanttElement = createComponent<Gantt, GanttOptions, GanttEvents>(Gantt);
export const JectsSchedulerElement = createComponent<Scheduler, SchedulerConfig, SchedulerEvents>(
  Scheduler,
);
export const JectsCalendarElement = createComponent<Calendar, CalendarConfig, CalendarEvents>(
  Calendar,
);
export const JectsKanbanElement = createComponent<TaskBoard, TaskBoardConfig, TaskBoardEvents>(
  TaskBoard,
);
export const JectsTodoElement = createComponent<TodoList, TodoListConfig, TodoListEvents>(TodoList);
export const JectsChartElement = createComponent<Chart, ChartConfig, ChartEvents>(Chart);
export const JectsDiagramElement = createComponent<Diagram, DiagramConfig, DiagramEvents>(Diagram);
export const JectsSpreadsheetElement = createComponent<
  Spreadsheet,
  SpreadsheetConfig,
  SpreadsheetEvents
>(Spreadsheet);
export const JectsPivotElement = createComponent<PivotTable, PivotTableConfig, PivotTableEvents>(
  PivotTable,
);
export const JectsBookingElement = createComponent<Booking, BookingConfig, BookingEvents>(Booking);
export const JectsChatbotElement = createComponent<Chatbot, ChatbotConfig, ChatbotEvents>(Chatbot);

// --- widget elements --------------------------------------------------------
export const JectsButtonElement = createComponent<Button, ButtonConfig, ButtonEvents>(Button);
export const JectsFormElement = createComponent<Form, FormConfig, FormEvents>(Form);
export const JectsWindowElement = createComponent<Window, WindowConfig, WindowEvents>(Window);
export const JectsTextFieldElement = createComponent<TextField, TextFieldConfig, TextFieldEvents>(
  TextField,
);
export const JectsSelectElement = createComponent<Select, SelectConfig, SelectEvents>(Select);
export const JectsRichTextElement = createComponent<RichText, RichTextConfig, RichTextEvents>(
  RichText,
);

/** The custom-element tag for each generated element, paired with its class. */
export interface JectsElementDefinition {
  readonly tag: string;
  readonly ctor: JectsElementConstructor<object, unknown, unknown>;
}

/**
 * Every `<jects-*>` tag and its element class, in a stable order. The list is the
 * single source of truth {@link register} iterates over.
 */
export const elementDefinitions: readonly JectsElementDefinition[] = [
  { tag: 'jects-grid', ctor: JectsGridElement },
  { tag: 'jects-gantt', ctor: JectsGanttElement },
  { tag: 'jects-scheduler', ctor: JectsSchedulerElement },
  { tag: 'jects-calendar', ctor: JectsCalendarElement },
  { tag: 'jects-kanban', ctor: JectsKanbanElement },
  { tag: 'jects-todo', ctor: JectsTodoElement },
  { tag: 'jects-chart', ctor: JectsChartElement },
  { tag: 'jects-diagram', ctor: JectsDiagramElement },
  { tag: 'jects-spreadsheet', ctor: JectsSpreadsheetElement },
  { tag: 'jects-pivot', ctor: JectsPivotElement },
  { tag: 'jects-booking', ctor: JectsBookingElement },
  { tag: 'jects-chatbot', ctor: JectsChatbotElement },
  { tag: 'jects-button', ctor: JectsButtonElement },
  { tag: 'jects-form', ctor: JectsFormElement },
  { tag: 'jects-window', ctor: JectsWindowElement },
  { tag: 'jects-text-field', ctor: JectsTextFieldElement },
  { tag: 'jects-select', ctor: JectsSelectElement },
  { tag: 'jects-rich-text', ctor: JectsRichTextElement },
] as const;

/**
 * Define every `<jects-*>` custom element. Idempotent: a tag already present in the
 * target registry is skipped, so calling `register()` more than once is safe.
 *
 * @param target Registry to define into. Defaults to the global `customElements`.
 */
export function register(target: CustomElementRegistry = customElements): void {
  for (const { tag, ctor } of elementDefinitions) {
    if (!target.get(tag)) {
      target.define(tag, ctor as unknown as CustomElementConstructor);
    }
  }
}

// Re-export the engine config/event types so consumers can annotate config & handlers.
export type {
  GridOptions,
  GridEvents,
  GanttOptions,
  GanttEvents,
  SchedulerConfig,
  SchedulerEvents,
  CalendarConfig,
  CalendarEvents,
  TaskBoardConfig,
  TaskBoardEvents,
  TodoListConfig,
  TodoListEvents,
  ChartConfig,
  ChartEvents,
  DiagramConfig,
  DiagramEvents,
  SpreadsheetConfig,
  SpreadsheetEvents,
  PivotTableConfig,
  PivotTableEvents,
  BookingConfig,
  BookingEvents,
  ChatbotConfig,
  ChatbotEvents,
  ButtonConfig,
  ButtonEvents,
  FormConfig,
  FormEvents,
  WindowConfig,
  WindowEvents,
  TextFieldConfig,
  TextFieldEvents,
  SelectConfig,
  SelectEvents,
  RichTextConfig,
  RichTextEvents,
};
