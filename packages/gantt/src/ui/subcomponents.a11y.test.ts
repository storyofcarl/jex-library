/**
 * axe-core a11y browser tests for the Gantt's PUBLIC sub-components mounted in
 * isolation (Quality Gate Q2): the timeline pane (`GanttTimelineView`) and the
 * task-tree pane (`GanttTaskTree` fallback treegrid). Run in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, these assert the keyboard
 * affordances the Quality Gate required exist and are operable: task bars expose
 * a roving tabindex + usage hint and respond to keyboard, and treegrid rows
 * carry aria-expanded + a roving tabindex and navigate by keyboard.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WEEK_AND_DAY } from '@jects/timeline-core';
import { TreeStore } from '@jects/core';
import { GanttTimelineView } from './timeline-view.js';
import { GanttTaskTree } from './task-tree.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { TaskModel, DependencyModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  host.style.height = '320px';
  host.style.width = '900px';
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

describe('GanttTimelineView a11y (real Chromium)', () => {
  let view: GanttTimelineView | null = null;
  afterEach(() => {
    view?.destroy();
    view = null;
  });

  it('mounts with no serious/critical violations and keyboard-operable bars', async () => {
    view = new GanttTimelineView({ preset: WEEK_AND_DAY, range: { start: T0 - 7 * DAY, end: T0 + 30 * DAY } });
    host.append(view.el);
    const tasks: TaskModel[] = [
      { id: 'a', name: 'Design', start: T0, end: T0 + 3 * DAY, duration: 3 * DAY, percentDone: 0.4 },
      { id: 'b', name: 'Build', start: T0 + 3 * DAY, end: T0 + 6 * DAY, duration: 3 * DAY },
      { id: 'm', name: 'Launch', start: T0 + 6 * DAY, end: T0 + 6 * DAY, milestone: true },
    ];
    const deps: DependencyModel[] = [{ id: 'l1', fromId: 'a', toId: 'b', type: 'FS' }];
    view.setRows(
      tasks.map((task, i) => ({ task, top: i * 32, height: 32 })),
      deps,
    );

    await expectNoA11yViolations(host);

    // Exactly one bar holds the roving tabindex (tab order entry point); the rest
    // are reachable by arrow keys (tabindex -1).
    const bars = [...host.querySelectorAll('.jects-gantt__bar')] as HTMLElement[];
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.filter((b) => b.tabIndex === 0).length).toBe(1);
    // Each bar advertises its keyboard usage via aria-describedby → the hint.
    const a = host.querySelector('.jects-gantt__bar[data-task-id="a"]') as HTMLElement;
    const describedBy = a.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(host.querySelector(`#${describedBy}`)).not.toBeNull();

    // It responds to a keyboard nudge without throwing (routed to the callback).
    a.focus();
    a.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
});

describe('GanttTaskTree fallback treegrid a11y (real Chromium)', () => {
  let tree: GanttTaskTree | null = null;
  afterEach(() => {
    tree?.destroy();
    tree = null;
  });

  function store(): TreeStore<TaskModel & { children?: TaskModel[] }> {
    return new TreeStore<TaskModel & { children?: TaskModel[] }>({
      data: [
        {
          id: 'p',
          name: 'Phase 1',
          start: T0,
          end: T0 + 8 * DAY,
          duration: 8 * DAY,
          children: [
            { id: 'a', name: 'Design', start: T0, end: T0 + 3 * DAY, duration: 3 * DAY },
            { id: 'b', name: 'Build', start: T0 + 3 * DAY, end: T0 + 6 * DAY, duration: 3 * DAY, percentDone: 0.4 },
          ],
        },
      ],
      expanded: ['p'],
    });
  }

  it('mounts with no serious/critical violations and an operable treegrid', async () => {
    const treeStore = store();
    tree = new GanttTaskTree({
      store: treeStore,
      rowHeight: 32,
      headerHeight: 48,
      width: 420,
      predecessorsOf: () => '',
      // The owner repaints on expand/collapse (exactly how the Gantt widget
      // wires it via `refreshPanes`); the fallback treegrid then reflects the
      // new aria-expanded state.
      onRowExpand: () => tree!.refresh(),
    });
    host.append(tree.el);

    await expectNoA11yViolations(host);

    // Summary rows expose expand state; one row holds the roving tabindex.
    const summaryRow = host.querySelector('.jects-gantt__tree-row[data-task-id="p"]') as HTMLElement;
    expect(summaryRow.getAttribute('aria-expanded')).toBe('true');
    const rows = [...host.querySelectorAll('.jects-gantt__tree-row')] as HTMLElement[];
    expect(rows.filter((r) => r.tabIndex === 0).length).toBe(1);
    // Rows carry their tree position metadata for AT.
    expect(summaryRow.getAttribute('aria-level')).toBe('1');

    // Collapsing via keyboard flips the store state (and, after the owner's
    // repaint, the rendered aria-expanded).
    summaryRow.focus();
    summaryRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(treeStore.isExpanded('p')).toBe(false);
    const after = host.querySelector('.jects-gantt__tree-row[data-task-id="p"]') as HTMLElement;
    expect(after.getAttribute('aria-expanded')).toBe('false');
  });
});
