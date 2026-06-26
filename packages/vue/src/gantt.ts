/**
 * `@jects/vue/gantt` — typed Vue 3 binding for {@link Gantt} only.
 *
 * Imports only the shared factory and the `@jects/gantt` engine, so this subpath
 * never drags sibling engines into a consumer's bundle.
 */
import { createComponent } from './factory.js';
import { Gantt, type GanttOptions, type GanttEvents } from '@jects/gantt';

export const JectsGantt = createComponent<Gantt, GanttOptions, GanttEvents>(Gantt);

export type { GanttOptions, GanttEvents };
