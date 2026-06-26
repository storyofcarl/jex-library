/**
 * jsdom unit tests for the Gantt **Progress line / status line** feature.
 *
 * Two layers:
 *   1. Pure geometry — `computeProgressVertices` / `progressPolylinePoints`
 *      project bar geometry + a status-date x into the zig-zag vertices and the
 *      SVG polyline points, with the right behind/ahead/on-track classification.
 *   2. Integration — installed on a real `Gantt`, it paints one SVG overlay with
 *      the status line, the jagged polyline, and per-task vertex dots; it exposes
 *      a runtime `setStatusDate`, emits `progressLineChange`, and cleans up on
 *      `destroy()`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from './gantt.js';
import {
  GanttProgressLineFeature,
  createProgressLine,
  computeProgressVertices,
  progressPolylinePoints,
  type ProgressBarGeometry,
  type ProgressLineChangePayload,
} from './progress-line.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

/* ── pure geometry ─────────────────────────────────────────────────────── */

describe('computeProgressVertices', () => {
  function bar(part: Partial<ProgressBarGeometry>): ProgressBarGeometry {
    return {
      taskId: 't',
      left: 0,
      width: 100,
      top: 0,
      height: 20,
      percentDone: 0.5,
      ...part,
    };
  }

  it('bows left of the status date for a task that is behind schedule', () => {
    // statusX = 80, progress point = 0 + 0.3*100 = 30 → behind (negative dev).
    const [v] = computeProgressVertices([bar({ percentDone: 0.3 })], 80);
    expect(v.x).toBe(30);
    expect(v.deviation).toBe(-50);
    expect(v.status).toBe('behind');
    expect(v.y).toBe(10); // top 0 + height 20 / 2
  });

  it('bows right of the status date for a task that is ahead', () => {
    // statusX = 20, progress point = 0.6*100 = 60 → ahead (positive dev).
    const [v] = computeProgressVertices([bar({ percentDone: 0.6 })], 20);
    expect(v.x).toBe(60);
    expect(v.deviation).toBe(40);
    expect(v.status).toBe('ahead');
  });

  it('reports on-track when the progress point sits on the status date', () => {
    const [v] = computeProgressVertices([bar({ percentDone: 0.5 })], 50);
    expect(v.status).toBe('onTrack');
    expect(v.deviation).toBe(0);
  });

  it('clamps percentDone into 0..1 and treats milestones (zero width) as the left edge', () => {
    const over = computeProgressVertices([bar({ percentDone: 5 })], 0)[0];
    expect(over.x).toBe(100); // clamped to 1.0 → left+width

    const under = computeProgressVertices([bar({ percentDone: -1 })], 0)[0];
    expect(under.x).toBe(0); // clamped to 0 → left

    const milestone = computeProgressVertices(
      [bar({ width: 0, left: 42, percentDone: 0.5 })],
      0,
    )[0];
    expect(milestone.x).toBe(42); // collapses to its left edge
  });

  it('orders vertices top-to-bottom regardless of input order', () => {
    const vs = computeProgressVertices(
      [bar({ taskId: 'low', top: 80 }), bar({ taskId: 'high', top: 0 })],
      50,
    );
    expect(vs.map((v) => v.taskId)).toEqual(['high', 'low']);
  });
});

describe('progressPolylinePoints', () => {
  it('starts and ends on the status x and threads each vertex at its row centre', () => {
    const vs = computeProgressVertices(
      [
        { taskId: 'a', left: 0, width: 100, top: 0, height: 20, percentDone: 0.3 },
      ],
      80,
    );
    const points = progressPolylinePoints(vs, 80, 0, 200);
    const coords = points.split(' ').map((p) => p.split(',').map(Number));
    // First & last point ride the status line.
    expect(coords[0]).toEqual([80, 0]);
    expect(coords[coords.length - 1]).toEqual([80, 200]);
    // The middle bow reaches the progress point (x=30) at the row centre (y=10).
    expect(coords).toContainEqual([30, 10]);
    // It enters and leaves the row on the status line (bar top/bottom).
    expect(coords).toContainEqual([80, 0]);
    expect(coords).toContainEqual([80, 20]);
  });
});

/* ── integration on a real Gantt ───────────────────────────────────────── */

function mixedProgressTasks(): TaskModel[] {
  return [
    // 'a': only 20% done but well into its window → behind.
    { id: 'a', name: 'Design', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY, percentDone: 0.2 } as TaskModel,
    // 'b': 90% done early → ahead.
    { id: 'b', name: 'Build', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY, percentDone: 0.9 } as TaskModel,
  ];
}

describe('GanttProgressLineFeature (integration)', () => {
  it('paints one SVG overlay with a base line, a polyline, and vertex dots', () => {
    gantt = new Gantt(host, { tasks: mixedProgressTasks(), projectStart: T0 });
    const feature = createProgressLine({ statusDate: T0 + 2 * DAY });
    gantt.use(feature);
    feature.paint();

    const svgs = gantt.el.querySelectorAll('.jects-gantt__progress-line');
    expect(svgs).toHaveLength(1);
    expect(gantt.el.querySelector('.jects-gantt__progress-line-base')).not.toBeNull();
    expect(gantt.el.querySelector('.jects-gantt__progress-line-poly')).not.toBeNull();

    const dots = gantt.el.querySelectorAll('.jects-gantt__progress-line-vertex');
    expect(dots.length).toBe(2); // one per in-progress leaf task
  });

  it('classifies the behind task and the ahead task with the right vertex modifiers', () => {
    gantt = new Gantt(host, { tasks: mixedProgressTasks(), projectStart: T0 });
    const feature = createProgressLine({ statusDate: T0 + 2 * DAY });
    gantt.use(feature);
    feature.paint();

    const dotA = gantt.el.querySelector(
      '.jects-gantt__progress-line-vertex[data-task-id="a"]',
    ) as SVGElement;
    const dotB = gantt.el.querySelector(
      '.jects-gantt__progress-line-vertex[data-task-id="b"]',
    ) as SVGElement;
    expect(dotA.getAttribute('data-status')).toBe('behind');
    expect(dotB.getAttribute('data-status')).toBe('ahead');
    expect(dotA.getAttribute('class')).toContain('--behind');
    expect(dotB.getAttribute('class')).toContain('--ahead');
  });

  it('getVertices() reports the deviation sign for each task', () => {
    gantt = new Gantt(host, { tasks: mixedProgressTasks(), projectStart: T0 });
    const feature = createProgressLine({ statusDate: T0 + 2 * DAY });
    gantt.use(feature);
    const vs = feature.getVertices();
    const a = vs.find((v) => String(v.taskId) === 'a')!;
    const b = vs.find((v) => String(v.taskId) === 'b')!;
    expect(a.deviation).toBeLessThan(0);
    expect(b.deviation).toBeGreaterThan(0);
  });

  it('skips fully-done and not-started tasks by default (inProgressOnly)', () => {
    gantt = new Gantt(host, {
      tasks: [
        { id: 'done', name: 'Done', start: T0, duration: DAY, end: T0 + DAY, percentDone: 1 } as TaskModel,
        { id: 'fresh', name: 'Fresh', start: T0, duration: DAY, end: T0 + DAY, percentDone: 0 } as TaskModel,
        { id: 'wip', name: 'WIP', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY, percentDone: 0.4 } as TaskModel,
      ],
      projectStart: T0,
    });
    const feature = createProgressLine({ statusDate: T0 + 2 * DAY });
    gantt.use(feature);
    feature.paint();
    const dots = gantt!.el.querySelectorAll('.jects-gantt__progress-line-vertex');
    expect(dots).toHaveLength(1);
    expect((dots[0] as SVGElement).getAttribute('data-task-id')).toBe('wip');
  });

  it('honours a getProgress override', () => {
    gantt = new Gantt(host, {
      tasks: [{ id: 'a', name: 'A', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY, percentDone: 0 } as TaskModel],
      projectStart: T0,
    });
    const feature = createProgressLine({
      statusDate: T0 + 2 * DAY,
      getProgress: () => 0.5,
    });
    gantt.use(feature);
    feature.paint();
    // Driven by getProgress (0.5), not the task's percentDone (0), so it draws.
    expect(gantt.el.querySelectorAll('.jects-gantt__progress-line-vertex')).toHaveLength(1);
  });

  it('setStatusDate repaints and emits progressLineChange', () => {
    gantt = new Gantt(host, { tasks: mixedProgressTasks(), projectStart: T0 });
    const feature = createProgressLine({ statusDate: T0 + DAY });
    gantt.use(feature);

    const seen: ProgressLineChangePayload[] = [];
    (gantt as unknown as { on(e: string, fn: (p: ProgressLineChangePayload) => void): void }).on(
      'progressLineChange',
      (p) => seen.push(p),
    );

    feature.setStatusDate(T0 + 3 * DAY);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.statusDate).toBe(T0 + 3 * DAY);
    expect(feature.getStatusDate()).toBe(T0 + 3 * DAY);
  });

  it('draws nothing actionable when the status date is outside the axis range', () => {
    gantt = new Gantt(host, { tasks: mixedProgressTasks(), projectStart: T0 });
    const feature = createProgressLine({ statusDate: T0 - 365 * DAY });
    gantt.use(feature);
    feature.paint();
    // No vertices when the status x cannot be resolved within the range.
    expect(feature.getVertices()).toHaveLength(0);
    const svg = gantt.el.querySelector('.jects-gantt__progress-line')!;
    expect(svg.getAttribute('aria-label')).toContain('out of range');
  });

  it('the overlay carries an accessible img label summarising schedule health', () => {
    gantt = new Gantt(host, { tasks: mixedProgressTasks(), projectStart: T0 });
    const feature = createProgressLine({ statusDate: T0 + 2 * DAY });
    gantt.use(feature);
    feature.paint();
    const svg = gantt.el.querySelector('.jects-gantt__progress-line')!;
    expect(svg.getAttribute('role')).toBe('img');
    const label = svg.getAttribute('aria-label')!;
    expect(label).toContain('behind');
    expect(label).toContain('ahead');
  });

  it('re-paints idempotently (one overlay, no duplicate vertices)', () => {
    gantt = new Gantt(host, { tasks: mixedProgressTasks(), projectStart: T0 });
    const feature = createProgressLine({ statusDate: T0 + 2 * DAY });
    gantt.use(feature);
    feature.paint();
    feature.paint();
    expect(gantt.el.querySelectorAll('.jects-gantt__progress-line')).toHaveLength(1);
    expect(gantt.el.querySelectorAll('.jects-gantt__progress-line-vertex')).toHaveLength(2);
  });

  it('removes its overlay and releases subscriptions on destroy()', () => {
    gantt = new Gantt(host, { tasks: mixedProgressTasks(), projectStart: T0 });
    const feature = new GanttProgressLineFeature({ statusDate: T0 + 2 * DAY });
    gantt.use(feature);
    feature.paint();
    expect(gantt.el.querySelector('.jects-gantt__progress-line')).not.toBeNull();

    feature.destroy();
    expect(gantt.el.querySelector('.jects-gantt__progress-line')).toBeNull();
    // Idempotent.
    expect(() => feature.destroy()).not.toThrow();
  });

  it('can be re-installed after destroy (instance reuse)', () => {
    gantt = new Gantt(host, { tasks: mixedProgressTasks(), projectStart: T0 });
    const feature = new GanttProgressLineFeature({ statusDate: T0 + 2 * DAY });
    gantt.use(feature);
    feature.paint();
    feature.destroy();

    gantt.use(feature);
    feature.paint();
    expect(gantt.el.querySelectorAll('.jects-gantt__progress-line')).toHaveLength(1);
    expect(gantt.el.querySelectorAll('.jects-gantt__progress-line-vertex')).toHaveLength(2);
  });
});
