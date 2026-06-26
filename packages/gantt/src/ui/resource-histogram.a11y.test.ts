/**
 * axe-core a11y + visual/interaction browser test for the Gantt **Resource
 * Histogram** view (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the feature end to
 * end on a real `Gantt` (for the shared time axis) + a `ResourceManager`: the
 * histogram paints one lane per resource with time-positioned bucket columns
 * sharing the Gantt axis; an over-allocated resource's lane + bars carry the
 * over-allocation accent and accessible name; the capacity line is present; and
 * clicking a column emits `bucketActivate`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the shipped, token-pure package stylesheet so the geometry/contrast
// assertions exercise the real CSS rather than unstyled defaults.
import '../styles.css';
import { Gantt } from './gantt.js';
import { ResourceHistogram } from './resource-histogram.js';
import { ResourceManager } from '../resource/resource-manager.js';
import type { TaskModel } from '../contract.js';
import type { ResourceModel } from '../resource/resource-contract.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let ganttHost: HTMLElement;
let histHost: HTMLElement;
let gantt: Gantt | null = null;
let hist: ResourceHistogram | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '960px';
  host.style.height = '480px';
  host.style.position = 'relative';
  ganttHost = document.createElement('div');
  ganttHost.style.height = '240px';
  histHost = document.createElement('div');
  histHost.style.height = '200px';
  histHost.style.width = '960px';
  host.append(ganttHost, histHost);
  document.body.appendChild(host);
});

afterEach(() => {
  hist?.destroy();
  hist = null;
  gantt?.destroy();
  gantt = null;
  host.remove();
});

function tasks(): TaskModel[] {
  return [
    { id: 't1', name: 'Design', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY } as TaskModel,
    { id: 't2', name: 'Build', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY } as TaskModel,
    { id: 't3', name: 'Test', start: T0 + 2 * DAY, duration: 2 * DAY, end: T0 + 4 * DAY } as TaskModel,
  ];
}

const resources: ResourceModel[] = [
  { id: 'ada', name: 'Ada Lovelace', capacity: 1 },
  { id: 'boris', name: 'Boris', capacity: 1 },
];

function build(): { gantt: Gantt; mgr: ResourceManager; hist: ResourceHistogram } {
  const g = new Gantt(ganttHost, { tasks: tasks(), projectStart: T0 });
  const mgr = new ResourceManager({ resources });
  g.use(mgr);
  // Over-allocate Ada: full time on BOTH t1 and t2 across the same two days.
  mgr.assign('t1', 'ada', 100);
  mgr.assign('t2', 'ada', 100);
  mgr.assign('t3', 'boris', 100);
  const h = new ResourceHistogram(histHost, {
    api: mgr,
    axis: g.timeline.axis,
    getTaskSpan: (id) => g.getTask(id),
    bucketMs: DAY,
  });
  return { gantt: g, mgr, hist: h };
}

describe('ResourceHistogram a11y + visual (real Chromium)', () => {
  it('paints lanes + bucket columns + capacity line with no serious/critical violations', async () => {
    const built = build();
    gantt = built.gantt;
    hist = built.hist;

    await expectNoA11yViolations(host);

    const root = histHost.querySelector('.jects-resource-histogram') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute('role')).toBe('group');
    expect(root.getAttribute('aria-label')).toBe('Resource histogram');

    // One lane per resource.
    const lanes = histHost.querySelectorAll('.jects-resource-histogram__lane');
    expect(lanes.length).toBe(2);

    // Each lane has a capacity line and bucket columns.
    const adaLane = histHost.querySelector(
      '.jects-resource-histogram__lane[data-resource-id="ada"]',
    ) as HTMLElement;
    expect(adaLane.querySelector('.jects-resource-histogram__capacity')).not.toBeNull();
    const adaBars = adaLane.querySelectorAll('.jects-resource-histogram__bar');
    expect(adaBars.length).toBeGreaterThan(0);
  });

  it('flags the over-allocated resource and renders its bars above capacity', async () => {
    const built = build();
    gantt = built.gantt;
    hist = built.hist;

    const adaLane = histHost.querySelector(
      '.jects-resource-histogram__lane[data-resource-id="ada"]',
    ) as HTMLElement;
    // Ada is over-allocated (200% > 100% capacity).
    expect(adaLane.classList.contains('jects-resource-histogram__lane--over')).toBe(true);
    const over = adaLane.querySelector('.jects-resource-histogram__bar--over') as HTMLElement;
    expect(over).not.toBeNull();
    expect(over.getAttribute('aria-label')).toContain('over-allocated');

    // Visual: the over-allocated bar is taller than the capacity-line height
    // (its allocation exceeds the capacity ceiling).
    const plot = adaLane.querySelector('.jects-resource-histogram__plot') as HTMLElement;
    const cap = adaLane.querySelector('.jects-resource-histogram__capacity') as HTMLElement;
    const plotRect = plot.getBoundingClientRect();
    const barRect = over.getBoundingClientRect();
    const capRect = cap.getBoundingClientRect();
    const barTopFromFloor = plotRect.bottom - barRect.top;
    const capFromFloor = plotRect.bottom - capRect.top;
    expect(barTopFromFloor).toBeGreaterThan(capFromFloor - 1);

    // Boris is NOT over-allocated.
    const borisLane = histHost.querySelector(
      '.jects-resource-histogram__lane[data-resource-id="boris"]',
    ) as HTMLElement;
    expect(borisLane.classList.contains('jects-resource-histogram__lane--over')).toBe(false);
  });

  it('shares the Gantt axis: a bucket column lines up with the timeline x', async () => {
    const built = build();
    gantt = built.gantt;
    hist = built.hist;

    const axis = gantt.timeline.axis;
    const expectedX = axis.toX(T0); // x of the first bucket on the shared axis
    const firstBar = histHost.querySelector(
      '.jects-resource-histogram__lane[data-resource-id="ada"] .jects-resource-histogram__bar',
    ) as HTMLElement;
    expect(parseFloat(firstBar.style.left)).toBeCloseTo(expectedX, 0);
  });

  it('emits bucketActivate when a column is clicked', async () => {
    const built = build();
    gantt = built.gantt;
    hist = built.hist;

    let fired: { resourceId: string | number; over: boolean } | undefined;
    hist.on('bucketActivate', (p) => (fired = p));
    const bar = histHost.querySelector(
      '.jects-resource-histogram__lane[data-resource-id="ada"] .jects-resource-histogram__bar--over',
    ) as HTMLElement;
    bar.click();
    expect(fired?.resourceId).toBe('ada');
    expect(fired?.over).toBe(true);
  });
});
