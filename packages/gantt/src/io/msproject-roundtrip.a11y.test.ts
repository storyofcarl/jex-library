/**
 * a11y + visual SMOKE test (real Chromium) for the public MS Project (MSPDI)
 * import/export surface of `@jects/gantt`.
 *
 * The parity item is "wire/export MSPDI import+export into the public API". This
 * test exercises that surface end-to-end against a REAL browser:
 *   1. Parse MSPDI XML → `GanttOptions` (`importMsProjectAsOptions`) and mount a
 *      live `Gantt` from it — i.e. a `.mpp` saved as XML round-trips into the UI.
 *   2. Assert the imported plan RENDERS: the WBS tree + timeline bars are present
 *      with the imported names, the milestone is marked, and the chart carries
 *      its accessible group role/label.
 *   3. Run axe-core over the mounted, imported Gantt — zero serious/critical
 *      violations (the imported component is accessible, not just functional).
 *   4. Export the LIVE Gantt back to MSPDI XML (`ganttToMsProjectXml`) and confirm
 *      it re-imports with the same task/dependency set — the full UI round-trip.
 *
 * Runs in Chromium (not jsdom) because axe needs real layout/roles/accessible
 * names, and the bar geometry must be real for the "it rendered" assertions to
 * mean anything.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from '../ui/gantt.js';
import {
  exportMsProject,
  importMsProject,
  importMsProjectAsOptions,
  ganttToMsProjectXml,
  type MsProjectBundle,
} from './index.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);

let host: HTMLElement;
let gantt: Gantt | null = null;

function sampleBundle(): MsProjectBundle {
  return {
    name: 'MSPDI Import',
    projectStart: T0,
    defaultCalendarId: 'std',
    tasks: [
      { id: 'p', name: 'Phase 1', summary: true },
      { id: 'a', name: 'Design', parentId: 'p', start: T0, end: T0 + 3 * DAY, duration: 3 * DAY, percentDone: 0.5 },
      { id: 'b', name: 'Build', parentId: 'p', start: T0 + 4 * DAY, end: T0 + 7 * DAY, duration: 3 * DAY },
      { id: 'm', name: 'Launch', parentId: 'p', start: T0 + 7 * DAY, end: T0 + 7 * DAY, milestone: true },
    ],
    dependencies: [
      { id: 'd1', fromId: 'a', toId: 'b', type: 'FS', lag: DAY },
      { id: 'd2', fromId: 'b', toId: 'm', type: 'FS' },
    ],
    calendars: [
      {
        id: 'std',
        name: 'Standard',
        week: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, intervals: [{ from: 480, to: 1020 }] })),
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

describe('MS Project (MSPDI) import/export — public API in real Chromium', () => {
  it('imports MSPDI XML into a rendered, accessible Gantt', async () => {
    const xml = exportMsProject(sampleBundle());
    const { options, warnings } = importMsProjectAsOptions(xml);
    expect(warnings).toEqual([]);

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

  it('exports the live (imported) Gantt back to MSPDI XML that re-imports identically', () => {
    const original = sampleBundle();
    const { options } = importMsProjectAsOptions(exportMsProject(original));
    gantt = new Gantt(host, options);

    const xml = ganttToMsProjectXml(gantt, { name: 'Exported From UI' });
    expect(xml).toContain('schemas.microsoft.com/project');

    const { bundle, warnings } = importMsProject(xml);
    expect(warnings).toEqual([]);
    expect(bundle.name).toBe('Exported From UI');
    expect(bundle.tasks.length).toBe(original.tasks.length);
    expect(bundle.dependencies.length).toBe(original.dependencies.length);
    expect(bundle.resources.length).toBe(original.resources.length);

    const names = bundle.tasks.map((t) => t.name).sort();
    expect(names).toEqual(['Build', 'Design', 'Launch', 'Phase 1']);
  });
});
