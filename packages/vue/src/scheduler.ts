/**
 * `@jects/vue/scheduler` — typed Vue 3 binding for {@link Scheduler} only.
 *
 * Imports only the shared factory and the `@jects/scheduler` engine.
 */
import { createComponent } from './factory.js';
import { Scheduler, type SchedulerConfig, type SchedulerEvents } from '@jects/scheduler';

export const JectsScheduler = createComponent<Scheduler, SchedulerConfig, SchedulerEvents>(
  Scheduler,
);

export type { SchedulerConfig, SchedulerEvents };
