/**
 * `@jects/vue/todo` — typed Vue 3 binding for the `@jects/todo` {@link TodoList} only.
 *
 * Imports only the shared factory and the `@jects/todo` engine.
 */
import { createComponent } from './factory.js';
import { TodoList, type TodoListConfig, type TodoListEvents } from '@jects/todo';

export const JectsTodo = createComponent<TodoList, TodoListConfig, TodoListEvents>(TodoList);

export type { TodoListConfig, TodoListEvents };
