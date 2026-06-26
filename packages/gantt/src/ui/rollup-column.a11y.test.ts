/**
 * axe-core a11y + visual/interaction browser test for the **task-tree 'rollup'
 * data column** (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the rollup column
 * end to end inside a real `GanttTaskTree` accessible-fallback treegrid:
 *   - flag mode renders a `role="checkbox"` toggle per row reflecting `task.rollup`;
 *   - the toggle is keyboard-operable (focus + Space) and updates the store + cell;
 *   - the checked toggle paints with the calm-cyan accent (real shipped CSS), i.e.
 *     it is visibly distinct from the unchecked state;
 *   - summary mode renders an aggregate on the parent row.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the theme tokens FIRST so `oklch(var(--jects-*))` colors resolve to real
// values (the checked/unchecked toggle backgrounds read as distinct colors),
// then the shipped, token-pure package stylesheet so the visual assertions
// exercise the real CSS rather than unstyled defaults.
import '@jects/theme/base.css';
import '../styles.css';
import { TreeStore } from '@jects/core';
import { GanttTaskTree, DEFAULT_GANTT_COLUMNS } from './task-tree.js';
import { rollupColumn, readRollupFlag } from './rollup-column.js';
import type { TaskModel } from '../contract.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

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
  host.style.position = 'relative';
  host.style.width = '720px';
  host.style.height = '240px';
  document.body.appendChild(host);
});

afterEach(() => {
  tree?.destroy();
  tree = null;
  host.remove();
});

describe('rollup-column a11y + visual (real Chromium)', () => {
  it('renders accessible checkbox toggles with no serious/critical violations', async () => {
    tree = new GanttTaskTree({
      store: makeStore(),
      columns: [...DEFAULT_GANTT_COLUMNS, rollupColumn({ kind: 'flag' })],
      rowHeight: 32,
      headerHeight: 48,
      width: 720,
      predecessorsOf: () => '',
    });
    host.append(tree.el);

    await expectNoA11yViolations(host);

    const checks = [...tree.el.querySelectorAll<HTMLElement>('.jects-gantt__rollup-check')];
    expect(checks.length).toBe(3);
    for (const c of checks) {
      expect(c.getAttribute('role')).toBe('checkbox');
      expect(c.hasAttribute('aria-checked')).toBe(true);
      expect(c.getAttribute('aria-label')).toContain('Roll up');
    }

    // The flagged row is visibly checked: real shipped CSS fills it differently
    // from the unchecked row.
    const on = tree.el.querySelector<HTMLElement>(
      '[data-task-id="a"] .jects-gantt__rollup-check',
    )!;
    const off = tree.el.querySelector<HTMLElement>(
      '[data-task-id="b"] .jects-gantt__rollup-check',
    )!;
    expect(on.classList.contains('jects-gantt__rollup-check--on')).toBe(true);
    expect(off.classList.contains('jects-gantt__rollup-check--on')).toBe(false);
    const onBg = getComputedStyle(on).backgroundColor;
    const offBg = getComputedStyle(off).backgroundColor;
    expect(onBg).not.toBe(offBg);
  });

  it('toggles the flag from the keyboard (focus + Space) and updates store + cell', async () => {
    const store = makeStore();
    tree = new GanttTaskTree({
      store,
      columns: [...DEFAULT_GANTT_COLUMNS, rollupColumn({ kind: 'flag' })],
      rowHeight: 32,
      headerHeight: 48,
      width: 720,
      predecessorsOf: () => '',
    });
    host.append(tree.el);

    const off = tree.el.querySelector<HTMLElement>(
      '[data-task-id="b"] .jects-gantt__rollup-check',
    )!;
    off.focus();
    expect(document.activeElement).toBe(off);
    off.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

    expect(readRollupFlag(store.getById('b')!)).toBe(true);
    const after = tree.el.querySelector<HTMLElement>(
      '[data-task-id="b"] .jects-gantt__rollup-check',
    )!;
    expect(after.getAttribute('aria-checked')).toBe('true');

    await expectNoA11yViolations(host);
  });

  it('renders a summary aggregate on the parent row', async () => {
    tree = new GanttTaskTree({
      store: makeStore(),
      columns: [
        ...DEFAULT_GANTT_COLUMNS,
        rollupColumn({ kind: 'summary', field: 'duration', aggregation: 'sum', header: 'Σ Dur' }),
      ],
      rollupColumnConfig: { kind: 'summary', field: 'duration', aggregation: 'sum' },
      rowHeight: 32,
      headerHeight: 48,
      width: 720,
      predecessorsOf: () => '',
    });
    host.append(tree.el);

    const parentCell = tree.el.querySelector<HTMLElement>(
      '[data-task-id="p"] .jects-gantt__rollup-cell',
    )!;
    expect(parentCell.textContent).toBe('5d');

    await expectNoA11yViolations(host);
  });
});
