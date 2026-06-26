/**
 * jsdom unit tests for the Gantt **child-rollup glyphs + tooltip** feature
 * (`rollups.ts`).
 *
 * Three layers:
 *   1. Pure geometry — `projectRollups` projects child spans (absolute
 *      content-pixel space) into bar-local glyphs, clamped to the summary bar,
 *      with milestones collapsing to centred diamonds.
 *   2. Tooltip text — `defaultTooltipText` formats name + dates + progress.
 *   3. Integration — installed on a real `Gantt`, it overlays glyphs on a
 *      collapsed summary bar (one per eligible leaf child), wires per-glyph
 *      tooltip data + focusability, honours the per-task `rollup` flag and the
 *      `allSummaries` / `mode` config, hides while the summary is expanded (in the
 *      default `'collapsed'` mode), and cleans up on `destroy()`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { type TreeStore, type RecordId } from '@jects/core';
import { Gantt } from './gantt.js';
import {
  GanttRollups,
  createRollups,
  projectRollups,
  defaultTooltipText,
  isoDate,
  MIN_GLYPH_WIDTH,
  MILESTONE_GLYPH_SIZE,
  type RollupChild,
} from './rollups.js';
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

describe('projectRollups', () => {
  function child(part: Partial<RollupChild>): RollupChild {
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
    const [g] = projectRollups({ left: 80, width: 200 }, [child({ left: 120, width: 30 })]);
    expect(g.kind).toBe('bar');
    expect(g.left).toBe(40); // 120 - 80
    expect(g.width).toBe(30);
    expect(g.taskId).toBe('c');
  });

  it('clamps a glyph so it never extends past the summary bar edges', () => {
    const [g] = projectRollups({ left: 80, width: 200 }, [child({ left: 40, width: 400 })]);
    expect(g.left).toBe(0);
    expect(g.width).toBeLessThanOrEqual(200);
  });

  it('enforces a minimum visible width for very short child tasks', () => {
    const [g] = projectRollups({ left: 0, width: 200 }, [child({ left: 10, width: 0.2 })]);
    expect(g.width).toBeGreaterThanOrEqual(MIN_GLYPH_WIDTH);
  });

  it('collapses a milestone child to a centred diamond at its instant', () => {
    const [g] = projectRollups({ left: 0, width: 200 }, [
      child({ left: 100, width: 0, milestone: true }),
    ]);
    expect(g.kind).toBe('milestone');
    expect(g.width).toBe(MILESTONE_GLYPH_SIZE);
    expect(g.left).toBeCloseTo(100 - MILESTONE_GLYPH_SIZE / 2, 5);
  });

  it('drops a child that falls entirely outside the summary bar', () => {
    const glyphs = projectRollups({ left: 0, width: 100 }, [child({ left: 500, width: 40 })]);
    expect(glyphs).toHaveLength(0);
  });

  it('orders glyphs left-to-right regardless of input order', () => {
    const glyphs = projectRollups({ left: 0, width: 400 }, [
      child({ taskId: 'late', left: 200, width: 20 }),
      child({ taskId: 'early', left: 20, width: 20 }),
    ]);
    expect(glyphs.map((g) => g.taskId)).toEqual(['early', 'late']);
  });
});

/* ── tooltip text ──────────────────────────────────────────────────────── */

describe('defaultTooltipText / isoDate', () => {
  it('formats name, span dates and percent done', () => {
    const text = defaultTooltipText(
      { id: 'a', name: 'Design', percentDone: 0.5 } as TaskModel,
      { start: T0, end: T0 + 2 * DAY },
    );
    expect(text).toContain('Design');
    expect(text).toContain(isoDate(T0));
    expect(text).toContain(isoDate(T0 + 2 * DAY));
    expect(text).toContain('50%');
  });

  it('renders a milestone tooltip with a single instant', () => {
    const text = defaultTooltipText(
      { id: 'm', name: 'Sign-off', milestone: true } as TaskModel,
      { start: T0, end: T0 },
    );
    expect(text).toBe(`Sign-off · ${isoDate(T0)}`);
  });

  it('isoDate returns a UTC YYYY-MM-DD string', () => {
    expect(isoDate(T0)).toBe('2026-01-05');
    expect(isoDate(Number.NaN)).toBe('');
  });
});

/* ── integration on a real Gantt ───────────────────────────────────────── */

function plan(opts: { rollup?: boolean } = {}): TaskModel[] {
  const flag = opts.rollup ? { rollup: true } : {};
  return [
    { id: 'parent', name: 'Phase 1', ...flag } as TaskModel,
    { id: 'a', name: 'Design', parentId: 'parent', start: T0, duration: 2 * DAY, end: T0 + 2 * DAY, percentDone: 0.5, ...flag } as TaskModel,
    { id: 'b', name: 'Build', parentId: 'parent', start: T0 + 2 * DAY, duration: 3 * DAY, end: T0 + 5 * DAY, ...flag } as TaskModel,
    { id: 'm', name: 'Sign-off', parentId: 'parent', start: T0 + 5 * DAY, milestone: true, ...flag } as TaskModel,
  ];
}

function collapse(g: Gantt, id: RecordId): void {
  const store = (g as unknown as { _store: TreeStore<TaskModel> })._store;
  store.collapse(id);
  (g as unknown as { refreshPanes(): void }).refreshPanes();
}

function summaryBar(g: Gantt): HTMLElement | null {
  return g.el.querySelector('.jects-gantt__bar--summary[data-task-id="parent"]');
}

describe('GanttRollups (integration)', () => {
  it('overlays one glyph per eligible leaf child on a collapsed summary', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = createRollups();
    gantt.use(feature);

    collapse(gantt, 'parent');
    feature.paint();

    const bar = summaryBar(gantt)!;
    expect(bar).not.toBeNull();
    const track = bar.querySelector('.jects-gantt__rollup-track');
    expect(track).not.toBeNull();
    const glyphs = track!.querySelectorAll('.jects-gantt__rollup-glyph');
    expect(glyphs).toHaveLength(3); // two tasks + one milestone
    expect(bar.dataset.rollups).toBe('3');
    expect(track!.querySelector('.jects-gantt__rollup-glyph--milestone[data-task-id="m"]')).not.toBeNull();
  });

  it('makes each glyph focusable and carries tooltip data + an accessible name', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = createRollups();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();

    const designGlyph = summaryBar(gantt)!.querySelector(
      '.jects-gantt__rollup-glyph[data-task-id="a"]',
    ) as HTMLElement;
    expect(designGlyph).not.toBeNull();
    expect(designGlyph.tabIndex).toBe(0);
    expect(designGlyph.getAttribute('role')).toBe('img');
    expect(designGlyph.getAttribute('aria-label')).toContain('Design');
    expect(designGlyph.dataset.tip).toContain('50%');
  });

  it('positions glyphs within the summary bar (every glyph left >= 0), ordered in time', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = createRollups();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();

    const glyphs = feature.glyphsFor('parent');
    expect(glyphs.length).toBe(3);
    for (const g of glyphs) {
      expect(g.left).toBeGreaterThanOrEqual(0);
      expect(g.width).toBeGreaterThan(0);
    }
    expect(glyphs.map((g) => String(g.taskId))).toEqual(['a', 'b', 'm']);
  });

  it("does NOT roll up in the default 'collapsed' mode while expanded", () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = createRollups();
    gantt.use(feature);
    feature.paint();

    const bar = summaryBar(gantt)!;
    expect(bar.querySelector('.jects-gantt__rollup-track')).toBeNull();
    expect(feature.glyphsFor('parent')).toHaveLength(0);
  });

  it("rolls up an expanded summary in 'always' mode", () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = new GanttRollups({ mode: 'always' });
    gantt.use(feature);
    feature.paint();

    const bar = summaryBar(gantt)!;
    expect(bar.querySelector('.jects-gantt__rollup-track')).not.toBeNull();
    expect(feature.glyphsFor('parent').length).toBe(3);
  });

  it('skips summaries without the rollup flag unless allSummaries is set', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const feature = createRollups();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();
    expect(summaryBar(gantt)!.querySelector('.jects-gantt__rollup-track')).toBeNull();

    feature.destroy();
    const all = new GanttRollups({ allSummaries: true });
    gantt.use(all);
    (gantt as unknown as { refreshPanes(): void }).refreshPanes();
    all.paint();
    expect(summaryBar(gantt)!.querySelector('.jects-gantt__rollup-track')).not.toBeNull();
    expect(all.glyphsFor('parent').length).toBe(3);
  });

  it('honours an includeChild override to pick which children roll up', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const feature = new GanttRollups({
      includeSummary: () => true,
      includeChild: (t) => String(t.id) === 'a',
    });
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();

    const glyphs = feature.glyphsFor('parent');
    expect(glyphs.map((g) => String(g.taskId))).toEqual(['a']);
  });

  it('honours a custom tooltipText resolver', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = new GanttRollups({ tooltipText: (t) => `TT:${String(t.id)}` });
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();

    const glyph = summaryBar(gantt)!.querySelector(
      '.jects-gantt__rollup-glyph[data-task-id="a"]',
    ) as HTMLElement;
    expect(glyph.dataset.tip).toBe('TT:a');
    expect(glyph.getAttribute('aria-label')).toBe('TT:a');
  });

  it('exposes the track as an accessible labelled group', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = createRollups();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();

    const track = summaryBar(gantt)!.querySelector('.jects-gantt__rollup-track')!;
    expect(track.getAttribute('role')).toBe('group');
    expect(track.getAttribute('aria-label')).toContain('rolled-up child');
  });

  it('shows the floating tooltip on focusin and hides it on focusout', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = createRollups();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();

    const glyph = summaryBar(gantt)!.querySelector(
      '.jects-gantt__rollup-glyph[data-task-id="a"]',
    ) as HTMLElement;
    glyph.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    const tip = gantt.el.querySelector('.jects-gantt__rollup-tip') as HTMLElement;
    expect(tip).not.toBeNull();
    expect(tip.hidden).toBe(false);
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.textContent).toContain('Design');

    glyph.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(tip.hidden).toBe(true);
  });

  it('disables the tooltip layer when tooltips:false (no popover on focus)', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = new GanttRollups({ tooltips: false });
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();

    const glyph = summaryBar(gantt)!.querySelector(
      '.jects-gantt__rollup-glyph[data-task-id="a"]',
    ) as HTMLElement;
    glyph.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(gantt.el.querySelector('.jects-gantt__rollup-tip')).toBeNull();
    // The accessible name is still present via title/aria-label.
    expect(glyph.title).toContain('Design');
  });

  it('re-paints idempotently (no duplicate tracks or glyphs)', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = createRollups();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();
    feature.paint();
    const bar = summaryBar(gantt)!;
    expect(bar.querySelectorAll('.jects-gantt__rollup-track')).toHaveLength(1);
    expect(bar.querySelectorAll('.jects-gantt__rollup-glyph')).toHaveLength(3);
  });

  it('clears the glyphs when the summary is expanded again', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = createRollups();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();
    expect(summaryBar(gantt)!.querySelector('.jects-gantt__rollup-track')).not.toBeNull();

    const store = (gantt as unknown as { _store: TreeStore<TaskModel> })._store;
    void store.expand('parent');
    (gantt as unknown as { refreshPanes(): void }).refreshPanes();
    feature.paint();
    expect(summaryBar(gantt)!.querySelector('.jects-gantt__rollup-track')).toBeNull();
  });

  it('removes all decoration and releases subscriptions on destroy()', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = new GanttRollups();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();
    expect(gantt.el.querySelector('.jects-gantt__rollup-track')).not.toBeNull();

    feature.destroy();
    expect(gantt.el.querySelector('.jects-gantt__rollup-track')).toBeNull();
    expect(gantt.el.querySelector('.jects-gantt__rollup-tip')).toBeNull();
    expect(summaryBar(gantt)!.hasAttribute('data-rollups')).toBe(false);
    expect(() => feature.destroy()).not.toThrow();
  });

  it('can be re-installed after destroy (instance reuse)', () => {
    gantt = new Gantt(host, { tasks: plan({ rollup: true }), projectStart: T0 });
    const feature = new GanttRollups();
    gantt.use(feature);
    collapse(gantt, 'parent');
    feature.paint();
    feature.destroy();

    gantt.use(feature);
    (gantt as unknown as { refreshPanes(): void }).refreshPanes();
    feature.paint();
    expect(gantt.el.querySelectorAll('.jects-gantt__rollup-track')).toHaveLength(1);
    expect(gantt.el.querySelectorAll('.jects-gantt__rollup-glyph')).toHaveLength(3);
  });
});
