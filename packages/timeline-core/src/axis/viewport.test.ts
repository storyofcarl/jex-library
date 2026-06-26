import { describe, it, expect } from 'vitest';
import type { Model, RecordId } from '@jects/core';
import type { TimelineRow } from '../contract.js';
import { DefaultTimeAxis } from './time-axis.js';
import { DefaultRowVirtualizer, type RowProvider } from './row-virtualizer.js';
import { DefaultTimelineViewport, type ViewportHost } from './viewport.js';
import { WEEK_AND_DAY } from './presets.js';

const utc = (y: number, mo: number, d: number, h = 0): number => Date.UTC(y, mo, d, h, 0, 0, 0);

interface Row extends Model {
  id: number;
}

function provider(n: number): RowProvider<Row> {
  const rows: TimelineRow<Row>[] = Array.from({ length: n }, (_, i) => ({
    id: i,
    record: { id: i },
    height: 30,
  }));
  const byId = new Map<RecordId, number>(rows.map((r, i) => [r.id, i]));
  return { count: () => n, rowAt: (i) => rows[i], indexOf: (id) => byId.get(id) ?? -1 };
}

/** A mutable scroll host for tests. */
function makeHost(): ViewportHost & { _top: number; _left: number } {
  const h = {
    _top: 0,
    _left: 0,
    height: 300,
    width: 600,
    get scrollTop() {
      return h._top;
    },
    get scrollLeft() {
      return h._left;
    },
    applyScroll(opts: { top?: number; left?: number }) {
      if (opts.top != null) h._top = opts.top;
      if (opts.left != null) h._left = opts.left;
    },
  };
  return h;
}

function setup() {
  const range = { start: utc(2026, 5, 1), end: utc(2026, 5, 31) };
  const axis = new DefaultTimeAxis({ range, preset: WEEK_AND_DAY, zoom: 1 });
  const rows = new DefaultRowVirtualizer<Row>({ provider: provider(100), rowHeight: 30 });
  const host = makeHost();
  const viewport = new DefaultTimelineViewport<Row>({ host, axis, rows });
  return { range, axis, rows, host, viewport };
}

describe('TimelineViewport: geometry passthrough', () => {
  it('exposes host scroll/size', () => {
    const { viewport, host } = setup();
    host.applyScroll({ top: 90, left: 120 });
    expect(viewport.scrollTop).toBe(90);
    expect(viewport.scrollLeft).toBe(120);
    expect(viewport.height).toBe(300);
    expect(viewport.width).toBe(600);
  });
});

describe('TimelineViewport: derived visible span', () => {
  it('derives visibleSpan from scrollLeft + width via the axis', () => {
    const { viewport, axis, host } = setup();
    host.applyScroll({ left: 60 }); // 1 day in @ 60px/day
    const span = viewport.visibleSpan;
    expect(span.start).toBeCloseTo(axis.toTime(60), -2);
    expect(span.end).toBeCloseTo(axis.toTime(660), -2);
    expect(span.end).toBeGreaterThan(span.start);
  });
});

describe('TimelineViewport: derived rowWindow', () => {
  it('returns the row virtualization window for the current scroll', () => {
    const { viewport, host } = setup();
    host.applyScroll({ top: 300 });
    const w = viewport.rowWindow;
    expect(w.totalSize).toBe(100 * 30);
    expect(w.rows.length).toBeGreaterThan(0);
    expect(w.startIndex).toBeLessThanOrEqual(10);
  });
});

describe('TimelineViewport: scrollToTime', () => {
  it('scrolls left when the target is left of view', () => {
    const { viewport, axis, host } = setup();
    host.applyScroll({ left: 600 });
    const t = utc(2026, 5, 2); // x = 60, left of current 600
    viewport.scrollToTime(t);
    expect(host.scrollLeft).toBeCloseTo(axis.toX(t), 5);
  });

  it('scrolls right when the target is past the right edge', () => {
    const { viewport, axis, host } = setup();
    const t = utc(2026, 5, 20); // far right
    viewport.scrollToTime(t);
    expect(host.scrollLeft).toBeCloseTo(axis.toX(t) - viewport.width, 5);
  });

  it('does nothing when the target is already visible', () => {
    const { viewport, host } = setup();
    host.applyScroll({ left: 0 });
    viewport.scrollToTime(utc(2026, 5, 3)); // x=120, within [0,600]
    expect(host.scrollLeft).toBe(0);
  });
});

describe('TimelineViewport: scrollToRow', () => {
  it('scrolls up to reveal a row above the view', () => {
    const { viewport, host } = setup();
    host.applyScroll({ top: 600 });
    viewport.scrollToRow(2); // offset 60, above
    expect(host.scrollTop).toBe(60);
  });

  it('scrolls down to reveal a row below the view', () => {
    const { viewport, host } = setup();
    viewport.scrollToRow(20); // offset 600, height 30; bottom-align
    expect(host.scrollTop).toBe(600 + 30 - 300);
  });

  it('leaves scroll alone for a visible row', () => {
    const { viewport, host } = setup();
    viewport.scrollToRow(2); // offset 60, within [0,300]
    expect(host.scrollTop).toBe(0);
  });
});

describe('TimelineViewport: scrollTo passthrough', () => {
  it('forwards a raw scroll request', () => {
    const { viewport, host } = setup();
    viewport.scrollTo({ top: 45, left: 90 });
    expect(host.scrollTop).toBe(45);
    expect(host.scrollLeft).toBe(90);
  });
});
