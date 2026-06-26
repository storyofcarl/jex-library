/**
 * a11y + visual/interaction SMOKE test for the read-only **Successors**
 * task-tree column in REAL Chromium. Run with
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * The successors column renders a comma-joined dependency notation string of the
 * links OUT of each task, symmetric to the predecessors column. In a real engine
 * we verify:
 *   1. The "Successors" header + cells paint with the shipped token-pure CSS
 *      (the `data-field="successors"` cells carry the monospace notation styling
 *      and a placeholder for empty cells).
 *   2. The cell content reflects the live dependency graph the engine holds, and
 *      stays in lockstep with the predecessors column (A's successor = B's
 *      predecessor).
 *   3. Adding a dependency through the public API updates the cell.
 *   4. axe-core finds zero serious/critical violations with the column mounted.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the real package stylesheet so the cell styling (monospace notation,
// empty-cell placeholder) is exercised as shipped.
import '../styles.css';
import { Gantt } from './gantt.js';
import { DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS } from './task-tree.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { DependencyModel, TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

function tasks(): TaskModel[] {
  return [
    { id: 'a', name: 'Design', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY } as TaskModel,
    { id: 'b', name: 'Build', start: T0 + 3 * DAY, duration: 4 * DAY, end: T0 + 7 * DAY } as TaskModel,
    { id: 'c', name: 'Test', start: T0 + 7 * DAY, duration: 2 * DAY, end: T0 + 9 * DAY } as TaskModel,
  ];
}

function deps(): DependencyModel[] {
  return [
    { id: 'd1', fromId: 'a', toId: 'b' }, // Design → Build (FS)
    { id: 'd2', fromId: 'a', toId: 'c', type: 'SS', lag: 1 * DAY }, // Design ⇒ Test (SS+1d)
  ];
}

beforeEach(() => {
  host = document.createElement('div');
  host.style.position = 'relative';
  host.style.height = '320px';
  host.style.width = '1100px';
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

function successorCell(taskId: string): HTMLElement {
  return host.querySelector(
    `[data-task-id="${taskId}"] [data-field="successors"]`,
  ) as HTMLElement;
}
function predecessorCell(taskId: string): HTMLElement {
  return host.querySelector(
    `[data-task-id="${taskId}"] [data-field="predecessors"]`,
  ) as HTMLElement;
}

describe('Successors column a11y + visual (real Chromium)', () => {
  it('renders the column, mirrors predecessors, and has no serious/critical violations', async () => {
    gantt = new Gantt(host, {
      tasks: tasks(),
      dependencies: deps(),
      projectStart: T0,
      columns: DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
    });

    await expectNoA11yViolations(host);

    // The "Successors" header is present in the tree pane.
    const headers = [...host.querySelectorAll('.jects-gantt__tree-th')].map((h) =>
      (h.textContent ?? '').trim(),
    );
    expect(headers).toContain('Successors');

    // A is the predecessor of B (FS) and C (SS+1d) → its successors cell lists both.
    const aCell = successorCell('a');
    expect(aCell).not.toBeNull();
    expect(aCell.textContent).toBe('b, cSS+1d');

    // Symmetry: A's successor "b" appears as B's predecessor.
    expect(predecessorCell('b').textContent).toContain('a');

    // C has no successors → empty cell; the shipped CSS paints an em-dash
    // placeholder via ::before (so the column doesn't read as a blank gap).
    const cCell = successorCell('c');
    expect(cCell.textContent).toBe('');
    const placeholder = getComputedStyle(cCell, '::before').content;
    expect(placeholder).toContain('—');

    // The notation cell uses the monospace family (token-pure styling applied).
    const font = getComputedStyle(aCell).fontFamily.toLowerCase();
    expect(font.length).toBeGreaterThan(0);
    // The cell is laid out (non-zero box) in the real grid.
    expect(aCell.getBoundingClientRect().width).toBeGreaterThan(0);
  });

  it('updates the successors cell when a dependency is added through the API', async () => {
    gantt = new Gantt(host, {
      tasks: tasks(),
      dependencies: [{ id: 'd1', fromId: 'a', toId: 'b' }],
      projectStart: T0,
      columns: DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
    });

    expect(successorCell('a').textContent).toBe('b');

    // Add B → C; B's successors cell now lists C (FS default → just the ref).
    const created = gantt.addDependency({ fromId: 'b', toId: 'c' });
    expect(created).toBeTruthy();
    expect(successorCell('b').textContent).toBe('c');

    // Still axe-clean after the live edit.
    await expectNoA11yViolations(host);
  });
});
