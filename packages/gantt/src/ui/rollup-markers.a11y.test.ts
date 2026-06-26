/**
 * axe-core a11y + visual/interaction browser test for the Gantt **child-task
 * rollup markers** feature (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the feature end to
 * end on a real `Gantt` + engine + real CSS: collapsing a summary projects each
 * hidden child task / milestone as a thin marker onto the summary bar, the
 * markers paint at their real pixel positions ordered left→right and stay within
 * the summary bar's own box, and re-expanding the summary removes them.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the shipped, token-pure package stylesheet so the geometry assertions
// exercise the real CSS rather than unstyled defaults.
import '../styles.css';
import { type TreeStore, type RecordId } from '@jects/core';
import { Gantt } from './gantt.js';
import { GanttRollupFeature } from './rollup-markers.js';
import type { TaskModel } from '../contract.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.position = 'relative';
  host.style.height = '320px';
  host.style.width = '960px';
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

function plan(): TaskModel[] {
  return [
    { id: 'parent', name: 'Phase 1', rollup: true } as TaskModel,
    { id: 'a', name: 'Design', parentId: 'parent', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY, rollup: true } as TaskModel,
    { id: 'b', name: 'Build', parentId: 'parent', start: T0 + 3 * DAY, duration: 3 * DAY, end: T0 + 6 * DAY, rollup: true } as TaskModel,
    { id: 'm', name: 'Sign-off', parentId: 'parent', start: T0 + 6 * DAY, milestone: true, rollup: true } as TaskModel,
  ];
}

function collapse(g: Gantt, id: RecordId): void {
  const store = (g as unknown as { _store: TreeStore<TaskModel> })._store;
  store.collapse(id);
  (g as unknown as { refreshPanes(): void }).refreshPanes();
}

describe('GanttRollupFeature a11y + visual (real Chromium)', () => {
  it('paints child rollup markers on a collapsed summary with no serious/critical violations', async () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const feature = new GanttRollupFeature();
    gantt.use(feature);

    collapse(gantt, 'parent');
    feature.paint();

    await expectNoA11yViolations(host);

    const bar = gantt.el.querySelector('.jects-gantt__bar--summary[data-task-id="parent"]') as HTMLElement;
    expect(bar).not.toBeNull();
    const overlay = bar.querySelector('.jects-gantt__rollups') as HTMLElement;
    expect(overlay).not.toBeNull();
    // The overlay is exposed to AT as a labelled image describing the rollup.
    expect(overlay.getAttribute('role')).toBe('img');
    expect(overlay.getAttribute('aria-label')).toContain('rolled-up child');

    const markers = [...overlay.querySelectorAll('.jects-gantt__rollup')] as HTMLElement[];
    expect(markers).toHaveLength(3);

    // Real geometry: every marker sits inside the summary bar and the three
    // children paint left→right in schedule order (a → b → milestone).
    const barRect = bar.getBoundingClientRect();
    const centres = markers.map((m) => {
      const r = m.getBoundingClientRect();
      // Each marker must lie within the summary bar's horizontal box.
      expect(r.left).toBeGreaterThanOrEqual(barRect.left - 1);
      expect(r.right).toBeLessThanOrEqual(barRect.right + 1);
      return r.left + r.width / 2;
    });
    expect(centres[0]).toBeLessThan(centres[1]);
    expect(centres[1]).toBeLessThan(centres[2]);

    // The milestone child renders as the diamond marker.
    expect(overlay.querySelector('.jects-gantt__rollup--milestone[data-task-id="m"]')).not.toBeNull();
  });

  it('removes the rollup markers when the summary is expanded again', async () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const feature = new GanttRollupFeature();
    gantt.use(feature);

    collapse(gantt, 'parent');
    feature.paint();
    expect(gantt.el.querySelector('.jects-gantt__rollups')).not.toBeNull();

    const store = (gantt as unknown as { _store: TreeStore<TaskModel> })._store;
    await store.expand('parent');
    (gantt as unknown as { refreshPanes(): void }).refreshPanes();
    feature.paint();

    // Children are visible as their own rows now → no rollup overlay.
    expect(gantt.el.querySelector('.jects-gantt__rollups')).toBeNull();
    await expectNoA11yViolations(host);
  });
});
