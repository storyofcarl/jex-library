/**
 * jsdom unit tests for the PERT / network-diagram chart view.
 *
 * Covers BOTH halves of the feature:
 *   • the PURE layered layout (`layoutPertChart`) — topological layering, crossing
 *     reduction, coordinate/edge geometry, cycle breaking — with no DOM; and
 *   • the `GanttPertChart` Widget — render of nodes/edges from a REAL CPM schedule
 *     result, critical-path highlighting, selection + its event, pan/zoom transform,
 *     keyboard navigation, factory registration, and leak-free `destroy()`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { create, isRegistered } from '@jects/core';
import { CpmEngine } from '../engine/scheduler.js';
import type { CalendarModel, DependencyModel, TaskModel } from '../contract.js';
import {
  GanttPertChart,
  createPertChart,
  layoutPertChart,
  fromScheduleResult,
  type PertChartNode,
  type PertChartEdge,
} from './pert-chart.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);

/* ── a real diamond network via the CPM engine ──────────────────────────── */
const cal247: CalendarModel = {
  id: 'c',
  week: Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    intervals: [{ from: 0, to: 1440 }],
  })),
};

function diamond(): { tasks: TaskModel[]; deps: DependencyModel[]; engine: CpmEngine } {
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

/* ═══════════════════════════════════════════════════════════════════════════
   1. PURE LAYOUT
   ═══════════════════════════════════════════════════════════════════════════ */

describe('layoutPertChart — pure layered layout', () => {
  const nodes: PertChartNode[] = [
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
    { id: 'd' },
  ];
  const edges: PertChartEdge[] = [
    { id: 'ab', fromId: 'a', toId: 'b' },
    { id: 'ac', fromId: 'a', toId: 'c' },
    { id: 'bd', fromId: 'b', toId: 'd' },
    { id: 'cd', fromId: 'c', toId: 'd' },
  ];

  it('layers nodes by longest predecessor chain (topological)', () => {
    const layout = layoutPertChart(nodes, edges);
    const layerOf = (id: string): number =>
      layout.nodes.find((b) => b.node.id === id)!.layer;
    expect(layerOf('a')).toBe(0);
    expect(layerOf('b')).toBe(1);
    expect(layerOf('c')).toBe(1);
    expect(layerOf('d')).toBe(2); // pushed past BOTH b and c → layer 2
    expect(layout.layerCount).toBe(3);
  });

  it('places later layers to the right of earlier ones (horizontal flow)', () => {
    const layout = layoutPertChart(nodes, edges);
    const x = (id: string): number => layout.nodes.find((b) => b.node.id === id)!.x;
    expect(x('a')).toBeLessThan(x('b'));
    expect(x('b')).toBeLessThan(x('d'));
    expect(x('a')).toBeLessThan(x('d'));
  });

  it('flows top→bottom for vertical direction', () => {
    const layout = layoutPertChart(nodes, edges, { direction: 'vertical' });
    const y = (id: string): number => layout.nodes.find((b) => b.node.id === id)!.y;
    expect(y('a')).toBeLessThan(y('b'));
    expect(y('b')).toBeLessThan(y('d'));
  });

  it('routes one orthogonal edge per kept dependency, terminals on box edges', () => {
    const layout = layoutPertChart(nodes, edges, { nodeWidth: 100, nodeHeight: 80 });
    expect(layout.edges).toHaveLength(4);
    const ab = layout.edges.find((e) => e.edge.id === 'ab')!;
    const a = layout.nodes.find((b) => b.node.id === 'a')!;
    const b = layout.nodes.find((b) => b.node.id === 'b')!;
    // from = right edge midpoint of A; to = left edge midpoint of B.
    expect(ab.from.x).toBeCloseTo(a.x + a.width);
    expect(ab.from.y).toBeCloseTo(a.y + a.height / 2);
    expect(ab.to.x).toBeCloseTo(b.x);
    expect(ab.points.length).toBeGreaterThanOrEqual(2);
  });

  it('marks an edge critical only when both endpoints are critical', () => {
    const crit: PertChartNode[] = [
      { id: 'a', critical: true },
      { id: 'b', critical: true },
      { id: 'c', critical: false },
      { id: 'd', critical: true },
    ];
    const layout = layoutPertChart(crit, edges);
    expect(layout.edges.find((e) => e.edge.id === 'ab')!.critical).toBe(true);
    expect(layout.edges.find((e) => e.edge.id === 'ac')!.critical).toBe(false);
    expect(layout.edges.find((e) => e.edge.id === 'cd')!.critical).toBe(false);
  });

  it('drops dangling and self edges from layout', () => {
    const layout = layoutPertChart(nodes, [
      { id: 'ab', fromId: 'a', toId: 'b' },
      { id: 'dangling', fromId: 'a', toId: 'zzz' },
      { id: 'self', fromId: 'c', toId: 'c' },
    ]);
    expect(layout.edges.map((e) => e.edge.id)).toEqual(['ab']);
  });

  it('breaks cycles defensively and still places every node', () => {
    const cyc: PertChartNode[] = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
    const cycEdges: PertChartEdge[] = [
      { id: 'xy', fromId: 'x', toId: 'y' },
      { id: 'yz', fromId: 'y', toId: 'z' },
      { id: 'zx', fromId: 'z', toId: 'x' }, // back-edge → cycle
    ];
    const layout = layoutPertChart(cyc, cycEdges);
    expect(layout.nodes).toHaveLength(3);
    expect(layout.cycleNodeIds.sort()).toEqual(['x', 'y', 'z']);
    // Still produces finite geometry for every node.
    for (const box of layout.nodes) {
      expect(Number.isFinite(box.x)).toBe(true);
      expect(Number.isFinite(box.y)).toBe(true);
    }
  });

  it('returns sane content size for an empty graph', () => {
    const layout = layoutPertChart([], []);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. SNAPSHOT FROM ENGINE SCHEDULE RESULT
   ═══════════════════════════════════════════════════════════════════════════ */

describe('fromScheduleResult — engine schedule → PERT snapshot', () => {
  it('carries dates, slack and critical flags from the CPM result', () => {
    const { tasks, deps, engine } = diamond();
    const result = engine.schedule({ projectStart: T0 });
    const snap = fromScheduleResult(tasks, deps, result);

    expect(snap.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    const a = snap.nodes.find((n) => n.id === 'a')!;
    const c = snap.nodes.find((n) => n.id === 'c')!;
    expect(a.critical).toBe(true);
    expect(a.start).toBe(T0);
    expect(c.critical).toBe(false);
    expect(c.totalSlack).toBe(3 * DAY);
    // All 4 dependencies become edges; ab/bd/cd touch only critical endpoints.
    expect(snap.edges).toHaveLength(4);
    expect(snap.edges.find((e) => e.id === 'bd')!.critical).toBe(true);
    expect(snap.edges.find((e) => e.id === 'ac')!.critical).toBe(false);
  });

  it('accepts a bare schedules map as well as a ScheduleResult', () => {
    const { tasks, deps, engine } = diamond();
    const result = engine.schedule({ projectStart: T0 });
    const snap = fromScheduleResult(tasks, deps, result.schedules);
    expect(snap.nodes).toHaveLength(4);
  });

  it('drops inactive dependencies', () => {
    const { tasks, engine } = diamond();
    const result = engine.schedule({ projectStart: T0 });
    const snap = fromScheduleResult(
      tasks,
      [{ id: 'ab', fromId: 'a', toId: 'b', active: false }],
      result,
    );
    expect(snap.edges).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. THE WIDGET
   ═══════════════════════════════════════════════════════════════════════════ */

describe('GanttPertChart widget', () => {
  let host: HTMLElement;
  let view: GanttPertChart | null;

  function mount(): GanttPertChart {
    const { tasks, deps, engine } = diamond();
    const result = engine.schedule({ projectStart: T0 });
    const snap = fromScheduleResult(tasks, deps, result);
    return new GanttPertChart(host, { nodes: snap.nodes, edges: snap.edges });
  }

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    view = null;
  });
  afterEach(() => {
    view?.destroy();
    host.remove();
  });

  it('registers with the factory', () => {
    expect(isRegistered('ganttPertChart')).toBe(true);
    const w = create({ type: 'ganttPertChart' }, host) as unknown as GanttPertChart;
    expect(w).toBeInstanceOf(GanttPertChart);
    w.destroy();
  });

  it('renders one node box per task and one path per edge', () => {
    view = mount();
    const nodes = host.querySelectorAll('.jects-pert-chart__node');
    const edges = host.querySelectorAll('.jects-pert-chart__edge');
    expect(nodes.length).toBe(4);
    expect(edges.length).toBe(4);
    // Node carries its name + dates.
    const a = host.querySelector('[data-node-id="a"]')!;
    expect(a.querySelector('.jects-pert-chart__node-title')!.textContent).toBe('Analyse');
    expect(a.getAttribute('role')).toBe('button');
  });

  it('highlights the critical path on nodes + edges', () => {
    view = mount();
    expect(host.querySelector('[data-node-id="a"]')!.classList).toContain(
      'jects-pert-chart__node--critical',
    );
    expect(host.querySelector('[data-node-id="c"]')!.classList).not.toContain(
      'jects-pert-chart__node--critical',
    );
    const bd = host.querySelector('[data-edge-id="bd"]')!;
    expect(bd.classList).toContain('jects-pert-chart__edge--critical');
  });

  it('toggling critical-path visibility removes the highlight', () => {
    view = mount();
    view.setCriticalPathVisible(false);
    expect(host.querySelector('[data-node-id="a"]')!.classList).not.toContain(
      'jects-pert-chart__node--critical',
    );
    expect(host.querySelector('[data-edge-id="bd"]')!.classList).not.toContain(
      'jects-pert-chart__edge--critical',
    );
  });

  it('emits nodeSelect and reflects selection in the DOM on click', () => {
    view = mount();
    const events: Array<{ nodeId: unknown; selected: readonly unknown[] }> = [];
    view.on('nodeSelect', (p) => events.push(p));

    const b = host.querySelector('[data-node-id="b"]') as HTMLElement;
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(events).toHaveLength(1);
    expect(events[0]!.nodeId).toBe('b');
    expect(events[0]!.selected).toEqual(['b']);
    expect(b.classList).toContain('jects-pert-chart__node--selected');
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(view.getSelected()).toEqual(['b']);
  });

  it('setSelected pushes external (Gantt) selection in without emitting by default', () => {
    view = mount();
    let emitted = 0;
    view.on('nodeSelect', () => emitted++);
    view.setSelected(['d']);
    expect(emitted).toBe(0);
    expect(host.querySelector('[data-node-id="d"]')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(view.getSelected()).toEqual(['d']);
  });

  it('emits nodeActivate on Enter and double-click', () => {
    view = mount();
    const activated: unknown[] = [];
    view.on('nodeActivate', (p) => activated.push(p.nodeId));

    const a = host.querySelector('[data-node-id="a"]') as HTMLElement;
    a.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    a.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(activated).toEqual(['a', 'a']);
  });

  it('moves roving focus with arrow keys in layer order', () => {
    view = mount();
    const order = view.getLayout().nodes.map((b) => b.node.id);
    const first = host.querySelector(
      `[data-node-id="${order[0] as string}"]`,
    ) as HTMLElement;
    first.focus();
    first.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    const second = host.querySelector(
      `[data-node-id="${order[1] as string}"]`,
    ) as HTMLElement;
    expect(document.activeElement).toBe(second);
    expect(second.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
  });

  it('applies a pan/zoom transform and clamps zoom + emits viewChange', () => {
    view = mount();
    const seen: number[] = [];
    view.on('viewChange', (p) => seen.push(p.zoom));

    view.setZoom(1.5);
    expect(view.getZoom()).toBe(1.5);
    view.setZoom(99); // clamped to maxZoom (2.5)
    expect(view.getZoom()).toBe(2.5);
    view.setPan(40, 12);
    expect(view.getPan()).toEqual({ x: 40, y: 12 });

    const content = host.querySelector('.jects-pert-chart__content') as HTMLElement;
    expect(content.style.transform).toContain('scale(2.5)');
    expect(content.style.transform).toContain('translate(40px, 12px)');
    expect(seen.length).toBeGreaterThan(0);
  });

  it('re-lays out on setData', () => {
    view = mount();
    expect(host.querySelectorAll('.jects-pert-chart__node').length).toBe(4);
    view.setData({
      nodes: [{ id: 'x', name: 'Solo' }],
      edges: [],
    });
    expect(host.querySelectorAll('.jects-pert-chart__node').length).toBe(1);
    expect(host.querySelector('[data-node-id="x"]')).not.toBeNull();
  });

  it('exposes the post-layout box for a node', () => {
    view = mount();
    const box = view.boxFor('a');
    expect(box).toBeDefined();
    expect(box!.layer).toBe(0);
    expect(box!.width).toBeGreaterThan(0);
  });

  it('createPertChart factory builds a working instance', () => {
    view = createPertChart(host, { nodes: [{ id: 'n1', name: 'One' }], edges: [] });
    expect(view).toBeInstanceOf(GanttPertChart);
    expect(host.querySelector('[data-node-id="n1"]')).not.toBeNull();
  });

  it('destroy() removes the root and is idempotent', () => {
    view = mount();
    expect(host.querySelector('.jects-pert-chart')).not.toBeNull();
    view.destroy();
    expect(host.querySelector('.jects-pert-chart')).toBeNull();
    expect(() => view!.destroy()).not.toThrow();
    expect(view.isDestroyed).toBe(true);
    view = null;
  });
});
