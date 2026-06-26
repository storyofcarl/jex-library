/**
 * jsdom unit tests for `GanttTimelineView` — the right-pane timeline renderer.
 * Covers bar/milestone/summary rendering, progress fill, today line, dependency
 * connectors, the drag-to-reschedule callback, and the drag-to-link callback.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WEEK_AND_DAY } from '@jects/timeline-core';
import { GanttTimelineView, terminalsFor } from './timeline-view.js';
import type { TaskModel, DependencyModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

// jsdom has no PointerEvent; provide a minimal MouseEvent-based shim with the
// `pointerId` the drag controllers gate on.
class PointerEventShim extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}
if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
  (globalThis as { PointerEvent?: unknown }).PointerEvent =
    PointerEventShim as unknown as typeof PointerEvent;
}
// jsdom elements lack setPointerCapture/releasePointerCapture.
if (!('setPointerCapture' in HTMLElement.prototype)) {
  (HTMLElement.prototype as unknown as { setPointerCapture(): void }).setPointerCapture = () => {};
  (HTMLElement.prototype as unknown as { releasePointerCapture(): void }).releasePointerCapture =
    () => {};
}

let host: HTMLElement;
let view: GanttTimelineView;

const range = { start: T0 - 7 * DAY, end: T0 + 30 * DAY };

function rowsOf(tasks: TaskModel[], critical: string[] = []) {
  return tasks.map((task, i) => ({
    task,
    top: i * 32,
    height: 32,
    critical: critical.includes(String(task.id)),
  }));
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  view?.destroy();
  host.remove();
});

describe('GanttTimelineView', () => {
  it('renders one bar per task row with a header and today line', () => {
    view = new GanttTimelineView({ preset: WEEK_AND_DAY, range, now: T0 + 2 * DAY });
    host.append(view.el);
    view.setRows(
      rowsOf([
        { id: 'a', name: 'Design', start: T0, end: T0 + 3 * DAY, duration: 3 * DAY },
        { id: 'b', name: 'Build', start: T0 + 3 * DAY, end: T0 + 6 * DAY, duration: 3 * DAY },
      ]),
      [],
    );
    expect(view.el.querySelectorAll('.jects-gantt__bar').length).toBe(2);
    expect(view.el.querySelector('.jects-gantt__today')).not.toBeNull();
    expect(view.el.querySelector('.jects-gantt__timeline-header')!.textContent).toBeTruthy();
  });

  it('draws a milestone as a diamond and a summary bar distinctly', () => {
    view = new GanttTimelineView({ preset: WEEK_AND_DAY, range });
    host.append(view.el);
    view.setRows(
      rowsOf([
        { id: 'p', name: 'Phase', start: T0, end: T0 + 6 * DAY, duration: 6 * DAY, summary: true },
        { id: 'm', name: 'Launch', start: T0 + 6 * DAY, end: T0 + 6 * DAY, milestone: true },
      ]),
      [],
    );
    expect(view.el.querySelector('.jects-gantt__bar--summary')).not.toBeNull();
    expect(view.el.querySelector('.jects-gantt__bar--milestone')).not.toBeNull();
  });

  it('renders a progress fill for a partially complete task', () => {
    view = new GanttTimelineView({ preset: WEEK_AND_DAY, range });
    host.append(view.el);
    view.setRows(
      rowsOf([
        { id: 'a', name: 'Work', start: T0, end: T0 + 4 * DAY, duration: 4 * DAY, percentDone: 0.5 },
      ]),
      [],
    );
    const fill = view.el.querySelector('.jects-gantt__bar-progress') as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe('50%');
  });

  it('marks critical-path bars with the critical modifier', () => {
    view = new GanttTimelineView({ preset: WEEK_AND_DAY, range });
    host.append(view.el);
    view.setRows(
      rowsOf(
        [{ id: 'a', name: 'A', start: T0, end: T0 + 2 * DAY, duration: 2 * DAY }],
        ['a'],
      ),
      [],
    );
    expect(view.el.querySelector('.jects-gantt__bar--critical')).not.toBeNull();
  });

  it('routes a dependency connector with an arrowhead between two bars', () => {
    view = new GanttTimelineView({ preset: WEEK_AND_DAY, range });
    host.append(view.el);
    const tasks: TaskModel[] = [
      { id: 'a', name: 'A', start: T0, end: T0 + 2 * DAY, duration: 2 * DAY },
      { id: 'b', name: 'B', start: T0 + 2 * DAY, end: T0 + 4 * DAY, duration: 2 * DAY },
    ];
    const deps: DependencyModel[] = [{ id: 'l1', fromId: 'a', toId: 'b', type: 'FS' }];
    view.setRows(rowsOf(tasks), deps);
    expect(view.el.querySelectorAll('.jects-gantt__dep-line').length).toBe(1);
    expect(view.el.querySelectorAll('.jects-gantt__dep-arrow').length).toBe(1);
  });

  it('reports a reschedule when a bar is dragged', () => {
    let captured: { id: unknown; start: number; mode: string } | null = null;
    view = new GanttTimelineView({
      preset: WEEK_AND_DAY,
      range,
      onTaskSpanChange: (id, span, mode) => {
        captured = { id, start: span.start, mode };
      },
    });
    host.append(view.el);
    view.setRows(
      rowsOf([{ id: 'a', name: 'A', start: T0, end: T0 + 2 * DAY, duration: 2 * DAY }]),
      [],
    );
    const bar = view.el.querySelector('.jects-gantt__bar') as HTMLElement;
    const rect = bar.getBoundingClientRect();
    bar.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left + 5, pointerId: 1 }),
    );
    // Move several days to the right and release.
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: rect.left + 5 + 180, pointerId: 1 }),
    );
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: rect.left + 5 + 180, pointerId: 1 }),
    );
    expect(captured).not.toBeNull();
    expect(captured!.mode).toBe('move');
    expect(captured!.start).toBeGreaterThan(T0);
  });

  it('reports a dependency-create when dragging from a bar link handle', () => {
    let link: { fromId: unknown; toId: unknown } | null = null;
    view = new GanttTimelineView({
      preset: WEEK_AND_DAY,
      range,
      onDependencyCreate: (l) => {
        link = { fromId: l.fromId, toId: l.toId };
      },
    });
    host.append(view.el);
    view.setRows(
      rowsOf([
        { id: 'a', name: 'A', start: T0, end: T0 + 2 * DAY, duration: 2 * DAY },
        { id: 'b', name: 'B', start: T0 + 4 * DAY, end: T0 + 6 * DAY, duration: 2 * DAY },
      ]),
      [],
    );
    const barA = view.el.querySelector('[data-task-id="a"]') as HTMLElement;
    const barB = view.el.querySelector('[data-task-id="b"]') as HTMLElement;
    const handle = barA.querySelector('.jects-gantt__bar-link') as HTMLElement;
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, pointerId: 2 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, pointerId: 2 }));
    // Release over bar B.
    const up = new PointerEvent('pointerup', { clientX: 200, pointerId: 2 });
    Object.defineProperty(up, 'target', { value: barB });
    window.dispatchEvent(up);
    expect(link).not.toBeNull();
    expect(link!.fromId).toBe('a');
    expect(link!.toId).toBe('b');
  });

  it('renders a baseline overlay when a snapshot is supplied', () => {
    view = new GanttTimelineView({ preset: WEEK_AND_DAY, range });
    host.append(view.el);
    view.setRows(
      [
        {
          task: { id: 'a', name: 'A', start: T0 + 2 * DAY, end: T0 + 4 * DAY, duration: 2 * DAY },
          top: 0,
          height: 32,
          baseline: { taskId: 'a', start: T0, end: T0 + 2 * DAY, duration: 2 * DAY },
        },
      ],
      [],
    );
    expect(view.el.querySelector('.jects-gantt__baseline')).not.toBeNull();
  });

  it('makes bars keyboard-operable (roving tabindex + describedby) and opens on Enter', () => {
    let opened: unknown = null;
    view = new GanttTimelineView({
      preset: WEEK_AND_DAY,
      range,
      onTaskDblClick: (id) => {
        opened = id;
      },
    });
    host.append(view.el);
    view.setRows(
      rowsOf([
        { id: 'a', name: 'A', start: T0, end: T0 + 2 * DAY, duration: 2 * DAY },
        { id: 'b', name: 'B', start: T0 + 2 * DAY, end: T0 + 4 * DAY, duration: 2 * DAY },
      ]),
      [],
    );
    const bars = [...view.el.querySelectorAll('.jects-gantt__bar')] as HTMLElement[];
    // Roving tabindex: exactly one bar tabbable; all describe the usage hint.
    expect(bars.filter((b) => b.tabIndex === 0).length).toBe(1);
    expect(bars[0]!.tabIndex).toBe(0);
    expect(bars[0]!.getAttribute('aria-describedby')).toBeTruthy();
    const hintId = bars[0]!.getAttribute('aria-describedby')!;
    expect(view.el.querySelector(`#${hintId}`)!.textContent).toBeTruthy();
    // Enter opens the editor.
    bars[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(opened).toBe('a');
  });

  it('nudges a task span with arrow keys (move / resize) through onTaskSpanChange', () => {
    const calls: Array<{ id: unknown; start: number; end: number; mode: string }> = [];
    view = new GanttTimelineView({
      preset: WEEK_AND_DAY,
      range,
      onTaskSpanChange: (id, span, mode) => {
        calls.push({ id, start: span.start, end: span.end, mode });
      },
    });
    host.append(view.el);
    view.setRows(
      rowsOf([{ id: 'a', name: 'A', start: T0, end: T0 + 2 * DAY, duration: 2 * DAY }]),
      [],
    );
    const bar = view.el.querySelector('[data-task-id="a"]') as HTMLElement;
    // Plain ArrowRight → move whole bar forward by one day.
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(calls.at(-1)).toMatchObject({ id: 'a', mode: 'move', start: T0 + DAY, end: T0 + 3 * DAY });
    // Shift+ArrowRight → resize the finish only.
    bar.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
    );
    expect(calls.at(-1)).toMatchObject({ id: 'a', mode: 'resize-end', start: T0, end: T0 + 3 * DAY });
  });

  it('creates a dependency via keyboard: arm with L on A, finish with Enter on B', () => {
    let link: { fromId: unknown; toId: unknown } | null = null;
    view = new GanttTimelineView({
      preset: WEEK_AND_DAY,
      range,
      onDependencyCreate: (l) => {
        link = { fromId: l.fromId, toId: l.toId };
      },
    });
    host.append(view.el);
    view.setRows(
      rowsOf([
        { id: 'a', name: 'A', start: T0, end: T0 + 2 * DAY, duration: 2 * DAY },
        { id: 'b', name: 'B', start: T0 + 4 * DAY, end: T0 + 6 * DAY, duration: 2 * DAY },
      ]),
      [],
    );
    const barA = view.el.querySelector('[data-task-id="a"]') as HTMLElement;
    const barB = view.el.querySelector('[data-task-id="b"]') as HTMLElement;
    barA.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    barB.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(link).toEqual({ fromId: 'a', toId: 'b' });
  });

  it('shades non-working bands from a supplied working-time calendar', () => {
    view = new GanttTimelineView({
      preset: WEEK_AND_DAY,
      range,
      // Only Sunday off (Mon–Sat working).
      calendar: { weekendDays: [0], dayStartHour: 9, dayEndHour: 17 },
    });
    host.append(view.el);
    view.setRows(rowsOf([{ id: 'a', name: 'A', start: T0, end: T0 + DAY, duration: DAY }]), []);
    expect(view.el.querySelectorAll('.jects-gantt__nonworking').length).toBeGreaterThan(0);
  });

  it('disposes listeners and removes its element on destroy', () => {
    view = new GanttTimelineView({ preset: WEEK_AND_DAY, range });
    host.append(view.el);
    view.setRows(rowsOf([{ id: 'a', name: 'A', start: T0, end: T0 + DAY, duration: DAY }]), []);
    view.destroy();
    expect(view.el.isConnected).toBe(false);
  });
});

describe('terminalsFor', () => {
  it('maps the four precedence types to the correct terminals', () => {
    expect(terminalsFor('FS')).toEqual({ fromSide: 'end', toSide: 'start' });
    expect(terminalsFor('SS')).toEqual({ fromSide: 'start', toSide: 'start' });
    expect(terminalsFor('FF')).toEqual({ fromSide: 'end', toSide: 'end' });
    expect(terminalsFor('SF')).toEqual({ fromSide: 'start', toSide: 'end' });
  });
});
