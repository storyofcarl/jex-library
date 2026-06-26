/**
 * `@jects/angular/scheduler` — typed Angular standalone binding for the {@link Scheduler} engine.
 *
 * Importing this subpath pulls in `@jects/scheduler` and the shared factory only, never a
 * sibling engine. Use the root `@jects/angular` entry for the whole suite.
 */
import { createComponent } from './factory.js';
import { Scheduler, type SchedulerConfig, type SchedulerEvents } from '@jects/scheduler';

export const JectsScheduler = createComponent<Scheduler, SchedulerConfig, SchedulerEvents>(
  Scheduler,
  { selector: 'jects-scheduler' },
);

export type { SchedulerConfig, SchedulerEvents };
