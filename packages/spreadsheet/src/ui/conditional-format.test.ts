/** jsdom unit test for the conditional-formatting evaluator (pure logic). */
import { describe, it, expect } from 'vitest';
import { resolveConditionalFormat, cfRangeContains } from './conditional-format.js';
import type { CellValue, CfRule } from '../contract.js';

const FULL = { top: 0, left: 0, bottom: 9, right: 9 };

describe('cfRangeContains', () => {
  it('tests inclusive bounds', () => {
    expect(cfRangeContains({ top: 1, left: 1, bottom: 3, right: 3 }, 2, 2)).toBe(true);
    expect(cfRangeContains({ top: 1, left: 1, bottom: 3, right: 3 }, 0, 2)).toBe(false);
  });
});

describe('resolveConditionalFormat — cellValue', () => {
  it('applies a style when the comparison matches', () => {
    const rule: CfRule = {
      kind: 'cellValue',
      range: FULL,
      op: '>',
      value: 100,
      style: { backgroundToken: '--jects-destructive' },
    };
    const get = (): CellValue => null;
    expect(resolveConditionalFormat([rule], 0, 0, 150, get)?.style?.backgroundToken).toBe(
      '--jects-destructive',
    );
    expect(resolveConditionalFormat([rule], 0, 0, 50, get)).toBeUndefined();
  });

  it('supports between', () => {
    const rule: CfRule = {
      kind: 'cellValue',
      range: FULL,
      op: 'between',
      value: 10,
      value2: 20,
      style: { bold: true },
    };
    const get = (): CellValue => null;
    expect(resolveConditionalFormat([rule], 0, 0, 15, get)?.style?.bold).toBe(true);
    expect(resolveConditionalFormat([rule], 0, 0, 25, get)).toBeUndefined();
  });

  it('later rules paint over earlier ones', () => {
    const rules: CfRule[] = [
      { kind: 'cellValue', range: FULL, op: '>', value: 0, style: { colorToken: '--a' } },
      { kind: 'cellValue', range: FULL, op: '>', value: 0, style: { colorToken: '--b' } },
    ];
    const get = (): CellValue => null;
    expect(resolveConditionalFormat(rules, 0, 0, 5, get)?.style?.colorToken).toBe('--b');
  });
});

describe('resolveConditionalFormat — colorScale & dataBar', () => {
  const grid: number[] = [0, 5, 10];
  const get = (_r: number, c: number): CellValue => grid[c] ?? null;
  const range = { top: 0, left: 0, bottom: 0, right: 2 };

  it('maps a colorScale to min/max tokens by position', () => {
    const rule: CfRule = {
      kind: 'colorScale',
      range,
      minToken: '--lo',
      maxToken: '--hi',
    };
    expect(resolveConditionalFormat([rule], 0, 0, 0, get)?.backgroundToken).toBe('--lo');
    expect(resolveConditionalFormat([rule], 0, 2, 10, get)?.backgroundToken).toBe('--hi');
  });

  it('computes a dataBar fraction within the range extent', () => {
    const rule: CfRule = { kind: 'dataBar', range, colorToken: '--bar' };
    expect(resolveConditionalFormat([rule], 0, 1, 5, get)?.dataBar?.fraction).toBeCloseTo(0.5);
    expect(resolveConditionalFormat([rule], 0, 2, 10, get)?.dataBar?.fraction).toBeCloseTo(1);
  });
});

describe('resolveConditionalFormat — expression', () => {
  it('applies a style when the expression evaluates truthy', () => {
    const rule: CfRule = {
      kind: 'expression',
      range: FULL,
      formula: '=A1>5',
      style: { italic: true },
    };
    const get = (): CellValue => null;
    const truthy = resolveConditionalFormat([rule], 0, 0, 0, get, () => true);
    const falsy = resolveConditionalFormat([rule], 0, 0, 0, get, () => false);
    expect(truthy?.style?.italic).toBe(true);
    expect(falsy).toBeUndefined();
  });
});
