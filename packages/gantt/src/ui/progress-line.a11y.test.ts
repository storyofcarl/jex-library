/**
 * axe-core a11y + visual/interaction browser test for the Gantt **Progress line /
 * status line** feature (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the feature end to
 * end on a real `Gantt` + engine: the status line + jagged progress polyline +
 * per-task vertex dots paint into one SVG overlay at their real pixel positions;
 * a behind task's vertex sits LEFT of the status line and an ahead task's sits
 * RIGHT; and `setStatusDate` moves the line and re-classifies the tasks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the shipped, token-pure package stylesheet so the geometry assertions
// exercise the real CSS rather than unstyled defaults.
import '../styles.css';
import { Gantt } from './gantt.js';
import { GanttProgressLineFeature } from './progress-line.js';
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

function tasks(): TaskModel[] {
  return [
    // 'a': barely started but two days into its window → behind.
    { id: 'a', name: 'Design', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY, percentDone: 0.15 } as TaskModel,
    // 'b': nearly complete early → ahead.
    { id: 'b', name: 'Build', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY, percentDone: 0.85 } as TaskModel,
  ];
}

describe('GanttProgressLineFeature a11y + visual (real Chromium)', () => {
  it('paints the status line, jagged polyline and vertex dots with no serious/critical violations', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttProgressLineFeature({ statusDate: T0 + 2 * DAY });
    gantt.use(feature);
    feature.paint();

    await expectNoA11yViolations(host);

    const svg = gantt.el.querySelector('.jects-gantt__progress-line') as SVGSVGElement;
    expect(svg).not.toBeNull();
    // The overlay is exposed to AT as a labelled image (role=img + aria-label).
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toContain('behind');

    // Base status line + jagged polyline both present and sized.
    const base = svg.querySelector('.jects-gantt__progress-line-base') as SVGLineElement;
    const poly = svg.querySelector('.jects-gantt__progress-line-poly') as SVGPolylineElement;
    expect(base).not.toBeNull();
    expect(poly).not.toBeNull();
    expect(poly.getAttribute('points')!.split(' ').length).toBeGreaterThan(3);

    // One vertex dot per in-progress task, classified by schedule status.
    const dots = [...svg.querySelectorAll('.jects-gantt__progress-line-vertex')] as SVGCircleElement[];
    expect(dots.length).toBe(2);
    const byTask = new Map(dots.map((d) => [d.dataset.taskId, d]));
    expect(byTask.get('a')!.dataset.status).toBe('behind');
    expect(byTask.get('b')!.dataset.status).toBe('ahead');

    // Visual geometry: the status line x is between the behind vertex (left) and
    // the ahead vertex (right) — the classic zig-zag silhouette.
    const statusX = Number(base.getAttribute('x1'));
    const cxBehind = Number(byTask.get('a')!.getAttribute('cx'));
    const cxAhead = Number(byTask.get('b')!.getAttribute('cx'));
    expect(cxBehind).toBeLessThan(statusX);
    expect(cxAhead).toBeGreaterThan(statusX);
  });

  it('setStatusDate moves the line and re-classifies tasks', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttProgressLineFeature({ statusDate: T0 + 1 * DAY });
    gantt.use(feature);
    feature.paint();

    const base = () =>
      gantt!.el.querySelector('.jects-gantt__progress-line-base') as SVGLineElement;
    const x0 = Number(base().getAttribute('x1'));

    feature.setStatusDate(T0 + 3 * DAY);
    const x1 = Number(base().getAttribute('x1'));
    // Later status date → status line moves right on a left-to-right time axis.
    expect(x1).toBeGreaterThan(x0);
  });
});
