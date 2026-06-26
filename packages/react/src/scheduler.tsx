/**
 * `@jects/react/scheduler` — isolated React binding for the Jects Scheduler engine.
 *
 * Importing this entry pulls in ONLY `@jects/scheduler` (plus the shared factory and
 * React), never any sibling engine.
 */
import { Scheduler, type SchedulerConfig, type SchedulerEvents } from '@jects/scheduler';
import { createComponent } from './factory.js';

export const JectsScheduler = createComponent<Scheduler, SchedulerConfig, SchedulerEvents>(
  Scheduler,
);
export type { SchedulerConfig, SchedulerEvents };
