/**
 * jsdom unit tests for `GanttTaskTree` — the left task-tree pane. The grid is
 * imported lazily; these tests exercise the always-present accessible fallback
 * treegrid: column rendering, WBS outline numbering, formatted date/duration/
 * percent cells, the visible-row layout seam, and click forwarding.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TreeStore } from '@jects/core';
import { GanttTaskTree, DEFAULT_GANTT_COLUMNS } from './task-tree.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let tree: GanttTaskTree | null = null;

function makeStore(): TreeStore<TaskModel & { children?: TaskModel[] }> {
  return new TreeStore<TaskModel & { children?: TaskModel[] }>({
    data: [
      {
        id: 'p',
        name: 'Phase 1',
        children: [
          { id: 'a', name: 'Design', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY },
          {
            id: 'b',
            name: 'Build',
            start: T0 + 3 * DAY,
            duration: 2 * DAY,
            end: T0 + 5 * DAY,
            percentDone: 0.5,
          },
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

describe('GanttTaskTree (accessible fallback)', () => {
  it('renders a treegrid with the default columns and a header per column', () => {
    tree = new GanttTaskTree({
      store: makeStore(),
      rowHeight: 32,
      headerHeight: 48,
      width: 400,
      predecessorsOf: () => '',
    });
    host.append(tree.el);
    const table = tree.el.querySelector('[role="treegrid"]');
    expect(table).not.toBeNull();
    expect(tree.el.querySelectorAll('.jects-gantt__tree-th').length).toBe(
      DEFAULT_GANTT_COLUMNS.length,
    );
  });

  it('renders one row per visible (expanded) task with aria-level', () => {
    tree = new GanttTaskTree({
      store: makeStore(),
      rowHeight: 32,
      headerHeight: 48,
      width: 400,
      predecessorsOf: () => '',
    });
    host.append(tree.el);
    const rows = tree.el.querySelectorAll('.jects-gantt__tree-row');
    expect(rows.length).toBe(3); // parent + 2 children
    expect(rows[0]!.getAttribute('aria-level')).toBe('1');
    expect(rows[1]!.getAttribute('aria-level')).toBe('2');
  });

  it('formats date / duration / percent cells and computes WBS outline numbers', () => {
    tree = new GanttTaskTree({
      store: makeStore(),
      rowHeight: 32,
      headerHeight: 48,
      width: 400,
      predecessorsOf: (id) => (id === 'b' ? 'a' : ''),
    });
    host.append(tree.el);
    const text = tree.el.textContent!;
    expect(text).toContain('2026-01-05'); // Design start
    expect(text).toContain('3d'); // Design duration
    expect(text).toContain('50%'); // Build percent
    // WBS: parent = "1", first child = "1.1", second = "1.2".
    expect(text).toContain('1.1');
    expect(text).toContain('1.2');
  });

  it('exposes the visible-row layout for lockstep alignment', () => {
    tree = new GanttTaskTree({
      store: makeStore(),
      rowHeight: 30,
      headerHeight: 48,
      width: 400,
      predecessorsOf: () => '',
    });
    const rows = tree.getVisibleRows();
    expect(rows.length).toBe(3);
    expect(rows[0]!.top).toBe(0);
    expect(rows[1]!.top).toBe(30);
    expect(rows[2]!.top).toBe(60);
    expect(tree.contentHeight()).toBe(90);
  });

  it('forwards row clicks and double-clicks to the callbacks', () => {
    const clicks: unknown[] = [];
    const dbls: unknown[] = [];
    tree = new GanttTaskTree({
      store: makeStore(),
      rowHeight: 32,
      headerHeight: 48,
      width: 400,
      predecessorsOf: () => '',
      onTaskClick: (id) => clicks.push(id),
      onTaskDblClick: (id) => dbls.push(id),
    });
    host.append(tree.el);
    const row = tree.el.querySelector('[data-task-id="a"]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(clicks).toEqual(['a']);
    expect(dbls).toEqual(['a']);
  });

  it('makes rows keyboard-operable: roving tabindex, aria-expanded, set/posinset', () => {
    tree = new GanttTaskTree({
      store: makeStore(),
      rowHeight: 32,
      headerHeight: 48,
      width: 400,
      predecessorsOf: () => '',
    });
    host.append(tree.el);
    const rows = [...tree.el.querySelectorAll('.jects-gantt__tree-row')] as HTMLElement[];
    // Roving tabindex: exactly one row tabbable.
    expect(rows.filter((r) => r.tabIndex === 0).length).toBe(1);
    expect(rows[0]!.tabIndex).toBe(0);
    // Parent row exposes aria-expanded; leaf rows do not.
    const parent = tree.el.querySelector('[data-task-id="p"]') as HTMLElement;
    expect(parent.getAttribute('aria-expanded')).toBe('true');
    const child = tree.el.querySelector('[data-task-id="a"]') as HTMLElement;
    expect(child.hasAttribute('aria-expanded')).toBe(false);
    // aria-setsize / aria-posinset present.
    expect(child.getAttribute('aria-setsize')).toBe('2'); // two children of p
    expect(child.getAttribute('aria-posinset')).toBe('1');
  });

  it('activates a row on Enter and navigates with Arrow keys', () => {
    const clicks: unknown[] = [];
    tree = new GanttTaskTree({
      store: makeStore(),
      rowHeight: 32,
      headerHeight: 48,
      width: 400,
      predecessorsOf: () => '',
      onTaskClick: (id) => clicks.push(id),
    });
    host.append(tree.el);
    const parent = tree.el.querySelector('[data-task-id="p"]') as HTMLElement;
    // Enter activates.
    parent.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(clicks).toEqual(['p']);
    // ArrowDown moves the roving tabindex to the next visible row.
    parent.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const child = tree.el.querySelector('[data-task-id="a"]') as HTMLElement;
    expect(child.tabIndex).toBe(0);
    expect(parent.tabIndex).toBe(-1);
  });

  it('collapses an expanded parent on ArrowLeft (updates aria-expanded)', () => {
    let expandedEvt: { id: unknown; expanded: boolean } | null = null;
    tree = new GanttTaskTree({
      store: makeStore(),
      rowHeight: 32,
      headerHeight: 48,
      width: 400,
      predecessorsOf: () => '',
      onRowExpand: (id, expanded) => {
        expandedEvt = { id, expanded };
      },
    });
    host.append(tree.el);
    const parent = tree.el.querySelector('[data-task-id="p"]') as HTMLElement;
    parent.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(expandedEvt).toEqual({ id: 'p', expanded: false });
    // After collapse + repaint, the parent is now collapsed.
    tree.refresh();
    const reparent = tree.el.querySelector('[data-task-id="p"]') as HTMLElement;
    expect(reparent.getAttribute('aria-expanded')).toBe('false');
    // Children no longer rendered.
    expect(tree.el.querySelector('[data-task-id="a"]')).toBeNull();
  });

  it('removes its element on destroy', () => {
    tree = new GanttTaskTree({
      store: makeStore(),
      rowHeight: 32,
      headerHeight: 48,
      width: 400,
      predecessorsOf: () => '',
    });
    host.append(tree.el);
    const el = tree.el;
    tree.destroy();
    expect(el.isConnected).toBe(false);
  });
});
