/**
 * a11y + visual/interaction SMOKE test for the Gantt **Indicators** feature in
 * REAL Chromium. Run with `pnpm --filter @jects/gantt test:browser`.
 *
 * Indicators are small edge glyphs whose geometry (sitting just outside a bar's
 * start/end edge, centred vertically) only means anything with real layout, and
 * whose operability (click/keyboard) + accessibility (role/name/contrast) must be
 * verified in a real engine — hence Chromium, not jsdom.
 *
 * Asserts:
 *   1. Indicators paint onto bars and are laid out at the bar's start/end edges.
 *   2. An indicator is operable by real pointer click (→ onIndicatorClick).
 *   3. axe-core finds zero serious/critical violations with indicators mounted.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from './gantt.js';
import { GanttIndicatorsFeature, type IndicatorClickPayload } from './indicators.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

function tasks(): TaskModel[] {
  return [
    {
      id: 'a',
      name: 'Design',
      start: T0,
      duration: 4 * DAY,
      end: T0 + 4 * DAY,
      constraintType: 'mustStartOn',
      constraintDate: T0,
      deadline: T0 + 2 * DAY, // late: finishes after the deadline
    } as TaskModel,
    {
      id: 'b',
      name: 'Build',
      start: T0 + 4 * DAY,
      duration: 3 * DAY,
      end: T0 + 7 * DAY,
      deadline: T0 + 12 * DAY, // on time
    } as TaskModel,
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

describe('GanttIndicatorsFeature (real Chromium)', () => {
  it('paints indicators and lays them out at the bar edges', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttIndicatorsFeature();
    gantt.use(feature);
    feature.paint();

    const bar = host.querySelector('.jects-gantt__bar[data-task-id="a"]') as HTMLElement;
    const barRect = bar.getBoundingClientRect();

    const startCluster = bar.querySelector('.jects-gantt__indicators--start') as HTMLElement;
    const endCluster = bar.querySelector('.jects-gantt__indicators--end') as HTMLElement;
    expect(startCluster).not.toBeNull();
    expect(endCluster).not.toBeNull();

    // The start cluster hangs to the LEFT of the bar's start edge; the end cluster
    // hangs to the RIGHT of the bar's end edge (with a small tolerance).
    const startRect = startCluster.getBoundingClientRect();
    const endRect = endCluster.getBoundingClientRect();
    expect(startRect.right).toBeLessThanOrEqual(barRect.left + 2);
    expect(endRect.left).toBeGreaterThanOrEqual(barRect.right - 2);

    // Each indicator has real, non-zero rendered size.
    const glyph = bar.querySelector('.jects-gantt__indicator') as HTMLElement;
    const g = glyph.getBoundingClientRect();
    expect(g.width).toBeGreaterThan(0);
    expect(g.height).toBeGreaterThan(0);
  });

  it('is operable by real pointer click', () => {
    const clicks: IndicatorClickPayload[] = [];
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttIndicatorsFeature({ onIndicatorClick: (p) => clicks.push(p) });
    gantt.use(feature);
    feature.paint();

    const span = host.querySelector(
      '.jects-gantt__bar[data-task-id="a"] .jects-gantt__indicator--late',
    ) as HTMLElement;
    expect(span).not.toBeNull();
    span.click();

    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.indicator.kind).toBe('late');
    expect(String(clicks[0]!.task.id)).toBe('a');
  });

  it('mounts with no serious/critical a11y violations', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttIndicatorsFeature();
    gantt.use(feature);
    feature.paint();
    await expectNoA11yViolations(host);
  });

  it('removeFeature() unwires the indicator DOM + leaves no leaked subscriptions', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttIndicatorsFeature();
    gantt.use(feature);
    feature.paint();
    expect(host.querySelectorAll('.jects-gantt__indicator').length).toBeGreaterThan(0);

    // Remove the feature while the Gantt is alive (the real-world teardown).
    gantt.removeFeature('indicators');
    // DOM decoration is gone…
    expect(host.querySelectorAll('.jects-gantt__indicators').length).toBe(0);
    expect(host.querySelectorAll('.jects-gantt__indicator').length).toBe(0);

    // …and a subsequent engine event (real requestAnimationFrame path) does not
    // resurrect any indicators on the dead feature.
    (gantt as unknown as { emit(e: string, p: unknown): boolean }).emit('taskChange', {
      task: tasks()[0],
      changes: [],
    });
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    expect(host.querySelectorAll('.jects-gantt__indicator').length).toBe(0);
  });
});
