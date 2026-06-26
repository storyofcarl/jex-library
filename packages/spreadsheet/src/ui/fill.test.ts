/** jsdom unit test for fill-series logic. */
import { describe, it, expect } from 'vitest';
import { fillSeries, fillBlock } from './fill.js';

describe('fillSeries', () => {
  it('extends a single number as a +1 series', () => {
    expect(fillSeries([1], 3)).toEqual([2, 3, 4]);
  });

  it('detects an arithmetic step from two sources', () => {
    expect(fillSeries([2, 4], 3)).toEqual([6, 8, 10]);
    expect(fillSeries([10, 7], 2)).toEqual([4, 1]);
  });

  it('cycles non-numeric sources', () => {
    expect(fillSeries(['a', 'b'], 4)).toEqual(['a', 'b', 'a', 'b']);
  });

  it('cycles when the numeric source is non-linear', () => {
    expect(fillSeries([1, 2, 5], 2)).toEqual([1, 2]);
  });
});

describe('fillBlock', () => {
  it('fills down per column', () => {
    const out = fillBlock([[1, 10]], 'down', 2);
    expect(out).toEqual([
      [2, 11],
      [3, 12],
    ]);
  });

  it('fills right per row', () => {
    const out = fillBlock([[5], [2]], 'right', 2);
    expect(out).toEqual([
      [6, 7],
      [3, 4],
    ]);
  });

  it('returns empty for non-positive extent', () => {
    expect(fillBlock([[1]], 'down', 0)).toEqual([]);
  });
});
