/**
 * jsdom unit tests for the Gantt **PERT / network-diagram view**.
 *
 * Two surfaces are covered:
 *   1. the PURE layout function `computePertLayout` — topological-rank layering,
 *      critical-path node/edge marking, terminal routing per dependency type, and
 *      cycle handling — verified without a DOM; and
 *   2. the `PertView` Widget — render (SVG nodes/edges), node activation event,
 *      pan/zoom transform + clamping, `fromGantt` wiring, and leak-free destroy.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PertView,
  createPertView,
  computePertLayout,
  type PertTaskInput,
  type PertDependencyInput,
} from './pert-view.js';
import type { GanttApi, TaskSchedule } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

/* A small diamond network:  A → B → D,  A → C → D  (D depends on both B and C). */
function diamond(): {
  tasks: PertTaskInput[];
  deps: PertDependencyInput[];
} {
  return {
    tasks: [
      { id: 'A', name: 'Start', start: T0, end: T0 + DAY, duration: DAY, totalSlack: 0 },
      { id: 'B', name: 'Long', start: T0 + DAY, end: T0 + 4 * DAY, duration: 3 * DAY, totalSlack: 0 },
      { id: 'C', name: 'Short', start: T0 + DAY, end: T0 + 2 * DAY, duration: DAY, totalSlack: 2 * DAY },
      { id: 'D', name: 'End', start: T0 + 4 * DAY, end: T0 + 5 * DAY, duration: DAY, totalSlack: 0 },
    ],
    deps: [
      { id: 'ab', fromId: 'A', toId: 'B' },
      { id: 'ac', fromId: 'A', toId: 'C' },
      { id: 'bd', fromId: 'B', toId: 'D' },
      { id: 'cd', fromId: 'C', toId: 'D' },
    ],
  };
}

describe('computePertLayout (pure)', () => {
  it('ranks nodes by longest path (topological layering)', () => {
    const { tasks, deps } = diamond();
    const layout = computePertLayout(tasks, deps);
    const rankOf = (id: string): number =>
      layout.nodes.find((n) => n.id === id)!.rank;

    expect(rankOf('A')).toBe(0);
    expect(rankOf('B')).toBe(1);
    expect(rankOf('C')).toBe(1);
    // D depends on B (rank 1) AND C (rank 1): longest path puts it at rank 2.
    expect(rankOf('D')).toBe(2);
    expect(layout.rankCount).toBe(3);
    expect(layout.cycleMembers).toEqual([]);
  });

  it('places later ranks strictly to the right (edges flow left→right)', () => {
    const { tasks, deps } = diamond();
    const layout = computePertLayout(tasks, deps);
    const xOf = (id: string): number => layout.nodes.find((n) => n.id === id)!.x;
    expect(xOf('A')).toBeLessThan(xOf('B'));
    expect(xOf('B')).toBeLessThan(xOf('D'));
    expect(xOf('C')).toBe(xOf('B')); // same rank → same column
  });

  it('stacks same-rank nodes vertically without overlap', () => {
    const { tasks, deps } = diamond();
    const layout = computePertLayout(tasks, deps, { nodeHeight: 72, rowGap: 28 });
    const b = layout.nodes.find((n) => n.id === 'B')!;
    const c = layout.nodes.find((n) => n.id === 'C')!;
    expect(b.row).not.toBe(c.row);
    // The two rank-1 boxes do not vertically overlap.
    const [hi, lo] = b.y < c.y ? [b, c] : [c, b];
    expect(hi.y + hi.height).toBeLessThanOrEqual(lo.y);
  });

  it('marks zero-slack nodes critical and the connecting edges critical', () => {
    const { tasks, deps } = diamond();
    const layout = computePertLayout(tasks, deps);
    const crit = new Set(layout.nodes.filter((n) => n.critical).map((n) => n.id));
    expect(crit).toEqual(new Set(['A', 'B', 'D']));
    // C has slack → not critical.
    expect(crit.has('C')).toBe(false);

    const critEdges = new Set(layout.edges.filter((e) => e.critical).map((e) => e.id));
    // A→B and B→D connect consecutive critical nodes; A→C and C→D do not.
    expect(critEdges).toEqual(new Set(['ab', 'bd']));
  });

  it('honours an explicit critical flag over the slack test', () => {
    const tasks: PertTaskInput[] = [
      { id: 'X', totalSlack: 5 * DAY, critical: true },
      { id: 'Y', totalSlack: 0, critical: false },
    ];
    const layout = computePertLayout(tasks, []);
    expect(layout.nodes.find((n) => n.id === 'X')!.critical).toBe(true);
    expect(layout.nodes.find((n) => n.id === 'Y')!.critical).toBe(false);
  });

  it('routes FS edges finish(right)→start(left) and SS edges start→start', () => {
    const tasks: PertTaskInput[] = [
      { id: 'P', name: 'Pred' },
      { id: 'S', name: 'Succ' },
    ];
    const fs = computePertLayout(tasks, [{ id: 'l', fromId: 'P', toId: 'S', type: 'FS' }]);
    const fsEdge = fs.edges[0];
    const p = fs.nodes.find((n) => n.id === 'P')!;
    const s = fs.nodes.find((n) => n.id === 'S')!;
    // FS leaves the predecessor's RIGHT edge…
    expect(fsEdge.points[0].x).toBeCloseTo(p.x + p.width, 5);
    // …and enters the successor's LEFT edge.
    expect(fsEdge.points[fsEdge.points.length - 1].x).toBeCloseTo(s.x, 5);

    const ss = computePertLayout(tasks, [{ id: 'l', fromId: 'P', toId: 'S', type: 'SS' }]);
    const ssEdge = ss.edges[0];
    const p2 = ss.nodes.find((n) => n.id === 'P')!;
    // SS leaves the predecessor's LEFT (start) edge.
    expect(ssEdge.points[0].x).toBeCloseTo(p2.x, 5);
  });

  it('ignores dependencies whose endpoints are missing and self-loops', () => {
    const tasks: PertTaskInput[] = [{ id: 'A' }, { id: 'B' }];
    const layout = computePertLayout(tasks, [
      { id: 'ghost', fromId: 'A', toId: 'Z' }, // Z missing
      { id: 'self', fromId: 'A', toId: 'A' }, // self-loop
      { id: 'real', fromId: 'A', toId: 'B' },
    ]);
    expect(layout.edges.map((e) => e.id)).toEqual(['real']);
  });

  it('terminates on a dependency cycle and reports the members', () => {
    const tasks: PertTaskInput[] = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    const layout = computePertLayout(tasks, [
      { id: 'ab', fromId: 'A', toId: 'B' },
      { id: 'bc', fromId: 'B', toId: 'C' },
      { id: 'ca', fromId: 'C', toId: 'A' }, // closes the cycle
    ]);
    expect(layout.cycleMembers.length).toBeGreaterThan(0);
    // All three edges are still emitted so the user sees the offending link.
    expect(layout.edges).toHaveLength(3);
    // Layout still produced finite geometry.
    expect(Number.isFinite(layout.width)).toBe(true);
    expect(Number.isFinite(layout.height)).toBe(true);
  });

  it('produces an empty-but-valid layout for no tasks', () => {
    const layout = computePertLayout([], []);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
    expect(layout.rankCount).toBe(0);
    expect(layout.width).toBeGreaterThan(0);
  });
});

describe('PertView (Widget, jsdom)', () => {
  let host: HTMLElement;
  let view: PertView | null = null;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    view?.destroy();
    view = null;
    host.remove();
  });

  it('renders one SVG node group per task and one polyline per dependency', () => {
    const { tasks, deps } = diamond();
    view = new PertView(host, { tasks, dependencies: deps });

    const nodes = view.el.querySelectorAll('.jects-pert__node');
    expect(nodes).toHaveLength(4);
    const edges = view.el.querySelectorAll('.jects-pert__edge');
    expect(edges).toHaveLength(4);

    // The diagram region is labelled for assistive tech.
    expect(view.el.getAttribute('role')).toBe('group');
    expect(view.el.getAttribute('aria-label')).toBe('PERT network diagram');
  });

  it('emphasises the critical path nodes + edges with modifier classes', () => {
    const { tasks, deps } = diamond();
    view = new PertView(host, { tasks, dependencies: deps });

    const critNodes = view.el.querySelectorAll('.jects-pert__node--critical');
    expect(critNodes).toHaveLength(3); // A, B, D
    const critEdges = view.el.querySelectorAll('.jects-pert__edge--critical');
    expect(critEdges).toHaveLength(2); // A→B, B→D
  });

  it('can hide critical emphasis via showCriticalPath:false', () => {
    const { tasks, deps } = diamond();
    view = new PertView(host, { tasks, dependencies: deps, showCriticalPath: false });
    expect(view.el.querySelector('.jects-pert__node--critical')).toBeNull();
    expect(view.el.querySelector('.jects-pert__edge--critical')).toBeNull();
  });

  it('labels each node box with its name, dates and slack for AT', () => {
    const { tasks, deps } = diamond();
    view = new PertView(host, { tasks, dependencies: deps });
    const a = view.el.querySelector('[data-task-id="A"]') as SVGGElement;
    expect(a).not.toBeNull();
    expect(a.getAttribute('role')).toBe('button');
    expect(a.getAttribute('tabindex')).toBe('0');
    const label = a.getAttribute('aria-label') ?? '';
    expect(label).toContain('Start');
    expect(label).toContain('critical');
    expect(label).toContain('2026-01-05');
  });

  it('emits nodeClick when a node box is activated by click', () => {
    const { tasks, deps } = diamond();
    view = new PertView(host, { tasks, dependencies: deps });
    let clicked: string | undefined;
    view.on('nodeClick', ({ task }) => {
      clicked = String(task.id);
    });
    const box = view.el.querySelector('[data-task-id="C"]') as SVGGElement;
    box.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicked).toBe('C');
  });

  it('emits nodeClick on Enter / Space keydown', () => {
    const { tasks, deps } = diamond();
    view = new PertView(host, { tasks, dependencies: deps });
    let count = 0;
    view.on('nodeClick', () => {
      count++;
    });
    const box = view.el.querySelector('[data-task-id="A"]') as SVGGElement;
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(count).toBe(2);
  });

  it('zooms within the configured min/max and emits viewportChange', () => {
    view = new PertView(host, { tasks: diamond().tasks, minZoom: 0.5, maxZoom: 2 });
    const seen: number[] = [];
    view.on('viewportChange', ({ zoom }) => seen.push(zoom));

    view.setZoom(5); // clamps to max 2
    expect(view.zoom).toBe(2);
    view.setZoom(0.1); // clamps to min 0.5
    expect(view.zoom).toBe(0.5);
    expect(seen.length).toBeGreaterThanOrEqual(2);

    // The transform reflects the zoom.
    const vp = view.el.querySelector('.jects-pert__viewport') as SVGGElement;
    expect(vp.getAttribute('transform')).toContain('scale(0.5)');
  });

  it('pans and reflects the offset in the viewport transform', () => {
    view = new PertView(host, { tasks: diamond().tasks });
    view.setPan(40, -20);
    expect(view.pan).toEqual({ x: 40, y: -20 });
    const vp = view.el.querySelector('.jects-pert__viewport') as SVGGElement;
    expect(vp.getAttribute('transform')).toContain('translate(40,-20)');
  });

  it('zoomIn / zoomOut step the zoom factor', () => {
    view = new PertView(host, { tasks: diamond().tasks });
    const start = view.zoom;
    view.zoomIn();
    expect(view.zoom).toBeGreaterThan(start);
    view.zoomOut();
    view.zoomOut();
    expect(view.zoom).toBeLessThan(start);
  });

  it('re-reads the model on refresh() after an update()', () => {
    view = new PertView(host, { tasks: [{ id: 'A' }], dependencies: [] });
    expect(view.el.querySelectorAll('.jects-pert__node')).toHaveLength(1);
    view.update({ tasks: [{ id: 'A' }, { id: 'B' }], dependencies: [{ id: 'l', fromId: 'A', toId: 'B' }] });
    expect(view.el.querySelectorAll('.jects-pert__node')).toHaveLength(2);
    expect(view.el.querySelectorAll('.jects-pert__edge')).toHaveLength(1);
  });

  it('merges a live schedule resolver over per-task fields', () => {
    const tasks: PertTaskInput[] = [{ id: 'A', totalSlack: 99 * DAY }];
    const schedule = (id: string | number): TaskSchedule | undefined =>
      id === 'A'
        ? {
            taskId: 'A',
            start: T0,
            end: T0 + DAY,
            earlyStart: T0,
            earlyFinish: T0 + DAY,
            lateStart: T0,
            lateFinish: T0 + DAY,
            totalSlack: 0,
            freeSlack: 0,
            critical: true,
          }
        : undefined;
    view = new PertView(host, { tasks, schedule });
    // The schedule's critical:true overrides the stale per-task slack.
    expect(view.el.querySelector('.jects-pert__node--critical')).not.toBeNull();
    expect(view.layout?.nodes[0].critical).toBe(true);
  });

  it('fromGantt wires schedule + refresh and registers teardown', () => {
    const handlers = new Map<string, Set<(p: unknown) => void>>();
    const trackers: Array<() => void> = [];
    const schedules = new Map<string, TaskSchedule>();
    const stubApi = {
      getSchedule: (id: string | number) => schedules.get(String(id)),
      on: (event: string, fn: (p: unknown) => void) => {
        (handlers.get(event) ?? handlers.set(event, new Set()).get(event)!).add(fn);
        return () => handlers.get(event)?.delete(fn);
      },
      track: (d: () => void) => trackers.push(d),
    } as unknown as GanttApi;

    const { tasks, deps } = diamond();
    view = PertView.fromGantt(host, stubApi, { tasks, dependencies: deps });
    expect(view.el.querySelectorAll('.jects-pert__node')).toHaveLength(4);

    // A scheduleChange refreshes the view.
    schedules.set('C', {
      taskId: 'C',
      start: T0,
      end: T0 + DAY,
      earlyStart: T0,
      earlyFinish: T0 + DAY,
      lateStart: T0,
      lateFinish: T0 + DAY,
      totalSlack: 0,
      freeSlack: 0,
      critical: true,
    });
    handlers.get('scheduleChange')?.forEach((fn) => fn({}));
    // C is now critical via the live schedule.
    expect(view.el.querySelector('.jects-pert__node--critical[data-task-id="C"]')).not.toBeNull();

    // The Gantt's track() disposer tears the view down.
    expect(trackers.length).toBeGreaterThan(0);
    trackers.forEach((d) => d());
    expect(view.isDestroyed).toBe(true);
  });

  it('destroy() removes the root and is idempotent', () => {
    view = createPertView(host, { tasks: diamond().tasks });
    const el = view.el;
    expect(host.contains(el)).toBe(true);
    view.destroy();
    expect(view.isDestroyed).toBe(true);
    expect(host.contains(el)).toBe(false);
    // Idempotent.
    expect(() => view!.destroy()).not.toThrow();
  });
});
