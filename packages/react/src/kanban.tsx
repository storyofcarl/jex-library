/**
 * `@jects/react/kanban` — isolated React binding for the Jects Kanban (TaskBoard) engine.
 *
 * Importing this entry pulls in ONLY `@jects/kanban` (plus the shared factory and
 * React), never any sibling engine.
 */
import { TaskBoard, type TaskBoardConfig, type TaskBoardEvents } from '@jects/kanban';
import { createComponent } from './factory.js';

export const JectsKanban = createComponent<TaskBoard, TaskBoardConfig, TaskBoardEvents>(TaskBoard);
export type { TaskBoardConfig, TaskBoardEvents };
