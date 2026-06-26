/**
 * Fill semantics (drag-fill / fill-down / fill-right). Given a source block and
 * a fill direction + length, produce the values to write. Pure value logic.
 *
 *   - Single numeric source → linear series (1,2,3…) when the source is a single
 *     number and the destination extends it; otherwise the value is repeated.
 *   - Two-or-more numeric sources → arithmetic progression by the detected step.
 *   - Non-numeric (string/bool) sources → repeated cyclically.
 */

import type { CellValue } from '../contract.js';

/** Detect a constant arithmetic step from a numeric source column/row. */
function detectStep(nums: number[]): number {
  if (nums.length < 2) return 1;
  const step = (nums[1] as number) - (nums[0] as number);
  for (let i = 2; i < nums.length; i++) {
    if (Math.abs((nums[i] as number) - (nums[i - 1] as number) - step) > 1e-9) return NaN; // not linear → repeat
  }
  return step;
}

/**
 * Produce `count` filled values from a 1D source sequence. Numeric sources
 * extrapolate a linear series; everything else cycles.
 */
export function fillSeries(source: CellValue[], count: number): CellValue[] {
  if (source.length === 0) return new Array(count).fill(null);
  const allNumbers = source.every((v) => typeof v === 'number');
  const out: CellValue[] = [];
  if (allNumbers) {
    const nums = source as number[];
    const step = detectStep(nums);
    if (!Number.isNaN(step)) {
      const last = nums[nums.length - 1] as number;
      for (let i = 0; i < count; i++) out.push(last + step * (i + 1));
      return out;
    }
  }
  // cycle the source
  for (let i = 0; i < count; i++) out.push(source[i % source.length] ?? null);
  return out;
}

/** Fill direction. */
export type FillDirection = 'down' | 'up' | 'right' | 'left';

/**
 * Given a 2D source block and a fill direction + number of extra lines, compute
 * the 2D values to write (one array per extra line). Each line extends along the
 * cross axis using `fillSeries` per column (down/up) or per row (right/left).
 */
export function fillBlock(
  source: CellValue[][],
  direction: FillDirection,
  extra: number,
): CellValue[][] {
  if (extra <= 0) return [];
  if (direction === 'down' || direction === 'up') {
    const cols = source[0]?.length ?? 0;
    const result: CellValue[][] = Array.from({ length: extra }, () => new Array(cols).fill(null));
    for (let c = 0; c < cols; c++) {
      const colVals = source.map((r) => r[c] ?? null);
      const ordered = direction === 'up' ? [...colVals].reverse() : colVals;
      const series = fillSeries(ordered, extra);
      for (let i = 0; i < extra; i++) {
        const target = direction === 'up' ? extra - 1 - i : i;
        (result[target] as CellValue[])[c] = series[i] ?? null;
      }
    }
    return result;
  }
  // right / left
  const rows = source.length;
  const result: CellValue[][] = Array.from({ length: rows }, () => new Array(extra).fill(null));
  for (let r = 0; r < rows; r++) {
    const rowVals = source[r] ?? [];
    const ordered = direction === 'left' ? [...rowVals].reverse() : rowVals;
    const series = fillSeries(ordered, extra);
    for (let i = 0; i < extra; i++) {
      const target = direction === 'left' ? extra - 1 - i : i;
      (result[r] as CellValue[])[target] = series[i] ?? null;
    }
  }
  return result;
}
