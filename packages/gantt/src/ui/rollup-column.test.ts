/**
 * jsdom unit tests for the **task-tree 'rollup' data column** (Bryntum/DHTMLX
 * column-type parity). Covers the pure resolvers/aggregations, the formatter, the
 * DOM checkbox cell + its toggle, and the task-tree integration (the `'rollup'`
 * field case in `GanttTaskTree`'s accessible fallback).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TreeStore } from '@jects/core';
import {
  resolveRollupCell,
  aggregateRollup,
  formatRollupCell,
  buildRollupCell,
  rollupColumn,
  ROLLUP_COLUMN,
  ROLLUP_COLUMN_FIELD,
  readRollupFlag,
  rollupFlagPatch,
  getRollupColumnConfig,
  type RollupTreeSource,
} from './rollup-column.js';
import { GanttTaskTree, DEFAULT_GANTT_COLUMNS } from './task-tree.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

/** A tiny in-memory tree source for the pure resolvers (no store needed). */
function source(tasks: TaskModel[]): RollupTreeSource {
  const byParent = new Map<unknown, TaskModel[]>();
  for (const t of tasks) {
    const p = (t as { parentId?: unknown }).parentId ?? null;
    const arr = byParent.get(p) ?? [];
    arr.push(t);
    byParent.set(p, arr);
  }
  return {
    getChildren: (id) => byParent.get(id) ?? [],
  };
}

describe('rollup-column — flag read/write', () => {
  it('reads the rollup flag direct and under data', () => {
    expect(readRollupFlag({ id: 1, rollup: true })).toBe(true);
    expect(readRollupFlag({ id: 2, rollup: false })).toBe(false);
    expect(readRollupFlag({ id: 3, data: { rollup: true } })).toBe(true);
    expect(readRollupFlag({ id: 4 })).toBe(false);
  });

  it('rollupFlagPatch sets the top-level flag', () => {
    expect(rollupFlagPatch(true)).toEqual({ rollup: true });
    expect(rollupFlagPatch(false)).toEqual({ rollup: false });
  });
});

describe('rollup-column — aggregateRollup', () => {
  it('sums, averages, mins, maxes and counts present values', () => {
    expect(aggregateRollup([1, 2, 3], 'sum')).toBe(6);
    expect(aggregateRollup([1, 2, 3], 'avg')).toBe(2);
    expect(aggregateRollup([1, 2, 3], 'min')).toBe(1);
    expect(aggregateRollup([1, 2, 3], 'max')).toBe(3);
    expect(aggregateRollup([1, null, 3], 'count')).toBe(2);
  });

  it('treats values as booleans for any/all', () => {
    expect(aggregateRollup([0, 0, 1], 'any')).toBe(true);
    expect(aggregateRollup([0, 0, 0], 'any')).toBe(false);
    expect(aggregateRollup([1, 1, 1], 'all')).toBe(true);
    expect(aggregateRollup([1, 0, 1], 'all')).toBe(false);
    expect(aggregateRollup([], 'all')).toBe(false);
  });

  it('returns null for empty numeric aggregations (except sum/count)', () => {
    expect(aggregateRollup([], 'avg')).toBeNull();
    expect(aggregateRollup([], 'min')).toBeNull();
    expect(aggregateRollup([], 'sum')).toBe(0);
    expect(aggregateRollup([], 'count')).toBe(0);
  });
});

describe('rollup-column — resolveRollupCell', () => {
  const tasks: TaskModel[] = [
    { id: 'p', name: 'Phase' },
    { id: 'a', name: 'Design', parentId: 'p', rollup: true, percentDone: 0.5, effort: 2 * DAY },
    { id: 'b', name: 'Build', parentId: 'p', percentDone: 1, effort: 4 * DAY },
  ];
  const src = source(tasks);

  it('flag mode returns the task own rollup flag', () => {
    expect(resolveRollupCell(tasks[1]!, src, { kind: 'flag' })).toBe(true);
    expect(resolveRollupCell(tasks[2]!, src, { kind: 'flag' })).toBe(false);
  });

  it('summary mode aggregates a numeric field across descendant leaves', () => {
    // sum of effort over leaves a+b = 6 days
    expect(
      resolveRollupCell(tasks[0]!, src, { kind: 'summary', field: 'effort', aggregation: 'sum' }),
    ).toBe(6 * DAY);
    // avg percentDone over leaves = 0.75
    expect(
      resolveRollupCell(tasks[0]!, src, {
        kind: 'summary',
        field: 'percentDone',
        aggregation: 'avg',
      }),
    ).toBe(0.75);
  });

  it('summary mode on a leaf returns the leaf own source value', () => {
    expect(
      resolveRollupCell(tasks[1]!, src, { kind: 'summary', field: 'percentDone' }),
    ).toBe(0.5);
  });

  it('honours a value override', () => {
    expect(resolveRollupCell(tasks[2]!, src, { value: () => 42 })).toBe(42);
  });
});

describe('rollup-column — formatRollupCell', () => {
  const task: TaskModel = { id: 'x' };
  it('formats booleans as a check / dash', () => {
    expect(formatRollupCell(true, task, { kind: 'flag' })).toBe('✓');
    expect(formatRollupCell(false, task, { kind: 'flag' })).toBe('—');
    expect(formatRollupCell(null, task, { kind: 'flag' })).toBe('—');
  });
  it('formats percentDone summaries as a percent', () => {
    expect(formatRollupCell(0.75, task, { kind: 'summary', field: 'percentDone' })).toBe('75%');
  });
  it('formats effort/duration summaries in days', () => {
    expect(formatRollupCell(6 * DAY, task, { kind: 'summary', field: 'effort' })).toBe('6d');
  });
  it('honours a custom format', () => {
    expect(
      formatRollupCell(3, task, { kind: 'summary', format: (v) => `[${String(v)}]` }),
    ).toBe('[3]');
  });
});

describe('rollup-column — buildRollupCell (DOM)', () => {
  const src = source([{ id: 'a', name: 'Design', rollup: true }]);

  it('renders a role=checkbox toggle that reflects the flag', () => {
    const handle = buildRollupCell({ id: 'a', name: 'Design', rollup: true }, src, { kind: 'flag' });
    expect(handle.el.getAttribute('role')).toBe('checkbox');
    expect(handle.el.getAttribute('aria-checked')).toBe('true');
    expect(handle.el.classList.contains('jects-gantt__rollup-check--on')).toBe(true);
    handle.dispose();
  });

  it('invokes onToggle with the NEXT value on click and stops propagation', () => {
    const calls: Array<[unknown, boolean]> = [];
    const handle = buildRollupCell(
      { id: 'a', name: 'Design', rollup: false },
      src,
      { kind: 'flag' },
      (id, next) => calls.push([id, next]),
    );
    let bubbled = false;
    const wrapper = document.createElement('div');
    wrapper.addEventListener('click', () => (bubbled = true));
    wrapper.append(handle.el);
    handle.el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls).toEqual([['a', true]]);
    expect(bubbled).toBe(false); // stopPropagation prevents row activation
    handle.dispose();
  });

  it('toggles on Space/Enter for keyboard users', () => {
    const calls: Array<[unknown, boolean]> = [];
    const handle = buildRollupCell(
      { id: 'a', name: 'Design', rollup: false },
      src,
      { kind: 'flag' },
      (id, next) => calls.push([id, next]),
    );
    handle.el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    handle.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(calls).toEqual([
      ['a', true],
      ['a', true],
    ]);
    handle.dispose();
  });

  it('renders a read-only check when not editable', () => {
    const handle = buildRollupCell(
      { id: 'a', name: 'Design', rollup: true },
      src,
      { kind: 'flag', editable: false },
    );
    expect(handle.el.getAttribute('aria-disabled')).toBe('true');
    expect(handle.el.tabIndex).toBe(-1);
    handle.dispose();
  });

  it('renders a static labelled value in summary mode', () => {
    const handle = buildRollupCell(
      { id: 'p', name: 'Phase' },
      source([
        { id: 'p', name: 'Phase' },
        { id: 'a', parentId: 'p', percentDone: 0.5 },
        { id: 'b', parentId: 'p', percentDone: 1 },
      ]),
      { kind: 'summary', field: 'percentDone', aggregation: 'avg' },
    );
    expect(handle.el.classList.contains('jects-gantt__rollup-cell')).toBe(true);
    expect(handle.el.textContent).toBe('75%');
    handle.dispose();
  });
});

describe('rollup-column — column factory', () => {
  it('rollupColumn() yields a rollup-field column and registers its config', () => {
    const col = rollupColumn({ kind: 'summary', field: 'effort', aggregation: 'sum', header: 'Σ Effort' });
    expect(col.field).toBe(ROLLUP_COLUMN_FIELD);
    expect(col.header).toBe('Σ Effort');
    expect(getRollupColumnConfig().kind).toBe('summary');
    expect(getRollupColumnConfig().field).toBe('effort');
  });

  it('ROLLUP_COLUMN is a ready-made flag column', () => {
    expect(ROLLUP_COLUMN.field).toBe(ROLLUP_COLUMN_FIELD);
  });
});

/* ── Integration with GanttTaskTree (accessible fallback) ─────────────────── */

let host: HTMLElement;
let tree: GanttTaskTree | null = null;

function makeStore(): TreeStore<TaskModel & { children?: TaskModel[] }> {
  return new TreeStore<TaskModel & { children?: TaskModel[] }>({
    data: [
      {
        id: 'p',
        name: 'Phase 1',
        children: [
          { id: 'a', name: 'Design', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY, rollup: true },
          { id: 'b', name: 'Build', start: T0 + 3 * DAY, duration: 2 * DAY, end: T0 + 5 * DAY },
        ],
      },
    ],
    expanded: ['p'],
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  tree?.destroy();
  tree = null;
  host.remove();
});

describe('GanttTaskTree — rollup column integration', () => {
  it('renders an interactive rollup checkbox cell per row reflecting the flag', () => {
    tree = new GanttTaskTree({
      store: makeStore(),
      columns: [...DEFAULT_GANTT_COLUMNS, rollupColumn({ kind: 'flag' })],
      rowHeight: 32,
      headerHeight: 48,
      width: 600,
      predecessorsOf: () => '',
    });
    host.append(tree.el);
    const checks = tree.el.querySelectorAll('.jects-gantt__rollup-check');
    expect(checks.length).toBe(3); // parent + 2 children
    // Row 'a' is flagged → checked; 'b' is not.
    const rowA = tree.el.querySelector('[data-task-id="a"] .jects-gantt__rollup-check');
    const rowB = tree.el.querySelector('[data-task-id="b"] .jects-gantt__rollup-check');
    expect(rowA?.getAttribute('aria-checked')).toBe('true');
    expect(rowB?.getAttribute('aria-checked')).toBe('false');
  });

  it('toggling the rollup checkbox updates the store and repaints', () => {
    const store = makeStore();
    tree = new GanttTaskTree({
      store,
      columns: [...DEFAULT_GANTT_COLUMNS, rollupColumn({ kind: 'flag' })],
      rowHeight: 32,
      headerHeight: 48,
      width: 600,
      predecessorsOf: () => '',
    });
    host.append(tree.el);
    const check = tree.el.querySelector(
      '[data-task-id="b"] .jects-gantt__rollup-check',
    ) as HTMLElement;
    check.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Store now carries the flag…
    expect(readRollupFlag(store.getById('b')!)).toBe(true);
    // …and after the repaint the cell reflects it.
    const after = tree.el.querySelector('[data-task-id="b"] .jects-gantt__rollup-check');
    expect(after?.getAttribute('aria-checked')).toBe('true');
  });

  it('routes toggles to onRollupToggle when provided (no direct store write)', () => {
    const store = makeStore();
    const calls: Array<[unknown, boolean]> = [];
    tree = new GanttTaskTree({
      store,
      columns: [...DEFAULT_GANTT_COLUMNS, rollupColumn({ kind: 'flag' })],
      onRollupToggle: (id, next) => calls.push([id, next]),
      rowHeight: 32,
      headerHeight: 48,
      width: 600,
      predecessorsOf: () => '',
    });
    host.append(tree.el);
    const check = tree.el.querySelector(
      '[data-task-id="b"] .jects-gantt__rollup-check',
    ) as HTMLElement;
    check.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls).toEqual([['b', true]]);
    // The injected handler owns the write; the store wasn't touched directly.
    expect(readRollupFlag(store.getById('b')!)).toBe(false);
  });

  it('renders a summary-mode aggregate on the parent row', () => {
    tree = new GanttTaskTree({
      store: makeStore(),
      columns: [
        ...DEFAULT_GANTT_COLUMNS,
        rollupColumn({ kind: 'summary', field: 'duration', aggregation: 'sum', header: 'Σ Dur' }),
      ],
      rollupColumnConfig: { kind: 'summary', field: 'duration', aggregation: 'sum' },
      rowHeight: 32,
      headerHeight: 48,
      width: 600,
      predecessorsOf: () => '',
    });
    host.append(tree.el);
    const parentCell = tree.el.querySelector(
      '[data-task-id="p"] .jects-gantt__rollup-cell',
    );
    // 3d + 2d = 5d summed over the two leaves.
    expect(parentCell?.textContent).toBe('5d');
  });
});
