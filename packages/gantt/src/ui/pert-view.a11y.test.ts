/**
 * axe-core a11y + visual/interaction browser test for the Gantt **PERT /
 * network-diagram view** (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the feature end to
 * end on a real `PertView` + real CSS: the diagram lays its nodes out by
 * topological rank (later ranks strictly to the right), the critical path is
 * emphasised on both nodes and edges, every node box is a focusable, labelled
 * `button`, activating a node emits `nodeClick`, and pan + zoom move/scale the
 * SVG viewport.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the shipped, token-pure package stylesheet so the geometry + contrast
// assertions exercise the real CSS rather than unstyled defaults.
import '../styles.css';
import { PertView, type PertTaskInput, type PertDependencyInput } from './pert-view.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let view: PertView | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.position = 'relative';
  host.style.height = '480px';
  host.style.width = '1000px';
  document.body.appendChild(host);
});

afterEach(() => {
  view?.destroy();
  view = null;
  host.remove();
});

function network(): {
  tasks: PertTaskInput[];
  dependencies: PertDependencyInput[];
} {
  return {
    tasks: [
      { id: 'A', name: 'Kickoff', start: T0, end: T0 + DAY, duration: DAY, totalSlack: 0 },
      { id: 'B', name: 'Build core', start: T0 + DAY, end: T0 + 4 * DAY, duration: 3 * DAY, totalSlack: 0 },
      { id: 'C', name: 'Docs', start: T0 + DAY, end: T0 + 2 * DAY, duration: DAY, totalSlack: 2 * DAY },
      { id: 'D', name: 'Integrate', start: T0 + 4 * DAY, end: T0 + 6 * DAY, duration: 2 * DAY, totalSlack: 0 },
      { id: 'E', name: 'Release', start: T0 + 6 * DAY, end: T0 + 6 * DAY, milestone: true, totalSlack: 0 },
    ],
    dependencies: [
      { id: 'ab', fromId: 'A', toId: 'B' },
      { id: 'ac', fromId: 'A', toId: 'C' },
      { id: 'bd', fromId: 'B', toId: 'D' },
      { id: 'cd', fromId: 'C', toId: 'D' },
      { id: 'de', fromId: 'D', toId: 'E' },
    ],
  };
}

describe('PertView a11y + visual (real Chromium)', () => {
  it('renders the network diagram with no serious/critical violations', async () => {
    const { tasks, dependencies } = network();
    view = new PertView(host, { tasks, dependencies });

    await expectNoA11yViolations(host);

    // Each task is a focusable, labelled button; each dependency a polyline.
    const nodes = [...view.el.querySelectorAll('.jects-pert__node')] as SVGGElement[];
    expect(nodes).toHaveLength(5);
    for (const n of nodes) {
      expect(n.getAttribute('role')).toBe('button');
      expect(n.getAttribute('tabindex')).toBe('0');
      expect((n.getAttribute('aria-label') ?? '').length).toBeGreaterThan(0);
    }
    expect(view.el.querySelectorAll('.jects-pert__edge')).toHaveLength(5);
  });

  it('lays out later ranks strictly to the right of earlier ranks', () => {
    const { tasks, dependencies } = network();
    view = new PertView(host, { tasks, dependencies });

    const boxOf = (id: string): DOMRect =>
      (view!.el.querySelector(`[data-task-id="${id}"]`) as SVGGElement).getBoundingClientRect();

    // A (rank 0) is left of B/C (rank 1), which are left of D (rank 2), left of E (rank 3).
    expect(boxOf('A').left).toBeLessThan(boxOf('B').left);
    expect(boxOf('B').left).toBeLessThan(boxOf('D').left);
    expect(boxOf('D').left).toBeLessThan(boxOf('E').left);
    // B and C share a rank → same column (same left, different top).
    expect(Math.abs(boxOf('B').left - boxOf('C').left)).toBeLessThan(2);
    expect(Math.abs(boxOf('B').top - boxOf('C').top)).toBeGreaterThan(10);
  });

  it('emphasises the critical path on nodes and edges', () => {
    const { tasks, dependencies } = network();
    view = new PertView(host, { tasks, dependencies });

    // A, B, D, E are zero-slack → critical; C has slack → not.
    const critIds = [...view.el.querySelectorAll('.jects-pert__node--critical')].map(
      (n) => (n as SVGGElement).dataset.taskId,
    );
    expect(new Set(critIds)).toEqual(new Set(['A', 'B', 'D', 'E']));

    // The critical edges use the destructive accent marker.
    const critEdges = view.el.querySelectorAll('.jects-pert__edge--critical');
    // A→B, B→D, D→E are critical (consecutive critical nodes); A→C, C→D are not.
    expect(critEdges).toHaveLength(3);
    for (const e of critEdges) {
      expect(e.getAttribute('marker-end')).toBe('url(#pert-arrow-critical)');
    }
  });

  it('activating a node emits nodeClick (mouse + keyboard)', async () => {
    const { tasks, dependencies } = network();
    view = new PertView(host, { tasks, dependencies });
    const fired: string[] = [];
    view.on('nodeClick', ({ task }) => fired.push(String(task.id)));

    const b = view.el.querySelector('[data-task-id="B"]') as SVGGElement;
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    b.focus();
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(fired).toEqual(['B', 'B']);
    await expectNoA11yViolations(host);
  });

  it('pans and zooms the viewport (real transforms)', () => {
    const { tasks, dependencies } = network();
    view = new PertView(host, { tasks, dependencies });
    const vp = view.el.querySelector('.jects-pert__viewport') as SVGGElement;

    const a0 = (view.el.querySelector('[data-task-id="A"]') as SVGGElement).getBoundingClientRect();
    view.setPan(120, 60);
    const a1 = (view.el.querySelector('[data-task-id="A"]') as SVGGElement).getBoundingClientRect();
    // Panning moved the node on screen.
    expect(a1.left).toBeGreaterThan(a0.left + 50);
    expect(a1.top).toBeGreaterThan(a0.top + 20);
    expect(vp.getAttribute('transform')).toContain('translate(120,60)');

    view.setZoom(0.5);
    expect(vp.getAttribute('transform')).toContain('scale(0.5)');
    const a2 = (view.el.querySelector('[data-task-id="A"]') as SVGGElement).getBoundingClientRect();
    // Zooming out shrank the rendered box.
    expect(a2.width).toBeLessThan(a1.width);
  });

  it('zoomToFit scales the whole graph to fit the pane', () => {
    const { tasks, dependencies } = network();
    view = new PertView(host, { tasks, dependencies, minZoom: 0.1, maxZoom: 3 });
    view.zoomToFit();
    // After fit, the whole content (width) maps within the visible svg box.
    const svg = view.el.querySelector('.jects-pert__svg') as SVGSVGElement;
    const layout = view.layout!;
    expect(view.zoom).toBeGreaterThan(0);
    expect(view.zoom * layout.width).toBeLessThanOrEqual(svg.getBoundingClientRect().width + 2);
  });
});
