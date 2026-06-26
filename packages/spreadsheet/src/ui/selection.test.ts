/** jsdom unit test for selection geometry. */
import { describe, it, expect } from 'vitest';
import {
  clampAddress,
  rangeOf,
  rangeContains,
  rangeSize,
  isSingle,
  iterateRange,
  moveAddress,
  addrEquals,
  type SelectionState,
} from './selection.js';

describe('selection geometry', () => {
  it('clamps an address into the grid', () => {
    expect(clampAddress({ row: -3, col: 99 }, 10, 5)).toEqual({ row: 0, col: 4 });
  });

  it('normalizes a range regardless of anchor/active order', () => {
    const state: SelectionState = { anchor: { row: 4, col: 3 }, active: { row: 1, col: 1 } };
    expect(rangeOf(state)).toEqual({ top: 1, left: 1, bottom: 4, right: 3 });
  });

  it('tests containment and size', () => {
    const r = { top: 1, left: 1, bottom: 3, right: 2 };
    expect(rangeContains(r, 2, 2)).toBe(true);
    expect(rangeContains(r, 0, 0)).toBe(false);
    expect(rangeSize(r)).toEqual({ rows: 3, cols: 2 });
  });

  it('detects a single-cell selection', () => {
    expect(isSingle({ anchor: { row: 2, col: 2 }, active: { row: 2, col: 2 } })).toBe(true);
    expect(isSingle({ anchor: { row: 2, col: 2 }, active: { row: 3, col: 2 } })).toBe(false);
  });

  it('iterates a range row-major', () => {
    const cells = [...iterateRange({ top: 0, left: 0, bottom: 1, right: 1 })];
    expect(cells).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ]);
  });

  it('moves and clamps addresses', () => {
    expect(moveAddress({ row: 0, col: 0 }, -1, 0, 5, 5)).toEqual({ row: 0, col: 0 });
    expect(moveAddress({ row: 0, col: 0 }, 1, 1, 5, 5)).toEqual({ row: 1, col: 1 });
    expect(addrEquals({ row: 1, col: 2 }, { row: 1, col: 2 })).toBe(true);
  });
});
