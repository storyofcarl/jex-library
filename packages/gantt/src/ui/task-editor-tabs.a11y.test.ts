/**
 * axe-core a11y + interaction/visual browser test for `GanttTabbedTaskEditor`
 * (Quality Gate Q2). Run in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * It mounts the multi-tab editor with a real `AssignmentStore`, asserts zero
 * serious/critical axe violations on the General AND the Resources tab, exercises
 * the feature end-to-end (open the Resources tab, assign a resource via keyboard,
 * set its units, Save) and confirms the commit reached the store. A snapshot is
 * captured so the tabbed editor is covered by visual review.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { page } from '@vitest/browser/context';
import { GanttTabbedTaskEditor, type TaskEditorSavePayload } from './task-editor-tabs.js';
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

let host: HTMLElement;
let editor: GanttTabbedTaskEditor | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '480px';
  host.style.padding = '16px';
  document.body.appendChild(host);
});

afterEach(() => {
  editor?.destroy();
  editor = null;
  host.remove();
});

describe('GanttTabbedTaskEditor a11y + interaction (real Chromium)', () => {
  it('mounts both tabs with no serious/critical violations and is keyboard operable', async () => {
    const store = new AssignmentStore({ resources: RESOURCES });
    store.assign('a', 'r1', 100);

    let saved: TaskEditorSavePayload | null = null;
    editor = new GanttTabbedTaskEditor({
      host,
      assignmentStore: store,
      onSave: (_id, payload) => {
        saved = payload;
      },
    });
    const task: TaskModel = {
      id: 'a',
      name: 'Design',
      start: T0,
      end: T0 + 2 * DAY,
      duration: 2 * DAY,
      percentDone: 0.4,
    };
    editor.open(task);

    // General tab: zero serious/critical violations.
    await expectNoA11yViolations(host);

    // Move to the Resources tab via the keyboard (roving tabindex + ArrowRight).
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(editor.activeTabId).toBe('resources');

    // Resources tab visible + accessible.
    await expectNoA11yViolations(host);

    // Assign r2 via its checkbox, set units, then Save.
    const r2Check = host.querySelector(
      '.jects-gantt__assign-row[data-resource-id="r2"] .jects-gantt__assign-check',
    ) as HTMLInputElement;
    r2Check.checked = true;
    r2Check.dispatchEvent(new Event('change', { bubbles: true }));

    const r2Units = host.querySelector(
      '.jects-gantt__assign-row[data-resource-id="r2"] .jects-gantt__assign-units-input',
    ) as HTMLInputElement;
    r2Units.value = '60';
    r2Units.dispatchEvent(new Event('input', { bubbles: true }));

    // Visual artifact of the populated Resources tab (saved next to the test).
    await page.screenshot({ path: 'tabbed-task-editor-resources.png' });

    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save')!.click();

    expect(saved).not.toBeNull();
    const units = new Map(saved!.assignments.map((a) => [a.resourceId, a.units]));
    expect(units.get('r1')).toBe(100);
    expect(units.get('r2')).toBe(60);
    // The commit reached the store.
    expect(store.getAssignment('a', 'r2')?.units).toBe(60);
    expect(store.isAssigned('a', 'r1')).toBe(true);
  });

  it('traps focus inside the modal and inerts the page behind it', () => {
    // A real interactive element OUTSIDE the dialog ("the app behind it"). The
    // editor mounts on document.body so this button is a true sibling of the
    // dialog and can be proven inert + unreachable.
    const bgButton = document.createElement('button');
    bgButton.id = 'bg-action';
    bgButton.textContent = 'Background action';
    document.body.appendChild(bgButton);

    try {
      const store = new AssignmentStore({ resources: RESOURCES });
      editor = new GanttTabbedTaskEditor({
        host: document.body,
        assignmentStore: store,
        onSave: () => {},
      });
      editor.open({ id: 'a', name: 'Design', start: T0, end: T0 + DAY, duration: DAY });

      const dialog = document.querySelector('.jects-gantt__task-editor') as HTMLElement;
      expect(dialog).not.toBeNull();

      // The page behind the modal is removed from the a11y tree + made inert.
      expect(bgButton.getAttribute('aria-hidden')).toBe('true');
      expect(bgButton.hasAttribute('inert')).toBe(true);
      // The dialog itself stays interactive.
      expect(dialog.hasAttribute('inert')).toBe(false);

      // Programmatic focus on an inert element does not stick (real engine).
      bgButton.focus();
      expect(document.activeElement).not.toBe(bgButton);

      // Tabbing from the LAST focusable in the dialog cycles back into the
      // dialog — focus never escapes to the page behind it.
      const focusables = [
        ...dialog.querySelectorAll<HTMLElement>('button, input, [tabindex]'),
      ].filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
      const last = focusables[focusables.length - 1]!;
      last.focus();
      expect(document.activeElement).toBe(last);
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).not.toBe(bgButton);

      // Closing restores the background.
      editor.close();
      expect(bgButton.getAttribute('aria-hidden')).toBeNull();
      expect(bgButton.hasAttribute('inert')).toBe(false);
    } finally {
      bgButton.remove();
    }
  });
});
