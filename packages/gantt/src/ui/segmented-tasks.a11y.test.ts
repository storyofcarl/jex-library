/**
 * axe-core a11y + visual/interaction browser test for the Gantt **split /
 * segmented tasks** feature (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the feature end to
 * end on a real `Gantt` + engine + real CSS: a split task renders one sub-bar per
 * working segment joined by a dashed connector, the sub-bars paint at their real
 * pixel positions ordered left→right with a positive gap between them, a
 * programmatic `split` adds a piece and `join` collapses it, and `destroy()`
 * removes the overlays.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the shipped, token-pure package stylesheet so the geometry assertions
// exercise the real CSS rather than unstyled defaults.
import '../styles.css';
// Defensive: also import the feature stylesheet directly in case the aggregate
// has not yet been wired by the integrator.
import './segmented-tasks.css';
import { Gantt } from './gantt.js';
import { GanttSegmentedTasksFeature } from './segmented-tasks.js';
import { readSegments } from '../engine/segments.js';
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
    {
      id: 't1',
      name: 'Foundations',
      start: T0,
      end: T0 + 6 * DAY,
      duration: 4 * DAY,
      segments: [
        { start: T0, end: T0 + 2 * DAY },
        { start: T0 + 4 * DAY, end: T0 + 6 * DAY },
      ],
    } as TaskModel,
    { id: 't2', name: 'Walls', start: T0 + 7 * DAY, end: T0 + 9 * DAY, duration: 2 * DAY } as TaskModel,
  ];
}

describe('GanttSegmentedTasksFeature a11y + visual (real Chromium)', () => {
  it('paints segment sub-bars + a connector on a split task with no serious/critical violations', async () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const feature = new GanttSegmentedTasksFeature();
    gantt.use(feature);
    feature.paint();

    await expectNoA11yViolations(host);

    const bar = gantt.el.querySelector(
      '.jects-gantt__bar[data-task-id="t1"]',
    ) as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.dataset.split).toBe('2');

    const overlay = bar.querySelector('.jects-gantt__segments') as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.getAttribute('role')).toBe('group');
    expect(overlay.getAttribute('aria-label')).toMatch(/split into 2 working segments/i);

    const subBars = overlay.querySelectorAll<HTMLElement>('.jects-gantt__segment');
    expect(subBars).toHaveLength(2);
    const connectors = overlay.querySelectorAll<HTMLElement>('.jects-gantt__segment-connector');
    expect(connectors).toHaveLength(1);

    // Real geometry: the sub-bars occupy real width and the second starts to the
    // right of the first with a positive gap (the connector bridges it).
    const r0 = subBars[0]!.getBoundingClientRect();
    const r1 = subBars[1]!.getBoundingClientRect();
    expect(r0.width).toBeGreaterThan(0);
    expect(r1.width).toBeGreaterThan(0);
    expect(r1.left).toBeGreaterThan(r0.right);
    expect(connectors[0]!.getBoundingClientRect().width).toBeGreaterThan(0);
  });

  it('split then join round-trips through the engine and re-renders', async () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const feature = new GanttSegmentedTasksFeature();
    gantt.use(feature);
    feature.paint();

    // Split the second piece again → 3 segments.
    const ok = feature.split('t1', T0 + 5 * DAY);
    expect(ok).toBe(true);
    feature.paint();
    expect(readSegments(gantt.getTask('t1')!).length).toBeGreaterThanOrEqual(3);

    await expectNoA11yViolations(host);

    // Join every gap → back to a single contiguous bar (no overlay).
    feature.joinAll('t1');
    feature.paint();
    expect(readSegments(gantt.getTask('t1')!).length).toBeLessThan(2);
    const bar = gantt.el.querySelector('.jects-gantt__bar[data-task-id="t1"]') as HTMLElement;
    expect(bar.dataset.split).toBeUndefined();
  });

  it('removes its overlays on destroy()', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const feature = new GanttSegmentedTasksFeature();
    gantt.use(feature);
    feature.paint();
    expect(gantt.el.querySelector('.jects-gantt__segments')).not.toBeNull();

    feature.destroy();
    expect(gantt.el.querySelector('.jects-gantt__segments')).toBeNull();
  });
});
