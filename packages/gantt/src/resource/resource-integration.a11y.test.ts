/**
 * axe-core a11y + interaction browser test for the RESOURCE INTEGRATION
 * (Quality Gate Q2). Run with `pnpm --filter @jects/gantt test:browser`.
 *
 * Mounts a real `Gantt` wired with resources + an effort-driven engine, installs
 * the integration (folds the `ResourceApi`, bridges the effort engine), and in
 * real Chromium:
 *   - asserts zero serious/critical axe violations on the live Gantt + a
 *     `ResourceAssignmentView` reading the folded surface,
 *   - verifies a live assign reflows an effort-driven bar (duration halves) and
 *     the timeline repaints,
 *   - verifies an over-allocated resource is flagged + labelled and the chips
 *     are keyboard-operable.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { Gantt } from '../ui/gantt.js';
import {
  installResourceManagement,
  createResourceGanttEngine,
  type ResourceGantt,
} from './resource-integration.js';
import { ResourceAssignmentView } from './resource-assignment-view.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { TaskModel } from '../contract.js';
import type { ResourceModel } from './resource-contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

const resources: ResourceModel[] = [
  { id: 'r1', name: 'Ada Lovelace', hourlyCost: 120, capacity: 1, group: 'eng' },
  { id: 'r2', name: 'Boris Becker', hourlyCost: 80, capacity: 1, group: 'eng' },
  { id: 'crane', name: 'Crane', type: 'equipment', capacity: 1 },
];

function tasks(): TaskModel[] {
  return [
    {
      id: 'a',
      name: 'Implement',
      start: T0,
      duration: 4 * DAY,
      end: T0 + 4 * DAY,
      effortDriven: true,
    } as TaskModel,
    { id: 'b', name: 'Review', start: T0 + 4 * DAY, duration: 2 * DAY, end: T0 + 6 * DAY },
  ];
}

let host: HTMLElement;
let gantt: Gantt | null = null;
let view: ResourceAssignmentView | null = null;
let api: ResourceGantt;

beforeEach(() => {
  host = document.createElement('div');
  host.style.cssText = 'inline-size: 900px; block-size: 320px; padding: 16px;';
  document.body.appendChild(host);
  gantt = new Gantt(host, {
    tasks: tasks(),
    projectStart: T0,
    engine: createResourceGanttEngine(),
    resources,
  } as never);
  api = installResourceManagement(gantt);
});

afterEach(() => {
  view?.destroy();
  view = null;
  gantt?.destroy();
  gantt = null;
  host.remove();
});

describe('Resource integration a11y + interaction (real Chromium)', () => {
  it('a resource-wired Gantt has no serious/critical violations', async () => {
    api.assign('a', 'r1', 100);
    api.assign('a', 'r2', 50);
    await expectNoA11yViolations(host);
  });

  it('a live assign reflows the effort-driven bar (duration halves) and repaints', async () => {
    api.assign('a', 'r1', 100);
    expect(gantt!.getTask('a')!.duration).toBe(4 * DAY);

    const widthBefore = barWidth('a');
    api.assign('a', 'r2', 100); // Σ 200% ⇒ duration halves to 2 days.
    expect(gantt!.getTask('a')!.duration).toBe(2 * DAY);

    const widthAfter = barWidth('a');
    // The bar visibly shrinks (effort-driven reflow painted to the timeline).
    expect(widthAfter).toBeLessThan(widthBefore);
  });

  it('flags + labels an over-allocated resource; chips are keyboard-operable', async () => {
    api.assign('a', 'r1', 100);
    api.assign('b', 'r1', 100); // 200% across two tasks ⇒ over capacity (100%).
    expect(api.isOverAllocated('r1')).toBe(true);

    // The view reads the FOLDED Gantt surface (api === gantt).
    const viewHost = document.createElement('div');
    host.appendChild(viewHost);
    view = new ResourceAssignmentView(viewHost, { api, taskId: 'a' });

    const over = viewHost.querySelector<HTMLElement>('.jects-resource-chips__chip--over');
    expect(over).toBeTruthy();
    expect(over!.getAttribute('aria-label')).toContain('over-allocated');

    let fired: string | number | undefined;
    view.on('chipActivate', ({ resourceId }) => (fired = resourceId));
    over!.focus();
    expect(document.activeElement).toBe(over);
    over!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(fired).toBe('r1');

    await expectNoA11yViolations(host);
  });
});

/** Pixel width of the timeline bar for a task id (0 when not painted). */
function barWidth(taskId: string): number {
  const bar = gantt!.el.querySelector<HTMLElement>(
    `.jects-gantt__bar[data-task-id="${taskId}"]`,
  );
  return bar ? bar.getBoundingClientRect().width : 0;
}
