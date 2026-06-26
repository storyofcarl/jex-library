/**
 * jsdom unit tests for the read-only **Successors** task-tree column.
 *
 * Two layers:
 *   1. The pure resolver/helpers in `successors-column.ts` (DOM-free): notation
 *      formatting (type + lag suffixes), active-link filtering, orientation
 *      (mirror of predecessors), id→token mapping, the column descriptor, the
 *      idempotent `withSuccessorsColumn` injector, and the live resolver factory.
 *   2. The `GanttTaskTree` integration: a declared `successors` column renders
 *      the resolver's output in its cell (and carries the `data-field` hook),
 *      symmetric to the existing predecessors column.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TreeStore } from '@jects/core';
import {
  successorsLabel,
  predecessorsLabel,
  makeSuccessorsResolver,
  withSuccessorsColumn,
  isSuccessorsField,
  SUCCESSORS_COLUMN,
  SUCCESSORS_COLUMN_FIELD,
  SUCCESSORS_COLUMN_HEADER,
} from './successors-column.js';
import { GanttTaskTree, DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS } from './task-tree.js';
import type { DependencyModel, TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

/** A small dependency set: A→B (FS), A→C (SS+2d), B→C (FF), and an inactive A→D. */
function deps(): DependencyModel[] {
  return [
    { id: 'd1', fromId: 'a', toId: 'b' }, // FS (default)
    { id: 'd2', fromId: 'a', toId: 'c', type: 'SS', lag: 2 * DAY },
    { id: 'd3', fromId: 'b', toId: 'c', type: 'FF' },
    { id: 'd4', fromId: 'a', toId: 'd', active: false }, // inactive — skipped
  ];
}

describe('successorsLabel (pure resolver)', () => {
  it('formats outgoing links as comma-joined notation, omitting FS + zero lag', () => {
    // A is the predecessor of B (FS) and C (SS+2d).
    expect(successorsLabel(deps(), 'a')).toBe('b, cSS+2d');
  });

  it('renders the dependency type only when not the default FS', () => {
    // B → C is FF.
    expect(successorsLabel(deps(), 'b')).toBe('cFF');
  });

  it('skips inactive links', () => {
    // A → D is inactive; only B and C show (split tokens to avoid matching the
    // letter "d" inside the "+2d" lag suffix).
    const tokens = successorsLabel(deps(), 'a').split(', ');
    expect(tokens).toEqual(['b', 'cSS+2d']);
    expect(tokens.some((t) => t.startsWith('d'))).toBe(false);
  });

  it('returns empty string for a task with no successors', () => {
    // C is only ever a successor, never a predecessor.
    expect(successorsLabel(deps(), 'c')).toBe('');
  });

  it('renders a negative lag as a lead with a minus sign', () => {
    const d: DependencyModel[] = [{ id: 'x', fromId: 'a', toId: 'b', lag: -1 * DAY }];
    expect(successorsLabel(d, 'a')).toBe('b-1d');
  });

  it('maps the referenced id to a token when refToToken is supplied', () => {
    const out = successorsLabel(deps(), 'a', { refToToken: (id) => `#${String(id).toUpperCase()}` });
    expect(out).toBe('#B, #CSS+2d');
  });

  it('honors a custom msPerDay when rendering lag days', () => {
    const d: DependencyModel[] = [{ id: 'x', fromId: 'a', toId: 'b', type: 'SS', lag: 16 }];
    // 16 ms over an 8-ms "day" = +2d.
    expect(successorsLabel(d, 'a', { msPerDay: 8 })).toBe('bSS+2d');
  });
});

describe('predecessorsLabel (mirror) is symmetric to successorsLabel', () => {
  it('orients the other way — fromId becomes the label', () => {
    // C's predecessors are A (SS+2d) and B (FF).
    expect(predecessorsLabel(deps(), 'c')).toBe('aSS+2d, bFF');
    // and successorsLabel of A includes C, predecessorsLabel of C includes A.
    expect(successorsLabel(deps(), 'a')).toContain('c');
    expect(predecessorsLabel(deps(), 'c')).toContain('a');
  });
});

describe('makeSuccessorsResolver', () => {
  it('builds a resolver over a static iterable', () => {
    const resolve = makeSuccessorsResolver(deps());
    expect(resolve('a')).toBe('b, cSS+2d');
    expect(resolve('c')).toBe('');
  });

  it('reads a getter LAZILY so it reflects later mutations', () => {
    const live: DependencyModel[] = [{ id: 'd1', fromId: 'a', toId: 'b' }];
    const resolve = makeSuccessorsResolver(() => live);
    expect(resolve('a')).toBe('b');
    live.push({ id: 'd2', fromId: 'a', toId: 'c', type: 'SS' });
    expect(resolve('a')).toBe('b, cSS');
  });
});

describe('column descriptor + injector', () => {
  it('exposes a frozen descriptor with the expected field/header/width', () => {
    expect(SUCCESSORS_COLUMN_FIELD).toBe('successors');
    expect(SUCCESSORS_COLUMN_HEADER).toBe('Successors');
    expect(SUCCESSORS_COLUMN.field).toBe('successors');
    expect(Object.isFrozen(SUCCESSORS_COLUMN)).toBe(true);
  });

  it('isSuccessorsField guards the field id', () => {
    expect(isSuccessorsField('successors')).toBe(true);
    expect(isSuccessorsField('predecessors')).toBe(false);
  });

  it('appends the successors column without mutating the input', () => {
    const base = [{ field: 'name' }, { field: 'predecessors' }];
    const out = withSuccessorsColumn(base);
    expect(out).toHaveLength(3);
    expect(out[2]!.field).toBe('successors');
    expect(base).toHaveLength(2); // input untouched
  });

  it('is idempotent — does not duplicate an already-present successors column', () => {
    const base = [{ field: 'name' }, { field: 'successors', header: 'Custom' }];
    const out = withSuccessorsColumn(base);
    expect(out.filter((c) => c.field === 'successors')).toHaveLength(1);
    expect(out[1]!.header).toBe('Custom'); // existing config preserved
  });

  it('applies header/width overrides on the appended column', () => {
    const out = withSuccessorsColumn([{ field: 'name' }], { header: 'After', width: 200 });
    const col = out.find((c) => c.field === 'successors')!;
    expect(col.header).toBe('After');
    expect(col.width).toBe(200);
  });
});

/* ── GanttTaskTree integration ─────────────────────────────────────────── */

function makeStore(): TreeStore<TaskModel & { children?: TaskModel[] }> {
  return new TreeStore<TaskModel & { children?: TaskModel[] }>({
    data: [
      { id: 'a', name: 'Design', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY },
      { id: 'b', name: 'Build', start: T0 + 3 * DAY, duration: 2 * DAY, end: T0 + 5 * DAY },
      { id: 'c', name: 'Test', start: T0 + 5 * DAY, duration: 2 * DAY, end: T0 + 7 * DAY },
    ],
  });
}

describe('GanttTaskTree successors column', () => {
  let host: HTMLElement;
  let tree: GanttTaskTree | null = null;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    tree?.destroy();
    tree = null;
    host.remove();
  });

  it('renders the successors cell via the injected resolver', () => {
    const resolve = makeSuccessorsResolver(deps());
    tree = new GanttTaskTree({
      store: makeStore(),
      columns: DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
      rowHeight: 32,
      headerHeight: 48,
      width: 600,
      predecessorsOf: () => '',
      successorsOf: resolve,
    });
    host.append(tree.el);

    // A "Successors" header is present.
    const headers = [...tree.el.querySelectorAll('.jects-gantt__tree-th')].map(
      (h) => h.textContent,
    );
    expect(headers).toContain('Successors');

    // A's successors cell shows "b, cSS+2d"; C's is empty.
    const cellFor = (taskId: string): string => {
      const row = tree!.el.querySelector(`[data-task-id="${taskId}"]`)!;
      const cell = row.querySelector('[data-field="successors"]')!;
      return cell.textContent ?? '';
    };
    expect(cellFor('a')).toBe('b, cSS+2d');
    expect(cellFor('c')).toBe('');
  });

  it('renders an empty successors cell when no resolver is wired', () => {
    tree = new GanttTaskTree({
      store: makeStore(),
      columns: DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
      rowHeight: 32,
      headerHeight: 48,
      width: 600,
      predecessorsOf: () => '',
      // successorsOf intentionally omitted.
    });
    host.append(tree.el);
    const row = tree.el.querySelector('[data-task-id="a"]')!;
    const cell = row.querySelector('[data-field="successors"]')!;
    expect(cell.textContent).toBe('');
  });

  it('keeps the cell in sync after a refresh when the link set changes', () => {
    const live: DependencyModel[] = [{ id: 'd1', fromId: 'a', toId: 'b' }];
    tree = new GanttTaskTree({
      store: makeStore(),
      columns: DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
      rowHeight: 32,
      headerHeight: 48,
      width: 600,
      predecessorsOf: () => '',
      successorsOf: makeSuccessorsResolver(() => live),
    });
    host.append(tree.el);

    const cellFor = (taskId: string): string =>
      tree!.el
        .querySelector(`[data-task-id="${taskId}"] [data-field="successors"]`)!
        .textContent ?? '';
    expect(cellFor('a')).toBe('b');

    // Add a new outgoing link, then repaint — the cell reflects it.
    live.push({ id: 'd2', fromId: 'a', toId: 'c', type: 'FF' });
    tree.refresh();
    expect(cellFor('a')).toBe('b, cFF');
  });
});
