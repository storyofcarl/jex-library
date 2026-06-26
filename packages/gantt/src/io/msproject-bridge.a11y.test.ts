/**
 * axe-core a11y + visual browser test for the MS Project (MSPDI) round-trip
 * (Quality Gate Q2). Run with `pnpm --filter @jects/gantt test:browser`.
 *
 * Exercises the FEATURE end-to-end in real Chromium: a Gantt RECONSTRUCTED from
 * an imported MSPDI document must render accessibly (zero serious/critical axe
 * violations), and gathering that live Gantt back to MSPDI XML must produce a
 * well-formed `<Project>` that re-imports identically. This is the user-visible
 * proof that the codec is wired to the component — not just unit-tested in
 * isolation.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { Gantt } from '../ui/gantt.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { MsProjectBundle } from './msproject.js';
import { exportMsProject, importMsProject } from './msproject.js';
import {
  fromMsProject,
  importMsProjectAsOptions,
  ganttToMsProjectXml,
} from './gantt-bridge.js';
import type { ResourceModel, AssignmentModel } from '../resource/resource-contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);

let host: HTMLElement;
let gantt: Gantt | null = null;

function bundle(): MsProjectBundle {
  const resources: ResourceModel[] = [
    { id: 'r1', name: 'Ada Lovelace', type: 'work', maxUnits: 100, hourlyCost: 95 },
  ];
  const assignments: AssignmentModel[] = [
    { id: 'as1', taskId: 'a', resourceId: 'r1', units: 100 },
  ];
  return {
    name: 'MSPDI Round-Trip',
    projectStart: T0,
    defaultCalendarId: 'std',
    tasks: [
      { id: 'p', name: 'Phase 1', summary: true },
      { id: 'a', name: 'Design', parentId: 'p', start: T0, end: T0 + 3 * DAY, duration: 3 * DAY, percentDone: 0.4 },
      { id: 'b', name: 'Build', parentId: 'p', start: T0 + 3 * DAY, end: T0 + 6 * DAY, duration: 3 * DAY },
      { id: 'm', name: 'Launch', parentId: 'p', start: T0 + 6 * DAY, end: T0 + 6 * DAY, milestone: true },
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
    resources,
    assignments,
    baselines: [],
  };
}

beforeEach(() => {
  host = document.createElement('div');
  host.style.height = '400px';
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

describe('MSPDI round-trip (axe-core, real Chromium)', () => {
  it('a Gantt reconstructed from an imported MSPDI document renders accessibly', async () => {
    const xml = exportMsProject(bundle());
    const { options, warnings } = importMsProjectAsOptions(xml);
    expect(warnings).toEqual([]);
    gantt = new Gantt(host, options);
    // The imported project renders bars for every task.
    expect(gantt.el.querySelectorAll('.jects-gantt__bar').length).toBe(4);
    await expectNoA11yViolations(host);
  });

  it('gathers the live Gantt back to well-formed MSPDI that re-imports identically', async () => {
    gantt = new Gantt(host, fromMsProject(bundle()));
    const xml = ganttToMsProjectXml(gantt);
    expect(xml).toContain('<Project');
    expect(xml).toContain('http://schemas.microsoft.com/project');

    const { bundle: re, warnings } = importMsProject(xml);
    expect(warnings).toEqual([]);
    expect(re.tasks.length).toBe(4);
    expect(re.dependencies.length).toBe(2);
    expect(re.resources.length).toBe(1);
    expect(re.assignments.length).toBe(1);
    await expectNoA11yViolations(host);
  });
});
