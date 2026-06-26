import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HOUR_AND_DAY } from '@jects/timeline-core';
import { Scheduler } from './scheduler.js';
import type { ResourceModel, EventModel } from '../contract.js';

const DAY = 86_400_000;
const start = Date.UTC(2025, 0, 1);

/**
 * Synthesize a pointer event for jsdom (which ships no `PointerEvent`
 * constructor here). Builds a bubbling `MouseEvent` and forces the
 * `clientX`/`clientY`/`pointerId`/`button` fields the pan gesture reads.
 */
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
  ];
}
function events(): EventModel[] {
  return [
    { id: 'e1', resourceId: 'r1', name: 'Task A', startDate: start, endDate: start + DAY },
  ];
}

describe('Scheduler TimeRanges / ResourceTimeRanges / Pan / InfiniteScroll', () => {
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

  function make(extra: Record<string, unknown> = {}): Scheduler {
    sched = new Scheduler(host, {
      resources: resources(),
      events: events(),
      preset: HOUR_AND_DAY,
      range: { start: start - DAY, end: start + DAY * 5 },
      ...extra,
    } as never);
    return sched;
  }

  /* ── TimeRanges (global) ── */

  it('renders a global time range as a shaded band with a label', () => {
    const s = make({
      timeRanges: [
        { id: 'lunch', startDate: start + DAY, endDate: start + DAY + 3_600_000, name: 'Lunch' },
      ],
    });
    const band = s.el.querySelector('.jects-scheduler__timerange') as HTMLElement;
    expect(band).toBeTruthy();
    expect(band.classList.contains('jects-scheduler__timerange--marker')).toBe(false);
    expect(parseFloat(band.style.width)).toBeGreaterThan(0);
    expect(band.querySelector('.jects-scheduler__timerange-label')!.textContent).toBe('Lunch');
  });

  it('renders a zero-width global time range as a marker (no width)', () => {
    const s = make({
      timeRanges: [{ id: 'now', startDate: start + DAY, endDate: start + DAY }],
    });
    const marker = s.el.querySelector('.jects-scheduler__timerange--marker') as HTMLElement;
    expect(marker).toBeTruthy();
    expect(marker.style.width).toBe('');
  });

  it('applies cls + style to a global time range element', () => {
    const s = make({
      timeRanges: [
        { id: 'r', startDate: start, endDate: start + DAY, cls: 'my-range hot', style: 'opacity:0.5;' },
      ],
    });
    const band = s.el.querySelector('.jects-scheduler__timerange') as HTMLElement;
    expect(band.classList.contains('my-range')).toBe(true);
    expect(band.classList.contains('hot')).toBe(true);
    expect(band.getAttribute('style')).toContain('opacity:0.5');
  });

  it('does not render a global time range outside the axis range', () => {
    const s = make({
      timeRanges: [{ id: 'far', startDate: start + DAY * 100, endDate: start + DAY * 101 }],
    });
    expect(s.el.querySelector('.jects-scheduler__timerange')).toBeNull();
  });

  /* ── ResourceTimeRanges (per-resource) ── */

  it('renders a resource time range confined to its resource row band', () => {
    const s = make({
      rowHeight: 50,
      resourceTimeRanges: [
        { id: 'pto', resourceId: 'r2', startDate: start, endDate: start + DAY, name: 'PTO' },
      ],
    });
    const band = s.el.querySelector('.jects-scheduler__resource-timerange') as HTMLElement;
    expect(band).toBeTruthy();
    // r2 is the second resource → top = 1 * rowHeight(50) = 50.
    expect(band.style.top).toBe('50px');
    expect(band.style.height).toBe('50px');
    expect(band.querySelector('.jects-scheduler__resource-timerange-label')!.textContent).toBe('PTO');
  });

  it('drops a resource time range for an unknown resource', () => {
    const s = make({
      resourceTimeRanges: [{ id: 'x', resourceId: 'ghost', startDate: start, endDate: start + DAY }],
    });
    expect(s.el.querySelector('.jects-scheduler__resource-timerange')).toBeNull();
  });

  /* ── Pan ── */

  it('drag-pans the scroller when panEnabled (background drag updates scroll)', () => {
    const s = make({ panEnabled: true });
    const scroller = s.el.querySelector('.jects-scheduler__scroller') as HTMLElement;
    // Force a scrollable surface in jsdom (which reports 0 by default).
    Object.defineProperty(scroller, 'scrollLeft', { value: 0, writable: true, configurable: true });
    Object.defineProperty(scroller, 'scrollTop', { value: 0, writable: true, configurable: true });
    const content = s.el.querySelector('.jects-scheduler__content') as HTMLElement;

    content.dispatchEvent(pe('pointerdown', { button: 0, clientX: 200, clientY: 150 }));
    // Drag left + up by 60px / 40px → scroll increases by the inverse.
    window.dispatchEvent(pe('pointermove', { clientX: 140, clientY: 110 }));
    expect(scroller.scrollLeft).toBe(60);
    expect(scroller.scrollTop).toBe(40);
    expect(s.el.classList.contains('jects-scheduler--panning')).toBe(true);
    window.dispatchEvent(pe('pointerup'));
    expect(s.el.classList.contains('jects-scheduler--panning')).toBe(false);
  });

  it('does not pan when panEnabled is off', () => {
    const s = make({ panEnabled: false });
    const scroller = s.el.querySelector('.jects-scheduler__scroller') as HTMLElement;
    Object.defineProperty(scroller, 'scrollLeft', { value: 0, writable: true, configurable: true });
    const content = s.el.querySelector('.jects-scheduler__content') as HTMLElement;
    content.dispatchEvent(pe('pointerdown', { button: 0, clientX: 200, clientY: 150 }));
    window.dispatchEvent(pe('pointermove', { clientX: 140, clientY: 110 }));
    expect(scroller.scrollLeft).toBe(0);
    window.dispatchEvent(pe('pointerup'));
  });

  /* ── Infinite scroll ── */

  it('extends the axis range on scroll near an edge when infiniteScroll is on', () => {
    // No `range` pin → infinite scroll is active; derived range from the events.
    sched = new Scheduler(host, {
      resources: resources(),
      events: events(),
      preset: HOUR_AND_DAY,
      infiniteScroll: true,
    } as never);
    const s = sched;
    const axis = s.getAxis();
    const beforeEnd = axis.range.end;
    const scroller = s.el.querySelector('.jects-scheduler__scroller') as HTMLElement;
    // In jsdom clientWidth is 0 → viewportWidth falls back to contentWidth, so
    // scrollLeft=0 + viewportWidth covers the whole content → right edge is near.
    scroller.dispatchEvent(new Event('scroll'));
    expect(s.getAxis().range.end).toBeGreaterThan(beforeEnd);
  });

  it('does not extend the range when infiniteScroll is off', () => {
    sched = new Scheduler(host, {
      resources: resources(),
      events: events(),
      preset: HOUR_AND_DAY,
      infiniteScroll: false,
    } as never);
    const s = sched;
    const beforeEnd = s.getAxis().range.end;
    const scroller = s.el.querySelector('.jects-scheduler__scroller') as HTMLElement;
    scroller.dispatchEvent(new Event('scroll'));
    expect(s.getAxis().range.end).toBe(beforeEnd);
  });

  it('does not extend a config-pinned range even with infiniteScroll on', () => {
    const s = make({ infiniteScroll: true }); // make() pins `range`
    const beforeEnd = s.getAxis().range.end;
    const scroller = s.el.querySelector('.jects-scheduler__scroller') as HTMLElement;
    scroller.dispatchEvent(new Event('scroll'));
    expect(s.getAxis().range.end).toBe(beforeEnd);
  });

  it('setRange() public API widens the covered range + repaints', () => {
    const s = make();
    const wider = { start: start - DAY * 10, end: start + DAY * 20 };
    s.setRange(wider);
    expect(s.getAxis().range.start).toBe(wider.start);
    expect(s.getAxis().range.end).toBe(wider.end);
  });
});
