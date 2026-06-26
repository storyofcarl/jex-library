/** jsdom unit tests — col/row span resolution. */
import { describe, it, expect } from 'vitest';
import {
  resolveSpans,
  normalizeSpan,
  isCovered,
  originAt,
  type SpanHost,
  type CellSpan,
} from './spans.js';
import type { Model } from '@jects/core';
import type { CellAddress, ColumnDef } from '../contract.js';

interface Row extends Model {
  id: number;
  a: string;
  b: string;
  c: string;
}

const rows: Row[] = [
  { id: 1, a: 'a1', b: 'b1', c: 'c1' },
  { id: 2, a: 'a2', b: 'b2', c: 'c2' },
  { id: 3, a: 'a3', b: 'b3', c: 'c3' },
];

function host(columns: ColumnDef<Row>[]): SpanHost<Row> {
  return {
    rowCount: () => rows.length,
    colCount: () => columns.length,
    rowAt: (i) => rows[i],
    columnAt: (i) => columns[i],
    valueAt: (cell: CellAddress) => {
      const col = columns[cell.colIndex];
      const row = rows[cell.rowIndex];
      return col?.field ? (row as Record<string, unknown>)[col.field] : undefined;
    },
  };
}

describe('normalizeSpan', () => {
  it('coerces number, undefined, and partial objects', () => {
    expect(normalizeSpan(undefined)).toEqual({ colSpan: 1, rowSpan: 1 });
    expect(normalizeSpan(3)).toEqual({ colSpan: 3, rowSpan: 1 });
    expect(normalizeSpan({ colSpan: 2 } as CellSpan)).toEqual({ colSpan: 2, rowSpan: 1 });
    expect(normalizeSpan({ colSpan: 0, rowSpan: 0 })).toEqual({ colSpan: 1, rowSpan: 1 });
  });
});

describe('resolveSpans', () => {
  it('no spans → every cell is its own origin, none covered', () => {
    const columns: ColumnDef<Row>[] = [{ field: 'a' }, { field: 'b' }, { field: 'c' }];
    const map = resolveSpans(host(columns), { rowStart: 0, rowEnd: 3, colStart: 0, colEnd: 3 });
    expect(map.hasSpans).toBe(false);
    expect(map.origins.size).toBe(9);
    expect(map.covered.size).toBe(0);
  });

  it('colSpan covers cells to the right of the origin', () => {
    const columns: ColumnDef<Row>[] = [
      { field: 'a', meta: { span: (c) => (c.rowIndex === 0 ? { colSpan: 2, rowSpan: 1 } : 1) } },
      { field: 'b' },
      { field: 'c' },
    ];
    const map = resolveSpans(host(columns), { rowStart: 0, rowEnd: 3, colStart: 0, colEnd: 3 });
    expect(map.hasSpans).toBe(true);
    expect(originAt(map, 0, 0)).toMatchObject({ colSpan: 2, rowSpan: 1 });
    expect(isCovered(map, 0, 1)).toBe(true);
    expect(isCovered(map, 0, 2)).toBe(false);
    // covered cells do not become origins
    expect(originAt(map, 0, 1)).toBeUndefined();
  });

  it('rowSpan covers cells below the origin', () => {
    const columns: ColumnDef<Row>[] = [
      { field: 'a', meta: { span: (c) => (c.rowIndex === 0 ? { colSpan: 1, rowSpan: 2 } : 1) } },
      { field: 'b' },
    ];
    const map = resolveSpans(host(columns), { rowStart: 0, rowEnd: 3, colStart: 0, colEnd: 2 });
    expect(originAt(map, 0, 0)).toMatchObject({ rowSpan: 2 });
    expect(isCovered(map, 1, 0)).toBe(true);
    expect(isCovered(map, 2, 0)).toBe(false);
  });

  it('clamps span extent to the DATA bounds, not the window', () => {
    const columns: ColumnDef<Row>[] = [
      { field: 'a', meta: { span: () => ({ colSpan: 5, rowSpan: 5 }) } },
      { field: 'b' },
      { field: 'c' },
    ];
    // window only covers rows [0,2) cols [0,2); data is 3×3.
    const map = resolveSpans(host(columns), { rowStart: 0, rowEnd: 2, colStart: 0, colEnd: 2 });
    const origin = originAt(map, 0, 0)!;
    // Span extent is clamped to the data (3×3), NOT the 2×2 window — otherwise
    // scrolling would re-render covered cells the origin truly owns.
    expect(origin.colSpan).toBe(3);
    expect(origin.rowSpan).toBe(3);
    // The `covered` map only reports cells *inside the window* (what the renderer
    // paints): (2,0) is outside the window so it is not listed there…
    expect(isCovered(map, 2, 0)).toBe(false);
    // …but (1,1), inside the window, is correctly covered by the origin.
    expect(isCovered(map, 1, 1)).toBe(true);
  });

  it('records coverage for an origin scrolled ABOVE the window (no duplication)', () => {
    // A rowSpan origin at row 0 that reaches into a window starting at row 1.
    const columns: ColumnDef<Row>[] = [
      { field: 'a', meta: { span: (c) => (c.rowIndex === 0 ? { colSpan: 1, rowSpan: 3 } : 1) } },
      { field: 'b' },
    ];
    // Window is rows [1,3) — the origin (0,0) is NOT painted, but it covers (1,0) and (2,0).
    const map = resolveSpans(host(columns), { rowStart: 1, rowEnd: 3, colStart: 0, colEnd: 2 });
    // The origin itself is outside the window, so it is not a renderable origin…
    expect(originAt(map, 0, 0)).toBeUndefined();
    // …but it is reported as a clipped origin reaching into the window.
    expect(map.clippedOrigins.get('0:0')).toMatchObject({ rowSpan: 3 });
    // The covered cells inside the window are recorded → renderer skips them.
    expect(isCovered(map, 1, 0)).toBe(true);
    expect(isCovered(map, 2, 0)).toBe(true);
  });

  it('records coverage for an origin scrolled LEFT of the window', () => {
    const columns: ColumnDef<Row>[] = [
      { field: 'a', meta: { span: (c) => (c.rowIndex === 0 ? { colSpan: 3, rowSpan: 1 } : 1) } },
      { field: 'b' },
      { field: 'c' },
    ];
    // Window is cols [1,3) — origin (0,0) is left of it but covers (0,1) and (0,2).
    const map = resolveSpans(host(columns), { rowStart: 0, rowEnd: 1, colStart: 1, colEnd: 3 });
    expect(originAt(map, 0, 0)).toBeUndefined();
    expect(map.clippedOrigins.get('0:0')).toMatchObject({ colSpan: 3 });
    expect(isCovered(map, 0, 1)).toBe(true);
    expect(isCovered(map, 0, 2)).toBe(true);
  });
});
