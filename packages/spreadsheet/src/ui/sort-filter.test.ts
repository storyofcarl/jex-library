/** jsdom unit test for the pure sort/filter helpers + the wired widget paths. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sortRows, filterRows, distinctColumnValues, valueInSet } from './sort-filter.js';
import { Spreadsheet } from './spreadsheet.js';
import type { CellValue } from '../contract.js';

describe('sortRows (pure)', () => {
  it('sorts ascending by a key column', () => {
    const rows: CellValue[][] = [
      ['c', 3],
      ['a', 1],
      ['b', 2],
    ];
    const out = sortRows(rows, { column: 1, dir: 'asc' });
    expect(out.map((r) => r[1])).toEqual([1, 2, 3]);
  });

  it('sorts descending', () => {
    const rows: CellValue[][] = [[1], [3], [2]];
    expect(sortRows(rows, { column: 0, dir: 'desc' }).map((r) => r[0])).toEqual([3, 2, 1]);
  });

  it('is stable for equal keys (preserves original order)', () => {
    const rows: CellValue[][] = [
      [1, 'first'],
      [1, 'second'],
      [1, 'third'],
    ];
    const out = sortRows(rows, { column: 0 });
    expect(out.map((r) => r[1])).toEqual(['first', 'second', 'third']);
  });

  it('orders numbers before text before blanks', () => {
    const rows: CellValue[][] = [['x'], [null], [5]];
    expect(sortRows(rows, { column: 0 }).map((r) => r[0])).toEqual([5, 'x', null]);
  });
});

describe('filterRows (pure)', () => {
  it('partitions rows by a predicate', () => {
    const rows: CellValue[][] = [[1], [2], [3], [4]];
    const { visible, hidden } = filterRows(rows, 0, (v) => (v as number) % 2 === 0);
    expect(visible).toEqual([1, 3]);
    expect(hidden).toEqual([0, 2]);
  });

  it('distinct + valueInSet', () => {
    const rows: CellValue[][] = [['a'], ['b'], ['a']];
    expect(distinctColumnValues(rows, 0).sort()).toEqual(['a', 'b']);
    const pred = valueInSet(['a']);
    expect(pred('a')).toBe(true);
    expect(pred('b')).toBe(false);
  });
});

describe('Spreadsheet — sort/filter wiring', () => {
  let host: HTMLElement;
  let ss: Spreadsheet;
  const ref = (row: number, col: number) => ({ sheet: ss.getApi().getActiveSheet().id, row, col });

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    ss = new Spreadsheet(host, {});
    // Header row + 3 data rows in A/B.
    ss.getApi().setValue(ref(0, 0), 'Name');
    ss.getApi().setValue(ref(0, 1), 'Score');
    ss.getApi().setValue(ref(1, 0), 'C');
    ss.getApi().setValue(ref(1, 1), 30);
    ss.getApi().setValue(ref(2, 0), 'A');
    ss.getApi().setValue(ref(2, 1), 10);
    ss.getApi().setValue(ref(3, 0), 'B');
    ss.getApi().setValue(ref(3, 1), 20);
  });
  afterEach(() => {
    if (!ss.isDestroyed) ss.destroy();
    host.remove();
  });

  it('sortRange reorders whole records by a column and is undoable', () => {
    ss.sortRange({ column: 1, dir: 'asc' }, { top: 1, left: 0, bottom: 3, right: 1 });
    expect(ss.getApi().getValue(ref(1, 1))).toBe(10);
    expect(ss.getApi().getValue(ref(1, 0))).toBe('A'); // record moved together
    expect(ss.getApi().getValue(ref(3, 1))).toBe(30);
    ss.undo();
    expect(ss.getApi().getValue(ref(1, 1))).toBe(30);
  });

  it('applyFilter hides non-matching rows and clearFilter reveals them', () => {
    ss.applyFilter(1, (v) => (v as number) >= 20, { top: 1, left: 0, bottom: 3, right: 1 });
    // Row with score 10 (row index 2) is hidden.
    expect(ss.getApi().getActiveSheet().rows?.[2]?.hidden).toBe(true);
    expect(ss.getApi().getActiveSheet().rows?.[1]?.hidden).toBeFalsy();
    ss.clearFilter();
    expect(ss.getApi().getActiveSheet().rows?.[2]?.hidden).toBeFalsy();
  });

  it('renders a header sort/filter affordance and acts on click', () => {
    ss.getGrid().update({});
    const menu = host.querySelector(
      '.jects-sheet__colhead[data-col="1"] .jects-sheet__colmenu',
    ) as HTMLButtonElement;
    expect(menu).toBeTruthy();
    menu.click(); // sort ascending by Score; header row auto-detected & preserved
    expect(ss.getApi().getValue(ref(0, 0))).toBe('Name'); // header stays on top
    expect(ss.getApi().getValue(ref(1, 1))).toBe(10);
  });
});
