/**
 * axe-core a11y + visual/interaction browser test for the PERT / network-diagram
 * chart view (Quality Gate Q2), in REAL Chromium.
 * Run with `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the feature end to
 * end against a REAL CPM schedule result with real layout/geometry:
 *   1. Node boxes paint at their laid-out pixel positions, later layers to the
 *      right of earlier ones, with the critical path tinted.
 *   2. Dependency edges paint as SVG paths between the right boxes; critical edges
 *      get the critical class.
 *   3. A node is keyboard-operable: focus → Enter activates; selection is mirrored
 *      to `aria-pressed` and routes a `nodeSelect` event (the Gantt-sync seam).
 *   4. Wheel zoom changes the content transform (pan/zoom works in a real browser).
 *   5. The mounted figure has zero serious/critical a11y violations.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the real, shipped stylesheet so the geometry assertions exercise the
// token-pure CSS (absolute node boxes, transformed content) not unstyled defaults.
import '../styles.css';
import { CpmEngine } from '../engine/scheduler.js';
import {
  GanttPertChart,
  fromScheduleResult,
  type PertChartNode,
} from './pert-chart.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { CalendarModel, DependencyModel, TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

const cal247: CalendarModel = {
  id: 'c',
  week: Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    intervals: [{ from: 0, to: 1440 }],
  })),
};

function snapshot(): { nodes: PertChartNode[]; edges: ReturnType<typeof build>['edges'] } {
  const { tasks, deps, engine } = build();
  const result = engine.schedule({ projectStart: T0 });
  return fromScheduleResult(tasks, deps, result);
}

function build(): { tasks: TaskModel[]; deps: DependencyModel[]; engine: CpmEngine } {
  const tasks: TaskModel[] = [
    { id: 'a', name: 'Analyse', calendarId: 'c', duration: 2 * DAY },
    { id: 'b', name: 'Build', calendarId: 'c', duration: 4 * DAY },
    { id: 'c', name: 'Check', calendarId: 'c', duration: DAY },
    { id: 'd', name: 'Deliver', calendarId: 'c', duration: 2 * DAY },
  ];
  const deps: DependencyModel[] = [
    { id: 'ab', fromId: 'a', toId: 'b', type: 'FS' },
    { id: 'ac', fromId: 'a', toId: 'c', type: 'FS' },
    { id: 'bd', fromId: 'b', toId: 'd', type: 'FS' },
    { id: 'cd', fromId: 'c', toId: 'd', type: 'FS' },
  ];
  const engine = new CpmEngine();
  engine.setCalendars([cal247], 'c');
  engine.setTasks(tasks);
  engine.setDependencies(deps);
  return { tasks, deps, engine };
}

let host: HTMLElement;
let view: GanttPertChart | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.position = 'relative';
  host.style.width = '900px';
  host.style.height = '420px';
  document.body.appendChild(host);
});

afterEach(() => {
  view?.destroy();
  view = null;
  host.remove();
});

describe('GanttPertChart a11y + visual (real Chromium)', () => {
  it('paints the network with critical path and is accessible + interactive', async () => {
    const snap = snapshot();
    view = new GanttPertChart(host, { nodes: snap.nodes, edges: snap.edges });

    // Zero serious/critical axe violations for the mounted figure.
    await expectNoA11yViolations(host);

    // One node box per task, one edge path per dependency.
    const nodeEls = [...host.querySelectorAll<HTMLElement>('.jects-pert-chart__node')];
    expect(nodeEls.length).toBe(4);
    expect(host.querySelectorAll('.jects-pert-chart__edge').length).toBe(4);

    // Real left→right layering: A (layer 0) sits left of B (layer 1), which sits
    // left of D (layer 2).
    const left = (id: string): number =>
      (host.querySelector(`[data-node-id="${id}"]`) as HTMLElement).getBoundingClientRect()
        .left;
    expect(left('a')).toBeLessThan(left('b'));
    expect(left('b')).toBeLessThan(left('d'));

    // Critical path tinted on the node + edge.
    const a = host.querySelector('[data-node-id="a"]') as HTMLElement;
    expect(a.classList).toContain('jects-pert-chart__node--critical');
    expect(
      (host.querySelector('[data-edge-id="bd"]') as Element).classList,
    ).toContain('jects-pert-chart__edge--critical');

    // The edge path actually has geometry (a non-empty `d` between two boxes).
    const bd = host.querySelector('[data-edge-id="bd"]') as SVGPathElement;
    expect(bd.getAttribute('d') ?? '').toMatch(/^M /);
    expect(bd.getBoundingClientRect().width).toBeGreaterThan(0);

    // Keyboard: focus B, press Enter → nodeActivate; Space → nodeSelect mirrored.
    let activated: string | null = null;
    let selected: readonly unknown[] = [];
    view.on('nodeActivate', (p) => (activated = String(p.nodeId)));
    view.on('nodeSelect', (p) => (selected = p.selected));

    const b = host.querySelector('[data-node-id="b"]') as HTMLElement;
    b.focus();
    expect(document.activeElement).toBe(b);
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(activated).toBe('b');

    b.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.classList).toContain('jects-pert-chart__node--selected');
    expect([...selected]).toEqual(['b']);

    // Pan/zoom: a wheel-up over the viewport zooms the content (transform changes).
    const content = host.querySelector('.jects-pert-chart__content') as HTMLElement;
    const before = content.style.transform;
    const vp = host.querySelector('.jects-pert-chart__viewport') as HTMLElement;
    vp.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -120, clientX: 200, clientY: 120, bubbles: true, cancelable: true }),
    );
    expect(content.style.transform).not.toBe(before);
    expect(view.getZoom()).toBeGreaterThan(1);

    // …and selecting via setSelected (the Gantt→PERT push) re-renders aria-pressed.
    view.setSelected(['d']);
    expect(
      (host.querySelector('[data-node-id="d"]') as HTMLElement).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(b.getAttribute('aria-pressed')).toBe('false');
  });
});
