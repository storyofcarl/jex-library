import { describe, it, expect } from 'vitest';
import {
  resolveSeries,
  applyStacking,
  valueDomain,
  axisInUse,
  isCartesian,
  isStackable,
} from './series-math.js';

describe('type predicates', () => {
  it('classifies cartesian types', () => {
    expect(isCartesian('line')).toBe(true);
    expect(isCartesian('bar')).toBe(true);
    expect(isCartesian('pie')).toBe(false);
    expect(isCartesian('radar')).toBe(false);
  });

  it('classifies stackable types', () => {
    expect(isStackable('bar')).toBe(true);
    expect(isStackable('area')).toBe(true);
    expect(isStackable('line')).toBe(false);
  });
});

describe('resolveSeries', () => {
  it('applies default type and names', () => {
    const r = resolveSeries([{ data: [1, 2] }, { data: [3, 4], name: 'B' }], 'bar', false);
    expect(r[0]!.type).toBe('bar');
    expect(r[0]!.name).toBe('Series 1');
    expect(r[1]!.name).toBe('B');
  });

  it('honors per-series type for combination charts', () => {
    const r = resolveSeries([{ data: [1], type: 'line' }, { data: [2] }], 'bar', false);
    expect(r[0]!.type).toBe('line');
    expect(r[1]!.type).toBe('bar');
  });

  it('assigns a default stack group when stacked=true', () => {
    const r = resolveSeries([{ data: [1] }, { data: [2] }], 'bar', true);
    expect(r[0]!.stack).toBe('_default');
    expect(r[1]!.stack).toBe('_default');
  });

  it('does not stack non-stackable types', () => {
    const r = resolveSeries([{ data: [1], type: 'line' }], 'line', true);
    expect(r[0]!.stack).toBeUndefined();
  });
});

describe('applyStacking', () => {
  it('accumulates positive values from a shared baseline', () => {
    const r = resolveSeries(
      [
        { data: [1, 2], stack: 's' },
        { data: [3, 4], stack: 's' },
      ],
      'bar',
      false,
    );
    applyStacking(r);
    expect(r[0]!.base).toEqual([0, 0]);
    expect(r[0]!.top).toEqual([1, 2]);
    expect(r[1]!.base).toEqual([1, 2]);
    expect(r[1]!.top).toEqual([4, 6]);
  });

  it('separates positive and negative stacks', () => {
    const r = resolveSeries(
      [
        { data: [5], stack: 's' },
        { data: [-3], stack: 's' },
      ],
      'bar',
      false,
    );
    applyStacking(r);
    expect(r[0]!.base).toEqual([0]);
    expect(r[0]!.top).toEqual([5]);
    expect(r[1]!.base).toEqual([-3]);
    expect(r[1]!.top).toEqual([0]);
  });

  it('ignores hidden series when stacking', () => {
    const r = resolveSeries(
      [
        { data: [1], stack: 's', hidden: true },
        { data: [2], stack: 's' },
      ],
      'bar',
      false,
    );
    applyStacking(r);
    expect(r[1]!.base).toEqual([0]);
    expect(r[1]!.top).toEqual([2]);
  });
});

describe('valueDomain', () => {
  it('spans the min/max of visible series, including 0 for bars', () => {
    const r = resolveSeries([{ data: [3, 7, 5] }], 'bar', false);
    const dom = valueDomain(r, 'left');
    expect(dom).toEqual({ min: 0, max: 7 });
  });

  it('uses stacked tops for the domain max', () => {
    const r = resolveSeries(
      [
        { data: [3], stack: 's' },
        { data: [4], stack: 's' },
      ],
      'bar',
      false,
    );
    applyStacking(r);
    const dom = valueDomain(r, 'left');
    expect(dom!.max).toBe(7);
  });

  it('does not force 0 for line series', () => {
    const r = resolveSeries([{ data: [10, 20, 15] }], 'line', false);
    const dom = valueDomain(r, 'left');
    expect(dom).toEqual({ min: 10, max: 20 });
  });

  it('returns null when no series bind to the axis', () => {
    const r = resolveSeries([{ data: [1], axis: 'left' }], 'line', false);
    expect(valueDomain(r, 'right')).toBeNull();
  });

  it('separates left/right axis domains (dual axes)', () => {
    const r = resolveSeries(
      [
        { data: [1, 2], axis: 'left' },
        { data: [100, 200], axis: 'right' },
      ],
      'line',
      false,
    );
    expect(valueDomain(r, 'left')!.max).toBe(2);
    expect(valueDomain(r, 'right')!.max).toBe(200);
    expect(axisInUse(r, 'left')).toBe(true);
    expect(axisInUse(r, 'right')).toBe(true);
  });
});
