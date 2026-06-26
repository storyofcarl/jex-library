/**
 * axe-core a11y + visual/interaction browser test for the Resource-assignment
 * SURFACES wired live (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the wiring end to
 * end with the real, token-pure stylesheet:
 *   - the task-tree "Resources" column auto-appends and paints avatar chips for
 *     the assigned resources at their real, themed pixel sizes,
 *   - the assignment editor field shows the destructive over-allocation cue
 *     (row class + badge) when the projected total exceeds capacity, and clears
 *     it when the units drop back under capacity.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the shipped, token-pure stylesheet so geometry/colour assertions exercise
// the real CSS rather than unstyled defaults.
import '../styles.css';
import { TreeStore } from '@jects/core';
import { AssignmentStore, type ResourceModel } from './resource-assignment.js';
import { ResourceAssignmentField } from './resource-assignment-field.js';
import { GanttTaskTree, DEFAULT_GANTT_COLUMNS } from './task-tree.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

const RES: ResourceModel[] = [
  { id: 'r1', name: 'Ada Lovelace', maxUnits: 100 },
  { id: 'r2', name: 'Grace Hopper', initials: 'GH', maxUnits: 100 },
  { id: 'r3', name: 'Alan Turing', role: 'Engineer', maxUnits: 100 },
];

let host: HTMLElement;
let tree: GanttTaskTree | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '760px';
  host.style.padding = '16px';
  host.style.background = 'oklch(var(--jects-background))';
  host.style.color = 'oklch(var(--jects-foreground))';
  document.body.appendChild(host);
});

afterEach(() => {
  tree?.destroy();
  tree = null;
  host.remove();
});

describe('Resource-assignment wiring a11y + visual (real Chromium)', () => {
  it('paints the task-tree "Resources" column chips with no serious/critical violations', async () => {
    const store = new AssignmentStore({ resources: RES });
    store.assign('a', 'r1', 100);
    store.assign('a', 'r2', 50);

    const taskStore = new TreeStore<TaskModel & { children?: TaskModel[] }>({
      data: [
        { id: 'a', name: 'Design', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY },
        { id: 'b', name: 'Build', start: T0 + 2 * DAY, duration: 2 * DAY, end: T0 + 4 * DAY },
      ],
    });

    tree = new GanttTaskTree({
      store: taskStore,
      assignmentStore: store,
      rowHeight: 28,
      headerHeight: 32,
      width: 720,
      predecessorsOf: () => '',
    });
    host.append(tree.el);

    await expectNoA11yViolations(host);

    const headers = [...tree.el.querySelectorAll('.jects-gantt__tree-th')].map((h) => h.textContent);
    expect(headers).toContain('Resources');
    expect(headers.length).toBe(DEFAULT_GANTT_COLUMNS.length + 1);

    const rowA = tree.el.querySelector<HTMLElement>('.jects-gantt__tree-row[data-task-id="a"]')!;
    expect(rowA.querySelectorAll('.jects-gantt__assignee').length).toBe(2);

    // The avatar paints a real, non-zero circle whose colour is driven by a
    // `--jects-*` token (resolved theme-side), proven by the inline custom
    // property the renderer sets.
    const avatar = rowA.querySelector('.jects-gantt__avatar') as HTMLElement;
    const rect = avatar.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(8);
    expect(rect.height).toBeGreaterThan(8);
    expect(avatar.style.getPropertyValue('--jects-avatar-color')).toContain('var(--jects-');
  });

  it('shows + clears the over-allocation cue in the editor field, no a11y violations', async () => {
    const store = new AssignmentStore({ resources: RES });
    // r1 already carries 80% elsewhere; assigning here at 100 → 180 > 100 cap.
    store.assign('t-other', 'r1', 80);

    const field = new ResourceAssignmentField({ store, taskId: 't1', label: 'Assigned resources' });
    host.append(field.el);

    await expectNoA11yViolations(host);

    const r1Row = [...field.el.querySelectorAll<HTMLElement>('.jects-gantt__assign-row')].find(
      (r) => r.dataset.resourceId === 'r1',
    )!;
    const check = r1Row.querySelector<HTMLInputElement>('.jects-gantt__assign-check')!;
    const badge = r1Row.querySelector<HTMLElement>('.jects-gantt__assign-over')!;

    // Initially unassigned here → no over-allocation.
    expect(r1Row.classList.contains('jects-gantt__assign-row--over')).toBe(false);
    expect(getComputedStyle(badge).display).toBe('none');

    // Keyboard-activate the checkbox → assigned at 100 → over-allocated.
    check.focus();
    check.click();
    expect(r1Row.classList.contains('jects-gantt__assign-row--over')).toBe(true);
    // The destructive over-allocation band/badge is wired through the token-pure
    // CSS: the row carries the `--over` modifier and the badge becomes visible.
    expect(getComputedStyle(badge).display).not.toBe('none');
    expect(badge.title).toContain('180%');

    // Drop units to 10% → 80 + 10 = 90 ≤ 100 → cue clears.
    const units = r1Row.querySelector<HTMLInputElement>('.jects-gantt__assign-units-input')!;
    units.focus();
    units.value = '10';
    units.dispatchEvent(new Event('input', { bubbles: true }));
    expect(r1Row.classList.contains('jects-gantt__assign-row--over')).toBe(false);
    expect(getComputedStyle(badge).display).toBe('none');

    // No a11y regressions after interaction.
    await expectNoA11yViolations(host);
    field.destroy();
  });
});
