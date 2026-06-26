/**
 * Tier-1/2 Scheduler-Pro feature tests:
 *   1. Milestones — zero-duration diamond markers anchored at startDate.
 *   2. Drag event between resources — vertical lane offset reassigns resourceId.
 *   3. Live progress bars — percentDone fill inside event bars.
 *   4. Buffer-time visualization — setup/teardown zones behind bars.
 *   5. Resource-row multi-select — checkbox + ctrl/shift selection.
 *
 * jsdom note: `getBoundingClientRect()` returns all-zeros, so `toContentX/Y`
 * collapse to the raw client coordinate. The default `rowHeight` is 48, so a
 * `clientY` of 60 maps to row index 1 (the second lane).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HOUR_AND_DAY } from '@jects/timeline-core';
import { Scheduler } from './scheduler.js';
import type { ResourceModel, EventModel } from '../contract.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const start = Date.UTC(2025, 0, 1);

function pe(
  type: string,
  init: { clientX?: number; clientY?: number; pointerId?: number; button?: number } = {},
): PointerEvent {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clientX', { value: init.clientX ?? 0, configurable: true });
  Object.defineProperty(ev, 'clientY', { value: init.clientY ?? 0, configurable: true });
  Object.defineProperty(ev, 'pointerId', { value: init.pointerId ?? 1, configurable: true });
  Object.defineProperty(ev, 'button', { value: init.button ?? 0, configurable: true });
  Object.defineProperty(ev, 'pointerType', { value: 'mouse', configurable: true });
  return ev as unknown as PointerEvent;
}

function resources(): ResourceModel[] {
  return [
    { id: 'r1', name: 'Alice' },
    { id: 'r2', name: 'Bob' },
    { id: 'r3', name: 'Carol' },
  ];
}

describe('Scheduler Tier-1/2 features', () => {
  let host: HTMLElement;
  let sched: Scheduler | undefined;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    sched?.destroy();
    sched = undefined;
    host.remove();
  });

  function make(events: EventModel[], extra: Record<string, unknown> = {}): Scheduler {
    sched = new Scheduler(host, {
      resources: resources(),
      events,
      preset: HOUR_AND_DAY,
      range: { start: start - DAY, end: start + DAY * 5 },
      ...extra,
    } as never);
    return sched;
  }

  /* ── 1. Milestones ───────────────────────────────────────────────────── */

  describe('milestones', () => {
    it('renders a milestone event as a diamond marker (modifier class), no label', () => {
      const s = make([
        { id: 'm1', resourceId: 'r1', name: 'Launch', startDate: start, endDate: start, milestone: true },
      ]);
      const bar = s.el.querySelector<HTMLElement>('[data-event-id="m1"]')!;
      expect(bar).toBeTruthy();
      expect(bar.classList.contains('jects-scheduler__bar--milestone')).toBe(true);
    });

    it('anchors a milestone diamond centred on its startDate tick', () => {
      const s = make([
        { id: 'm1', resourceId: 'r1', name: 'Launch', startDate: start, endDate: start, milestone: true },
      ]);
      const axis = s.getAxis();
      const bar = s.el.querySelector<HTMLElement>('[data-event-id="m1"]')!;
      const left = parseFloat(bar.style.left);
      const side = parseFloat(bar.style.width);
      // The diamond is a `side`-wide square centred on the start tick: its centre
      // (left + side/2) sits at the start instant's x.
      const expectedX = axis.toX(start);
      expect(left + side / 2).toBeCloseTo(expectedX, 0);
      // Square (width === height).
      expect(parseFloat(bar.style.height)).toBeCloseTo(side, 5);
    });

    it('exposes the milestone in its aria-label', () => {
      const s = make([
        { id: 'm1', resourceId: 'r1', name: 'Launch', startDate: start, endDate: start, milestone: true },
      ]);
      const bar = s.el.querySelector<HTMLElement>('[data-event-id="m1"]')!;
      expect(bar.getAttribute('aria-label')).toContain('milestone');
    });

    it('does not paint a progress fill on a milestone', () => {
      const s = make([
        {
          id: 'm1', resourceId: 'r1', name: 'Launch', startDate: start, endDate: start,
          milestone: true, percentDone: 0.5,
        },
      ]);
      const bar = s.el.querySelector<HTMLElement>('[data-event-id="m1"]')!;
      expect(bar.querySelector('.jects-scheduler__bar-progress')).toBeNull();
    });
  });

  /* ── 2. Drag between resources ───────────────────────────────────────── */

  describe('drag event between resources', () => {
    function drag(s: Scheduler, eventId: string, toClientY: number): void {
      const content = s.el.querySelector<HTMLElement>('.jects-scheduler__content')!;
      const bar = s.el.querySelector<HTMLElement>(`[data-event-id="${eventId}"]`)!;
      // pointerdown originates on the bar (mid-body), routed via content listener.
      const downX = parseFloat(bar.style.left) + parseFloat(bar.style.width) / 2;
      const downY = parseFloat(bar.style.top) + parseFloat(bar.style.height) / 2;
      bar.dispatchEvent(pe('pointerdown', { button: 0, clientX: downX, clientY: downY }));
      // Move the pointer down into another lane (X unchanged → no time move).
      window.dispatchEvent(pe('pointermove', { clientX: downX, clientY: toClientY }));
      window.dispatchEvent(pe('pointerup', { clientX: downX, clientY: toClientY }));
    }

    it('reassigns the event resourceId to the lane the pointer ends over', () => {
      const s = make(
        [{ id: 'e1', resourceId: 'r1', name: 'A', startDate: start + HOUR * 2, endDate: start + HOUR * 6 }],
        { reassignable: true, snap: false },
      );
      // Row 1 band centre (rowHeight 48): clientY 60 → index 1 → resource r2.
      drag(s, 'e1', 60);
      expect(s.getEventStore().getById('e1')!.resourceId).toBe('r2');
    });

    it('emits eventChange with the moved event when reassigned', () => {
      const s = make(
        [{ id: 'e1', resourceId: 'r1', name: 'A', startDate: start + HOUR * 2, endDate: start + HOUR * 6 }],
        { reassignable: true, snap: false },
      );
      const changes: string[] = [];
      s.on('eventChange', ({ event }) => changes.push(String(event.resourceId)));
      drag(s, 'e1', 110); // index 2 → r3
      expect(s.getEventStore().getById('e1')!.resourceId).toBe('r3');
      expect(changes).toContain('r3');
    });

    it('honours a beforeEventChange veto (no reassignment)', () => {
      const s = make(
        [{ id: 'e1', resourceId: 'r1', name: 'A', startDate: start + HOUR * 2, endDate: start + HOUR * 6 }],
        { reassignable: true, snap: false },
      );
      s.on('beforeEventChange', () => false);
      drag(s, 'e1', 60);
      expect(s.getEventStore().getById('e1')!.resourceId).toBe('r1');
    });

    it('does NOT reassign when reassignable is off', () => {
      const s = make(
        [{ id: 'e1', resourceId: 'r1', name: 'A', startDate: start + HOUR * 2, endDate: start + HOUR * 6 }],
        { reassignable: false, snap: false },
      );
      drag(s, 'e1', 60);
      expect(s.getEventStore().getById('e1')!.resourceId).toBe('r1');
    });

    it('preserves duration across a cross-lane move', () => {
      const ev: EventModel = { id: 'e1', resourceId: 'r1', name: 'A', startDate: start + HOUR * 2, endDate: start + HOUR * 6 };
      const s = make([ev], { reassignable: true, snap: false });
      drag(s, 'e1', 60);
      const after = s.getEventStore().getById('e1')!;
      expect(after.endDate - after.startDate).toBe(HOUR * 4);
    });
  });

  /* ── 3. Live progress bars ───────────────────────────────────────────── */

  describe('progress bars', () => {
    it('renders a percentDone fill sized to the percentage', () => {
      const s = make([
        { id: 'e1', resourceId: 'r1', name: 'A', startDate: start, endDate: start + DAY, percentDone: 0.4 },
      ]);
      const fill = s.el.querySelector<HTMLElement>('[data-event-id="e1"] .jects-scheduler__bar-progress')!;
      expect(fill).toBeTruthy();
      expect(fill.style.width).toBe('40%');
      expect(fill.dataset.percent).toBe('40');
    });

    it('clamps the fill to 100% and flags completion', () => {
      const s = make([
        { id: 'e1', resourceId: 'r1', name: 'A', startDate: start, endDate: start + DAY, percentDone: 1.5 },
      ]);
      const bar = s.el.querySelector<HTMLElement>('[data-event-id="e1"]')!;
      const fill = bar.querySelector<HTMLElement>('.jects-scheduler__bar-progress')!;
      expect(fill.style.width).toBe('100%');
      expect(bar.classList.contains('jects-scheduler__bar--complete')).toBe(true);
    });

    it('omits the fill when percentDone is 0 / absent', () => {
      const s = make([
        { id: 'e1', resourceId: 'r1', name: 'A', startDate: start, endDate: start + DAY },
        { id: 'e2', resourceId: 'r2', name: 'B', startDate: start, endDate: start + DAY, percentDone: 0 },
      ]);
      expect(s.el.querySelector('[data-event-id="e1"] .jects-scheduler__bar-progress')).toBeNull();
      expect(s.el.querySelector('[data-event-id="e2"] .jects-scheduler__bar-progress')).toBeNull();
    });

    it('reflects the percentage in the aria-label', () => {
      const s = make([
        { id: 'e1', resourceId: 'r1', name: 'A', startDate: start, endDate: start + DAY, percentDone: 0.4 },
      ]);
      const bar = s.el.querySelector<HTMLElement>('[data-event-id="e1"]')!;
      expect(bar.getAttribute('aria-label')).toContain('40% complete');
    });
  });

  /* ── 4. Buffer-time visualization ────────────────────────────────────── */

  describe('buffer-time visualization', () => {
    it('paints leading + trailing buffer zones from per-event setup/teardown', () => {
      const s = make(
        [
          {
            id: 'e1', resourceId: 'r1', name: 'A', startDate: start + HOUR * 6, endDate: start + HOUR * 10,
            setupTime: HOUR, teardownTime: HOUR,
          },
        ],
        { showBufferTime: true },
      );
      const zones = s.el.querySelectorAll('.jects-scheduler__buffers .jects-scheduler__buffer');
      expect(zones.length).toBe(2);
      expect(s.el.querySelector('.jects-scheduler__buffer--leading')).toBeTruthy();
      expect(s.el.querySelector('.jects-scheduler__buffer--trailing')).toBeTruthy();
    });

    it('applies config-level buffer defaults to events without per-event values', () => {
      const s = make(
        [{ id: 'e1', resourceId: 'r1', name: 'A', startDate: start + HOUR * 6, endDate: start + HOUR * 10 }],
        { showBufferTime: true, bufferDefaults: { setup: HOUR, teardown: HOUR } },
      );
      expect(
        s.el.querySelectorAll('.jects-scheduler__buffers .jects-scheduler__buffer').length,
      ).toBe(2);
    });

    it('flags a violated buffer when two events sit too close on a lane', () => {
      const s = make(
        [
          { id: 'e1', resourceId: 'r1', name: 'A', startDate: start + HOUR * 6, endDate: start + HOUR * 8, teardownTime: HOUR * 2 },
          { id: 'e2', resourceId: 'r1', name: 'B', startDate: start + HOUR * 8, endDate: start + HOUR * 10, setupTime: HOUR * 2 },
        ],
        { showBufferTime: true },
      );
      // The 0-hour idle gap is shorter than the required 2-hour buffer → violated.
      expect(s.el.querySelector('.jects-scheduler__buffer--violated')).toBeTruthy();
    });

    it('paints no buffer layer when showBufferTime is off', () => {
      const s = make([
        { id: 'e1', resourceId: 'r1', name: 'A', startDate: start, endDate: start + DAY, setupTime: HOUR },
      ]);
      expect(
        s.el.querySelectorAll('.jects-scheduler__buffers .jects-scheduler__buffer').length,
      ).toBe(0);
    });
  });

  /* ── 5. Resource-row multi-select ────────────────────────────────────── */

  describe('resource-row multi-select', () => {
    function clickRow(s: Scheduler, id: string, mods: { ctrl?: boolean; shift?: boolean } = {}): void {
      const row = s.el.querySelector<HTMLElement>(`.jects-scheduler__resource-row[data-resource-id="${id}"]`)!;
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: mods.ctrl, shiftKey: mods.shift });
      row.dispatchEvent(ev);
    }

    it('renders a selection checkbox per row when resourceSelectable', () => {
      const s = make([], { resourceSelectable: true });
      expect(s.el.querySelectorAll('.jects-scheduler__resource-select').length).toBe(3);
    });

    it('selects a single row on a plain click', () => {
      const s = make([], { resourceSelectable: true });
      clickRow(s, 'r2');
      expect(s.getSelectedResources().map((r) => r.id)).toEqual(['r2']);
      const row = s.el.querySelector(`.jects-scheduler__resource-row[data-resource-id="r2"]`)!;
      expect(row.classList.contains('jects-scheduler__resource-row--selected')).toBe(true);
    });

    it('ctrl-click toggles a row in/out of the set', () => {
      const s = make([], { resourceSelectable: true });
      clickRow(s, 'r1');
      clickRow(s, 'r3', { ctrl: true });
      expect(new Set(s.getSelectedResources().map((r) => r.id))).toEqual(new Set(['r1', 'r3']));
      clickRow(s, 'r1', { ctrl: true });
      expect(s.getSelectedResources().map((r) => r.id)).toEqual(['r3']);
    });

    it('shift-click selects a contiguous range from the anchor', () => {
      const s = make([], { resourceSelectable: true });
      clickRow(s, 'r1');
      clickRow(s, 'r3', { shift: true });
      expect(new Set(s.getSelectedResources().map((r) => r.id))).toEqual(new Set(['r1', 'r2', 'r3']));
    });

    it('emits resourceSelectionChange with the current set', () => {
      const s = make([], { resourceSelectable: true });
      const seen: string[][] = [];
      s.on('resourceSelectionChange', ({ ids }) => seen.push(ids.map(String)));
      clickRow(s, 'r2');
      expect(seen.at(-1)).toEqual(['r2']);
    });

    it('selectResources / clearResourceSelection drive the set programmatically', () => {
      const s = make([], { resourceSelectable: true });
      s.selectResources(['r1', 'r3']);
      expect(new Set(s.getSelectedResources().map((r) => r.id))).toEqual(new Set(['r1', 'r3']));
      s.clearResourceSelection();
      expect(s.getSelectedResources()).toEqual([]);
    });
  });
});
