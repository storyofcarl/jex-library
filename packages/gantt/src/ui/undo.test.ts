/**
 * jsdom integration tests for the `GanttUndoRedo` (STM) feature against a real
 * `Gantt` + scheduling engine. Verifies that edits routed through the engine
 * pipeline are recorded, that undo/redo reverse/replay them through that SAME
 * pipeline (so dates stay consistent), that the toolbar reflects canUndo/canRedo,
 * and that destroy() restores the wrapped methods + leaks nothing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from './gantt.js';
import { GanttUndoRedo, createUndoRedo } from './undo.js';
import { ResourceManager } from '../resource/resource-manager.js';
import type { TaskModel, DependencyModel } from '../contract.js';
import type { ResourceModel } from '../resource/resource-contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

function tasks(): TaskModel[] {
  return [
    { id: 'a', name: 'Design', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY },
    { id: 'b', name: 'Build', start: T0 + 3 * DAY, duration: 3 * DAY, end: T0 + 6 * DAY, percentDone: 0.25 },
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

/** Install the Gantt with the STM feature; coalesceMs:0 commits each edit. */
function withStm(opts: { coalesceMs?: number; toolbar?: boolean } = {}): GanttUndoRedo {
  gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
  const feature = new GanttUndoRedo({ coalesceMs: opts.coalesceMs ?? 0, toolbar: opts.toolbar ?? true });
  gantt.use(feature);
  return feature;
}

describe('GanttUndoRedo — recording + undo/redo of span edits', () => {
  it('records a span change and undo restores the original span', () => {
    const stm = withStm();
    expect(stm.canUndo).toBe(false);

    const newSpan = { start: T0 + DAY, end: T0 + 4 * DAY };
    gantt!.updateTaskSpan('a', newSpan);
    expect(stm.canUndo).toBe(true);

    const moved = gantt!.getTask('a')!;
    expect(moved.start).toBe(newSpan.start);

    expect(stm.undo()).toBe(true);
    const restored = gantt!.getTask('a')!;
    expect(restored.start).toBe(T0);
    expect(stm.canUndo).toBe(false);
    expect(stm.canRedo).toBe(true);

    expect(stm.redo()).toBe(true);
    expect(gantt!.getTask('a')!.start).toBe(newSpan.start);
  });

  it('records a field edit and undo restores prior fields', () => {
    const stm = withStm();
    gantt!.updateTask('b', { name: 'Implement', percentDone: 0.9 });
    expect(gantt!.getTask('b')!.name).toBe('Implement');
    expect(gantt!.getTask('b')!.percentDone).toBe(0.9);

    stm.undo();
    expect(gantt!.getTask('b')!.name).toBe('Build');
    expect(gantt!.getTask('b')!.percentDone).toBe(0.25);
  });

  it('does NOT record the applier mutations during undo (no history corruption)', () => {
    const stm = withStm();
    gantt!.updateTaskSpan('a', { start: T0 + DAY, end: T0 + 4 * DAY });
    expect(stm.stm.undoCount).toBe(1);
    stm.undo();
    // After undo the redo stack holds the one tx; the undo stack is empty.
    expect(stm.stm.undoCount).toBe(0);
    expect(stm.stm.redoCount).toBe(1);
  });
});

describe('GanttUndoRedo — dependency edits', () => {
  it('records an added dependency and undo removes it', () => {
    const stm = withStm();
    const created = gantt!.addDependency({ fromId: 'a', toId: 'b', type: 'FS' });
    expect(created).toBeDefined();
    expect(gantt!.getDependenciesFor('b').length).toBe(1);

    stm.undo();
    expect(gantt!.getDependenciesFor('b').length).toBe(0);

    stm.redo();
    expect(gantt!.getDependenciesFor('b').length).toBe(1);
  });

  it('records a removed dependency and undo restores it with its id', () => {
    gantt = new Gantt(host, {
      tasks: tasks(),
      dependencies: [{ id: 'l1', fromId: 'a', toId: 'b', type: 'FS' } as DependencyModel],
      projectStart: T0,
    });
    const stm = createUndoRedo({ coalesceMs: 0 });
    gantt.use(stm);

    expect(gantt.getDependenciesFor('b').length).toBe(1);
    gantt.removeDependency('l1');
    expect(gantt.getDependenciesFor('b').length).toBe(0);

    stm.undo();
    expect(gantt.getDependenciesFor('b').some((d) => d.id === 'l1')).toBe(true);
  });
});

describe('GanttUndoRedo — explicit transactions', () => {
  it('groups multiple edits into one atomic undo unit', () => {
    const stm = withStm();
    stm.startTransaction('Save task');
    gantt!.updateTask('a', { name: 'Spec' });
    gantt!.updateTaskSpan('a', { start: T0 + DAY, end: T0 + 4 * DAY });
    stm.endTransaction();

    expect(stm.stm.undoCount).toBe(1);
    stm.undo();
    // Both reversed: name back to Design, start back to T0.
    expect(gantt!.getTask('a')!.name).toBe('Design');
    expect(gantt!.getTask('a')!.start).toBe(T0);
  });
});

describe('GanttUndoRedo — toolbar', () => {
  it('renders a token-pure toolbar with disabled buttons until an edit', () => {
    withStm({ toolbar: true });
    const bar = gantt!.el.querySelector('.jects-gantt__stm') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.getAttribute('role')).toBe('toolbar');

    const undoBtn = bar.querySelector('.jects-gantt__stm__undo') as HTMLButtonElement;
    const redoBtn = bar.querySelector('.jects-gantt__stm__redo') as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);

    gantt!.updateTaskSpan('a', { start: T0 + DAY, end: T0 + 4 * DAY });
    expect(undoBtn.disabled).toBe(false);
    expect(redoBtn.disabled).toBe(true);

    undoBtn.click();
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(false);
  });

  it('updates button tooltips with the next undo/redo title', () => {
    withStm({ toolbar: true });
    gantt!.updateTask('b', { name: 'X' });
    const undoBtn = gantt!.el.querySelector('.jects-gantt__stm__undo') as HTMLButtonElement;
    expect(undoBtn.title).toContain('Edit task');
  });
});

describe('GanttUndoRedo — keyboard shortcuts', () => {
  it('Ctrl+Z undoes and Ctrl+Shift+Z redoes', () => {
    const stm = withStm();
    gantt!.updateTaskSpan('a', { start: T0 + DAY, end: T0 + 4 * DAY });
    expect(gantt!.getTask('a')!.start).toBe(T0 + DAY);

    gantt!.el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
    );
    expect(gantt!.getTask('a')!.start).toBe(T0);

    gantt!.el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    expect(gantt!.getTask('a')!.start).toBe(T0 + DAY);
    void stm;
  });
});

describe('GanttUndoRedo — stmChange event mirrored on the Gantt', () => {
  it('emits stmChange with availability on every history change', () => {
    const stm = withStm();
    const payloads: Array<{ canUndo: boolean; canRedo: boolean }> = [];
    (gantt as unknown as { on(e: string, fn: (p: { canUndo: boolean; canRedo: boolean }) => void): () => void }).on(
      'stmChange',
      (p) => payloads.push(p),
    );
    gantt!.updateTaskSpan('a', { start: T0 + DAY, end: T0 + 4 * DAY });
    expect(payloads.at(-1)).toMatchObject({ canUndo: true, canRedo: false });
    void stm;
  });
});

describe('GanttUndoRedo — lifecycle', () => {
  it('restores the wrapped mutation methods + removes the toolbar on destroy', () => {
    const stm = withStm({ toolbar: true });
    const original = (gantt as unknown as Record<string, unknown>).updateTaskSpan;
    stm.destroy();
    expect(gantt!.el.querySelector('.jects-gantt__stm')).toBeNull();
    // The wrapper was replaced by the original bound method (different ref ok,
    // but it must still work + no longer record onto the destroyed STM).
    expect((gantt as unknown as Record<string, unknown>).updateTaskSpan).not.toBe(original);
    gantt!.updateTaskSpan('a', { start: T0 + DAY, end: T0 + 4 * DAY });
    expect(stm.canUndo).toBe(false);
  });

  it('is removable via removeFeature without throwing', () => {
    withStm();
    expect(() => gantt!.removeFeature('undoRedo')).not.toThrow();
  });
});

/* ── resource assignment undo/redo (ResourceManager-routed) ────────────────── */

const RESOURCES: ResourceModel[] = [
  { id: 'r1', name: 'Ada', capacity: 1 },
  { id: 'r2', name: 'Grace', capacity: 1 },
];

/**
 * Gantt + an explicitly-installed `ResourceManager`, then the STM installed AFTER
 * (so the STM wraps the already-present manager synchronously). Returns both.
 */
function withResourcesAndStm(): { stm: GanttUndoRedo; mgr: ResourceManager } {
  gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
  const mgr = new ResourceManager({ resources: RESOURCES });
  gantt.use(mgr);
  const stm = new GanttUndoRedo({ coalesceMs: 0 });
  gantt.use(stm);
  return { stm, mgr };
}

/** Resource ids the AssignmentStore holds for a task (the store's truth). */
function storeResourceIds(mgr: ResourceManager, taskId: string): string[] {
  return mgr.assignmentStore.resourceIdsOf(taskId).map(String);
}

describe('GanttUndoRedo — resource assignment recording', () => {
  it('records an assign and undo unassigns via the ResourceManager (store + field stay consistent)', () => {
    const { stm, mgr } = withResourcesAndStm();

    expect(stm.canUndo).toBe(false);
    mgr.assign('a', 'r1', 100);
    expect(stm.canUndo).toBe(true);

    // Both the store AND the mirrored task field agree the resource is assigned.
    expect(storeResourceIds(mgr, 'a')).toEqual(['r1']);
    expect(gantt!.getTask('a')!.resourceIds).toEqual(['r1']);
    expect(mgr.getAssignmentsFor('a').map((r) => r.assignment.resourceId)).toEqual(['r1']);

    // Undo: the AssignmentStore is emptied (NOT just the task field) — the bug was
    // that the store still returned the resource after undo.
    expect(stm.undo()).toBe(true);
    expect(storeResourceIds(mgr, 'a')).toEqual([]);
    expect(gantt!.getTask('a')!.resourceIds ?? []).toEqual([]);
    expect(mgr.getAssignmentsFor('a').length).toBe(0);

    // Redo: assignment is restored consistently in both places.
    expect(stm.redo()).toBe(true);
    expect(storeResourceIds(mgr, 'a')).toEqual(['r1']);
    expect(gantt!.getTask('a')!.resourceIds).toEqual(['r1']);
  });

  it('records an unassign and undo re-assigns via the ResourceManager', () => {
    const { stm, mgr } = withResourcesAndStm();
    // Seed an assignment WITHOUT recording it (silent) so the first undoable
    // action is the unassign.
    mgr.assignmentStore.assign('a', 'r2', 100);
    gantt!.updateTask('a', { resourceIds: ['r2'] });
    stm.clear();

    expect(mgr.unassign('a', 'r2')).toBe(true);
    expect(storeResourceIds(mgr, 'a')).toEqual([]);

    stm.undo();
    // Re-assigned: store AND field carry r2 again.
    expect(storeResourceIds(mgr, 'a')).toEqual(['r2']);
    expect(gantt!.getTask('a')!.resourceIds).toEqual(['r2']);

    stm.redo();
    expect(storeResourceIds(mgr, 'a')).toEqual([]);
  });

  it('records ONE undo step per assign (no duplicate taskUpdate from resourceIds sync)', () => {
    const { stm, mgr } = withResourcesAndStm();
    mgr.assign('a', 'r1', 100);
    // A single assign must produce exactly one undoable transaction, not two
    // (assignmentAdd + a resourceIds taskUpdate).
    expect(stm.stm.undoCount).toBe(1);

    // One undo fully reverses it; nothing remains.
    stm.undo();
    expect(stm.stm.undoCount).toBe(0);
    expect(storeResourceIds(mgr, 'a')).toEqual([]);
  });

  it('groups assign + field edit into one transaction and undoes both', () => {
    const { stm, mgr } = withResourcesAndStm();
    stm.startTransaction('Staff task');
    gantt!.updateTask('a', { name: 'Spec' });
    mgr.assign('a', 'r1', 100);
    stm.endTransaction();

    expect(stm.stm.undoCount).toBe(1);
    stm.undo();
    expect(gantt!.getTask('a')!.name).toBe('Design');
    expect(storeResourceIds(mgr, 'a')).toEqual([]);
  });

  it('restores the ResourceManager assign/unassign on destroy (no recording after)', () => {
    const { stm, mgr } = withResourcesAndStm();
    stm.destroy();
    // The manager still works, but assigning no longer records onto the dead STM.
    mgr.assign('a', 'r1', 100);
    expect(stm.canUndo).toBe(false);
    expect(storeResourceIds(mgr, 'a')).toEqual(['r1']);
  });

  it('wraps a ResourceManager auto-installed AFTER the STM plugin (deferred)', async () => {
    // Both passed via options: the STM plugin installs first, the resource layer
    // is auto-installed afterwards, so the STM wraps it on the next tick.
    gantt = new Gantt(host, {
      tasks: tasks(),
      projectStart: T0,
      resources: RESOURCES,
      plugins: [new GanttUndoRedo({ coalesceMs: 0 })],
    } as never);
    const stm = gantt.features.get('undoRedo') as GanttUndoRedo;
    const mgr = gantt.features.get('resourceManager') as unknown as ResourceManager;
    // Let the deferred wrap run.
    await new Promise<void>((r) => setTimeout(r, 0));

    mgr.assign('a', 'r1', 100);
    expect(stm.canUndo).toBe(true);
    stm.undo();
    expect(storeResourceIds(mgr, 'a')).toEqual([]);
  });
});
