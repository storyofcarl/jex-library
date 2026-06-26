/**
 * jsdom unit tests for the dependency drawing / editing UI (`dependenciesEditable`).
 *
 * Covers the pure type inference, the store guards (self / duplicate / cycle),
 * and — wired through a real `Scheduler` — terminal rendering, programmatic
 * link creation with veto + emit, dependency-line `data-dep-id` tagging, and
 * select + delete (vetoable).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HOUR_AND_DAY } from '@jects/timeline-core';
import { Scheduler } from './scheduler.js';
import { inferDependencyType } from './dependency-edit.js';
import {
  createDependencyStore,
  hasDependency,
  wouldCreateCycle,
} from '../stores/dependency-store.js';
import type { ResourceModel, EventModel, DependencyModel } from '../contract.js';

const DAY = 86_400_000;
const start = Date.UTC(2025, 0, 1);

function resources(): ResourceModel[] {
  return [
    { id: 'r1', name: 'Alice' },
    { id: 'r2', name: 'Bob' },
  ];
}
function events(): EventModel[] {
  return [
    { id: 'e1', resourceId: 'r1', name: 'Task A', startDate: start, endDate: start + DAY },
    { id: 'e2', resourceId: 'r2', name: 'Task B', startDate: start + DAY, endDate: start + DAY * 2 },
  ];
}

describe('inferDependencyType', () => {
  it('infers FS/SS/FF/SF from the grabbed terminals', () => {
    expect(inferDependencyType('end', 'start')).toBe('FS');
    expect(inferDependencyType('start', 'start')).toBe('SS');
    expect(inferDependencyType('end', 'end')).toBe('FF');
    expect(inferDependencyType('start', 'end')).toBe('SF');
  });
});

describe('dependency store guards', () => {
  it('detects duplicate links (order + type sensitive)', () => {
    const store = createDependencyStore([{ id: 'd1', fromId: 'a', toId: 'b', type: 'FS' }]);
    expect(hasDependency(store, 'a', 'b', 'FS')).toBe(true);
    expect(hasDependency(store, 'a', 'b', 'SS')).toBe(false);
    expect(hasDependency(store, 'b', 'a', 'FS')).toBe(false);
  });

  it('detects cycles (self-link + transitive)', () => {
    const store = createDependencyStore([
      { id: 'd1', fromId: 'a', toId: 'b' },
      { id: 'd2', fromId: 'b', toId: 'c' },
    ]);
    expect(wouldCreateCycle(store, 'a', 'a')).toBe(true); // self
    expect(wouldCreateCycle(store, 'c', 'a')).toBe(true); // closes a→b→c→a
    expect(wouldCreateCycle(store, 'a', 'c')).toBe(false); // forward edge ok
  });
});

describe('Scheduler dependency editing', () => {
  let host: HTMLElement;
  let sched: Scheduler | undefined;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    sched?.destroy();
    sched = undefined;
    host.remove();
  });

  function make(extra: Record<string, unknown> = {}): Scheduler {
    sched = new Scheduler(host, {
      resources: resources(),
      events: events(),
      preset: HOUR_AND_DAY,
      range: { start: start - DAY, end: start + DAY * 5 },
      dependenciesEditable: true,
      ...extra,
    });
    return sched;
  }

  it('exposes a dependency editor + store only when editable', () => {
    const s = make();
    expect(s.getDependencyEditor()).not.toBeNull();
    expect(s.getDependencyStore()).toBeTruthy();
    expect(s.el.classList.contains('jects-scheduler--deps-editable')).toBe(true);

    const s2 = new Scheduler(document.createElement('div'), {
      resources: resources(),
      events: events(),
      preset: HOUR_AND_DAY,
      range: { start, end: start + DAY * 5 },
    });
    expect(s2.getDependencyEditor()).toBeNull();
    s2.destroy();
  });

  it('renders hover terminals at a bar start + end', () => {
    const s = make();
    s.getDependencyEditor()!.showTerminalsFor('e1');
    const terminals = s.el.querySelectorAll('.jects-scheduler__terminal');
    expect(terminals.length).toBe(2);
    const sides = Array.from(terminals).map((t) => (t as HTMLElement).dataset.side).sort();
    expect(sides).toEqual(['end', 'start']);
  });

  it('creates a dependency via the editor with type inference + veto + emit', () => {
    const s = make();
    const editor = s.getDependencyEditor()!;
    let beforePayload: Omit<DependencyModel, 'id'> | undefined;
    let created: DependencyModel | undefined;
    s.on('beforeDependencyCreate', ({ dependency }) => {
      beforePayload = dependency;
    });
    s.on('dependencyCreate', ({ dependency }) => {
      created = dependency;
    });

    const e1 = s.getEventStore().getById('e1')!;
    const e2 = s.getEventStore().getById('e2')!;
    const bars = (editor as unknown as { host: { visibleBars: Map<unknown, unknown> } }).host;
    // Drag from e1 'end' to e2 'start' → FS.
    const fromBar = bars.visibleBars.get('e1') as never;
    const toBar = bars.visibleBars.get('e2') as never;
    const result = editor.createDependency(
      { barId: e1.id, side: 'end', bar: fromBar },
      { barId: e2.id, side: 'start', bar: toBar },
    );

    expect(result).toBeDefined();
    expect(result!.type).toBe('FS');
    expect(beforePayload).toEqual({ fromId: 'e1', toId: 'e2', type: 'FS' });
    expect(created?.fromId).toBe('e1');
    expect(s.getDependencyStore().count).toBe(1);
    // The line is painted with a data-dep-id.
    const line = s.el.querySelector('.jects-scheduler__dep-line') as SVGPathElement;
    expect(line).toBeTruthy();
    expect(line.dataset.depId).toBe(result!.id);
  });

  it('honours a beforeDependencyCreate veto', () => {
    const s = make();
    const editor = s.getDependencyEditor()!;
    s.on('beforeDependencyCreate', () => false);
    const bars = (editor as unknown as { host: { visibleBars: Map<unknown, unknown> } }).host;
    const result = editor.createDependency(
      { barId: 'e1', side: 'end', bar: bars.visibleBars.get('e1') as never },
      { barId: 'e2', side: 'start', bar: bars.visibleBars.get('e2') as never },
    );
    expect(result).toBeUndefined();
    expect(s.getDependencyStore().count).toBe(0);
  });

  it('refuses self, duplicate, and cyclic links', () => {
    const s = make();
    const editor = s.getDependencyEditor()!;
    const bars = (editor as unknown as { host: { visibleBars: Map<unknown, unknown> } }).host;
    const b1 = bars.visibleBars.get('e1') as never;
    const b2 = bars.visibleBars.get('e2') as never;
    // self
    expect(editor.createDependency({ barId: 'e1', side: 'end', bar: b1 }, { barId: 'e1', side: 'start', bar: b1 })).toBeUndefined();
    // first link ok
    expect(editor.createDependency({ barId: 'e1', side: 'end', bar: b1 }, { barId: 'e2', side: 'start', bar: b2 })).toBeDefined();
    // duplicate
    expect(editor.createDependency({ barId: 'e1', side: 'end', bar: b1 }, { barId: 'e2', side: 'start', bar: b2 })).toBeUndefined();
    // cycle (e2 → e1 closes e1→e2→e1)
    expect(editor.createDependency({ barId: 'e2', side: 'end', bar: b2 }, { barId: 'e1', side: 'start', bar: b1 })).toBeUndefined();
    expect(s.getDependencyStore().count).toBe(1);
  });

  it('selects + deletes a dependency line (vetoable)', () => {
    const s = make({ dependencies: [{ id: 'd1', fromId: 'e1', toId: 'e2', type: 'FS' }] });
    const editor = s.getDependencyEditor()!;
    expect(s.getDependencyStore().count).toBe(1);

    editor.select('d1');
    expect(editor.selectedDependencyId).toBe('d1');
    const line = s.el.querySelector('.jects-scheduler__dep-line') as SVGPathElement;
    expect(line.classList.contains('jects-scheduler__dep-line--selected')).toBe(true);

    // Veto blocks deletion.
    const off = s.on('beforeDependencyDelete', () => false);
    expect(editor.deleteSelected()).toBe(false);
    expect(s.getDependencyStore().count).toBe(1);
    off();

    let deleted: DependencyModel | undefined;
    s.on('dependencyDelete', ({ dependency }) => {
      deleted = dependency;
    });
    expect(editor.deleteSelected()).toBe(true);
    expect(deleted?.id).toBe('d1');
    expect(s.getDependencyStore().count).toBe(0);
    expect(s.el.querySelector('.jects-scheduler__dep-line')).toBeNull();
  });

  it('repaints dependency lines reactively when the store changes', () => {
    const s = make();
    expect(s.el.querySelectorAll('.jects-scheduler__dep-line').length).toBe(0);
    s.getDependencyStore().add({ id: 'd9', fromId: 'e1', toId: 'e2', type: 'SS' });
    expect(s.el.querySelectorAll('.jects-scheduler__dep-line').length).toBe(1);
  });

  it('tears down the editor cleanly on destroy', () => {
    const s = make();
    s.getDependencyEditor()!.showTerminalsFor('e1');
    expect(s.el.querySelectorAll('.jects-scheduler__terminal').length).toBe(2);
    s.destroy();
    expect(s.isDestroyed).toBe(true);
    expect(s.getDependencyEditor()).toBeNull();
  });
});
