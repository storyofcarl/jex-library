/**
 * `@jects/elements/kanban` — the `<jects-kanban>` custom element only.
 * Importing this entry pulls ONLY `@jects/kanban` plus the engine-free shared factory.
 */
import { TaskBoard, type TaskBoardConfig, type TaskBoardEvents } from '@jects/kanban';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsKanbanElement = createComponent<TaskBoard, TaskBoardConfig, TaskBoardEvents>(
  TaskBoard,
);

/** The `<jects-kanban>` tag paired with its element class. */
export const kanbanElementDefinition: JectsElementDefinition = {
  tag: 'jects-kanban',
  ctor: JectsKanbanElement,
};

/** Define `<jects-kanban>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerKanban(target?: CustomElementRegistry): void {
  defineElements([kanbanElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { TaskBoardConfig, TaskBoardEvents };
