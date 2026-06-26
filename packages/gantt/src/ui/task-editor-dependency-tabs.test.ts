/**
 * jsdom unit tests for the dependency task-editor tabs — Predecessors,
 * Successors, Advanced (constraint/calendar/scheduling-mode), and Notes.
 *
 * Covered:
 *   - pure helpers (date <-> input, lag <-> days, constraintIsDated);
 *   - DependencyGridField: render as an ARIA grid, seed rows from links, add /
 *     remove / edit rows, draft → reconcile ops;
 *   - reconcileDependencies: adds, removes, type/lag edits, retarget (= remove +
 *     re-add), self-link guard, direction (predecessor vs successor) wiring;
 *   - AdvancedFields: constraint-date show/hide, calendar, manual-mode patch;
 *   - NotesField value;
 *   - GanttDependencyTabs.commit() routes through a fake GanttApi
 *     (addDependency / removeDependency / applyConstraint / updateTask) and is
 *     an honest local draft (no API calls before commit);
 *   - clean teardown.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DependencyGridField,
  AdvancedFields,
  NotesField,
  GanttDependencyTabs,
  reconcileDependencies,
  constraintIsDated,
  toDateInputValue,
  parseDateInputValue,
  lagToDays,
  daysToLag,
  DEPENDENCY_TABS,
  type DependencyDraftRow,
} from './task-editor-dependency-tabs.js';
import type {
  TaskModel,
  DependencyModel,
  GanttApi,
  ConstraintType,
} from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  host.remove();
});

/* ── a minimal fake GanttApi that records mutations ───────────────────────── */
interface ApiCalls {
  added: Array<Omit<DependencyModel, 'id'>>;
  removed: unknown[];
  constraints: Array<{ id: unknown; type: ConstraintType; date?: number }>;
  patched: Array<{ id: unknown; patch: Partial<TaskModel> }>;
}

function fakeApi(
  tasks: TaskModel[],
  deps: DependencyModel[],
): { api: GanttApi; calls: ApiCalls } {
  const calls: ApiCalls = { added: [], removed: [], constraints: [], patched: [] };
  let seq = 0;
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const api = {
    engine: {
      getTasks: () => tasks,
    },
    getTask: (id: unknown) => taskById.get(id as never),
    getDependenciesFor: (taskId: unknown) =>
      deps.filter((d) => d.fromId === taskId || d.toId === taskId),
    addDependency: (dep: Omit<DependencyModel, 'id'>): DependencyModel => {
      calls.added.push(dep);
      const created = { id: `new-${++seq}`, ...dep } as DependencyModel;
      deps.push(created);
      return created;
    },
    removeDependency: (id: unknown): void => {
      calls.removed.push(id);
      const i = deps.findIndex((d) => d.id === id);
      if (i >= 0) deps.splice(i, 1);
    },
    applyConstraint: (id: unknown, type: ConstraintType, date?: number): boolean => {
      calls.constraints.push({ id, type, date });
      return true;
    },
    updateTask: (id: unknown, patch: Partial<TaskModel>): boolean => {
      calls.patched.push({ id, patch });
      return true;
    },
  } as unknown as GanttApi;
  return { api, calls };
}

const TASKS: TaskModel[] = [
  { id: 'a', name: 'Design' },
  { id: 'b', name: 'Build' },
  { id: 'c', name: 'Test' },
  { id: 'd', name: 'Ship' },
];

/* ═══════════════════════════════════════════════════════════════════════════
   pure helpers
   ═══════════════════════════════════════════════════════════════════════════ */
describe('pure helpers', () => {
  it('toDateInputValue / parseDateInputValue round-trip (UTC)', () => {
    expect(toDateInputValue(T0)).toBe('2026-01-05');
    expect(toDateInputValue(undefined)).toBe('');
    expect(parseDateInputValue('2026-01-05')).toBe(T0);
    expect(parseDateInputValue('')).toBeUndefined();
  });
  it('lagToDays / daysToLag round-trip', () => {
    expect(daysToLag(2)).toBe(2 * DAY);
    expect(lagToDays(2 * DAY)).toBe(2);
    expect(lagToDays(-1 * DAY)).toBe(-1);
    expect(daysToLag(Number.NaN)).toBe(0);
    expect(lagToDays(undefined)).toBe(0);
  });
  it('constraintIsDated classifies dated vs undated constraints', () => {
    expect(constraintIsDated('asSoonAsPossible')).toBe(false);
    expect(constraintIsDated('asLateAsPossible')).toBe(false);
    expect(constraintIsDated('mustStartOn')).toBe(true);
    expect(constraintIsDated('finishNoLaterThan')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   DependencyGridField
   ═══════════════════════════════════════════════════════════════════════════ */
describe('DependencyGridField', () => {
  const links: DependencyModel[] = [
    { id: 'l1', fromId: 'b', toId: 'a', type: 'FS', lag: DAY },
  ];

  it('renders an ARIA grid seeded with a row per existing predecessor link', () => {
    const field = new DependencyGridField({
      taskId: 'a',
      direction: 'predecessors',
      links,
      taskOptions: TASKS.map((t) => ({ id: t.id, name: t.name! })),
    });
    host.append(field.el);

    const grid = host.querySelector('[role="grid"]')!;
    expect(grid.getAttribute('aria-label')).toBe('Predecessors');
    const rows = host.querySelectorAll('.jects-gantt__dep-row');
    expect(rows.length).toBe(1);

    // The seeded row reflects link l1: target=b, type=FS, lag=1 day.
    const target = rows[0].querySelector<HTMLSelectElement>('.jects-gantt__dep-target')!;
    expect(target.value).toBe('b');
    const type = rows[0].querySelector<HTMLSelectElement>('.jects-gantt__dep-type')!;
    expect(type.value).toBe('FS');
    const lag = rows[0].querySelector<HTMLInputElement>('.jects-gantt__dep-lag')!;
    expect(lag.value).toBe('1');
    // The edited task 'a' is excluded from the target options.
    expect([...target.options].map((o) => o.value)).not.toContain('a');
    field.destroy();
  });

  it('Add link appends an empty row and Remove drops a new row immediately', () => {
    const field = new DependencyGridField({
      taskId: 'a',
      direction: 'predecessors',
      links: [],
      taskOptions: TASKS.map((t) => ({ id: t.id, name: t.name! })),
    });
    host.append(field.el);
    expect(host.querySelector('.jects-gantt__dep-empty')!.hidden).toBe(false);

    field.addRow();
    expect(host.querySelectorAll('.jects-gantt__dep-row').length).toBe(1);
    expect(host.querySelector('.jects-gantt__dep-empty')!.hidden).toBe(true);
    expect(field.liveCount).toBe(1);

    host.querySelector<HTMLButtonElement>('.jects-gantt__dep-remove')!.click();
    expect(host.querySelectorAll('.jects-gantt__dep-row').length).toBe(0);
    expect(field.liveCount).toBe(0);
    // New (uncommitted) row removed → produces no reconcile op.
    expect(field.getRows().length).toBe(0);
    field.destroy();
  });

  it('Remove on an existing link marks it removed (kept in draft, removed flag set)', () => {
    const field = new DependencyGridField({
      taskId: 'a',
      direction: 'predecessors',
      links,
      taskOptions: TASKS.map((t) => ({ id: t.id, name: t.name! })),
    });
    host.append(field.el);
    host.querySelector<HTMLButtonElement>('.jects-gantt__dep-remove')!.click();
    const rows = field.getRows();
    expect(rows.length).toBe(1);
    expect(rows[0].linkId).toBe('l1');
    expect(rows[0].removed).toBe(true);
    expect(field.liveCount).toBe(0);
    field.destroy();
  });

  it('editing target/type/lag flows into the draft + fires onChange', () => {
    const onChange = vi.fn();
    const field = new DependencyGridField({
      taskId: 'a',
      direction: 'predecessors',
      links,
      taskOptions: TASKS.map((t) => ({ id: t.id, name: t.name! })),
      onChange,
    });
    host.append(field.el);
    const row = host.querySelector('.jects-gantt__dep-row')!;
    const type = row.querySelector<HTMLSelectElement>('.jects-gantt__dep-type')!;
    type.value = 'SS';
    type.dispatchEvent(new Event('change', { bubbles: true }));
    const lag = row.querySelector<HTMLInputElement>('.jects-gantt__dep-lag')!;
    lag.value = '-2';
    lag.dispatchEvent(new Event('input', { bubbles: true }));

    const drafted = field.getRows()[0];
    expect(drafted.type).toBe('SS');
    expect(drafted.lagDays).toBe(-2);
    expect(onChange).toHaveBeenCalled();
    field.destroy();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   reconcileDependencies
   ═══════════════════════════════════════════════════════════════════════════ */
describe('reconcileDependencies', () => {
  it('adds a new predecessor link as other → task', () => {
    const rows: DependencyDraftRow[] = [
      { otherId: 'b', type: 'FS', lagDays: 1, removed: false },
    ];
    const r = reconcileDependencies('a', 'predecessors', [], rows);
    expect(r.adds).toEqual([{ fromId: 'b', toId: 'a', type: 'FS', lag: DAY }]);
    expect(r.edits).toEqual([]);
  });

  it('adds a new successor link as task → other', () => {
    const rows: DependencyDraftRow[] = [
      { otherId: 'c', type: 'SS', lagDays: 0, removed: false },
    ];
    const r = reconcileDependencies('a', 'successors', [], rows);
    expect(r.adds).toEqual([{ fromId: 'a', toId: 'c', type: 'SS', lag: 0 }]);
  });

  it('marks a removed existing link for removal', () => {
    const orig: DependencyModel[] = [{ id: 'l1', fromId: 'b', toId: 'a', type: 'FS' }];
    const rows: DependencyDraftRow[] = [
      { linkId: 'l1', otherId: 'b', type: 'FS', lagDays: 0, removed: true },
    ];
    const r = reconcileDependencies('a', 'predecessors', orig, rows);
    expect(r.edits).toEqual([{ linkId: 'l1', remove: true }]);
    expect(r.adds).toEqual([]);
  });

  it('emits a type/lag patch for an edited existing link', () => {
    const orig: DependencyModel[] = [{ id: 'l1', fromId: 'b', toId: 'a', type: 'FS', lag: 0 }];
    const rows: DependencyDraftRow[] = [
      { linkId: 'l1', otherId: 'b', type: 'SS', lagDays: 2, removed: false },
    ];
    const r = reconcileDependencies('a', 'predecessors', orig, rows);
    expect(r.edits).toEqual([
      { linkId: 'l1', remove: false, patch: { type: 'SS', lag: 2 * DAY } },
    ]);
  });

  it('re-targeting an existing link becomes remove + re-add', () => {
    const orig: DependencyModel[] = [{ id: 'l1', fromId: 'b', toId: 'a', type: 'FS' }];
    const rows: DependencyDraftRow[] = [
      { linkId: 'l1', otherId: 'c', type: 'FS', lagDays: 0, removed: false },
    ];
    const r = reconcileDependencies('a', 'predecessors', orig, rows);
    expect(r.edits).toEqual([{ linkId: 'l1', remove: true }]);
    expect(r.adds).toEqual([{ fromId: 'c', toId: 'a', type: 'FS', lag: 0 }]);
  });

  it('skips empty-target new rows and never self-links', () => {
    const rows: DependencyDraftRow[] = [
      { otherId: '', type: 'FS', lagDays: 0, removed: false },
      { otherId: 'a', type: 'FS', lagDays: 0, removed: false }, // self
    ];
    const r = reconcileDependencies('a', 'predecessors', [], rows);
    expect(r.adds).toEqual([]);
  });

  it('no-ops an unchanged existing link', () => {
    const orig: DependencyModel[] = [{ id: 'l1', fromId: 'b', toId: 'a', type: 'FS', lag: 0 }];
    const rows: DependencyDraftRow[] = [
      { linkId: 'l1', otherId: 'b', type: 'FS', lagDays: 0, removed: false },
    ];
    const r = reconcileDependencies('a', 'predecessors', orig, rows);
    expect(r.adds).toEqual([]);
    expect(r.edits).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   AdvancedFields
   ═══════════════════════════════════════════════════════════════════════════ */
describe('AdvancedFields', () => {
  it('shows the date row only for dated constraints + emits the right patch', () => {
    const adv = new AdvancedFields({
      task: { id: 'a', constraintType: 'asSoonAsPossible' },
    });
    host.append(adv.el);
    const dateRow = host.querySelector('#jects-gantt-adv-constraint-date')!.closest('.jects-gantt__adv-row') as HTMLElement;
    expect(dateRow.hidden).toBe(true);

    const sel = host.querySelector<HTMLSelectElement>('#jects-gantt-adv-constraint')!;
    sel.value = 'mustStartOn';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(dateRow.hidden).toBe(false);

    const dateInput = host.querySelector<HTMLInputElement>('#jects-gantt-adv-constraint-date')!;
    dateInput.value = '2026-01-05';
    dateInput.dispatchEvent(new Event('change', { bubbles: true }));

    const patch = adv.getPatch();
    expect(patch.constraintType).toBe('mustStartOn');
    expect(patch.constraintDate).toBe(T0);
    adv.destroy();
  });

  it('surfaces calendar + manual-scheduled in the patch', () => {
    const adv = new AdvancedFields({
      task: { id: 'a', manuallyScheduled: false, calendarId: undefined },
      calendars: [
        { id: 'cal-1', name: 'Standard' },
        { id: 'cal-2', name: 'Night shift' },
      ],
    });
    host.append(adv.el);

    const cal = host.querySelector<HTMLSelectElement>('#jects-gantt-adv-calendar')!;
    cal.value = 'cal-2';
    cal.dispatchEvent(new Event('change', { bubbles: true }));
    const manual = host.querySelector<HTMLInputElement>('#jects-gantt-adv-manual')!;
    manual.checked = true;
    manual.dispatchEvent(new Event('change', { bubbles: true }));

    const patch = adv.getPatch();
    expect(patch.calendarId).toBe('cal-2');
    expect(patch.manuallyScheduled).toBe(true);
    adv.destroy();
  });

  it('omits the constraint date for undated constraint types', () => {
    const adv = new AdvancedFields({ task: { id: 'a', constraintType: 'asLateAsPossible' } });
    expect(adv.getPatch().constraintDate).toBeUndefined();
    adv.destroy();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   NotesField
   ═══════════════════════════════════════════════════════════════════════════ */
describe('NotesField', () => {
  it('renders a labelled textarea and reports its value', () => {
    const notes = new NotesField({ value: 'hello' });
    host.append(notes.el);
    const ta = host.querySelector<HTMLTextAreaElement>('.jects-gantt__notes-input')!;
    expect(ta.value).toBe('hello');
    expect(host.querySelector('label')!.htmlFor).toBe(ta.id);
    ta.value = 'updated';
    expect(notes.getValue()).toBe('updated');
    notes.destroy();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   GanttDependencyTabs orchestrator (routes through GanttApi)
   ═══════════════════════════════════════════════════════════════════════════ */
describe('GanttDependencyTabs', () => {
  it('builds the four panels in order with correct labels', () => {
    const { api } = fakeApi(TASKS, []);
    const tabs = new GanttDependencyTabs({ api, task: TASKS[0] });
    const panels = tabs.panels();
    expect(panels.map((p) => p.id)).toEqual([
      DEPENDENCY_TABS.predecessors,
      DEPENDENCY_TABS.successors,
      DEPENDENCY_TABS.advanced,
      DEPENDENCY_TABS.notes,
    ]);
    expect(panels.map((p) => p.label)).toEqual([
      'Predecessors',
      'Successors',
      'Advanced',
      'Notes',
    ]);
    tabs.destroy();
  });

  it('makes NO api calls before commit (honest local draft)', () => {
    const { api, calls } = fakeApi(TASKS, []);
    const tabs = new GanttDependencyTabs({ api, task: TASKS[0] });
    const panels = tabs.panels();
    for (const p of panels) host.append(p.content);

    // Add a predecessor row but do not commit.
    const predGrid = panels[0].content;
    const addBtn = predGrid.querySelector<HTMLButtonElement>('.jects-gantt__dep-add')!;
    addBtn.click();
    expect(calls.added.length).toBe(0);
    expect(calls.removed.length).toBe(0);
    tabs.destroy();
  });

  it('commit() adds a new predecessor link through addDependency', () => {
    const { api, calls } = fakeApi(TASKS, []);
    const tabs = new GanttDependencyTabs({ api, task: TASKS[0] });
    const panels = tabs.panels();
    for (const p of panels) host.append(p.content);

    panels[0].content.querySelector<HTMLButtonElement>('.jects-gantt__dep-add')!.click();
    const target = panels[0].content.querySelector<HTMLSelectElement>('.jects-gantt__dep-target')!;
    target.value = 'b';
    target.dispatchEvent(new Event('change', { bubbles: true }));
    const type = panels[0].content.querySelector<HTMLSelectElement>('.jects-gantt__dep-type')!;
    type.value = 'SS';
    type.dispatchEvent(new Event('change', { bubbles: true }));

    const result = tabs.commit();
    expect(calls.added).toEqual([{ fromId: 'b', toId: 'a', type: 'SS', lag: 0 }]);
    expect(result.added.length).toBe(1);
    tabs.destroy();
  });

  it('commit() removes a predecessor link through removeDependency', () => {
    const deps: DependencyModel[] = [{ id: 'l1', fromId: 'b', toId: 'a', type: 'FS' }];
    const { api, calls } = fakeApi(TASKS, deps);
    const tabs = new GanttDependencyTabs({ api, task: TASKS[0] });
    const panels = tabs.panels();
    for (const p of panels) host.append(p.content);

    panels[0].content.querySelector<HTMLButtonElement>('.jects-gantt__dep-remove')!.click();
    const result = tabs.commit();
    expect(calls.removed).toEqual(['l1']);
    expect(result.removed).toEqual(['l1']);
    tabs.destroy();
  });

  it('commit() applies a changed constraint through applyConstraint', () => {
    const { api, calls } = fakeApi(TASKS, []);
    const tabs = new GanttDependencyTabs({ api, task: { id: 'a', name: 'Design', constraintType: 'asSoonAsPossible' } });
    const panels = tabs.panels();
    for (const p of panels) host.append(p.content);

    const sel = panels[2].content.querySelector<HTMLSelectElement>('#jects-gantt-adv-constraint')!;
    sel.value = 'mustStartOn';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const date = panels[2].content.querySelector<HTMLInputElement>('#jects-gantt-adv-constraint-date')!;
    date.value = '2026-01-05';
    date.dispatchEvent(new Event('change', { bubbles: true }));

    const result = tabs.commit();
    expect(result.constraintApplied).toBe(true);
    expect(calls.constraints).toEqual([{ id: 'a', type: 'mustStartOn', date: T0 }]);
    tabs.destroy();
  });

  it('commit() patches manual-mode through updateTask', () => {
    const { api, calls } = fakeApi(TASKS, []);
    const tabs = new GanttDependencyTabs({ api, task: { id: 'a', manuallyScheduled: false } });
    const panels = tabs.panels();
    for (const p of panels) host.append(p.content);

    const manual = panels[2].content.querySelector<HTMLInputElement>('#jects-gantt-adv-manual')!;
    manual.checked = true;
    manual.dispatchEvent(new Event('change', { bubbles: true }));

    const result = tabs.commit();
    expect(result.taskPatched).toBe(true);
    expect(calls.patched.some((p) => p.id === 'a' && p.patch.manuallyScheduled === true)).toBe(true);
    tabs.destroy();
  });

  it('commit() writes the note into task.data through updateTask', () => {
    const { api, calls } = fakeApi(TASKS, []);
    const tabs = new GanttDependencyTabs({ api, task: { id: 'a', data: { note: 'old' } } });
    const panels = tabs.panels();
    for (const p of panels) host.append(p.content);

    const ta = panels[3].content.querySelector<HTMLTextAreaElement>('.jects-gantt__notes-input')!;
    expect(ta.value).toBe('old');
    ta.value = 'new note';
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    tabs.commit();
    const notePatch = calls.patched.find(
      (p) => p.id === 'a' && (p.patch.data as { note?: string } | undefined)?.note === 'new note',
    );
    expect(notePatch).toBeTruthy();
    tabs.destroy();
  });

  it('commit() with no changes makes no api calls', () => {
    const { api, calls } = fakeApi(TASKS, []);
    const tabs = new GanttDependencyTabs({ api, task: { id: 'a', constraintType: 'asSoonAsPossible' } });
    tabs.panels();
    tabs.commit();
    expect(calls.added.length).toBe(0);
    expect(calls.removed.length).toBe(0);
    expect(calls.constraints.length).toBe(0);
    expect(calls.patched.length).toBe(0);
    tabs.destroy();
  });

  it('destroy is idempotent and removes the field elements', () => {
    const { api } = fakeApi(TASKS, []);
    const tabs = new GanttDependencyTabs({ api, task: TASKS[0] });
    const panels = tabs.panels();
    for (const p of panels) host.append(p.content);
    expect(host.querySelector('.jects-gantt__dep-field')).not.toBeNull();
    tabs.destroy();
    expect(host.querySelector('.jects-gantt__dep-field')).toBeNull();
    expect(() => tabs.destroy()).not.toThrow();
  });
});
