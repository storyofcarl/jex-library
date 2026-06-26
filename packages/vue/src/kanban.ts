/**
 * `@jects/vue/kanban` — typed Vue 3 binding for the `@jects/kanban` {@link TaskBoard} only.
 *
 * Imports only the shared factory and the `@jects/kanban` engine.
 */
import { createComponent } from './factory.js';
import { TaskBoard, type TaskBoardConfig, type TaskBoardEvents } from '@jects/kanban';

export const JectsKanban = createComponent<TaskBoard, TaskBoardConfig, TaskBoardEvents>(TaskBoard);

export type { TaskBoardConfig, TaskBoardEvents };
