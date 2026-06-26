/**
 * a11y + visual/interaction SMOKE test for {@link GanttTabbedTaskEditorFeature}
 * in REAL Chromium (Quality Gate Q2). Run with
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Unlike the standalone editor a11y test, this exercises the FEATURE end-to-end
 * on a live `Gantt`: the capture-phase double-click swap actually opens the
 * tabbed editor (proving the orphaned UI is now reachable), axe asserts zero
 * serious/critical violations on both tabs, a resource is assigned via the
 * keyboard on the Resources tab, and Save routes the patch through the real
 * scheduling engine + commits the assignment to the store. A snapshot of the
 * populated Resources tab is captured for visual review.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import { Gantt } from './gantt.js';
import { GanttTabbedTaskEditorFeature } from './tabbed-task-editor-feature.js';
import { AssignmentStore, type ResourceModel } from './resource-assignment.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

const RESOURCES: ResourceModel[] = [
  { id: 'r1', name: 'Ada Lovelace', role: 'Engineer' },
  { id: 'r2', name: 'Grace Hopper', initials: 'GH', role: 'Lead' },
  { id: 'r3', name: 'Alan Turing' },
];

function tasks(): TaskModel[] {
  return [
    { id: 'a', name: 'Design', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY } as TaskModel,
    { id: 'b', name: 'Build', start: T0 + 4 * DAY, duration: 3 * DAY, end: T0 + 7 * DAY } as TaskModel,
  ];
}

let host: HTMLElement;
let gantt: Gantt | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.height = '320px';
  host.style.width = '960px';
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
  document.querySelectorAll('.jects-gantt__task-editor').forEach((n) => n.remove());
});

describe('GanttTabbedTaskEditorFeature (real Chromium)', () => {
  it('double-click opens the tabbed editor with no serious/critical a11y violations and saves through the engine', async () => {
    const store = new AssignmentStore({ resources: RESOURCES });
    store.assign('a', 'r1', 100);

    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttTabbedTaskEditorFeature({ assignmentStore: store }));

    // Open via a real double-click on the laid-out bar (the swap path).
    const bar = host.querySelector('.jects-gantt__bar[data-task-id="a"]') as HTMLElement;
    expect(bar).not.toBeNull();
    bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    const dialog = document.querySelector('.jects-gantt__task-editor') as HTMLElement;
    expect(dialog).not.toBeNull();
    // The built-in single-form Window editor must NOT have opened.
    expect(document.querySelector('.jects-window')).toBeNull();

    // General tab: zero serious/critical violations.
    await expectNoA11yViolations(dialog);

    // Keyboard-navigate to the Resources tab (roving tabindex + ArrowRight).
    const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['General', 'Resources']);
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    // Resources tab visible + accessible.
    await expectNoA11yViolations(dialog);

    // Assign r2 via its checkbox + set units.
    const r2Check = dialog.querySelector(
      '.jects-gantt__assign-row[data-resource-id="r2"] .jects-gantt__assign-check',
    ) as HTMLInputElement;
    r2Check.checked = true;
    r2Check.dispatchEvent(new Event('change', { bubbles: true }));

    const r2Units = dialog.querySelector(
      '.jects-gantt__assign-row[data-resource-id="r2"] .jects-gantt__assign-units-input',
    ) as HTMLInputElement;
    r2Units.value = '60';
    r2Units.dispatchEvent(new Event('input', { bubbles: true }));

    // Visual artifact of the populated Resources tab.
    await page.screenshot({ path: 'tabbed-task-editor-feature-resources.png' });

    // Also edit the name on the General tab (round-trip through the engine).
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    const nameInput = dialog.querySelector('#jects-gantt-te-field-name') as HTMLInputElement;
    nameInput.value = 'Design v2';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Save')!.click();

    // Engine-routed update + store commit landed.
    expect(gantt.getTask('a')!.name).toBe('Design v2');
    expect(store.isAssigned('a', 'r2')).toBe(true);
    expect(store.getAssignment('a', 'r2')?.units).toBe(60);
    // Dialog closed.
    expect(document.querySelector('.jects-gantt__task-editor')).toBeNull();
  });
});
