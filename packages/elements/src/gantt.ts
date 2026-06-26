/**
 * `@jects/elements/gantt` — the `<jects-gantt>` custom element only.
 * Importing this entry pulls ONLY `@jects/gantt` plus the engine-free shared factory.
 */
import { Gantt, type GanttOptions, type GanttEvents } from '@jects/gantt';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsGanttElement = createComponent<Gantt, GanttOptions, GanttEvents>(Gantt);

/** The `<jects-gantt>` tag paired with its element class. */
export const ganttElementDefinition: JectsElementDefinition = {
  tag: 'jects-gantt',
  ctor: JectsGanttElement,
};

/** Define `<jects-gantt>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerGantt(target?: CustomElementRegistry): void {
  defineElements([ganttElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { GanttOptions, GanttEvents };
