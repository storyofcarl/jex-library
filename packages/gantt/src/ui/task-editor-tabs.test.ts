/**
 * jsdom unit tests for `GanttTabbedTaskEditor` — the multi-tab task editor that
 * adds the Bryntum/DHTMLX "Resources" tab (assign/unassign + per-assignment
 * units %) next to the General fields.
 *
 * Covered: tab rendering + ARIA wiring, keyboard tab navigation (roving
 * tabindex + Arrow/Home/End), the General-field → typed patch coercion, the
 * Resources-tab draft → assignment commit on Save, honest Cancel, Resources tab
 * hidden when no store, and clean teardown.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GanttTabbedTaskEditor,
  toDateValue,
  parseDateInput,
  TASK_EDITOR_TABS,
  type TaskEditorSavePayload,
} from './task-editor-tabs.js';
import { AssignmentStore, type ResourceModel } from './resource-assignment.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

const RESOURCES: ResourceModel[] = [
  { id: 'r1', name: 'Ada Lovelace' },
  { id: 'r2', name: 'Grace Hopper', initials: 'GH' },
  { id: 'r3', name: 'Alan Turing' },
];

let host: HTMLElement;
let store: AssignmentStore;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  store = new AssignmentStore({ resources: RESOURCES });
});

afterEach(() => {
  host.remove();
});

function openEditor(
  task: TaskModel,
  opts: Partial<{ onSave: (id: unknown, p: TaskEditorSavePayload) => void; withStore: boolean }> = {},
): GanttTabbedTaskEditor {
  const editor = new GanttTabbedTaskEditor({
    host,
    assignmentStore: opts.withStore === false ? undefined : store,
    onSave: opts.onSave ?? (() => {}),
  });
  editor.open(task);
  return editor;
}

describe('GanttTabbedTaskEditor — pure helpers', () => {
  it('toDateValue formats epoch ms to yyyy-mm-dd (UTC) and round-trips', () => {
    expect(toDateValue(T0)).toBe('2026-01-05');
    expect(toDateValue(undefined)).toBe('');
    expect(parseDateInput(toDateValue(T0))).toBe(T0);
    expect(parseDateInput('')).toBeUndefined();
  });
});

describe('GanttTabbedTaskEditor — tabs + ARIA', () => {
  it('renders a tablist with General + Resources tabs wired to panels', () => {
    const editor = openEditor({ id: 'a', name: 'Design' });
    const tablist = host.querySelector('[role="tablist"]')!;
    expect(tablist).not.toBeNull();
    const tabs = [...host.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['General', 'Resources']);

    // aria-controls points at a real panel labelled back by the tab.
    for (const tab of tabs) {
      const panelId = tab.getAttribute('aria-controls')!;
      const panel = host.querySelector(`#${panelId}`)!;
      expect(panel.getAttribute('role')).toBe('tabpanel');
      expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
    }
    editor.destroy();
  });

  it('hides the Resources tab when no assignment store is supplied', () => {
    const editor = openEditor({ id: 'a', name: 'Design' }, { withStore: false });
    const tabs = [...host.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['General']);
    editor.destroy();
  });

  it('starts on General with roving tabindex + only the active panel visible', () => {
    const editor = openEditor({ id: 'a', name: 'Design' });
    expect(editor.activeTabId).toBe(TASK_EDITOR_TABS.general);
    const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].tabIndex).toBe(-1);

    const panels = host.querySelectorAll<HTMLElement>('[role="tabpanel"]');
    expect(panels[0].hidden).toBe(false);
    expect(panels[1].hidden).toBe(true);
    editor.destroy();
  });

  it('ArrowRight/ArrowLeft/Home/End move the active tab (wrapping)', () => {
    const editor = openEditor({ id: 'a', name: 'Design' });
    const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');

    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(editor.activeTabId).toBe(TASK_EDITOR_TABS.resources);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');

    // Wrap forward from last → first.
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(editor.activeTabId).toBe(TASK_EDITOR_TABS.general);

    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(editor.activeTabId).toBe(TASK_EDITOR_TABS.resources);
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(editor.activeTabId).toBe(TASK_EDITOR_TABS.general);

    // Wrap backward from first → last.
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(editor.activeTabId).toBe(TASK_EDITOR_TABS.resources);
    editor.destroy();
  });

  it('clicking a tab activates it and shows its panel', () => {
    const editor = openEditor({ id: 'a', name: 'Design' });
    const resourcesTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (t) => t.textContent === 'Resources',
    )!;
    resourcesTab.click();
    expect(editor.activeTabId).toBe(TASK_EDITOR_TABS.resources);
    const panel = host.querySelector(`#${resourcesTab.getAttribute('aria-controls')}`) as HTMLElement;
    expect(panel.hidden).toBe(false);
    // The Resources panel hosts the assignment field with a row per resource.
    expect(panel.querySelectorAll('.jects-gantt__assign-row').length).toBe(RESOURCES.length);
    editor.destroy();
  });
});

describe('GanttTabbedTaskEditor — General-tab patch', () => {
  it('coerces field inputs into a typed patch on Save', () => {
    let saved: { id: unknown; payload: TaskEditorSavePayload } | null = null;
    const editor = openEditor(
      { id: 'a', name: 'Design', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY },
      { onSave: (id, payload) => (saved = { id, payload }) },
    );

    (host.querySelector('#jects-gantt-te-field-name') as HTMLInputElement).value = 'Design v2';
    (host.querySelector('#jects-gantt-te-field-start') as HTMLInputElement).value = '2026-01-06';
    (host.querySelector('#jects-gantt-te-field-end') as HTMLInputElement).value = '2026-01-09';
    (host.querySelector('#jects-gantt-te-field-duration') as HTMLInputElement).value = '3';
    (host.querySelector('#jects-gantt-te-field-percentDone') as HTMLInputElement).value = '40';
    (host.querySelector('#jects-gantt-te-field-milestone') as HTMLInputElement).checked = false;

    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save')!.click();

    expect(saved).not.toBeNull();
    expect(saved!.id).toBe('a');
    expect(saved!.payload.patch.name).toBe('Design v2');
    expect(saved!.payload.patch.start).toBe(Date.parse('2026-01-06'));
    expect(saved!.payload.patch.duration).toBe(3 * DAY);
    expect(saved!.payload.patch.percentDone).toBeCloseTo(0.4);
    expect(saved!.payload.patch.milestone).toBe(false);
    expect(editor.isOpen).toBe(false);
  });
});

describe('GanttTabbedTaskEditor — Resources tab assignment', () => {
  it('assigns resources + units on Save and commits to the store', () => {
    store.assign('a', 'r1', 100); // pre-existing assignment to r1
    let saved: TaskEditorSavePayload | null = null;
    const editor = openEditor(
      { id: 'a', name: 'Design' },
      { onSave: (_id, payload) => (saved = payload) },
    );

    // Open the Resources tab + toggle r2 on and set its units, leave r1 on.
    [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((t) => t.textContent === 'Resources')!
      .click();

    const r2Check = host.querySelector(
      '.jects-gantt__assign-row[data-resource-id="r2"] .jects-gantt__assign-check',
    ) as HTMLInputElement;
    r2Check.checked = true;
    r2Check.dispatchEvent(new Event('change', { bubbles: true }));

    const r2Units = host.querySelector(
      '.jects-gantt__assign-row[data-resource-id="r2"] .jects-gantt__assign-units-input',
    ) as HTMLInputElement;
    r2Units.value = '50';
    r2Units.dispatchEvent(new Event('input', { bubbles: true }));

    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save')!.click();

    expect(saved).not.toBeNull();
    const byRes = new Map(saved!.assignments.map((a) => [a.resourceId, a.units]));
    expect(byRes.get('r1')).toBe(100);
    expect(byRes.get('r2')).toBe(50);

    // Committed to the store.
    expect(store.isAssigned('a', 'r1')).toBe(true);
    expect(store.getAssignment('a', 'r2')?.units).toBe(50);
    editor.destroy();
  });

  it('unassigning a resource removes it on Save', () => {
    store.assign('a', 'r1', 100);
    store.assign('a', 'r2', 80);
    const editor = openEditor({ id: 'a', name: 'Design' });

    [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((t) => t.textContent === 'Resources')!
      .click();

    const r1Check = host.querySelector(
      '.jects-gantt__assign-row[data-resource-id="r1"] .jects-gantt__assign-check',
    ) as HTMLInputElement;
    r1Check.checked = false;
    r1Check.dispatchEvent(new Event('change', { bubbles: true }));

    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save')!.click();

    expect(store.isAssigned('a', 'r1')).toBe(false);
    expect(store.isAssigned('a', 'r2')).toBe(true);
    editor.destroy();
  });
});

describe('GanttTabbedTaskEditor — modal focus containment', () => {
  it('marks background siblings aria-hidden + inert while open and restores on close', () => {
    // A sibling that represents "the rest of the app" behind the modal.
    const bg = document.createElement('div');
    bg.id = 'bg-app';
    const bgBtn = document.createElement('button');
    bgBtn.textContent = 'Background action';
    bg.append(bgBtn);
    host.append(bg);

    const editor = openEditor({ id: 'a', name: 'Design' });

    // The dialog root is a sibling of bg under host; bg must be inerted/hidden.
    expect(bg.getAttribute('aria-hidden')).toBe('true');
    expect(bg.hasAttribute('inert')).toBe(true);
    // The dialog itself is NOT inerted.
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.hasAttribute('inert')).toBe(false);
    expect(dialog.getAttribute('aria-hidden')).not.toBe('true');

    editor.close();
    // Background restored (no clobbering of pre-existing state).
    expect(bg.getAttribute('aria-hidden')).toBeNull();
    expect(bg.hasAttribute('inert')).toBe(false);
  });

  it('does not clobber a sibling that was already aria-hidden', () => {
    const bg = document.createElement('div');
    bg.setAttribute('aria-hidden', 'true');
    host.append(bg);

    const editor = openEditor({ id: 'a', name: 'Design' });
    // We skipped it (already hidden) → no inert added by us.
    expect(bg.hasAttribute('inert')).toBe(false);

    editor.close();
    // Its pre-existing aria-hidden is preserved (we never touched it).
    expect(bg.getAttribute('aria-hidden')).toBe('true');
  });

  it('installs a focus trap whose disposer is cleaned up on close (no leaked keydown listener)', () => {
    const editor = openEditor({ id: 'a', name: 'Design' });
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    const removeSpy = vi.spyOn(dialog, 'removeEventListener');
    editor.close();
    // The trap's keydown listener (and the Escape listener) are removed on close.
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    removeSpy.mockRestore();
  });
});

describe('GanttTabbedTaskEditor — cancel + lifecycle', () => {
  it('Cancel closes without saving or committing', () => {
    store.assign('a', 'r1', 100);
    const onSave = vi.fn();
    const editor = openEditor({ id: 'a', name: 'Design' }, { onSave });

    [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((t) => t.textContent === 'Resources')!
      .click();
    const r1Check = host.querySelector(
      '.jects-gantt__assign-row[data-resource-id="r1"] .jects-gantt__assign-check',
    ) as HTMLInputElement;
    r1Check.checked = false;
    r1Check.dispatchEvent(new Event('change', { bubbles: true }));

    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click();

    expect(onSave).not.toHaveBeenCalled();
    expect(editor.isOpen).toBe(false);
    // The store is untouched (draft was discarded).
    expect(store.isAssigned('a', 'r1')).toBe(true);
  });

  it('Escape closes the dialog', () => {
    const editor = openEditor({ id: 'a', name: 'Design' });
    editor.el!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(editor.isOpen).toBe(false);
  });

  it('destroy removes the DOM and is idempotent', () => {
    const editor = openEditor({ id: 'a', name: 'Design' });
    expect(host.querySelector('.jects-gantt__task-editor')).not.toBeNull();
    editor.destroy();
    expect(host.querySelector('.jects-gantt__task-editor')).toBeNull();
    expect(() => editor.destroy()).not.toThrow();
    expect(editor.isOpen).toBe(false);
  });
});
