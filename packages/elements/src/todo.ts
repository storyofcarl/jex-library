/**
 * `@jects/elements/todo` — the `<jects-todo>` custom element only.
 * Importing this entry pulls ONLY `@jects/todo` plus the engine-free shared factory.
 */
import { TodoList, type TodoListConfig, type TodoListEvents } from '@jects/todo';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsTodoElement = createComponent<TodoList, TodoListConfig, TodoListEvents>(TodoList);

/** The `<jects-todo>` tag paired with its element class. */
export const todoElementDefinition: JectsElementDefinition = {
  tag: 'jects-todo',
  ctor: JectsTodoElement,
};

/** Define `<jects-todo>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerTodo(target?: CustomElementRegistry): void {
  defineElements([todoElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { TodoListConfig, TodoListEvents };
