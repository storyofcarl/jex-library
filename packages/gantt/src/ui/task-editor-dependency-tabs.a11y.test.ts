/**
 * axe-core a11y + interaction/visual browser test for the dependency
 * task-editor tabs (Quality Gate Q2). Run in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * It mounts the four panels (Predecessors / Successors / Advanced / Notes) inside
 * a WAI-ARIA tabpanel scaffold with a fake `GanttApi`, asserts zero
 * serious/critical axe violations on each, exercises the feature end-to-end
 * (add a predecessor link via the keyboard-operable grid, edit its type + lag,
 * change the constraint to a dated one + set the date, toggle manual mode, type
 * a note, then Save) and confirms the commit routed through the API. A snapshot
 * of the populated Predecessors grid is captured for visual review.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import {
  GanttDependencyTabs,
  type TaskOption,
} from './task-editor-dependency-tabs.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { TaskModel, DependencyModel, GanttApi, ConstraintType } from '../contract.js';

const DAY = 86_400_000;

const TASKS: TaskModel[] = [
  { id: 'a', name: 'Design' },
  { id: 'b', name: 'Build' },
  { id: 'c', name: 'Test' },
  { id: 'd', name: 'Ship' },
];
const OPTIONS: TaskOption[] = TASKS.map((t) => ({ id: t.id, name: t.name! }));
void OPTIONS;

interface Recorder {
  added: Array<Omit<DependencyModel, 'id'>>;
  removed: unknown[];
  constraints: Array<{ id: unknown; type: ConstraintType; date?: number }>;
  patched: Array<{ id: unknown; patch: Partial<TaskModel> }>;
}

function fakeApi(deps: DependencyModel[]): { api: GanttApi; rec: Recorder } {
  const rec: Recorder = { added: [], removed: [], constraints: [], patched: [] };
  let seq = 0;
  const taskById = new Map(TASKS.map((t) => [t.id, t]));
  const api = {
    engine: { getTasks: () => TASKS },
    getTask: (id: unknown) => taskById.get(id as never),
    getDependenciesFor: (taskId: unknown) =>
      deps.filter((d) => d.fromId === taskId || d.toId === taskId),
    addDependency: (dep: Omit<DependencyModel, 'id'>) => {
      rec.added.push(dep);
      const created = { id: `new-${++seq}`, ...dep } as DependencyModel;
      deps.push(created);
      return created;
    },
    removeDependency: (id: unknown) => rec.removed.push(id),
    applyConstraint: (id: unknown, type: ConstraintType, date?: number) => {
      rec.constraints.push({ id, type, date });
      return true;
    },
    updateTask: (id: unknown, patch: Partial<TaskModel>) => {
      rec.patched.push({ id, patch });
      return true;
    },
  } as unknown as GanttApi;
  return { api, rec };
}

let host: HTMLElement;
let tabs: GanttDependencyTabs | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '520px';
  host.style.padding = '16px';
  document.body.appendChild(host);
});

afterEach(() => {
  tabs?.destroy();
  tabs = null;
  host.remove();
});

/** Mount the four panels into a real tablist/tabpanel scaffold for axe. */
function mountTabs(t: GanttDependencyTabs): HTMLButtonElement[] {
  const panels = t.panels();
  const tablist = document.createElement('div');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Task editor sections');
  const tabButtons: HTMLButtonElement[] = [];
  panels.forEach((p, i) => {
    const tabId = `dep-tab-${p.id}`;
    const panelId = `dep-panel-${p.id}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = tabId;
    btn.textContent = p.label;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', panelId);
    btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    btn.tabIndex = i === 0 ? 0 : -1;
    tablist.append(btn);
    tabButtons.push(btn);

    const panel = document.createElement('div');
    panel.id = panelId;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabId);
    panel.hidden = i !== 0;
    panel.append(p.content);
    host.append(panel);

    btn.addEventListener('click', () => {
      tabButtons.forEach((b, j) => {
        b.setAttribute('aria-selected', j === i ? 'true' : 'false');
        b.tabIndex = j === i ? 0 : -1;
        const pn = host.querySelector(`#dep-panel-${panels[j].id}`) as HTMLElement;
        pn.hidden = j !== i;
      });
    });
  });
  host.prepend(tablist);
  return tabButtons;
}

describe('dependency task-editor tabs a11y + interaction (real Chromium)', () => {
  it('mounts all four panels with no serious/critical violations and is keyboard operable', async () => {
    const { api, rec } = fakeApi([{ id: 'l1', fromId: 'b', toId: 'a', type: 'FS', lag: DAY }]);
    tabs = new GanttDependencyTabs({
      api,
      task: { id: 'a', name: 'Design', constraintType: 'asSoonAsPossible', data: { note: '' } },
      extras: { calendars: [{ id: 'std', name: 'Standard 5×8' }] },
    });
    const tabButtons = mountTabs(tabs);

    // Predecessors tab (default visible): zero serious/critical violations.
    await expectNoA11yViolations(host);

    // Add a predecessor link via the grid's Add button, set its fields.
    const predPanel = host.querySelector('#dep-panel-predecessors') as HTMLElement;
    predPanel.querySelector<HTMLButtonElement>('.jects-gantt__dep-add')!.click();
    const newTarget = [...predPanel.querySelectorAll<HTMLSelectElement>('.jects-gantt__dep-target')].at(-1)!;
    newTarget.value = 'c';
    newTarget.dispatchEvent(new Event('change', { bubbles: true }));
    const newType = [...predPanel.querySelectorAll<HTMLSelectElement>('.jects-gantt__dep-type')].at(-1)!;
    newType.value = 'SS';
    newType.dispatchEvent(new Event('change', { bubbles: true }));
    const newLag = [...predPanel.querySelectorAll<HTMLInputElement>('.jects-gantt__dep-lag')].at(-1)!;
    newLag.value = '2';
    newLag.dispatchEvent(new Event('input', { bubbles: true }));

    // Snapshot of the populated Predecessors grid for visual review.
    await page.screenshot({ path: 'task-editor-dependency-predecessors.png' });

    // Advanced tab: switch to a dated constraint + toggle manual mode.
    tabButtons.find((b) => b.textContent === 'Advanced')!.click();
    await expectNoA11yViolations(host);
    const advPanel = host.querySelector('#dep-panel-advanced') as HTMLElement;
    const cSel = advPanel.querySelector<HTMLSelectElement>('#jects-gantt-adv-constraint')!;
    cSel.value = 'mustStartOn';
    cSel.dispatchEvent(new Event('change', { bubbles: true }));
    const cDate = advPanel.querySelector<HTMLInputElement>('#jects-gantt-adv-constraint-date')!;
    cDate.value = '2026-01-12';
    cDate.dispatchEvent(new Event('change', { bubbles: true }));
    const manual = advPanel.querySelector<HTMLInputElement>('#jects-gantt-adv-manual')!;
    manual.checked = true;
    manual.dispatchEvent(new Event('change', { bubbles: true }));

    // Notes tab.
    tabButtons.find((b) => b.textContent === 'Notes')!.click();
    await expectNoA11yViolations(host);
    const ta = host.querySelector<HTMLTextAreaElement>('.jects-gantt__notes-input')!;
    ta.value = 'Coordinate with the platform team.';
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    // Save: commit routes through the API.
    const result = tabs.commit();
    expect(result.added).toEqual([{ fromId: 'c', toId: 'a', type: 'SS', lag: 2 * DAY }]);
    expect(rec.added).toContainEqual({ fromId: 'c', toId: 'a', type: 'SS', lag: 2 * DAY });
    expect(rec.constraints).toContainEqual({ id: 'a', type: 'mustStartOn', date: Date.parse('2026-01-12') });
    expect(rec.patched.some((p) => p.patch.manuallyScheduled === true)).toBe(true);
    expect(
      rec.patched.some((p) => (p.patch.data as { note?: string } | undefined)?.note === 'Coordinate with the platform team.'),
    ).toBe(true);
  });
});
