/**
 * jsdom unit tests for `GanttResourcePane` — the integrated, axis-synced docked
 * resource pane that wires `ResourceHistogram` + `ResourceUtilizationView` +
 * `ResourceView` into the Gantt shell.
 *
 * Covers:
 *   - the pure helpers (`pickInitialView`, `resolveTaskSpan`, `buildTabs`);
 *   - install: the pane mounts its own docked region under the Gantt root, builds
 *     a tablist toolbar of view toggles + the three view widgets, sharing the
 *     Gantt's time axis;
 *   - toggling views (`showView`) updates `aria-selected`, roving tabindex, and
 *     which panel is shown; keyboard ArrowRight/Home/End move between tabs;
 *   - collapse/expand hides the body and reflects `aria-expanded`;
 *   - live refresh: assigning a resource repaints the active view (the histogram
 *     gains a lane / bars for the new assignment) after a refresh tick;
 *   - the inert empty-state when no resource layer is wired;
 *   - clean teardown through the Gantt feature lifecycle (no leaks).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Gantt } from './gantt.js';
import {
  GanttResourcePane,
  installResourcePane,
  pickInitialView,
  resolveTaskSpan,
  buildTabs,
  GANTT_RESOURCE_PANE_FEATURE,
  type ResourcePaneView,
} from './gantt-resource-pane.js';
import type { TaskModel } from '../contract.js';
import type { ResourceModel, AssignmentModel } from '../resource/resource-contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5); // Monday

let host: HTMLElement;
let gantt: Gantt | null = null;

function tasks(): TaskModel[] {
  return [
    { id: 't1', name: 'Design', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY },
    { id: 't2', name: 'Build', start: T0 + 2 * DAY, duration: 2 * DAY, end: T0 + 4 * DAY },
  ];
}

function resources(): ResourceModel[] {
  return [
    { id: 'r1', name: 'Ada', capacity: 1, hourlyCost: 100 },
    { id: 'r2', name: 'Boris', capacity: 1, hourlyCost: 80 },
  ];
}

function assignments(): AssignmentModel[] {
  return [{ id: 'as1', taskId: 't1', resourceId: 'r1', units: 100 }];
}

function makeGantt(opts: Record<string, unknown> = {}): Gantt {
  return new Gantt(host, {
    projectStart: T0,
    tasks: tasks(),
    resources: resources(),
    assignments: assignments(),
    ...opts,
  } as never);
}

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '800px';
  host.style.height = '500px';
  document.body.appendChild(host);
  // jsdom lacks rAF in some configs; ensure a deterministic, synchronous-ish one.
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 0) as unknown as number) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) =>
      clearTimeout(id as unknown as NodeJS.Timeout)) as typeof cancelAnimationFrame;
  }
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
  vi.restoreAllMocks();
});

/* ── pure helpers ─────────────────────────────────────────────────────────── */

describe('pure helpers', () => {
  it('pickInitialView honours an enabled explicit view, else falls to the first', () => {
    const all: ResourcePaneView[] = ['histogram', 'utilization', 'resources'];
    expect(pickInitialView(all, 'utilization')).toBe('utilization');
    expect(pickInitialView(all, undefined)).toBe('histogram');
    // explicit view not in the enabled set → first enabled
    expect(pickInitialView(['resources'], 'histogram')).toBe('resources');
    // empty set → safe default
    expect(pickInitialView([], undefined)).toBe('histogram');
  });

  it('resolveTaskSpan prefers the engine schedule, falls back to task fields', () => {
    const sched = (id: string) => (id === 's' ? { start: 10, end: 20 } : undefined);
    const getTask = (id: string) =>
      ({ id, start: 100, duration: 50 }) as unknown as TaskModel;
    // schedule present + valid
    expect(resolveTaskSpan('s', sched as never, getTask as never)).toEqual({ start: 10, end: 20 });
    // no schedule → task.start + duration
    expect(resolveTaskSpan('x', sched as never, getTask as never)).toEqual({ start: 100, end: 150 });
    // missing task → undefined
    expect(
      resolveTaskSpan('x', () => undefined, () => undefined),
    ).toBeUndefined();
    // task without start → undefined
    expect(
      resolveTaskSpan('x', () => undefined, (() => ({ id: 'x' })) as never),
    ).toBeUndefined();
  });

  it('buildTabs maps every enabled view to a labelled tab in order', () => {
    expect(buildTabs(['resources', 'histogram'])).toEqual([
      { view: 'resources', label: 'Resources' },
      { view: 'histogram', label: 'Histogram' },
    ]);
  });
});

/* ── install + structure ──────────────────────────────────────────────────── */

describe('install + structure', () => {
  it('mounts a docked region with a tablist of view toggles + three panels', () => {
    gantt = makeGantt();
    const pane = installResourcePane(gantt);

    expect(gantt.features.get(GANTT_RESOURCE_PANE_FEATURE)).toBe(pane);
    const root = pane.element!;
    expect(root).toBeTruthy();
    // It is docked under the Gantt root.
    expect(gantt.el.contains(root)).toBe(true);
    expect(root.getAttribute('role')).toBe('region');

    const tablist = root.querySelector('[role="tablist"]')!;
    expect(tablist).toBeTruthy();
    const tabs = root.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(3);
    expect([...tabs].map((t) => t.getAttribute('data-view'))).toEqual([
      'histogram',
      'utilization',
      'resources',
    ]);

    const panels = root.querySelectorAll('[role="tabpanel"]');
    expect(panels).toHaveLength(3);
    // Each panel is wired to its tab.
    for (const view of ['histogram', 'utilization', 'resources']) {
      const tab = root.querySelector(`#jects-gantt-resource-pane-tab-${view}`)!;
      const panel = root.querySelector(`#jects-gantt-resource-pane-panel-${view}`)!;
      expect(tab.getAttribute('aria-controls')).toBe(panel.id);
      expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
    }
  });

  it('mounts the histogram against the shared Gantt axis (lane for the assignment)', () => {
    gantt = makeGantt();
    const pane = installResourcePane(gantt);
    const histPanel = pane.element!.querySelector(
      '#jects-gantt-resource-pane-panel-histogram',
    )!;
    // The histogram widget rendered a lane for the assigned resource.
    const lanes = histPanel.querySelectorAll('.jects-resource-histogram__lane');
    expect(lanes.length).toBeGreaterThanOrEqual(1);
  });

  it('restricts to a subset of views when configured', () => {
    gantt = makeGantt();
    const pane = installResourcePane(gantt, { views: ['histogram'] });
    expect(pane.element!.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(pane.view).toBe('histogram');
  });

  it('honours initialView', () => {
    gantt = makeGantt();
    const pane = installResourcePane(gantt, { initialView: 'resources' });
    expect(pane.view).toBe('resources');
    const tab = pane.element!.querySelector('#jects-gantt-resource-pane-tab-resources')!;
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });
});

/* ── view toggling ────────────────────────────────────────────────────────── */

describe('view toggling', () => {
  it('showView updates aria-selected, roving tabindex, and panel visibility', () => {
    gantt = makeGantt();
    const pane = installResourcePane(gantt);
    const root = pane.element!;

    const histTab = root.querySelector<HTMLButtonElement>('#jects-gantt-resource-pane-tab-histogram')!;
    const utilTab = root.querySelector<HTMLButtonElement>('#jects-gantt-resource-pane-tab-utilization')!;
    const histPanel = root.querySelector<HTMLElement>('#jects-gantt-resource-pane-panel-histogram')!;
    const utilPanel = root.querySelector<HTMLElement>('#jects-gantt-resource-pane-panel-utilization')!;

    // initial: histogram active
    expect(histTab.getAttribute('aria-selected')).toBe('true');
    expect(histTab.tabIndex).toBe(0);
    expect(utilTab.tabIndex).toBe(-1);
    expect(histPanel.hidden).toBe(false);
    expect(utilPanel.hidden).toBe(true);

    pane.showView('utilization');
    expect(pane.view).toBe('utilization');
    expect(utilTab.getAttribute('aria-selected')).toBe('true');
    expect(histTab.getAttribute('aria-selected')).toBe('false');
    expect(utilTab.tabIndex).toBe(0);
    expect(utilPanel.hidden).toBe(false);
    expect(histPanel.hidden).toBe(true);
  });

  it('clicking a tab switches the view', () => {
    gantt = makeGantt();
    const pane = installResourcePane(gantt);
    const resTab = pane.element!.querySelector<HTMLButtonElement>(
      '#jects-gantt-resource-pane-tab-resources',
    )!;
    resTab.click();
    expect(pane.view).toBe('resources');
  });

  it('keyboard ArrowRight / Home / End move between tabs', () => {
    gantt = makeGantt();
    const pane = installResourcePane(gantt);
    const histTab = pane.element!.querySelector<HTMLButtonElement>(
      '#jects-gantt-resource-pane-tab-histogram',
    )!;
    histTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(pane.view).toBe('utilization');

    const utilTab = pane.element!.querySelector<HTMLButtonElement>(
      '#jects-gantt-resource-pane-tab-utilization',
    )!;
    utilTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(pane.view).toBe('resources');

    const resTab = pane.element!.querySelector<HTMLButtonElement>(
      '#jects-gantt-resource-pane-tab-resources',
    )!;
    resTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(pane.view).toBe('histogram');
  });
});

/* ── collapse / expand ────────────────────────────────────────────────────── */

describe('collapse / expand', () => {
  it('toggles the body and reflects aria-expanded', () => {
    gantt = makeGantt();
    const pane = installResourcePane(gantt);
    const root = pane.element!;
    const body = root.querySelector<HTMLElement>('.jects-gantt-resource-pane__body')!;
    const collapseBtn = root.querySelector<HTMLButtonElement>('.jects-gantt-resource-pane__collapse')!;

    expect(pane.isCollapsed).toBe(false);
    expect(collapseBtn.getAttribute('aria-expanded')).toBe('true');
    expect(body.hidden).toBe(false);

    collapseBtn.click();
    expect(pane.isCollapsed).toBe(true);
    expect(collapseBtn.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true);
    expect(root.classList.contains('jects-gantt-resource-pane--collapsed')).toBe(true);

    // selecting a tab re-expands (reference behaviour)
    pane.showView('utilization');
    expect(pane.isCollapsed).toBe(false);
  });

  it('starts collapsed when configured', () => {
    gantt = makeGantt();
    const pane = installResourcePane(gantt, { collapsed: true });
    expect(pane.isCollapsed).toBe(true);
    const body = pane.element!.querySelector<HTMLElement>('.jects-gantt-resource-pane__body')!;
    expect(body.hidden).toBe(true);
  });
});

/* ── live refresh ─────────────────────────────────────────────────────────── */

describe('live refresh', () => {
  it('repaints the active histogram view after an assignment (new lane appears)', async () => {
    gantt = makeGantt();
    const pane = installResourcePane(gantt);
    const histPanel = pane.element!.querySelector<HTMLElement>(
      '#jects-gantt-resource-pane-panel-histogram',
    )!;
    const before = histPanel.querySelectorAll('.jects-resource-histogram__lane').length;

    // Assign the second resource to t2 → its histogram lane should now be populated.
    gantt.resources!.assign('t2', 'r2', 100);
    // Flush the coalesced refresh tick.
    await new Promise((r) => setTimeout(r, 5));
    pane.refresh();

    const after = histPanel.querySelectorAll(
      '.jects-resource-histogram__lane[data-resource-id="r2"] .jects-resource-histogram__bar:not(.jects-resource-histogram__bar--empty)',
    ).length;
    expect(after).toBeGreaterThan(0);
    expect(before).toBeGreaterThanOrEqual(0);
  });

  it('refresh() repaints the active view synchronously', () => {
    gantt = makeGantt();
    const pane = installResourcePane(gantt, { initialView: 'utilization' });
    // Should not throw and should keep the utilization grid present.
    pane.refresh();
    const grid = pane.element!.querySelector('.jects-resource-utilization');
    expect(grid).toBeTruthy();
  });
});

/* ── inert when no resource layer ─────────────────────────────────────────── */

describe('no resource layer', () => {
  it('renders an inert empty state when the Gantt has no resources', () => {
    gantt = new Gantt(host, { projectStart: T0, tasks: tasks() } as never);
    const pane = installResourcePane(gantt);
    expect(gantt.resources).toBeUndefined();
    const empties = pane.element!.querySelectorAll('.jects-gantt-resource-pane__empty');
    expect(empties.length).toBeGreaterThan(0);
    // Still toggles cleanly.
    expect(() => pane.showView('resources')).not.toThrow();
  });
});

/* ── teardown ─────────────────────────────────────────────────────────────── */

describe('teardown', () => {
  it('removes its owned root and disposes mounted views on destroy', () => {
    gantt = makeGantt();
    const pane = new GanttResourcePane();
    gantt.use(pane);
    const root = pane.element!;
    expect(gantt.el.contains(root)).toBe(true);

    pane.destroy();
    expect(pane.element).toBeNull();
    expect(root.isConnected).toBe(false);
    expect(gantt.features.get(GANTT_RESOURCE_PANE_FEATURE)).toBeUndefined();
  });

  it('is torn down when the host Gantt is destroyed', () => {
    gantt = makeGantt();
    const pane = installResourcePane(gantt);
    const root = pane.element!;
    gantt.destroy();
    gantt = null;
    expect(root.isConnected).toBe(false);
  });

  it('destroy is idempotent', () => {
    gantt = makeGantt();
    const pane = installResourcePane(gantt);
    pane.destroy();
    expect(() => pane.destroy()).not.toThrow();
  });

  it('mounts into a supplied element instead of owning the root', () => {
    gantt = makeGantt();
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const pane = installResourcePane(gantt, { mountInto: mount });
    expect(pane.element).toBe(mount);
    expect(mount.classList.contains('jects-gantt-resource-pane')).toBe(true);
    // Destroying does NOT remove a borrowed mount element.
    pane.destroy();
    expect(mount.isConnected).toBe(true);
    mount.remove();
  });
});
