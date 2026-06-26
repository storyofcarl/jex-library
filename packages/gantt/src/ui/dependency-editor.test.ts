/**
 * jsdom unit tests for the editable Predecessors/Successors columns + inline
 * dependency editor. Drives a real `Gantt` so the edits flow through the actual
 * `GanttApi.addDependency` / `removeDependency` engine seam, asserting:
 *   - notation reads (predecessors AND successors),
 *   - typing notation creates/removes links (re-propagating the schedule),
 *   - cycle rejection surfaces an inline error and the editor stays open,
 *   - the editor keyboard model (Enter commits, Escape cancels),
 *   - leak-free destroy through the feature lifecycle.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from './gantt.js';
import type { TaskModel } from '../contract.js';
import {
  GanttDependencyColumns,
  DependencyCellEditor,
  applyNotation,
  notationFor,
  orientedLinksFor,
  sideForField,
  buildRefResolver,
  PREDECESSORS_COLUMN_FIELD,
  SUCCESSORS_COLUMN_FIELD,
} from './dependency-editor.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

function tasks(): TaskModel[] {
  return [
    { id: 'a', name: 'A', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY },
    { id: 'b', name: 'B', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY },
    { id: 'c', name: 'C', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY },
  ];
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

function makeGantt(): Gantt {
  return new Gantt(host, { tasks: tasks(), projectStart: T0 });
}

describe('orientedLinksFor / notationFor', () => {
  it('reads predecessors and successors from opposite ends of a link', () => {
    gantt = new Gantt(host, {
      tasks: tasks(),
      dependencies: [{ id: 'l1', fromId: 'a', toId: 'b', type: 'FS', lag: DAY }],
      projectStart: T0,
    });
    // b's predecessor is a.
    expect(orientedLinksFor(gantt, 'b', 'predecessors').map((l) => l.ref)).toEqual(['a']);
    expect(notationFor(gantt, 'b', 'predecessors')).toBe('a+1d');
    // a's successor is b.
    expect(orientedLinksFor(gantt, 'a', 'successors').map((l) => l.ref)).toEqual(['b']);
    expect(notationFor(gantt, 'a', 'successors')).toBe('b+1d');
  });
});

describe('applyNotation', () => {
  it('creates a predecessor link by typing notation and re-propagates', () => {
    gantt = makeGantt();
    const r = applyNotation(gantt, 'b', 'predecessors', 'a');
    expect(r.ok).toBe(true);
    expect(r.added).toBe(1);
    expect(gantt.getDependenciesFor('b').length).toBe(1);
    // FS link drove B to start at A's finish.
    expect(gantt.getTask('b')!.start).toBe(gantt.getTask('a')!.end);
  });

  it('creates a successor link (oriented the other way)', () => {
    gantt = makeGantt();
    const r = applyNotation(gantt, 'a', 'successors', 'b, c');
    expect(r.ok).toBe(true);
    expect(r.added).toBe(2);
    // a is the predecessor of both.
    expect(orientedLinksFor(gantt, 'a', 'successors').map((l) => l.ref).sort()).toEqual([
      'b',
      'c',
    ]);
  });

  it('removes a link when its term is deleted from the cell', () => {
    gantt = new Gantt(host, {
      tasks: tasks(),
      dependencies: [
        { id: 'l1', fromId: 'a', toId: 'c', type: 'FS' },
        { id: 'l2', fromId: 'b', toId: 'c', type: 'FS' },
      ],
      projectStart: T0,
    });
    expect(gantt.getDependenciesFor('c').length).toBe(2);
    // Keep only a; drop b.
    const r = applyNotation(gantt, 'c', 'predecessors', 'a');
    expect(r.removed).toBe(1);
    expect(orientedLinksFor(gantt, 'c', 'predecessors').map((l) => l.ref)).toEqual(['a']);
  });

  it('replaces a link on a lag change (remove + add)', () => {
    gantt = new Gantt(host, {
      tasks: tasks(),
      dependencies: [{ id: 'l1', fromId: 'a', toId: 'b', type: 'FS', lag: 0 }],
      projectStart: T0,
    });
    const r = applyNotation(gantt, 'b', 'predecessors', 'a+2d');
    expect(r.ok).toBe(true);
    expect(r.added).toBe(1);
    expect(r.removed).toBe(1);
    expect(orientedLinksFor(gantt, 'b', 'predecessors')[0]!.lag).toBe(2 * DAY);
  });

  it('rejects a cycle and reports the rejection without stranding the prior link', () => {
    gantt = new Gantt(host, {
      tasks: tasks(),
      dependencies: [{ id: 'l1', fromId: 'a', toId: 'b', type: 'FS' }],
      projectStart: T0,
    });
    // a already -> b. Adding a as a successor-of-b (b -> a) would create a cycle.
    const r = applyNotation(gantt, 'b', 'successors', 'a');
    expect(r.ok).toBe(false);
    expect(r.added).toBe(0);
    expect(r.errors.join(' ')).toMatch(/cycle|rejected|vetoed/i);
    // The original a->b link is intact.
    expect(orientedLinksFor(gantt, 'b', 'predecessors').map((l) => l.ref)).toEqual(['a']);
  });

  it('reports an unknown task ref via resolveRef', () => {
    gantt = makeGantt();
    const r = applyNotation(gantt, 'b', 'predecessors', 'zzz', {
      resolveRef: () => undefined,
    });
    expect(r.ok).toBe(false);
    expect(r.added).toBe(0);
    expect(r.errors[0]).toMatch(/Unknown task/i);
  });
});

describe('DependencyCellEditor', () => {
  it('commits on Enter and applies the notation', () => {
    gantt = makeGantt();
    let committed = false;
    const editor = new DependencyCellEditor({
      api: gantt,
      taskId: 'b',
      side: 'predecessors',
      onCommit: (res) => {
        if (res.ok) committed = true;
      },
    });
    host.appendChild(editor.el);
    editor.input.value = 'a';
    editor.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(committed).toBe(true);
    expect(gantt.getDependenciesFor('b').length).toBe(1);
    editor.destroy();
  });

  it('shows an inline error and stays open when the engine rejects a cycle', () => {
    gantt = new Gantt(host, {
      tasks: tasks(),
      dependencies: [{ id: 'l1', fromId: 'a', toId: 'b', type: 'FS' }],
      projectStart: T0,
    });
    const editor = new DependencyCellEditor({
      api: gantt,
      taskId: 'b',
      side: 'successors',
    });
    host.appendChild(editor.el);
    editor.input.value = 'a'; // b -> a would cycle
    const res = editor.commit();
    expect(res.ok).toBe(false);
    const errorEl = editor.el.querySelector('.jects-gantt-dep-editor__error')!;
    expect(errorEl.textContent).toMatch(/cycle|rejected|vetoed/i);
    expect(editor.input.getAttribute('aria-invalid')).toBe('true');
    // Editor is still in the DOM (not torn down) so the user can fix it.
    expect(editor.el.isConnected).toBe(true);
    editor.destroy();
  });

  it('cancels on Escape without applying', () => {
    gantt = makeGantt();
    let cancelled = false;
    const editor = new DependencyCellEditor({
      api: gantt,
      taskId: 'b',
      side: 'predecessors',
      onCancel: () => {
        cancelled = true;
      },
    });
    host.appendChild(editor.el);
    editor.input.value = 'a';
    editor.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancelled).toBe(true);
    expect(gantt.getDependenciesFor('b').length).toBe(0);
    editor.destroy();
  });

  it('exposes accessible name, describedby, and an alert region', () => {
    gantt = makeGantt();
    const editor = new DependencyCellEditor({
      api: gantt,
      taskId: 'b',
      side: 'predecessors',
    });
    host.appendChild(editor.el);
    expect(editor.input.getAttribute('aria-label')).toBeTruthy();
    const describedBy = editor.input.getAttribute('aria-describedby')!;
    expect(editor.el.querySelector(`[id="${describedBy}"]`)).not.toBeNull();
    const alert = editor.el.querySelector('[role="alert"]')!;
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    editor.destroy();
  });
});

describe('GanttDependencyColumns feature', () => {
  it('installs, contributes two editable columns, and reads notation', () => {
    gantt = new Gantt(host, {
      tasks: tasks(),
      dependencies: [{ id: 'l1', fromId: 'a', toId: 'b', type: 'SS', lag: DAY }],
      projectStart: T0,
    });
    const feature = new GanttDependencyColumns();
    gantt.use(feature);
    const cols = feature.columns();
    expect(cols.map((c) => c.field)).toEqual([
      PREDECESSORS_COLUMN_FIELD,
      SUCCESSORS_COLUMN_FIELD,
    ]);
    expect(cols.every((c) => c.editable)).toBe(true);
    expect(feature.notation('b', 'predecessors')).toBe('aSS+1d');
    expect(feature.notation('a', 'successors')).toBe('bSS+1d');
  });

  it('opens an editor that tears down on successful commit', () => {
    gantt = makeGantt();
    const feature = new GanttDependencyColumns();
    gantt.use(feature);
    const editor = feature.openEditor('b', 'predecessors');
    host.appendChild(editor.el);
    editor.input.value = 'a';
    const res = editor.commit();
    expect(res.ok).toBe(true);
    expect(editor.el.isConnected).toBe(false); // disposed
    expect(gantt.getDependenciesFor('b').length).toBe(1);
  });

  it('disposes open editors when the Gantt is destroyed (leak-free)', () => {
    gantt = makeGantt();
    const feature = new GanttDependencyColumns();
    gantt.use(feature);
    const editor = feature.openEditor('b', 'predecessors');
    host.appendChild(editor.el);
    gantt.destroy();
    gantt = null;
    expect(editor.el.isConnected).toBe(false);
  });
});

describe('helpers', () => {
  it('maps column fields to sides', () => {
    expect(sideForField(PREDECESSORS_COLUMN_FIELD)).toBe('predecessors');
    expect(sideForField(SUCCESSORS_COLUMN_FIELD)).toBe('successors');
    expect(sideForField('name')).toBeNull();
  });

  it('buildRefResolver resolves by id and by name', () => {
    const { resolveRef, refToToken } = buildRefResolver(tasks());
    expect(resolveRef('a')).toBe('a');
    expect(resolveRef('B')).toBe('b'); // by name, case-insensitive
    expect(resolveRef('nope')).toBeUndefined();
    expect(refToToken('c')).toBe('c');
  });
});
