import { describe, it, expect } from 'vitest';
import type { Model, RecordId } from '@jects/core';
import type { TimelineRow } from '../contract.js';
import { DefaultRowVirtualizer, type RowProvider } from './row-virtualizer.js';

interface Res extends Model {
  id: number;
  name: string;
}

/** A simple in-memory row provider for tests. */
function makeProvider(heights: number[]): RowProvider<Res> {
  const rows: TimelineRow<Res>[] = heights.map((h, i) => ({
    id: i,
    record: { id: i, name: `r${i}` },
    height: h,
  }));
  const byId = new Map<RecordId, number>(rows.map((r, i) => [r.id, i]));
  return {
    count: () => rows.length,
    rowAt: (i) => rows[i],
    indexOf: (id) => byId.get(id) ?? -1,
  };
}

describe('RowVirtualizer: fixed heights', () => {
  const provider = makeProvider(new Array(100).fill(30));
  const v = new DefaultRowVirtualizer<Res>({ provider, rowHeight: 30 });

  it('reports count', () => {
    expect(v.count).toBe(100);
  });

  it('offsetOf / heightOf use the fixed height', () => {
    expect(v.heightOf(5)).toBe(30);
    expect(v.offsetOf(5)).toBe(150);
  });

  it('indexAt maps pixels to rows', () => {
    expect(v.indexAt(0)).toBe(0);
    expect(v.indexAt(95)).toBe(3);
    expect(v.indexAt(1_000_000)).toBe(99); // clamped
  });

  it('computeWindow returns a half-open [start, end) with overscan', () => {
    const w = v.computeWindow({ scrollTop: 300, viewportHeight: 120, overscan: 2 });
    // 300/30 = 10 first visible; viewport shows 4 rows; overscan 2.
    expect(w.startIndex).toBe(8);
    expect(w.endIndex).toBeGreaterThan(w.startIndex);
    expect(w.totalSize).toBe(100 * 30);
    expect(w.offset).toBe(w.startIndex * 30);
    // rows are materialized for the window
    expect(w.rows.length).toBe(w.endIndex - w.startIndex);
    expect(w.rows[0]!.id).toBe(8);
  });

  it('empty provider yields an empty window', () => {
    const ev = new DefaultRowVirtualizer<Res>({ provider: makeProvider([]), rowHeight: 30 });
    const w = ev.computeWindow({ scrollTop: 0, viewportHeight: 100 });
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(0);
    expect(w.rows).toEqual([]);
    expect(w.totalSize).toBe(0);
  });
});

describe('RowVirtualizer: variable heights (OffsetIndex)', () => {
  // Rows: 20, 40, 60, 20, 40, ... repeating; sum tracked by Fenwick tree.
  const heights = Array.from({ length: 50 }, (_, i) => [20, 40, 60][i % 3]!);
  const provider = makeProvider(heights);
  const v = new DefaultRowVirtualizer<Res>({
    provider,
    rowHeight: 30,
    variableRowHeight: true,
  });

  it('offsetOf accumulates true heights', () => {
    expect(v.offsetOf(0)).toBe(0);
    expect(v.offsetOf(1)).toBe(20);
    expect(v.offsetOf(2)).toBe(60); // 20 + 40
    expect(v.offsetOf(3)).toBe(120); // 20 + 40 + 60
  });

  it('heightOf reflects per-row heights', () => {
    expect(v.heightOf(0)).toBe(20);
    expect(v.heightOf(2)).toBe(60);
  });

  it('indexAt uses cumulative offsets', () => {
    expect(v.indexAt(0)).toBe(0);
    expect(v.indexAt(25)).toBe(1); // 20..60 belongs to row 1
    expect(v.indexAt(70)).toBe(2); // 60..120 belongs to row 2
  });

  it('computeWindow positions offset at the first painted row', () => {
    const total = heights.reduce((a, b) => a + b, 0);
    const w = v.computeWindow({ scrollTop: 100, viewportHeight: 80, overscan: 1 });
    expect(w.totalSize).toBe(total);
    expect(w.offset).toBe(v.offsetOf(w.startIndex));
    expect(w.rows[0]!.id).toBe(w.startIndex);
  });

  it('invalidate forces a rebuild of the offset index', () => {
    // Mutate provider heights by swapping in a new one is not possible here, but
    // invalidate must not throw and must keep answers consistent.
    v.invalidate();
    expect(v.offsetOf(2)).toBe(60);
  });
});

describe('RowVirtualizer: rowAt bounds', () => {
  const v = new DefaultRowVirtualizer<Res>({ provider: makeProvider([30, 30, 30]), rowHeight: 30 });
  it('returns undefined out of range', () => {
    expect(v.rowAt(-1)).toBeUndefined();
    expect(v.rowAt(3)).toBeUndefined();
    expect(v.rowAt(1)?.id).toBe(1);
  });
});
