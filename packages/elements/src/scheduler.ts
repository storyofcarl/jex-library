/**
 * `@jects/elements/scheduler` — the `<jects-scheduler>` custom element only.
 * Importing this entry pulls ONLY `@jects/scheduler` plus the engine-free shared factory.
 */
import { Scheduler, type SchedulerConfig, type SchedulerEvents } from '@jects/scheduler';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsSchedulerElement = createComponent<Scheduler, SchedulerConfig, SchedulerEvents>(
  Scheduler,
);

/** The `<jects-scheduler>` tag paired with its element class. */
export const schedulerElementDefinition: JectsElementDefinition = {
  tag: 'jects-scheduler',
  ctor: JectsSchedulerElement,
};

/** Define `<jects-scheduler>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerScheduler(target?: CustomElementRegistry): void {
  defineElements([schedulerElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { SchedulerConfig, SchedulerEvents };
