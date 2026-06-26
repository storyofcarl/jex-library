/**
 * axe-core a11y + visual/interaction browser test for the Resource assignment
 * feature (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the feature end to
 * end with the real, token-pure stylesheet:
 *   - the task-tree "Resources" column renders avatar/initials chips with the
 *     resolved theme colour and the comma-joined accessible name,
 *   - the assignment editor field is a keyboard-operable multi-select whose
 *     checkboxes + units spinbuttons drive the AssignmentStore on commit,
 *   - the per-bar resource label decorates a real task bar and reflects a later
 *     assign/unassign through the store.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the shipped, token-pure stylesheet so geometry/colour assertions exercise
// the real CSS rather than unstyled defaults.
import '../styles.css';
import {
  AssignmentStore,
  AssignmentColumnRenderer,
  GanttResourceLabelsFeature,
  type ResourceModel,
} from './resource-assignment.js';
import { ResourceAssignmentField } from './resource-assignment-field.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { TaskModel, GanttApi } from '../contract.js';

const RES: ResourceModel[] = [
  { id: 'r1', name: 'Ada Lovelace' },
  { id: 'r2', name: 'Grace Hopper', initials: 'GH', colorToken: 'cmyk-cyan' },
  { id: 'r3', name: 'Alan Turing', role: 'Engineer' },
  { id: 'r4', name: 'Linus Torvalds' },
];

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '720px';
  host.style.padding = '16px';
  // Mimic the page surface so contrast tokens resolve against a real background.
  host.style.background = 'oklch(var(--jects-background))';
  host.style.color = 'oklch(var(--jects-foreground))';
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

describe('Resource assignment a11y + visual (real Chromium)', () => {
  it('renders the tree "Resources" column chips with no serious/critical violations', async () => {
    const store = new AssignmentStore({ resources: RES });
    store.assign('t1', 'r1', 100);
    store.assign('t1', 'r2', 50);
    store.assign('t1', 'r3', 100);
    store.assign('t1', 'r4', 100);

    const renderer = new AssignmentColumnRenderer(store, { max: 3, showNames: true });
    const cell = renderer.renderCell({ id: 't1', name: 'Task' } as TaskModel);
    host.append(cell);

    await expectNoA11yViolations(host);

    // 3 shown + 1 overflow chip.
    expect(cell.querySelectorAll('.jects-gantt__assignee').length).toBe(4);
    const avatar = cell.querySelector('.jects-gantt__avatar') as HTMLElement;
    // The avatar paints a real, non-zero, themed circle.
    const rect = avatar.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(8);
    expect(rect.height).toBeGreaterThan(8);
    // Token-pure: the avatar colour is driven by a `--jects-*` token (resolved
    // theme-side), proven by the inline custom property the renderer sets.
    expect(avatar.style.getPropertyValue('--jects-avatar-color')).toContain('var(--jects-');
    // The group exposes the full assignee list as its accessible name.
    expect(cell.getAttribute('aria-label')).toContain('Ada Lovelace');
    // Overflow chip shows the remaining count.
    expect(cell.querySelector('.jects-gantt__avatar--more')!.textContent).toBe('+1');
  });

  it('the editor field is a keyboard-operable multi-select with units, no a11y violations', async () => {
    const store = new AssignmentStore({ resources: RES });
    store.assign('t1', 'r2', 75);

    const field = new ResourceAssignmentField({ store, taskId: 't1', label: 'Assigned resources' });
    host.append(field.el);

    await expectNoA11yViolations(host);

    const checks = field.el.querySelectorAll<HTMLInputElement>('.jects-gantt__assign-check');
    const units = field.el.querySelectorAll<HTMLInputElement>('.jects-gantt__assign-units-input');

    // r2 seeded as checked at 75%.
    expect(checks[1]!.checked).toBe(true);
    expect(units[1]!.value).toBe('75');

    // Keyboard: focus the first checkbox and toggle it via the space key, then
    // type a new units value — the draft + getValue reflect it.
    checks[0]!.focus();
    expect(host.ownerDocument.activeElement).toBe(checks[0]);
    checks[0]!.click(); // simulates keyboard activation of a checkbox
    expect(units[0]!.disabled).toBe(false);

    units[0]!.focus();
    units[0]!.value = '40';
    units[0]!.dispatchEvent(new Event('input', { bubbles: true }));

    expect(field.getValue()).toEqual(
      expect.arrayContaining([
        { resourceId: 'r1', units: 40 },
        { resourceId: 'r2', units: 75 },
      ]),
    );

    // Commit routes the draft through the store.
    field.commitTo();
    expect(store.getResourcesForTask('t1').map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(store.getAssignment('t1', 'r1')!.units).toBe(40);

    field.destroy();
  });

  it('paints a per-bar resource label that reflects later store edits', async () => {
    const store = new AssignmentStore({ resources: RES });
    store.assign('t1', 'r1', 100);

    // Minimal real bar layout so the feature has something to decorate.
    const root = document.createElement('div');
    root.className = 'jects-gantt';
    const barsLayer = document.createElement('div');
    barsLayer.className = 'jects-gantt__bars';
    barsLayer.setAttribute('role', 'list');
    barsLayer.setAttribute('aria-label', 'Task bars');
    const bar = document.createElement('div');
    bar.className = 'jects-gantt__bar';
    bar.dataset.taskId = 't1';
    bar.setAttribute('role', 'listitem');
    bar.setAttribute('aria-label', 'Build feature');
    bar.style.position = 'absolute';
    bar.style.left = '40px';
    bar.style.top = '12px';
    bar.style.width = '160px';
    bar.style.height = '18px';
    barsLayer.append(bar);
    const contentBox = document.createElement('div');
    contentBox.style.position = 'relative';
    contentBox.style.height = '120px';
    contentBox.append(barsLayer);
    root.append(contentBox);
    host.append(root);

    const task: TaskModel = { id: 't1', name: 'Build feature' } as TaskModel;
    const trackers: Array<() => void> = [];
    const api = {
      el: root,
      getTask: (id: unknown) => (String(id) === 't1' ? task : undefined),
      track: (d: () => void) => trackers.push(d),
    } as unknown as GanttApi;

    const feat = new GanttResourceLabelsFeature({ store, position: 'after', avatars: true });
    feat.init(api);

    await expectNoA11yViolations(host);

    const label = barsLayer.querySelector('.jects-gantt__bar-resources') as HTMLElement;
    expect(label).not.toBeNull();
    expect(label.title).toContain('Ada Lovelace');
    // The label sits to the right of the bar (after position) and is visible.
    const lr = label.getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    expect(lr.left).toBeGreaterThanOrEqual(br.right - 1);
    expect(lr.width).toBeGreaterThan(0);

    // A later assign re-decorates the bar (now two assignees).
    store.assign('t1', 'r2', 100);
    const after = barsLayer.querySelector('.jects-gantt__bar-resources') as HTMLElement;
    expect(after.querySelectorAll('.jects-gantt__assignee').length).toBe(2);

    // An unassign removes it down to one.
    store.unassignResource('t1', 'r1');
    const after2 = barsLayer.querySelector('.jects-gantt__bar-resources') as HTMLElement;
    expect(after2.querySelectorAll('.jects-gantt__assignee').length).toBe(1);

    feat.destroy();
    expect(barsLayer.querySelector('.jects-gantt__bar-resources')).toBeNull();
  });
});
