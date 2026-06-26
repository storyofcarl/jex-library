import { describe, it, expect } from 'vitest';
import type { TimeAxis, TimeSpan, TimelineEvent } from '@jects/timeline-core';
import { RowGeometry, toTimelineEvents } from './row-geometry.js';
import type { ResourceModel, EventModel } from '../contract.js';

/** Trivial linear axis: 1ms = 1px. */
function linearAxis(): TimeAxis {
  return {
    range: { start: 0, end: 10_000 },
    preset: { id: 'test', headers: [], tickUnit: 'millisecond', pxPerUnit: 1 },
    zoom: 1,
    contentWidth: 10_000,
    toX: (t) => t,
    toTime: (x) => x,
    spanToBox: (span: TimeSpan) => ({ x: span.start, width: span.end - span.start }),
    durationToWidth: (d) => d,
    ticksInRange: () => [],
    snap: (t) => t,
    setView: () => {},
    setRange: () => {},
  };
}

function res(id: string, extra: Partial<ResourceModel> = {}): ResourceModel {
  return { id, name: id, ...extra };
}

function tev(id: string, rowId: string, start: number, end: number): TimelineEvent<EventModel> {
  return {
    id,
    rowId,
    span: { start, end },
    record: { id, resourceId: rowId, startDate: start, endDate: end },
  };
}

const axis = linearAxis();

describe('RowGeometry — variable row height', () => {
  it('falls back to uniform rows when no lane has events', () => {
    const geom = new RowGeometry({ rowHeight: 48, strategy: 'stack' });
    const resources = [res('r1'), res('r2'), res('r3')];
    geom.measure(resources, axis, () => []);

    expect(geom.count).toBe(3);
    expect(geom.total()).toBe(48 * 3);
    expect(geom.rowTop(0)).toBe(0);
    expect(geom.rowTop(1)).toBe(48);
    expect(geom.rowTop(2)).toBe(96);
    expect(geom.heightOf(1)).toBe(48);
  });

  it('grows a dense lane that stacks overlapping events', () => {
    const geom = new RowGeometry({ rowHeight: 48, strategy: 'stack' });
    const resources = [res('r1'), res('r2')];
    // r1 has three mutually-overlapping events → 3 sub-lanes → taller than 48.
    const r1Events = [
      tev('a', 'r1', 0, 300),
      tev('b', 'r1', 50, 350),
      tev('c', 'r1', 100, 400),
    ];
    geom.measure(resources, axis, (r) => (r.id === 'r1' ? r1Events : []));

    const h0 = geom.heightOf(0);
    const h1 = geom.heightOf(1);
    expect(h0).toBeGreaterThan(48); // dense lane grew
    expect(h1).toBe(48); // sparse lane stayed at the floor
    // The second lane sits below the (taller) first lane, not at a fixed 48.
    expect(geom.rowTop(1)).toBe(h0);
    expect(geom.total()).toBe(h0 + h1);
  });

  it('respects an explicit resource.rowHeight floor', () => {
    const geom = new RowGeometry({ rowHeight: 40, strategy: 'stack' });
    const resources = [res('r1', { rowHeight: 120 }), res('r2')];
    geom.measure(resources, axis, () => []);
    expect(geom.heightOf(0)).toBe(120); // explicit override beats default floor
    expect(geom.heightOf(1)).toBe(40);
    expect(geom.rowTop(1)).toBe(120);
  });

  it('clamps a lane to maxRowHeight', () => {
    const geom = new RowGeometry({ rowHeight: 30, strategy: 'stack', maxRowHeight: 60 });
    const resources = [res('r1')];
    const many = Array.from({ length: 8 }, (_, i) => tev(`e${i}`, 'r1', 0, 500));
    geom.measure(resources, axis, () => many);
    expect(geom.heightOf(0)).toBe(60); // would be far taller, clamped
  });

  it('degrades to uniform rows when variableRowHeight is off', () => {
    const geom = new RowGeometry({ rowHeight: 50, strategy: 'stack', variableRowHeight: false });
    const resources = [res('r1'), res('r2')];
    const dense = [tev('a', 'r1', 0, 300), tev('b', 'r1', 50, 350)];
    geom.measure(resources, axis, (r) => (r.id === 'r1' ? dense : []));
    expect(geom.heightOf(0)).toBe(50);
    expect(geom.total()).toBe(100);
  });

  it('maps content pixels back to lane indices across variable heights', () => {
    const geom = new RowGeometry({ rowHeight: 48, strategy: 'stack' });
    const resources = [res('r1', { rowHeight: 100 }), res('r2'), res('r3', { rowHeight: 80 })];
    geom.measure(resources, axis, () => []);
    // lanes: r1 [0,100), r2 [100,148), r3 [148,228)
    expect(geom.indexAt(0)).toBe(0);
    expect(geom.indexAt(99)).toBe(0);
    expect(geom.indexAt(100)).toBe(1);
    expect(geom.indexAt(147)).toBe(1);
    expect(geom.indexAt(148)).toBe(2);
    expect(geom.indexAt(1000)).toBe(2); // past end clamps to last
  });

  it('exposes a live tops map keyed by resource id (router-friendly)', () => {
    const geom = new RowGeometry({ rowHeight: 48, strategy: 'stack' });
    const tops = geom.tops; // grab the reference BEFORE measuring
    geom.measure([res('r1', { rowHeight: 60 }), res('r2')], axis, () => []);
    expect(tops.get('r1')).toBe(0);
    expect(tops.get('r2')).toBe(60);
    // Re-measure with a different first height → the SAME map reflects it.
    geom.measure([res('r1', { rowHeight: 90 }), res('r2')], axis, () => []);
    expect(tops.get('r2')).toBe(90);
  });

  it('computes a virtualization window over variable offsets', () => {
    const geom = new RowGeometry({ rowHeight: 50, strategy: 'stack', overscan: 0 });
    // 10 lanes of height 50 → total 500.
    const resources = Array.from({ length: 10 }, (_, i) => res(`r${i}`));
    geom.measure(resources, axis, () => []);

    const win = geom.rowWindow(100, 120); // scrolled to y=100, 120px tall
    expect(win.totalSize).toBe(500);
    expect(win.startIndex).toBe(2); // y=100 → index 2
    expect(win.offset).toBe(100); // top of index 2
    // bottom edge y=220 → index 4, inclusive +1 → endIndex 5
    expect(win.endIndex).toBe(5);
  });

  it('window covers all rows when the viewport is unsized (jsdom)', () => {
    const geom = new RowGeometry({ rowHeight: 50, strategy: 'stack' });
    const resources = Array.from({ length: 4 }, (_, i) => res(`r${i}`));
    geom.measure(resources, axis, () => []);
    const win = geom.rowWindow(0, 0);
    expect(win.startIndex).toBe(0);
    expect(win.endIndex).toBe(4);
    expect(win.totalSize).toBe(200);
  });

  it('applies overscan padding symmetrically', () => {
    const geom = new RowGeometry({ rowHeight: 50, strategy: 'stack', overscan: 2 });
    const resources = Array.from({ length: 20 }, (_, i) => res(`r${i}`));
    geom.measure(resources, axis, () => []);
    const win = geom.rowWindow(500, 100); // index 10..12 visible
    expect(win.startIndex).toBe(8); // 10 - 2 overscan
    expect(win.endIndex).toBe(15); // 12 + 1 + 2 overscan
  });

  it('empty geometry yields an empty window', () => {
    const geom = new RowGeometry({ rowHeight: 48, strategy: 'stack' });
    geom.measure([], axis, () => []);
    const win = geom.rowWindow(0, 400);
    expect(win).toEqual({ startIndex: 0, endIndex: 0, totalSize: 0, offset: 0 });
  });
});

describe('toTimelineEvents', () => {
  it('maps resolved records to timeline events with progress/color/editable', () => {
    const records = [
      {
        id: 'e1',
        span: { start: 0, end: 100 },
        record: {
          id: 'e1',
          resourceId: 'r1',
          startDate: 0,
          endDate: 100,
          percentDone: 0.5,
          eventColor: 'cyan',
        } as EventModel,
      },
    ];
    const out = toTimelineEvents('r1', records, () => false);
    expect(out[0]!.rowId).toBe('r1');
    expect(out[0]!.progress).toBe(0.5);
    expect(out[0]!.styleKey).toBe('cyan');
    expect(out[0]!.editable).toBe(false);
  });
});
