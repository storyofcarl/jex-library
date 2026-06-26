/**
 * jsdom unit tests for the resource-assignment SURFACES wired live:
 *   - the editor field's over-allocation styling (row class + badge), projected
 *     against the store's committed allocation on other tasks,
 *   - the task-editor "Assigned resources" section (mounted + committed on Save
 *     when an `assignmentStore` is supplied),
 *   - the task-tree "Resources" column (auto-appended + rendered as live chips /
 *     accessible text from the AssignmentStore).
 *
 * `@jects/widgets` is mocked (as in task-editor.test.ts) so the editor compose +
 * commit path runs without the concurrently-evolving widgets build.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const formValues: Record<string, unknown> = {};

vi.mock('@jects/widgets', () => {
  class FakeWindow {
    el: HTMLElement;
    constructor(host: HTMLElement) {
      this.el = document.createElement('div');
      const body = document.createElement('div');
      body.className = 'jects-window__body';
      this.el.append(body);
      host.append(this.el);
    }
    on(): () => void {
      return () => {};
    }
    destroy(): void {
      this.el.remove();
    }
  }
  class FakeForm {
    el: HTMLElement;
    constructor(host: HTMLElement) {
      this.el = document.createElement('form');
      host.append(this.el);
    }
    getValue(): Record<string, unknown> {
      return formValues;
    }
    destroy(): void {
      this.el.remove();
    }
  }
  class FakeButton {
    el: HTMLButtonElement;
    constructor(host: HTMLElement, cfg: { text?: string }) {
      this.el = document.createElement('button');
      this.el.textContent = cfg.text ?? '';
      host.append(this.el);
    }
    on(evt: string, fn: () => void): () => void {
      this.el.addEventListener(evt, () => fn());
      return () => {};
    }
    destroy(): void {
      this.el.remove();
    }
  }
  return { Window: FakeWindow, Form: FakeForm, Button: FakeButton };
});

import { TreeStore } from '@jects/core';
import { AssignmentStore, type ResourceModel } from './resource-assignment.js';
import { ResourceAssignmentField } from './resource-assignment-field.js';
import { GanttTaskEditor } from './task-editor.js';
import { GanttTaskTree, DEFAULT_GANTT_COLUMNS } from './task-tree.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

const RES: ResourceModel[] = [
  { id: 'r1', name: 'Ada Lovelace', maxUnits: 100 },
  { id: 'r2', name: 'Grace Hopper', maxUnits: 100 },
  { id: 'r3', name: 'Alan Turing', maxUnits: 200 },
];

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  for (const k of Object.keys(formValues)) delete formValues[k];
});

afterEach(() => {
  host.remove();
});

/* ── over-allocation styling in the editor field ──────────────────────────── */

describe('ResourceAssignmentField — over-allocation styling', () => {
  it('marks a row over-allocated when the projected total exceeds capacity', () => {
    const store = new AssignmentStore({ resources: RES });
    // r1 already carries 60% on another task → assigning here at 100 = 160 > 100.
    store.assign('t-other', 'r1', 60);

    const field = new ResourceAssignmentField({ store, taskId: 't1' });
    host.append(field.el);

    const rows = field.el.querySelectorAll<HTMLElement>('.jects-gantt__assign-row');
    const r1Row = [...rows].find((r) => r.dataset.resourceId === 'r1')!;
    const check = r1Row.querySelector<HTMLInputElement>('.jects-gantt__assign-check')!;

    // Not yet assigned here → not over-allocated.
    expect(r1Row.classList.contains('jects-gantt__assign-row--over')).toBe(false);

    // Assign at the default 100% → 60 + 100 = 160 > 100 capacity → over.
    check.checked = true;
    check.dispatchEvent(new Event('change'));
    expect(field.isOverAllocated('r1')).toBe(true);
    expect(r1Row.classList.contains('jects-gantt__assign-row--over')).toBe(true);
    const badge = r1Row.querySelector<HTMLElement>('.jects-gantt__assign-over')!;
    expect(badge.hidden).toBe(false);
    expect(badge.title).toContain('160%');

    // Lower the units to 30% → 60 + 30 = 90 ≤ 100 → no longer over.
    const units = r1Row.querySelector<HTMLInputElement>('.jects-gantt__assign-units-input')!;
    units.value = '30';
    units.dispatchEvent(new Event('input'));
    expect(field.isOverAllocated('r1')).toBe(false);
    expect(r1Row.classList.contains('jects-gantt__assign-row--over')).toBe(false);
    expect(badge.hidden).toBe(true);

    field.destroy();
  });

  it('honors a higher maxUnits capacity (no over-allocation under it)', () => {
    const store = new AssignmentStore({ resources: RES });
    store.assign('t-other', 'r3', 150); // r3 capacity is 200
    const field = new ResourceAssignmentField({ store, taskId: 't1', defaultUnits: 40 });
    host.append(field.el);
    const r3Row = [...field.el.querySelectorAll<HTMLElement>('.jects-gantt__assign-row')].find(
      (r) => r.dataset.resourceId === 'r3',
    )!;
    r3Row.querySelector<HTMLInputElement>('.jects-gantt__assign-check')!.checked = true;
    r3Row.querySelector<HTMLInputElement>('.jects-gantt__assign-check')!.dispatchEvent(new Event('change'));
    // 150 + 40 = 190 ≤ 200 → not over.
    expect(field.isOverAllocated('r3')).toBe(false);
    field.destroy();
  });

  it('can be disabled via showOverAllocation:false (no badges rendered)', () => {
    const store = new AssignmentStore({ resources: RES });
    store.assign('t-other', 'r1', 90);
    const field = new ResourceAssignmentField({
      store,
      taskId: 't1',
      showOverAllocation: false,
    });
    host.append(field.el);
    expect(field.el.querySelector('.jects-gantt__assign-over')).toBeNull();
    field.destroy();
  });
});

/* ── task-editor "Assigned resources" section ─────────────────────────────── */

describe('GanttTaskEditor — assignment section', () => {
  it('renders the Assigned resources section when an assignmentStore is supplied', async () => {
    const store = new AssignmentStore({ resources: RES });
    store.assign('a', 'r2', 75);
    const editor = new GanttTaskEditor({ host, assignmentStore: store, onSave: () => {} });
    await editor.open({ id: 'a', name: 'Design' } as TaskModel);

    const section = host.querySelector('.jects-gantt__editor-section');
    expect(section).not.toBeNull();
    expect(section!.querySelector('.jects-gantt__editor-section-title')!.textContent).toBe(
      'Assigned resources',
    );
    const list = host.querySelector('.jects-gantt__assign-list')!;
    // The section heading names the field group.
    expect(list.getAttribute('aria-labelledby')).toBe('jects-gantt-assign-a');
    // r2 seeded as checked at 75%.
    const checks = host.querySelectorAll<HTMLInputElement>('.jects-gantt__assign-check');
    expect(checks[1]!.checked).toBe(true);
    editor.destroy();
  });

  it('commits the assignment draft to the store on Save', async () => {
    const store = new AssignmentStore({ resources: RES });
    const editor = new GanttTaskEditor({ host, assignmentStore: store, onSave: () => {} });
    await editor.open({ id: 'a', name: 'Design' } as TaskModel);

    // Assign r1 + r3 in the editor.
    const checks = host.querySelectorAll<HTMLInputElement>('.jects-gantt__assign-check');
    checks[0]!.checked = true;
    checks[0]!.dispatchEvent(new Event('change'));
    checks[2]!.checked = true;
    checks[2]!.dispatchEvent(new Event('change'));

    formValues.name = 'Design';
    const saveBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save')!;
    saveBtn.dispatchEvent(new MouseEvent('click'));

    expect(store.getResourcesForTask('a').map((r) => r.id)).toEqual(['r1', 'r3']);
    editor.destroy();
  });

  it('does not render the section when no assignmentStore is supplied', async () => {
    const editor = new GanttTaskEditor({ host, onSave: () => {} });
    await editor.open({ id: 'a', name: 'Design' } as TaskModel);
    expect(host.querySelector('.jects-gantt__editor-section')).toBeNull();
    expect(host.querySelector('.jects-gantt__assign-list')).toBeNull();
    editor.destroy();
  });
});

/* ── task-tree "Resources" column ─────────────────────────────────────────── */

function makeTaskStore(): TreeStore<TaskModel & { children?: TaskModel[] }> {
  return new TreeStore<TaskModel & { children?: TaskModel[] }>({
    data: [
      { id: 'a', name: 'Design', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY },
      { id: 'b', name: 'Build', start: T0 + 2 * DAY, duration: 2 * DAY, end: T0 + 4 * DAY },
    ],
  });
}

describe('GanttTaskTree — Resources column', () => {
  let tree: GanttTaskTree | null = null;
  afterEach(() => {
    tree?.destroy();
    tree = null;
  });

  it('auto-appends a Resources column and renders live assignment chips', () => {
    const store = new AssignmentStore({ resources: RES });
    store.assign('a', 'r1', 100);
    store.assign('a', 'r2', 50);

    tree = new GanttTaskTree({
      store: makeTaskStore(),
      assignmentStore: store,
      rowHeight: 28,
      headerHeight: 32,
      width: 480,
      predecessorsOf: () => '',
    });
    host.append(tree.el);

    // A "Resources" header was appended after the default columns.
    const headers = [...tree.el.querySelectorAll('.jects-gantt__tree-th')].map((h) => h.textContent);
    expect(headers).toContain('Resources');
    expect(headers.length).toBe(DEFAULT_GANTT_COLUMNS.length + 1);

    // Row 'a' shows two assignee chips; row 'b' shows none.
    const rowA = tree.el.querySelector<HTMLElement>('.jects-gantt__tree-row[data-task-id="a"]')!;
    expect(rowA.querySelectorAll('.jects-gantt__assignee').length).toBe(2);
    const rowB = tree.el.querySelector<HTMLElement>('.jects-gantt__tree-row[data-task-id="b"]')!;
    expect(rowB.querySelectorAll('.jects-gantt__assignee').length).toBe(0);

    // The chip group exposes the comma-joined assignee list as its accessible name.
    const group = rowA.querySelector('.jects-gantt__assignees')!;
    expect(group.getAttribute('aria-label')).toContain('Ada Lovelace');
  });

  it('reflects a later assign after refresh() (live)', () => {
    const store = new AssignmentStore({ resources: RES });
    tree = new GanttTaskTree({
      store: makeTaskStore(),
      assignmentStore: store,
      rowHeight: 28,
      headerHeight: 32,
      width: 480,
      predecessorsOf: () => '',
    });
    host.append(tree.el);

    let rowA = tree.el.querySelector<HTMLElement>('.jects-gantt__tree-row[data-task-id="a"]')!;
    expect(rowA.querySelectorAll('.jects-gantt__assignee').length).toBe(0);

    store.assign('a', 'r1', 100);
    tree.refresh();
    rowA = tree.el.querySelector<HTMLElement>('.jects-gantt__tree-row[data-task-id="a"]')!;
    expect(rowA.querySelectorAll('.jects-gantt__assignee').length).toBe(1);
  });

  it('omits the Resources column when no assignmentStore is supplied', () => {
    tree = new GanttTaskTree({
      store: makeTaskStore(),
      rowHeight: 28,
      headerHeight: 32,
      width: 480,
      predecessorsOf: () => '',
    });
    host.append(tree.el);
    const headers = [...tree.el.querySelectorAll('.jects-gantt__tree-th')].map((h) => h.textContent);
    expect(headers).not.toContain('Resources');
    expect(tree.el.querySelector('.jects-gantt__assignee')).toBeNull();
  });
});
