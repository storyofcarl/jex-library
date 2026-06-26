/**
 * axe-core a11y + interaction browser test for the WIRED resource layer
 * (Quality Gate Q2). Run with `pnpm --filter @jects/gantt test:browser`.
 *
 * Exercises the end-to-end integration this feature delivers: a `Gantt`
 * constructed with `GanttOptions.resources` / `.assignments` auto-installs a
 * `ResourceManager`, surfaced on `gantt.resources`. We mount the canonical
 * `ResourceAssignmentView` against that surface in real Chromium, assert zero
 * serious/critical axe violations, and drive an `assign` through the wired API to
 * confirm the chip row repaints with an over-allocation cue.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { Gantt } from '../ui/gantt.js';
import { ResourceAssignmentView } from './resource-assignment-view.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { TaskModel } from '../contract.js';
import type { ResourceModel, AssignmentModel } from './resource-contract.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5);

function plan(): TaskModel[] {
  return [
    { id: 'p', name: 'Release' },
    { id: 'a', name: 'Design', parentId: 'p', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY, effort: 32 * HOUR },
    { id: 'b', name: 'Build', parentId: 'p', start: T0 + 4 * DAY, duration: 5 * DAY, end: T0 + 9 * DAY, effort: 40 * HOUR },
  ];
}

const resources: ResourceModel[] = [
  { id: 'ada', name: 'Ada Lovelace', hourlyCost: 120, capacity: 1, group: 'Engineering' },
  { id: 'boris', name: 'Boris Becker', hourlyCost: 90, capacity: 1 },
];

const assignments: AssignmentModel[] = [
  { id: 'as1', taskId: 'a', resourceId: 'ada', units: 100 },
  { id: 'as2', taskId: 'b', resourceId: 'ada', units: 100 },
  { id: 'as3', taskId: 'b', resourceId: 'boris', units: 50 },
];

let host: HTMLElement;
let gantt: Gantt | null = null;
let view: ResourceAssignmentView | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.padding = '16px';
  document.body.appendChild(host);
});

afterEach(() => {
  view?.destroy();
  view = null;
  gantt?.destroy();
  gantt = null;
  host.remove();
});

describe('Wired resource layer a11y (axe-core, real Chromium)', () => {
  it('auto-installs the ResourceManager and surfaces it on gantt.resources', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0, resources, assignments });
    expect(gantt.resources).toBeDefined();
    expect(gantt.resources!.getResources().map((r) => r.id)).toEqual(['ada', 'boris']);
  });

  it('a chip row driven by the wired ResourceApi has no serious/critical violations', async () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0, resources, assignments });
    const panel = document.createElement('div');
    host.appendChild(panel);
    view = new ResourceAssignmentView(panel, { api: gantt.resources!, taskId: 'b' });
    // Ada (100) + Boris (50) on Build.
    expect(panel.querySelectorAll('.jects-resource-chips__chip').length).toBe(2);
    await expectNoA11yViolations(host);
  });

  it('flags an over-allocated resource through the wired surface and passes axe', async () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0, resources, assignments });
    const panel = document.createElement('div');
    host.appendChild(panel);
    // Ada is 100% on both A and B (overlapping) ⇒ 200 > capacity 100.
    view = new ResourceAssignmentView(panel, { api: gantt.resources!, taskId: 'a' });
    const over = panel.querySelector<HTMLElement>('.jects-resource-chips__chip--over');
    expect(over).toBeTruthy();
    expect(over!.getAttribute('aria-label')).toContain('over-allocated');
    await expectNoA11yViolations(host);
  });

  it('an assign through the wired API repaints the view (live integration)', async () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0, resources });
    const panel = document.createElement('div');
    host.appendChild(panel);
    view = new ResourceAssignmentView(panel, { api: gantt.resources!, taskId: 'a' });
    // Empty to start.
    expect(panel.querySelector('.jects-resource-chips__empty')).toBeTruthy();

    gantt.resources!.assign('a', 'ada', 80);
    view.update({ api: gantt.resources!, taskId: 'a' }); // re-render from the live surface
    const chip = panel.querySelector<HTMLElement>('.jects-resource-chips__chip');
    expect(chip).toBeTruthy();
    expect(chip!.getAttribute('aria-label')).toContain('Ada Lovelace');
    await expectNoA11yViolations(host);
  });

  it('a chip is keyboard-focusable and activates with Enter', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0, resources, assignments });
    const panel = document.createElement('div');
    host.appendChild(panel);
    view = new ResourceAssignmentView(panel, { api: gantt.resources!, taskId: 'b' });
    let fired: string | number | undefined;
    view.on('chipActivate', ({ resourceId }) => (fired = resourceId));
    const chip = panel.querySelector<HTMLElement>('.jects-resource-chips__chip')!;
    chip.focus();
    expect(document.activeElement).toBe(chip);
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(fired).toBeDefined();
  });
});
