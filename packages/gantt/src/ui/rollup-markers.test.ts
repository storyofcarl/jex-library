/**
 * jsdom unit tests for the Gantt **child-task rollup markers** feature.
 *
 * Two layers:
 *   1. Pure geometry — `computeRollupMarkers` projects child spans (in absolute
 *      content-pixel space) into bar-local markers, clamped to the summary bar,
 *      with milestones collapsing to centred diamonds.
 *   2. Integration — installed on a real `Gantt`, it overlays markers on a
 *      collapsed summary bar (one per eligible leaf child), honours the per-task
 *      `rollup` flag and the `allSummaries` / `mode` config, hides them while the
 *      summary is expanded (in the default `'collapsed'` mode), and cleans up on
 *      `destroy()`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { type TreeStore, type RecordId } from '@jects/core';
import { Gantt } from './gantt.js';
import {
  GanttRollupFeature,
  createRollupFeature,
  computeRollupMarkers,
  MIN_MARKER_WIDTH,
  MILESTONE_MARKER_SIZE,
  type RollupChildGeometry,
} from './rollup-markers.js';
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

describe('computeRollupMarkers', () => {
  function child(part: Partial<RollupChildGeometry>): RollupChildGeometry {
    return {
      taskId: 'c',
      left: 100,
      width: 40,
      milestone: false,
      span: { start: T0, end: T0 + DAY },
      ...part,
    };
  }

  it('translates a child span into bar-local pixels (childLeft - barLeft)', () => {
    const [m] = computeRollupMarkers({ left: 80, width: 200 }, [child({ left: 120, width: 30 })]);
    expect(m.kind).toBe('task');
    expect(m.left).toBe(40); // 120 - 80
    expect(m.width).toBe(30);
    expect(m.taskId).toBe('c');
  });

  it('clamps a marker so it never extends past the summary bar edges', () => {
    // Bar [80, 280]; child starts before the bar and ends past it.
    const [m] = computeRollupMarkers({ left: 80, width: 200 }, [child({ left: 40, width: 400 })]);
    expect(m.left).toBe(0); // clamped to the bar's left edge
    expect(m.width).toBeLessThanOrEqual(200); // never wider than the bar
  });

  it('enforces a minimum visible width for very short child tasks', () => {
    const [m] = computeRollupMarkers({ left: 0, width: 200 }, [child({ left: 10, width: 0.2 })]);
    expect(m.width).toBeGreaterThanOrEqual(MIN_MARKER_WIDTH);
  });

  it('collapses a milestone child to a centred diamond at its instant', () => {
    const [m] = computeRollupMarkers({ left: 0, width: 200 }, [
      child({ left: 100, width: 0, milestone: true }),
    ]);
    expect(m.kind).toBe('milestone');
    expect(m.width).toBe(MILESTONE_MARKER_SIZE);
    // Centred on x=100 within the bar → left = 100 - size/2.
    expect(m.left).toBeCloseTo(100 - MILESTONE_MARKER_SIZE / 2, 5);
  });

  it('drops a child that falls entirely outside the summary bar', () => {
    const markers = computeRollupMarkers({ left: 0, width: 100 }, [
      child({ left: 500, width: 40 }), // entirely to the right
    ]);
    expect(markers).toHaveLength(0);
  });

  it('orders markers left-to-right regardless of input order', () => {
    const markers = computeRollupMarkers({ left: 0, width: 400 }, [
      child({ taskId: 'late', left: 200, width: 20 }),
      child({ taskId: 'early', left: 20, width: 20 }),
    ]);
    expect(markers.map((m) => m.taskId)).toEqual(['early', 'late']);
  });
});

/* ── integration on a real Gantt ───────────────────────────────────────── */

/**
 * A small plan: one summary 'parent' with two leaf children + one milestone,
 * as a FLAT `parentId`-keyed array (the form the Gantt flattens into the engine,
 * so the engine derives `summary` on the parent and rolls up its dates).
 */
function plan(opts: { rollup?: boolean } = {}): TaskModel[] {
  const flag = opts.rollup ? { rollup: true } : {};
  return [
    { id: 'parent', name: 'Phase 1', ...flag } as TaskModel,
    { id: 'a', name: 'Design', parentId: 'parent', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY, ...flag } as TaskModel,
    { id: 'b', name: 'Build', parentId: 'parent', start: T0 + 2 * DAY, duration: 3 * DAY, end: T0 + 5 * DAY, ...flag } as TaskModel,
    { id: 'm', name: 'Sign-off', parentId: 'parent', start: T0 + 5 * DAY, milestone: true, ...flag } as TaskModel,
  ];
}

/** Collapse a node in the Gantt's tree store and force a synchronous repaint. */
function collapse(g: Gantt, id: RecordId): void {
  const store = (g as unknown as { _store: TreeStore<TaskModel> })._store;
  store.collapse(id);
  // The store change re-syncs panes; ensure the timeline rebuild has happened.
  (g as unknown as { refreshPanes(): void }).refreshPanes();
}

function summaryBar(g: Gantt): HTMLElement | null {
  return g.el.querySelector('.jects-gantt__bar--summary[data-task-id="parent"]');
}

describe('GanttRollupFeature (integration)', () => {
  it('overlays one rollup marker per eligible leaf child on a collapsed summary', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = createRollupFeature();
    gantt.use(feature);

    collapse(gantt, 'parent');
    feature.paint();

    const bar = summaryBar(gantt)!;
    expect(bar).not.toBeNull();
    const overlay = bar.querySelector('.jects-gantt__rollups');
    expect(overlay).not.toBeNull();
    // Two tasks + one milestone = three child markers.
    const markers = overlay!.querySelectorAll('.jects-gantt__rollup');
    expect(markers).toHaveLength(3);
    expect(bar.dataset.rollup).toBe('3');
    // Milestone child renders as a diamond marker.
    expect(overlay!.querySelector('.jects-gantt__rollup--milestone[data-task-id="m"]')).not.toBeNull();
  });

  it('positions markers within the summary bar (every marker left >= 0)', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = createRollupFeature();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();

    const markers = feature.markersFor('parent');
    expect(markers.length).toBe(3);
    for (const m of markers) {
      expect(m.left).toBeGreaterThanOrEqual(0);
      expect(m.width).toBeGreaterThan(0);
    }
    // Markers are ordered: design (start) before build before the sign-off point.
    expect(markers.map((m) => String(m.taskId))).toEqual(['a', 'b', 'm']);
  });

  it("does NOT roll up a summary in the default 'collapsed' mode while it is expanded", () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = createRollupFeature();
    gantt.use(feature);
    // Expanded by default — children render as their own rows/bars.
    feature.paint();

    const bar = summaryBar(gantt)!;
    expect(bar.querySelector('.jects-gantt__rollups')).toBeNull();
    expect(feature.markersFor('parent')).toHaveLength(0);
  });

  it("rolls up an expanded summary in 'always' mode", () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = new GanttRollupFeature({ mode: 'always' });
    gantt.use(feature);
    feature.paint();

    const bar = summaryBar(gantt)!;
    expect(bar.querySelector('.jects-gantt__rollups')).not.toBeNull();
    expect(feature.markersFor('parent').length).toBe(3);
  });

  it('skips summaries without the rollup flag unless allSummaries is set', () => {
    // No rollup flags anywhere.
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const feature = createRollupFeature();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();
    expect(summaryBar(gantt)!.querySelector('.jects-gantt__rollups')).toBeNull();

    // allSummaries opts every collapsed summary in.
    feature.destroy();
    const all = new GanttRollupFeature({ allSummaries: true });
    gantt.use(all);
    (gantt as unknown as { refreshPanes(): void }).refreshPanes();
    all.paint();
    expect(summaryBar(gantt)!.querySelector('.jects-gantt__rollups')).not.toBeNull();
    expect(all.markersFor('parent').length).toBe(3);
  });

  it('honours an isRollup override to pick which children roll up', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    // Only the 'a' task is eligible.
    const feature = new GanttRollupFeature({
      rollupChildrenOf: () => true,
      isRollup: (t) => String(t.id) === 'a',
    });
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();

    const markers = feature.markersFor('parent');
    expect(markers.map((m) => String(m.taskId))).toEqual(['a']);
  });

  it('exposes the overlay as an accessible labelled group', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = createRollupFeature();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();

    const overlay = summaryBar(gantt)!.querySelector('.jects-gantt__rollups')!;
    expect(overlay.getAttribute('role')).toBe('img');
    expect(overlay.getAttribute('aria-label')).toContain('rolled-up child');
  });

  it('re-paints idempotently (no duplicate overlays or markers)', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = createRollupFeature();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();
    feature.paint();
    const bar = summaryBar(gantt)!;
    expect(bar.querySelectorAll('.jects-gantt__rollups')).toHaveLength(1);
    expect(bar.querySelectorAll('.jects-gantt__rollup')).toHaveLength(3);
  });

  it('clears the markers when the summary is expanded again', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = createRollupFeature();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();
    expect(summaryBar(gantt)!.querySelector('.jects-gantt__rollups')).not.toBeNull();

    // Re-expand: children come back as rows, so the rollup must disappear.
    const store = (gantt as unknown as { _store: TreeStore<TaskModel> })._store;
    void store.expand('parent');
    (gantt as unknown as { refreshPanes(): void }).refreshPanes();
    feature.paint();
    expect(summaryBar(gantt)!.querySelector('.jects-gantt__rollups')).toBeNull();
  });

  it('removes all decoration and releases subscriptions on destroy()', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = new GanttRollupFeature();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();
    expect(gantt.el.querySelector('.jects-gantt__rollups')).not.toBeNull();

    feature.destroy();
    expect(gantt.el.querySelector('.jects-gantt__rollups')).toBeNull();
    expect(summaryBar(gantt)!.hasAttribute('data-rollup')).toBe(false);
    // Idempotent.
    expect(() => feature.destroy()).not.toThrow();
  });

  it('can be re-installed after destroy (instance reuse)', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = new GanttRollupFeature();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();
    feature.destroy();

    gantt.use(feature);
    (gantt as unknown as { refreshPanes(): void }).refreshPanes();
    feature.paint();
    expect(gantt.el.querySelectorAll('.jects-gantt__rollups')).toHaveLength(1);
    expect(gantt.el.querySelectorAll('.jects-gantt__rollup')).toHaveLength(3);
  });
});
