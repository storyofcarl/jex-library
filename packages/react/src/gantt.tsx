/**
 * `@jects/react/gantt` — isolated React binding for the Jects Gantt engine.
 *
 * Importing this entry pulls in ONLY `@jects/gantt` (plus the shared factory and
 * React), never any sibling engine.
 */
import { Gantt, type GanttOptions, type GanttEvents } from '@jects/gantt';
import { createComponent } from './factory.js';

export const JectsGantt = createComponent<Gantt, GanttOptions, GanttEvents>(Gantt);
export type { GanttOptions, GanttEvents };
