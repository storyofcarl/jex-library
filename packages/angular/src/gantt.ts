/**
 * `@jects/angular/gantt` — typed Angular standalone binding for the {@link Gantt} engine.
 *
 * Importing this subpath pulls in `@jects/gantt` and the shared factory only, never a
 * sibling engine. Use the root `@jects/angular` entry for the whole suite.
 */
import { createComponent } from './factory.js';
import { Gantt, type GanttOptions, type GanttEvents } from '@jects/gantt';

export const JectsGantt = createComponent<Gantt, GanttOptions, GanttEvents>(Gantt, {
  selector: 'jects-gantt',
});

export type { GanttOptions, GanttEvents };
