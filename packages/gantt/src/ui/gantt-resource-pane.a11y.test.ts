/**
 * axe-core a11y + visual/interaction browser test for `GanttResourcePane` — the
 * integrated, axis-synced docked resource pane (Quality Gate Q2). Runs in real
 * Chromium via `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the feature end to
 * end on a real `Gantt` with a resource layer:
 *   - the pane mounts a docked region under the Gantt root with a tablist toolbar
 *     (histogram / utilization / resources) + a collapse toggle;
 *   - the histogram panel shares the Gantt's time axis (its content width matches
 *     the axis content width — the basis for horizontal scroll lockstep);
 *   - switching tabs via click + keyboard moves focus and selection accessibly;
 *   - assigning a resource live-refreshes the active view;
 *   - collapse/expand hides the body and stays accessible.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the real, token-pure stylesheets so layout / role / contrast are exercised.
import './gantt.css';
import './resource-histogram.css';
import './resource-utilization.css';
import '../resource/resource-view.css';
import './gantt-resource-pane.css';
import { Gantt } from './gantt.js';
import { GanttResourcePane } from './gantt-resource-pane.js';
import type { TaskModel } from '../contract.js';
import type { ResourceModel, AssignmentModel } from '../resource/resource-contract.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;
let pane: GanttResourcePane | null = null;

function tasks(): TaskModel[] {
  return [
    { id: 't1', name: 'Design', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY } as TaskModel,
    { id: 't2', name: 'Build', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY } as TaskModel,
    { id: 't3', name: 'Test', start: T0 + 2 * DAY, duration: 2 * DAY, end: T0 + 4 * DAY } as TaskModel,
  ];
}

const resources: ResourceModel[] = [
  { id: 'ada', name: 'Ada Lovelace', capacity: 1, hourlyCost: 120 },
  { id: 'boris', name: 'Boris', capacity: 1, hourlyCost: 90 },
];

const assignments: AssignmentModel[] = [
  // Over-allocate Ada: full time on BOTH t1 and t2 across the same two days.
  { id: 'as1', taskId: 't1', resourceId: 'ada', units: 100 },
  { id: 'as2', taskId: 't2', resourceId: 'ada', units: 100 },
  { id: 'as3', taskId: 't3', resourceId: 'boris', units: 100 },
];

function build(): { gantt: Gantt; pane: GanttResourcePane } {
  const g = new Gantt(host, { tasks: tasks(), projectStart: T0, resources, assignments });
  const p = new GanttResourcePane();
  g.use(p);
  return { gantt: g, pane: p };
}

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '960px';
  host.style.height = '560px';
  host.style.position = 'relative';
  document.body.appendChild(host);
});

afterEach(() => {
  pane?.destroy();
  pane = null;
  gantt?.destroy();
  gantt = null;
  host.remove();
});

describe('GanttResourcePane a11y + visual (real Chromium)', () => {
  it('mounts a docked tablist pane with three panels and no serious/critical violations', async () => {
    const built = build();
    gantt = built.gantt;
    pane = built.pane;

    await expectNoA11yViolations(host);

    const root = pane.element!;
    expect(root).not.toBeNull();
    expect(gantt.el.contains(root)).toBe(true);
    expect(root.getAttribute('role')).toBe('region');

    const tablist = root.querySelector('[role="tablist"]')!;
    expect(tablist).not.toBeNull();
    expect(root.querySelectorAll('[role="tab"]').length).toBe(3);
    expect(root.querySelectorAll('[role="tabpanel"]').length).toBe(3);
  });

  it('shares the Gantt time axis (histogram panel content width matches the axis)', async () => {
    const built = build();
    gantt = built.gantt;
    pane = built.pane;

    const histPlot = pane.element!.querySelector(
      '.jects-resource-histogram__plot',
    ) as HTMLElement;
    expect(histPlot).not.toBeNull();
    const axisWidth = gantt.timeline.axis.contentWidth;
    // The histogram plot is sized from the shared axis content width.
    expect(histPlot.style.width).toBe(`${Math.max(axisWidth, 1)}px`);
  });

  it('flags Ada as over-allocated in the histogram lane', async () => {
    const built = build();
    gantt = built.gantt;
    pane = built.pane;

    const adaLane = pane.element!.querySelector(
      '.jects-resource-histogram__lane[data-resource-id="ada"]',
    ) as HTMLElement;
    expect(adaLane).not.toBeNull();
    expect(adaLane.classList.contains('jects-resource-histogram__lane--over')).toBe(true);
  });

  it('switches view via click + keeps a11y clean across panels', async () => {
    const built = build();
    gantt = built.gantt;
    pane = built.pane;
    const root = pane.element!;

    const utilTab = root.querySelector<HTMLButtonElement>(
      '#jects-gantt-resource-pane-tab-utilization',
    )!;
    utilTab.click();
    expect(pane.view).toBe('utilization');
    expect(utilTab.getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector('.jects-resource-utilization')).not.toBeNull();
    await expectNoA11yViolations(host);

    const resTab = root.querySelector<HTMLButtonElement>(
      '#jects-gantt-resource-pane-tab-resources',
    )!;
    resTab.click();
    expect(pane.view).toBe('resources');
    expect(root.querySelector('.jects-resource-view')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it('keyboard ArrowRight moves selection and focus across tabs', async () => {
    const built = build();
    gantt = built.gantt;
    pane = built.pane;
    const root = pane.element!;

    const histTab = root.querySelector<HTMLButtonElement>(
      '#jects-gantt-resource-pane-tab-histogram',
    )!;
    histTab.focus();
    histTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(pane.view).toBe('utilization');
    const utilTab = root.querySelector<HTMLButtonElement>(
      '#jects-gantt-resource-pane-tab-utilization',
    )!;
    expect(document.activeElement).toBe(utilTab);
  });

  it('live-refreshes the histogram when a resource is assigned', async () => {
    const built = build();
    gantt = built.gantt;
    pane = built.pane;

    // Boris currently has no bucket bars before T0+2d; assign him to t1 so his
    // lane gains allocation in the first two days.
    gantt.resources!.assign('t1', 'boris', 100);
    pane.refresh();

    const borisBars = pane.element!.querySelectorAll(
      '.jects-resource-histogram__lane[data-resource-id="boris"] .jects-resource-histogram__bar:not(.jects-resource-histogram__bar--empty)',
    );
    expect(borisBars.length).toBeGreaterThan(0);
  });

  it('collapse/expand hides the body and reflects aria-expanded', async () => {
    const built = build();
    gantt = built.gantt;
    pane = built.pane;
    const root = pane.element!;
    const collapseBtn = root.querySelector<HTMLButtonElement>(
      '.jects-gantt-resource-pane__collapse',
    )!;
    const body = root.querySelector<HTMLElement>('.jects-gantt-resource-pane__body')!;

    collapseBtn.click();
    expect(pane.isCollapsed).toBe(true);
    expect(collapseBtn.getAttribute('aria-expanded')).toBe('false');
    expect(getComputedStyle(body).display).toBe('none');
    await expectNoA11yViolations(host);

    collapseBtn.click();
    expect(pane.isCollapsed).toBe(false);
    expect(getComputedStyle(body).display).not.toBe('none');
  });
});
