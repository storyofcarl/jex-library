/**
 * `@jects/angular/todo` — typed Angular standalone binding for the {@link TodoList} engine.
 *
 * Importing this subpath pulls in `@jects/todo` and the shared factory only, never a
 * sibling engine. Use the root `@jects/angular` entry for the whole suite.
 */
import { createComponent } from './factory.js';
import { TodoList, type TodoListConfig, type TodoListEvents } from '@jects/todo';

export const JectsTodo = createComponent<TodoList, TodoListConfig, TodoListEvents>(TodoList, {
  selector: 'jects-todo',
});

export type { TodoListConfig, TodoListEvents };
