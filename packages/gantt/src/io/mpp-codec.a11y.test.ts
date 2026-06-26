/**
 * a11y + visual SMOKE test (real Chromium) for the native `.mpp` (binary OLE2)
 * import/export feature of `@jects/gantt`.
 *
 * The parity item is "Native .mpp binary import/export". This test exercises that
 * surface end-to-end against a REAL browser — proving the binary codec is wired
 * to the live component, not just unit-tested in isolation:
 *   1. Build a project, export it to a NATIVE `.mpp` (OLE2/CFB) binary
 *      (`exportMpp`) — a real compound file with the `D0CF11E0` magic.
 *   2. Parse that binary back into `GanttOptions` (`importMppAsOptions`) and mount
 *      a live `Gantt` — i.e. a binary `.mpp` round-trips into the UI.
 *   3. Assert the imported plan RENDERS: timeline bars for the leaf tasks, the
 *      milestone flagged, the resource layer live, and the chart's accessible
 *      group landmark present.
 *   4. Run axe-core over the mounted Gantt — zero serious/critical violations.
 *   5. Export the LIVE Gantt back to native `.mpp` (`ganttToMpp`) and confirm the
 *      bytes are a valid `.mpp` that re-imports with the same task/dep set.
 *
 * Runs in Chromium (not jsdom) because axe needs real layout/roles/names, and
 * the bar geometry must be real for the render assertions to mean anything. It
 * also confirms `TextEncoder`/`DataView`/typed-array byte logic behaves in a
 * real browser, not only Node.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from '../ui/gantt.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { MsProjectBundle } from './msproject.js';
import { exportMpp, importMpp, isMpp } from './mpp-codec.js';
import { importMppAsOptions, ganttToMpp } from './mpp-bridge.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);

let host: HTMLElement;
let gantt: Gantt | null = null;

function sampleBundle(): MsProjectBundle {
  return {
    name: 'Native MPP',
    projectStart: T0,
    defaultCalendarId: 'std',
    tasks: [
      { id: 'p', name: 'Phase 1', summary: true },
      {
        id: 'a',
        name: 'Design',
        parentId: 'p',
        start: T0,
        end: T0 + 3 * DAY,
        duration: 3 * DAY,
        percentDone: 0.5,
      },
      {
        id: 'b',
        name: 'Build',
        parentId: 'p',
        start: T0 + 4 * DAY,
        end: T0 + 7 * DAY,
        duration: 3 * DAY,
      },
      {
        id: 'm',
        name: 'Launch',
        parentId: 'p',
        start: T0 + 7 * DAY,
        end: T0 + 7 * DAY,
        milestone: true,
      },
    ],
    dependencies: [
      { id: 'd1', fromId: 'a', toId: 'b', type: 'FS', lag: DAY },
      { id: 'd2', fromId: 'b', toId: 'm', type: 'FS' },
    ],
    calendars: [
      {
        id: 'std',
        name: 'Standard',
        week: [1, 2, 3, 4, 5].map((weekday) => ({
          weekday,
          intervals: [{ from: 480, to: 1020 }],
        })),
      },
    ],
    resources: [{ id: 'r1', name: 'Ada', type: 'work', maxUnits: 100 }],
    assignments: [{ id: 'as1', taskId: 'a', resourceId: 'r1', units: 100 }],
    baselines: [],
  };
}

beforeEach(() => {
  host = document.createElement('div');
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '960px';
  host.style.height = '360px';
  host.style.overflow = 'hidden';
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
  document.querySelectorAll('.jects-window, .jects-overlay').forEach((n) => n.remove());
});

async function waitFor<T>(fn: () => T | null, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v != null) return v;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((res) => setTimeout(res, 16));
  }
}

describe('native .mpp (binary OLE2) import/export — real Chromium', () => {
  it('imports a native .mpp binary into a rendered, accessible Gantt', async () => {
    const bytes = exportMpp(sampleBundle());
    // It is a genuine OLE2/CFB binary, not XML.
    expect(isMpp(bytes)).toBe(true);

    const { options, warnings, jectsAuthored } = importMppAsOptions(bytes);
    expect(warnings).toEqual([]);
    expect(jectsAuthored).toBe(true);

    gantt = new Gantt(host, options);

    // The chart exposes its accessible group landmark.
    const group = host.querySelector('[role="group"]') as HTMLElement | null;
    expect(group).not.toBeNull();
    expect(group!.getAttribute('aria-label')).toBe('Gantt chart');

    // Timeline bars rendered for the imported leaf tasks (Design / Build).
    const bars = await waitFor(() => {
      const found = host.querySelectorAll('.jects-gantt__bar');
      return found.length >= 2 ? found : null;
    });
    expect(bars.length).toBeGreaterThanOrEqual(2);

    // The imported milestone is flagged on the model.
    expect(gantt.getTask('m')?.milestone).toBe(true);
    // Imported resource layer is live.
    expect(gantt.resources?.getResources().length).toBe(1);

    // axe: the imported Gantt has zero serious/critical violations.
    await expectNoA11yViolations(host);
  });

  it('exports the live Gantt back to a native .mpp that re-imports identically', () => {
    const original = sampleBundle();
    const { options } = importMppAsOptions(exportMpp(original));
    gantt = new Gantt(host, options);

    const bytes = ganttToMpp(gantt, { name: 'Exported From UI' });
    expect(isMpp(bytes)).toBe(true);

    const { bundle, warnings, jectsAuthored } = importMpp(bytes);
    expect(warnings).toEqual([]);
    expect(jectsAuthored).toBe(true);
    expect(bundle.name).toBe('Exported From UI');
    expect(bundle.tasks.length).toBe(original.tasks.length);
    expect(bundle.dependencies.length).toBe(original.dependencies.length);
    expect(bundle.resources.length).toBe(original.resources.length);

    const names = bundle.tasks.map((t) => t.name).sort();
    expect(names).toEqual(['Build', 'Design', 'Launch', 'Phase 1']);
  });
});
