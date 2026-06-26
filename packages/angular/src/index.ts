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
  JectsEventOf,
  JectsWidgetComponent,
  CreateComponentOptions,
} from './factory.js';

// --- engines ----------------------------------------------------------------
export const JectsGrid = createComponent<Grid, GridOptions, GridEvents>(Grid, {
  selector: 'jects-grid',
});
export const JectsGantt = createComponent<Gantt, GanttOptions, GanttEvents>(Gantt, {
  selector: 'jects-gantt',
});
export const JectsScheduler = createComponent<Scheduler, SchedulerConfig, SchedulerEvents>(
  Scheduler,
  { selector: 'jects-scheduler' },
);
export const JectsCalendar = createComponent<Calendar, CalendarConfig, CalendarEvents>(Calendar, {
  selector: 'jects-calendar',
});
export const JectsKanban = createComponent<TaskBoard, TaskBoardConfig, TaskBoardEvents>(TaskBoard, {
  selector: 'jects-kanban',
});
export const JectsTodo = createComponent<TodoList, TodoListConfig, TodoListEvents>(TodoList, {
  selector: 'jects-todo',
});
export const JectsChart = createComponent<Chart, ChartConfig, ChartEvents>(Chart, {
  selector: 'jects-chart',
});
export const JectsDiagram = createComponent<Diagram, DiagramConfig, DiagramEvents>(Diagram, {
  selector: 'jects-diagram',
});
export const JectsSpreadsheet = createComponent<Spreadsheet, SpreadsheetConfig, SpreadsheetEvents>(
  Spreadsheet,
  { selector: 'jects-spreadsheet' },
);
export const JectsPivot = createComponent<PivotTable, PivotTableConfig, PivotTableEvents>(
  PivotTable,
  { selector: 'jects-pivot' },
);
export const JectsBooking = createComponent<Booking, BookingConfig, BookingEvents>(Booking, {
  selector: 'jects-booking',
});
export const JectsChatbot = createComponent<Chatbot, ChatbotConfig, ChatbotEvents>(Chatbot, {
  selector: 'jects-chatbot',
});

// --- widgets ----------------------------------------------------------------
export const JectsButton = createComponent<Button, ButtonConfig, ButtonEvents>(Button, {
  selector: 'jects-button',
});
export const JectsForm = createComponent<Form, FormConfig, FormEvents>(Form, {
  selector: 'jects-form',
});
export const JectsWindow = createComponent<Window, WindowConfig, WindowEvents>(Window, {
  selector: 'jects-window',
});
export const JectsTextField = createComponent<TextField, TextFieldConfig, TextFieldEvents>(
  TextField,
  { selector: 'jects-text-field' },
);
export const JectsSelect = createComponent<Select, SelectConfig, SelectEvents>(Select, {
  selector: 'jects-select',
});
export const JectsRichText = createComponent<RichText, RichTextConfig, RichTextEvents>(RichText, {
  selector: 'jects-rich-text',
});

// Re-export the engine config/event types so consumers can annotate config/handlers.
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
