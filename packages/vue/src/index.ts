/**
 * `@jects/vue` — typed Vue 3 bindings for the Jects UI suite.
 *
 * Every component is generated from the shared {@link createComponent} factory over
 * the uniform `@jects/core` `Widget` contract, so they all behave identically:
 * pass engine config as props, subscribe with `on<Event>` props (`@event` in templates),
 * and reach the live engine instance through the component's `expose()`d `instance`.
 */
import { createComponent } from './factory.js';

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
  JectsEventHandlers,
  JectsComponentProps,
  JectsVueComponent,
  CreateComponentOptions,
} from './factory.js';

// --- engines ----------------------------------------------------------------
export const JectsGrid = createComponent<Grid, GridOptions, GridEvents>(Grid);
export const JectsGantt = createComponent<Gantt, GanttOptions, GanttEvents>(Gantt);
export const JectsScheduler = createComponent<Scheduler, SchedulerConfig, SchedulerEvents>(Scheduler);
export const JectsCalendar = createComponent<Calendar, CalendarConfig, CalendarEvents>(Calendar);
export const JectsKanban = createComponent<TaskBoard, TaskBoardConfig, TaskBoardEvents>(TaskBoard);
export const JectsTodo = createComponent<TodoList, TodoListConfig, TodoListEvents>(TodoList);
export const JectsChart = createComponent<Chart, ChartConfig, ChartEvents>(Chart);
export const JectsDiagram = createComponent<Diagram, DiagramConfig, DiagramEvents>(Diagram);
export const JectsSpreadsheet = createComponent<Spreadsheet, SpreadsheetConfig, SpreadsheetEvents>(
  Spreadsheet,
);
export const JectsPivot = createComponent<PivotTable, PivotTableConfig, PivotTableEvents>(PivotTable);
export const JectsBooking = createComponent<Booking, BookingConfig, BookingEvents>(Booking);
export const JectsChatbot = createComponent<Chatbot, ChatbotConfig, ChatbotEvents>(Chatbot);

// --- widgets ----------------------------------------------------------------
export const JectsButton = createComponent<Button, ButtonConfig, ButtonEvents>(Button);
export const JectsForm = createComponent<Form, FormConfig, FormEvents>(Form);
export const JectsWindow = createComponent<Window, WindowConfig, WindowEvents>(Window);
export const JectsTextField = createComponent<TextField, TextFieldConfig, TextFieldEvents>(TextField);
export const JectsSelect = createComponent<Select, SelectConfig, SelectEvents>(Select);
export const JectsRichText = createComponent<RichText, RichTextConfig, RichTextEvents>(RichText);

// Re-export the engine config/event types so consumers can annotate props/handlers.
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
