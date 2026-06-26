/**
 * Stories / usage examples for the Scheduler Print feature — a print-optimized,
 * paginated rendering of the timeline (horizontal time pages + vertical lane
 * pages, the time header + locked resource column repeated per page).
 *
 * Framework-free, copy-pasteable snippets (no story-framework runtime), matching
 * the convention the package's other `*.stories.ts` follow.
 */

import { Scheduler } from './scheduler.js';
import {
  installPrint,
  PrintController,
  type PrintConfig,
  type PrintHost,
  type PrintPlan,
} from './print.js';

/**
 * A `Scheduler` structurally satisfies `PrintHost`, but its `on`/`emit` are typed
 * over the closed `SchedulerEvents` map (which intentionally does not list the
 * feature's own `print`/`beforePrint`). This bridges that boundary the same way
 * the package bridges factory registration: a single localized widening.
 */
const asHost = (s: Scheduler): PrintHost => s as unknown as PrintHost;

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MON = Date.UTC(2025, 0, 6); // a Monday
const MON_9 = MON + HOUR * 9;

/**
 * Basic wiring: install Print, then call `print()` from a toolbar button. The
 * whole time range is paginated across landscape sheets, header repeated.
 */
export function printBasic(host: HTMLElement): {
  scheduler: Scheduler;
  printer: PrintController;
} {
  const scheduler = new Scheduler(host, {
    resources: [
      { id: 'r1', name: 'Alice' },
      { id: 'r2', name: 'Bob' },
      { id: 'r3', name: 'Carol' },
    ],
    events: [
      { id: 'a', resourceId: 'r1', name: 'Design', startDate: MON_9, endDate: MON_9 + HOUR * 4 },
      { id: 'b', resourceId: 'r2', name: 'Build', startDate: MON_9 + HOUR, endDate: MON_9 + HOUR * 6 },
      { id: 'c', resourceId: 'r3', name: 'Test', startDate: MON_9 + DAY, endDate: MON_9 + DAY + HOUR * 3 },
    ],
    range: { start: MON, end: MON + DAY * 14 },
  });
  const printer = installPrint(asHost(scheduler));
  // e.g. toolbar button → printer.print({ title: 'Crew schedule' });
  return { scheduler, printer };
}

/**
 * Print a specific time window in portrait, without the repeated resource column
 * (a denser, narrower export).
 */
export function printPortraitRange(host: HTMLElement): PrintController {
  const scheduler = new Scheduler(host, {
    resources: [{ id: 'r1', name: 'Alice' }],
    events: [{ id: 'a', resourceId: 'r1', name: 'Sprint', startDate: MON_9, endDate: MON_9 + DAY * 3 }],
    range: { start: MON, end: MON + DAY * 7 },
  });
  const printer = installPrint(asHost(scheduler));
  const config: PrintConfig = {
    title: 'Week 1',
    orientation: 'portrait',
    range: { start: MON, end: MON + DAY * 2 },
    repeatResourceColumn: false,
  };
  printer.print(config);
  return printer;
}

/**
 * Gated print: an app can VETO `beforePrint` (e.g. confirm first) or read the
 * page count from the plan before committing.
 */
export function printWithVeto(
  host: HTMLElement,
  confirm: (pageCount: number) => boolean,
): PrintController {
  const scheduler = new Scheduler(host, {
    resources: [{ id: 'r1', name: 'Alice' }],
    events: [{ id: 'a', resourceId: 'r1', name: 'A', startDate: MON_9, endDate: MON_9 + HOUR * 4 }],
  });
  const printer = installPrint(asHost(scheduler));
  printer.on('beforePrint', ({ plan }: { plan: PrintPlan }) => confirm(plan.pages.length));
  printer.on('print', ({ plan }) => {
    // e.g. toast: `Sent ${plan.pages.length} page(s) to the printer`.
    void plan;
  });
  return printer;
}

/**
 * Build the print document WITHOUT opening the dialog — e.g. to embed in a custom
 * export pipeline (PDF service) or to preview it on screen.
 */
export function printBuildPreview(host: HTMLElement, mountPreviewInto: HTMLElement): HTMLElement {
  const scheduler = new Scheduler(host, {
    resources: [{ id: 'r1', name: 'Alice' }, { id: 'r2', name: 'Bob' }],
    events: [
      { id: 'a', resourceId: 'r1', name: 'A', startDate: MON_9, endDate: MON_9 + HOUR * 4 },
      { id: 'b', resourceId: 'r2', name: 'B', startDate: MON_9 + DAY, endDate: MON_9 + DAY + HOUR * 2 },
    ],
    range: { start: MON, end: MON + DAY * 10 },
  });
  const printer = installPrint(asHost(scheduler));
  const { root } = printer.buildDocument({ title: 'Preview' });
  mountPreviewInto.appendChild(root);
  return root;
}

export const stories = {
  printBasic,
  printPortraitRange,
  printWithVeto,
  printBuildPreview,
};
