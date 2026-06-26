/**
 * jsdom unit tests for the Gantt **Indicators** feature.
 *
 * Two layers:
 *   1. Pure resolution — `indicatorsFor` / `resolveDeadline` produce the right
 *      built-in indicators (constraint / deadline / late) from a task model.
 *   2. Integration — installed on a real `Gantt`, it paints indicator spans onto
 *      task bars, the spans are operable (click → `onIndicatorClick`), and it
 *      cleans up on `destroy()`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Gantt } from './gantt.js';
import {
  GanttIndicatorsFeature,
  resolveDeadline,
  renderIndicatorIcon,
  type IndicatorClickPayload,
} from './indicators.js';
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

/* ── pure resolution ───────────────────────────────────────────────────── */

describe('resolveDeadline', () => {
  it('reads a numeric deadline, a Date deadline, and a nested data.deadline', () => {
    expect(resolveDeadline({ deadline: T0 })).toBe(T0);
    expect(resolveDeadline({ deadline: new Date(T0) })).toBe(T0);
    expect(resolveDeadline({ data: { deadline: T0 } })).toBe(T0);
    expect(resolveDeadline({})).toBeUndefined();
    expect(resolveDeadline({ deadline: 'nope' as unknown as number })).toBeUndefined();
  });
});

describe('GanttIndicatorsFeature.indicatorsFor', () => {
  function feature(cfg = {}): GanttIndicatorsFeature {
    return new GanttIndicatorsFeature(cfg);
  }

  it('emits a constraint indicator for date-bearing constraint types', () => {
    const f = feature();
    const task: TaskModel = {
      id: 't',
      constraintType: 'mustStartOn',
      constraintDate: T0,
    };
    const inds = f.indicatorsFor(task);
    const c = inds.find((i) => i.kind === 'constraint');
    expect(c).toBeDefined();
    expect(c!.date).toBe(T0);
    expect(c!.tooltip).toContain('Must start on');
  });

  it('does NOT emit a constraint indicator for asSoonAsPossible (the default)', () => {
    const f = feature();
    expect(f.indicatorsFor({ id: 't', constraintType: 'asSoonAsPossible' })).toHaveLength(0);
    expect(f.indicatorsFor({ id: 't' })).toHaveLength(0);
  });

  it('emits a deadline indicator and a late indicator when the finish passes it', () => {
    const f = feature();
    const onTime = f.indicatorsFor({ id: 'a', end: T0 + 2 * DAY, deadline: T0 + 3 * DAY });
    expect(onTime.map((i) => i.kind)).toEqual(['deadline']);

    const late = f.indicatorsFor({ id: 'b', end: T0 + 5 * DAY, deadline: T0 + 3 * DAY });
    expect(late.map((i) => i.kind)).toEqual(['deadline', 'late']);
    const lateInd = late.find((i) => i.kind === 'late')!;
    expect(lateInd.tooltip).toContain('Late');
  });

  it('honours feature flags (disabling a built-in suppresses it)', () => {
    const f = feature({ deadlineIndicators: false, lateIndicators: false });
    expect(f.indicatorsFor({ id: 'b', end: T0 + 5 * DAY, deadline: T0 + 3 * DAY })).toHaveLength(0);
  });

  it('appends custom indicators from getIndicators after the built-ins', () => {
    const f = feature({
      getIndicators: (task) => [
        { id: 'star', kind: 'custom', tooltip: `Custom for ${String(task.id)}`, side: 'end' },
      ],
    });
    const inds = f.indicatorsFor({ id: 'x', deadline: T0 + DAY, end: T0 });
    expect(inds.map((i) => i.id)).toEqual(['deadline', 'star']);
  });

  it('swallows a throwing custom resolver (built-ins survive)', () => {
    const f = feature({
      getIndicators: () => {
        throw new Error('boom');
      },
    });
    expect(() => f.indicatorsFor({ id: 'x', deadline: T0 + DAY, end: T0 })).not.toThrow();
    expect(f.indicatorsFor({ id: 'x', deadline: T0 + DAY, end: T0 })).toHaveLength(1);
  });
});

describe('renderIndicatorIcon', () => {
  it('renders a token-friendly currentColor SVG for each glyph', () => {
    const svg = renderIndicatorIcon('alert-triangle');
    expect(svg).toContain('<svg');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('aria-hidden="true"');
  });
});

/* ── integration on a real Gantt ───────────────────────────────────────── */

function tasksWithDeadlines(): TaskModel[] {
  return [
    {
      id: 'a',
      name: 'Design',
      start: T0,
      duration: 3 * DAY,
      end: T0 + 3 * DAY,
      constraintType: 'mustStartOn',
      constraintDate: T0,
      // finishes T0+3d, deadline T0+2d ⇒ late
      deadline: T0 + 2 * DAY,
    } as TaskModel,
    {
      id: 'b',
      name: 'Build',
      start: T0 + 3 * DAY,
      duration: 3 * DAY,
      end: T0 + 6 * DAY,
      deadline: T0 + 10 * DAY, // comfortably on time
    } as TaskModel,
  ];
}

describe('GanttIndicatorsFeature (integration)', () => {
  it('paints indicator spans onto task bars when installed', () => {
    gantt = new Gantt(host, { tasks: tasksWithDeadlines(), projectStart: T0 });
    const feature = new GanttIndicatorsFeature();
    gantt.use(feature);
    feature.paint();

    const all = gantt.el.querySelectorAll('.jects-gantt__indicator');
    expect(all.length).toBeGreaterThan(0);

    // Task 'a' should carry constraint + deadline + late.
    const barA = gantt.el.querySelector('.jects-gantt__bar[data-task-id="a"]')!;
    const kindsA = [...barA.querySelectorAll('.jects-gantt__indicator')].map(
      (e) => (e as HTMLElement).dataset.indicatorKind,
    );
    expect(kindsA).toContain('constraint');
    expect(kindsA).toContain('deadline');
    expect(kindsA).toContain('late');

    // Task 'b' is on time: deadline only, no late.
    const barB = gantt.el.querySelector('.jects-gantt__bar[data-task-id="b"]')!;
    const kindsB = [...barB.querySelectorAll('.jects-gantt__indicator')].map(
      (e) => (e as HTMLElement).dataset.indicatorKind,
    );
    expect(kindsB).toContain('deadline');
    expect(kindsB).not.toContain('late');
  });

  it('places indicators in start/end edge clusters', () => {
    gantt = new Gantt(host, { tasks: tasksWithDeadlines(), projectStart: T0 });
    const feature = new GanttIndicatorsFeature();
    gantt.use(feature);
    feature.paint();
    const barA = gantt.el.querySelector('.jects-gantt__bar[data-task-id="a"]')!;
    // constraint pins to start; deadline + late pin to end.
    expect(barA.querySelector('.jects-gantt__indicators--start .jects-gantt__indicator--constraint')).not.toBeNull();
    expect(barA.querySelector('.jects-gantt__indicators--end .jects-gantt__indicator--deadline')).not.toBeNull();
  });

  it('indicator spans are focusable buttons with an accessible label', () => {
    gantt = new Gantt(host, { tasks: tasksWithDeadlines(), projectStart: T0 });
    const feature = new GanttIndicatorsFeature();
    gantt.use(feature);
    feature.paint();
    const span = gantt.el.querySelector('.jects-gantt__indicator') as HTMLElement;
    expect(span.getAttribute('role')).toBe('button');
    expect(span.tabIndex).toBe(0);
    expect(span.getAttribute('aria-label')).toBeTruthy();
    expect(span.title).toBeTruthy();
  });

  it('fires onIndicatorClick (and the indicatorClick event) on activation', () => {
    const clicks: IndicatorClickPayload[] = [];
    gantt = new Gantt(host, { tasks: tasksWithDeadlines(), projectStart: T0 });
    const feature = new GanttIndicatorsFeature({
      onIndicatorClick: (p) => clicks.push(p),
    });
    gantt.use(feature);
    feature.paint();

    let evented = 0;
    (gantt as unknown as { on(e: string, fn: () => void): void }).on('indicatorClick', () => {
      evented++;
    });

    const span = gantt.el.querySelector(
      '.jects-gantt__bar[data-task-id="a"] .jects-gantt__indicator--constraint',
    ) as HTMLElement;
    span.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(clicks).toHaveLength(1);
    expect(String(clicks[0]!.task.id)).toBe('a');
    expect(clicks[0]!.indicator.kind).toBe('constraint');
    expect(evented).toBe(1);
  });

  it('activates via keyboard (Enter)', () => {
    const clicks: IndicatorClickPayload[] = [];
    gantt = new Gantt(host, { tasks: tasksWithDeadlines(), projectStart: T0 });
    const feature = new GanttIndicatorsFeature({ onIndicatorClick: (p) => clicks.push(p) });
    gantt.use(feature);
    feature.paint();
    const span = gantt.el.querySelector('.jects-gantt__indicator') as HTMLElement;
    span.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(clicks).toHaveLength(1);
  });

  it('re-paints idempotently (no duplicate spans on repeated paint)', () => {
    gantt = new Gantt(host, { tasks: tasksWithDeadlines(), projectStart: T0 });
    const feature = new GanttIndicatorsFeature();
    gantt.use(feature);
    feature.paint();
    const before = gantt.el.querySelectorAll('.jects-gantt__indicator').length;
    feature.paint();
    feature.paint();
    expect(gantt.el.querySelectorAll('.jects-gantt__indicator').length).toBe(before);
  });

  it('removes all indicator DOM and listeners on destroy()', () => {
    gantt = new Gantt(host, { tasks: tasksWithDeadlines(), projectStart: T0 });
    const feature = new GanttIndicatorsFeature();
    gantt.use(feature);
    feature.paint();
    expect(gantt.el.querySelectorAll('.jects-gantt__indicator').length).toBeGreaterThan(0);
    feature.destroy();
    expect(gantt.el.querySelectorAll('.jects-gantt__indicators').length).toBe(0);
    expect(gantt.el.querySelectorAll('.jects-gantt__indicator').length).toBe(0);
  });

  it('releases its engine subscriptions on destroy() — no leak after removeFeature', () => {
    gantt = new Gantt(host, { tasks: tasksWithDeadlines(), projectStart: T0 });
    const feature = new GanttIndicatorsFeature();
    gantt.use(feature);
    feature.paint();

    // Spy on the (private) repaint scheduler so we can detect a leaked handler
    // firing after the feature has been removed.
    const spy = vi.spyOn(
      feature as unknown as { schedulePaint(): void },
      'schedulePaint',
    );

    // Sanity: while installed, an engine event drives a repaint.
    (gantt as unknown as {
      emit(e: 'taskChange', p: unknown): boolean;
    }).emit('taskChange', { task: tasksWithDeadlines()[0], changes: [] });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();

    // Remove the feature WHILE the Gantt is still alive (the leak scenario).
    gantt.removeFeature('indicators');
    expect(gantt.features.get('indicators')).toBeUndefined();

    // Now the same engine events must NOT reach the dead feature — the three
    // subscriptions (scheduleChange/conflict/taskChange) were unsubscribed.
    const g = gantt as unknown as { emit(e: string, p: unknown): boolean };
    g.emit('taskChange', { task: tasksWithDeadlines()[0], changes: [] });
    g.emit('scheduleChange', { result: { conflicts: [] } });
    g.emit('conflict', { conflicts: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  it('destroy() is idempotent and clears conflictIds', () => {
    gantt = new Gantt(host, { tasks: tasksWithDeadlines(), projectStart: T0 });
    const feature = new GanttIndicatorsFeature();
    gantt.use(feature);
    feature.paint();
    expect(() => {
      feature.destroy();
      feature.destroy();
    }).not.toThrow();
    // conflictIds is private; assert observable effect: re-painting after destroy
    // produces no conflict spans and does not throw.
    expect(() => feature.paint()).not.toThrow();
    expect(gantt.el.querySelectorAll('.jects-gantt__indicator--conflict').length).toBe(0);
  });

  it('can be re-installed on the same instance after destroy() without double-subscribing', () => {
    gantt = new Gantt(host, { tasks: tasksWithDeadlines(), projectStart: T0 });
    const feature = new GanttIndicatorsFeature();
    gantt.use(feature);
    feature.paint();
    gantt.removeFeature('indicators');

    // Re-use the SAME instance.
    gantt.use(feature);
    feature.paint();
    const spy = vi.spyOn(feature as unknown as { schedulePaint(): void }, 'schedulePaint');
    (gantt as unknown as { emit(e: string, p: unknown): boolean }).emit('taskChange', {
      task: tasksWithDeadlines()[0],
      changes: [],
    });
    // Exactly one repaint scheduled — not two from a stale + fresh subscription.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('is removed cleanly when the Gantt itself is destroyed (tracked disposer)', () => {
    gantt = new Gantt(host, { tasks: tasksWithDeadlines(), projectStart: T0 });
    const feature = new GanttIndicatorsFeature();
    gantt.use(feature);
    feature.paint();
    gantt.destroy();
    // No throw, and the feature's observer/listeners are gone.
    expect(() => feature.paint()).not.toThrow();
  });

  it('can be installed declaratively via the plugins option', () => {
    const feature = new GanttIndicatorsFeature();
    gantt = new Gantt(host, {
      tasks: tasksWithDeadlines(),
      projectStart: T0,
      plugins: [feature],
    });
    feature.paint();
    expect(gantt.features.get('indicators')).toBe(feature);
    expect(gantt.el.querySelectorAll('.jects-gantt__indicator').length).toBeGreaterThan(0);
  });
});
