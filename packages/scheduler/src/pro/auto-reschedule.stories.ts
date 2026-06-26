/**
 * Stories / usage examples for the auto-reschedule plugin (Scheduler Pro's
 * flagship behaviour): moving or resizing an event, or creating/removing a
 * dependency, cascades to dependent events via the pure `schedule()` engine.
 *
 * These are framework-free, copy-pasteable snippets (no story framework runtime
 * dependency) — the same convention the package's other `*.stories.ts` follow.
 */

import { Scheduler } from '../view/scheduler.js';
import {
  installAutoReschedule,
  AutoReschedulePlugin,
  type AutoRescheduleConfig,
  type AutoRescheduleHost,
} from './auto-reschedule.js';
import type { DependencyModel } from '../contract.js';

/**
 * A `Scheduler` structurally satisfies `AutoRescheduleHost`, but its `on`/`emit`
 * are typed over the closed `SchedulerEvents` map (which intentionally does not
 * list the plugin's own `autoReschedule`/`beforeAutoReschedule` — those flow
 * through the shared runtime EventEmitter, which accepts any string). This helper
 * bridges that boundary the same way the package bridges the factory registration
 * cast: a single, localized widening at the call site.
 */
const asHost = (s: Scheduler): AutoRescheduleHost => s as unknown as AutoRescheduleHost;

const HOUR = 3_600_000;
const MON_9 = Date.UTC(2025, 0, 6, 9); // Monday 09:00 UTC

/**
 * Basic wiring: a two-task chain (A → B, finish-to-start). Dragging A right
 * pushes B so it always starts at/after A finishes, in working time.
 */
export function autoRescheduleBasic(host: HTMLElement): {
  scheduler: Scheduler;
  plugin: AutoReschedulePlugin;
} {
  const dependencies: DependencyModel[] = [
    { id: 'd1', fromId: 'a', toId: 'b', type: 'FS' },
  ];
  const scheduler = new Scheduler(host, {
    resources: [{ id: 'r1', name: 'Alice' }],
    events: [
      { id: 'a', resourceId: 'r1', name: 'Design', startDate: MON_9, endDate: MON_9 + HOUR * 4 },
      { id: 'b', resourceId: 'r1', name: 'Build', startDate: MON_9, endDate: MON_9 + HOUR * 3 },
    ],
    dependencies,
  });
  // Opt-in: dragging/resizing A now cascades to B.
  const plugin = installAutoReschedule(asHost(scheduler), { animationMs: 500 });
  return { scheduler, plugin };
}

/**
 * Gated cascade: an app can VETO the auto-reschedule (e.g. ask the user first)
 * by returning `false` from `beforeAutoReschedule`, or observe it via
 * `autoReschedule`.
 */
export function autoRescheduleWithVeto(
  host: HTMLElement,
  shouldApply: (changeCount: number) => boolean,
): AutoReschedulePlugin {
  const scheduler = new Scheduler(host, {
    resources: [{ id: 'r1', name: 'Alice' }],
    events: [
      { id: 'a', resourceId: 'r1', name: 'A', startDate: MON_9, endDate: MON_9 + HOUR * 4 },
      { id: 'b', resourceId: 'r1', name: 'B', startDate: MON_9, endDate: MON_9 + HOUR * 2 },
    ],
    dependencies: [{ id: 'd1', fromId: 'a', toId: 'b', type: 'FS' }],
  });
  const plugin = installAutoReschedule(asHost(scheduler));
  plugin.on('beforeAutoReschedule', ({ changes }) => shouldApply(changes.length));
  plugin.on('autoReschedule', ({ changes }) => {
    // e.g. toast: `${changes.length} task(s) rescheduled`.
    void changes;
  });
  return plugin;
}

/**
 * Backward (ALAP) scheduling: pass `direction: 'backward'` so a successor change
 * pulls predecessors earlier instead of pushing successors later.
 */
export function autoRescheduleBackward(host: HTMLElement): AutoReschedulePlugin {
  const cfg: AutoRescheduleConfig = { direction: 'backward', animationMs: 400 };
  const scheduler = new Scheduler(host, {
    resources: [{ id: 'r1', name: 'Alice' }],
    events: [
      { id: 'a', resourceId: 'r1', name: 'A', startDate: MON_9, endDate: MON_9 + HOUR * 3 },
      { id: 'b', resourceId: 'r1', name: 'B', startDate: MON_9 + HOUR * 4, endDate: MON_9 + HOUR * 6 },
    ],
    dependencies: [{ id: 'd1', fromId: 'a', toId: 'b', type: 'FS' }],
  });
  return new AutoReschedulePlugin(asHost(scheduler), cfg);
}

export const stories = {
  autoRescheduleBasic,
  autoRescheduleWithVeto,
  autoRescheduleBackward,
};
