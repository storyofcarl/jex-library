/**
 * `@jects/react/todo` — isolated React binding for the Jects Todo engine.
 *
 * Importing this entry pulls in ONLY `@jects/todo` (plus the shared factory and
 * React), never any sibling engine.
 */
import { TodoList, type TodoListConfig, type TodoListEvents } from '@jects/todo';
import { createComponent } from './factory.js';

export const JectsTodo = createComponent<TodoList, TodoListConfig, TodoListEvents>(TodoList);
export type { TodoListConfig, TodoListEvents };
