/**
 * jsdom unit tests for {@link GanttTabbedTaskEditorFeature} — the additive
 * `GanttFeature` that wires the (previously orphaned) multi-tab task editor +
 * effort panel into a live `Gantt`.
 *
 * Covers:
 *   - install via `gantt.use(...)` registers under `features`,
 *   - the capture-phase double-click swap opens the TABBED editor (General +
 *     Resources tabs) instead of the built-in single-form editor,
 *   - editing the General tab + Save routes the patch THROUGH `gantt.updateTask`
 *     (engine re-propagates) and mirrors resource ids onto the task,
 *   - the Resources tab commits its draft to the AssignmentStore on Save,
 *   - the explicit `editTask()` path with `interceptDoubleClick:false`,
 *   - `destroy()` removes the listener + dialog (leak-free).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isRegistered } from '@jects/core';
import { Gantt } from './gantt.js';
import {
  GanttTabbedTaskEditorFeature,
  createTabbedTaskEditor,
  TABBED_TASK_EDITOR_FEATURE,
  GanttTabbedTaskEditor,
  EffortPanel,
} from './tabbed-task-editor-feature.js';
import { AssignmentStore, type ResourceModel } from './resource-assignment.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

const RESOURCES: ResourceModel[] = [
  { id: 'r1', name: 'Ada Lovelace' },
  { id: 'r2', name: 'Grace Hopper' },
];

function tasks(): TaskModel[] {
  return [
    { id: 'a', name: 'Design', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY, percentDone: 0.4 },
    { id: 'b', name: 'Build', start: T0 + 3 * DAY, duration: 2 * DAY, end: T0 + 5 * DAY },
  ];
}

let host: HTMLElement;
let gantt: Gantt | null = null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
  // Tear down any leaked dialog.
  document.querySelectorAll('.jects-gantt__task-editor').forEach((n) => n.remove());
});

/** Double-click the task-`a` bar in the timeline. */
function dblClickBar(g: Gantt, taskId: string): HTMLElement {
  const bar = g.el.querySelector(
    `.jects-gantt__bar[data-task-id="${taskId}"]`,
  ) as HTMLElement | null;
  expect(bar, `bar for ${taskId}`).not.toBeNull();
  bar!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  return bar!;
}

describe('GanttTabbedTaskEditorFeature', () => {
  it('re-exports the previously orphaned controls', () => {
    expect(typeof GanttTabbedTaskEditor).toBe('function');
    expect(typeof EffortPanel).toBe('function');
    // EffortPanel still self-registers with the factory on import.
    expect(isRegistered('effortPanel')).toBe(true);
  });

  it('installs as a GanttFeature and exposes its store', () => {
    const store = new AssignmentStore({ resources: RESOURCES });
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = gantt.use(new GanttTabbedTaskEditorFeature({ assignmentStore: store }));
    expect(feat.name).toBe(TABBED_TASK_EDITOR_FEATURE);
    expect(gantt.features.get(TABBED_TASK_EDITOR_FEATURE)).toBe(feat);
    expect((feat as GanttTabbedTaskEditorFeature).assignmentStore).toBe(store);
  });

  it('double-click opens the TABBED editor (with General + Resources tabs), not the single-form one', () => {
    const store = new AssignmentStore({ resources: RESOURCES });
    gantt = new Gantt(host, {
      tasks: tasks(),
      projectStart: T0,
      plugins: [new GanttTabbedTaskEditorFeature({ assignmentStore: store })],
    });

    dblClickBar(gantt, 'a');

    const dialog = document.querySelector('.jects-gantt__task-editor');
    expect(dialog).not.toBeNull();
    // The built-in single-form editor uses a Window (.jects-window) — it must NOT
    // have opened (suppressed by the capture-phase swap).
    expect(document.querySelector('.jects-window')).toBeNull();
    // Tabs present: General + Resources.
    const tabLabels = [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabLabels).toEqual(['General', 'Resources']);
  });

  it('routes a General-tab Save through the engine + mirrors resource ids', () => {
    const store = new AssignmentStore({ resources: RESOURCES });
    store.assign('a', 'r1', 100);
    gantt = new Gantt(host, {
      tasks: tasks(),
      projectStart: T0,
      plugins: [new GanttTabbedTaskEditorFeature({ assignmentStore: store })],
    });

    dblClickBar(gantt, 'a');

    // Edit the name on the General tab.
    const nameInput = document.querySelector(
      '#jects-gantt-te-field-name',
    ) as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    nameInput.value = 'Design v2';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Save.
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save')!.click();

    // Engine-routed update landed on the model.
    expect(gantt.getTask('a')!.name).toBe('Design v2');
    // r1 (already assigned in the store) mirrored onto the task.
    expect(gantt.getTask('a')!.resourceIds).toEqual(['r1']);
    // Dialog closed.
    expect(document.querySelector('.jects-gantt__task-editor')).toBeNull();
  });

  it('commits a Resources-tab assignment to the store on Save', () => {
    const store = new AssignmentStore({ resources: RESOURCES });
    let savedTaskId: string | number | null = null;
    gantt = new Gantt(host, {
      tasks: tasks(),
      projectStart: T0,
      plugins: [
        new GanttTabbedTaskEditorFeature({
          assignmentStore: store,
          onSave: (id) => {
            savedTaskId = id as string;
          },
        }),
      ],
    });

    dblClickBar(gantt, 'a');

    // Check r2 in the Resources tab (the rows render for every store resource).
    const r2Check = document.querySelector(
      '.jects-gantt__assign-row[data-resource-id="r2"] .jects-gantt__assign-check',
    ) as HTMLInputElement;
    expect(r2Check).not.toBeNull();
    r2Check.checked = true;
    r2Check.dispatchEvent(new Event('change', { bubbles: true }));

    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save')!.click();

    expect(store.isAssigned('a', 'r2')).toBe(true);
    expect(savedTaskId).toBe('a');
  });

  it('auto-creates a store seeded from resources when none is supplied', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = gantt.use(
      createTabbedTaskEditor({ resources: RESOURCES }),
    ) as GanttTabbedTaskEditorFeature;
    expect(feat.assignmentStore).toBeInstanceOf(AssignmentStore);
    dblClickBar(gantt, 'a');
    // The auto-store's resources surface as rows on the Resources tab.
    expect(
      document.querySelectorAll('.jects-gantt__assign-row').length,
    ).toBe(RESOURCES.length);
  });

  it('hideResourcesTab degrades to a General-only editor', () => {
    gantt = new Gantt(host, {
      tasks: tasks(),
      projectStart: T0,
      plugins: [new GanttTabbedTaskEditorFeature({ hideResourcesTab: true })],
    });
    dblClickBar(gantt, 'a');
    const tabLabels = [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabLabels).toEqual(['General']);
  });

  it('interceptDoubleClick:false leaves the built-in editor and exposes editTask()', () => {
    const store = new AssignmentStore({ resources: RESOURCES });
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = gantt.use(
      new GanttTabbedTaskEditorFeature({ assignmentStore: store, interceptDoubleClick: false }),
    ) as GanttTabbedTaskEditorFeature;

    // No interceptor: a double-click does NOT open the tabbed editor.
    dblClickBar(gantt, 'a');
    expect(document.querySelector('.jects-gantt__task-editor')).toBeNull();

    // The explicit API opens it.
    feat.editTask('a');
    expect(feat.isOpen).toBe(true);
    expect(document.querySelector('.jects-gantt__task-editor')).not.toBeNull();
    feat.close();
    expect(feat.isOpen).toBe(false);
  });

  it('destroy() removes the dialog + interceptor (no leaks)', () => {
    const store = new AssignmentStore({ resources: RESOURCES });
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feat = gantt.use(
      new GanttTabbedTaskEditorFeature({ assignmentStore: store }),
    ) as GanttTabbedTaskEditorFeature;

    dblClickBar(gantt, 'a');
    expect(document.querySelector('.jects-gantt__task-editor')).not.toBeNull();

    feat.destroy();
    expect(document.querySelector('.jects-gantt__task-editor')).toBeNull();
    expect(feat.assignmentStore).toBeNull();

    // After destroy the interceptor is gone: a fresh double-click opens nothing.
    dblClickBar(gantt, 'a');
    expect(document.querySelector('.jects-gantt__task-editor')).toBeNull();
  });
});
