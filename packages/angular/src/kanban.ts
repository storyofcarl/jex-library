/**
 * `@jects/angular/kanban` — typed Angular standalone binding for the {@link TaskBoard} engine.
 *
 * Importing this subpath pulls in `@jects/kanban` and the shared factory only, never a
 * sibling engine. Use the root `@jects/angular` entry for the whole suite.
 */
import { createComponent } from './factory.js';
import { TaskBoard, type TaskBoardConfig, type TaskBoardEvents } from '@jects/kanban';

export const JectsKanban = createComponent<TaskBoard, TaskBoardConfig, TaskBoardEvents>(TaskBoard, {
  selector: 'jects-kanban',
});

export type { TaskBoardConfig, TaskBoardEvents };
