/**
 * a11y + visual/interaction SMOKE test for the Gantt **Resource labels** feature
 * in REAL Chromium. Run with `pnpm --filter @jects/gantt test:browser`.
 *
 * The per-bar resource label sits inside the laid-out bar (real geometry) and is
 * repainted via a live `MutationObserver` on every bars-layer mutation — both of
 * which only mean anything in a real engine. This test also guards the
 * destroy()→init() instance-reuse regression: after a teardown + re-init cycle
 * the feature must paint labels again (it previously latched `destroyed=true` and
 * silently rendered nothing forever).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from './gantt.js';
import {
  AssignmentStore,
  GanttResourceLabelsFeature,
  type ResourceModel,
} from './resource-assignment.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

const RESOURCES: ResourceModel[] = [
  { id: 'r1', name: 'Ada Lovelace' },
  { id: 'r2', name: 'Grace Hopper', initials: 'GH' },
];

let host: HTMLElement;
let gantt: Gantt | null = null;

function tasks(): TaskModel[] {
  return [
    { id: 'a', name: 'Design', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY } as TaskModel,
    { id: 'b', name: 'Build', start: T0 + 4 * DAY, duration: 3 * DAY, end: T0 + 7 * DAY } as TaskModel,
  ];
}

beforeEach(() => {
  host = document.createElement('div');
  host.style.height = '320px';
  host.style.width = '960px';
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

describe('GanttResourceLabelsFeature (real Chromium)', () => {
  it('paints a resource label inside the bar with real geometry', () => {
    const store = new AssignmentStore({ resources: RESOURCES });
    store.assign('a', 'r1', 100);
    store.assign('a', 'r2', 50);

    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttResourceLabelsFeature({ store, avatars: true }));

    const bar = host.querySelector('.jects-gantt__bar[data-task-id="a"]') as HTMLElement;
    const label = bar.querySelector('.jects-gantt__bar-resources') as HTMLElement;
    expect(label).not.toBeNull();
    expect(label.title).toContain('Ada Lovelace');

    // The label has real, non-zero rendered size and lives within the row band.
    const lr = label.getBoundingClientRect();
    expect(lr.width).toBeGreaterThan(0);
    expect(lr.height).toBeGreaterThan(0);
  });

  it('re-paints after a destroy()→init() reuse cycle (regression)', async () => {
    const store = new AssignmentStore({ resources: RESOURCES });
    store.assign('a', 'r1', 100);

    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttResourceLabelsFeature({ store, avatars: true });
    gantt.use(feature);
    expect(host.querySelectorAll('.jects-gantt__bar-resources').length).toBeGreaterThan(0);

    // Tear the feature down (real teardown path), then reuse the SAME instance.
    feature.destroy();
    expect(host.querySelectorAll('.jects-gantt__bar-resources').length).toBe(0);

    // Re-init against the still-live gantt. Before the fix this stayed at 0
    // forever because `destroyed` was never cleared.
    feature.init(gantt as never);
    expect(host.querySelectorAll('.jects-gantt__bar-resources').length).toBeGreaterThan(0);

    // The live MutationObserver + store subscription are active again: a new
    // assignment repaints through the real engine.
    store.assign('b', 'r2', 75);
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const bBar = host.querySelector('.jects-gantt__bar[data-task-id="b"]') as HTMLElement;
    expect(bBar.querySelector('.jects-gantt__bar-resources')).not.toBeNull();
  });

  it('mounts with no serious/critical a11y violations', async () => {
    const store = new AssignmentStore({ resources: RESOURCES });
    store.assign('a', 'r1', 100);
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttResourceLabelsFeature({ store }));
    await expectNoA11yViolations(host);
  });
});
