import { describe, it, expect } from 'vitest';
import { PivotEngine } from '../engine/index.js';
import { projectColumns, projectRows, leafHeader, PIVOT_META } from './project.js';

interface Sale extends Record<string, unknown> {
  region: string;
  quarter: string;
  amount: number;
}

const DATA: Sale[] = [
  { region: 'West', quarter: 'Q1', amount: 100 },
  { region: 'West', quarter: 'Q2', amount: 200 },
  { region: 'East', quarter: 'Q1', amount: 300 },
];

function result() {
  return new PivotEngine(DATA).compute({
    rows: ['region'],
    columns: ['quarter'],
    values: [{ field: 'amount', aggregator: 'sum' }],
    mode: 'flat',
    totals: { grand: true, rows: true, columns: true },
  });
}

describe('projectColumns', () => {
  it('creates leading row-header columns + one column per leaf', () => {
    const r = result();
    const cols = projectColumns(r, { rowFieldLabels: ['Region'], freezeRowHeaders: true });
    // 1 row-header column + 3 leaf columns (Q1, Q2, Total).
    expect(cols).toHaveLength(1 + r.columnLeaves.length);
    expect(cols[0]!.header).toBe('Region');
    expect(cols[0]!.frozen).toBe('left');
    // value columns are numeric + end-aligned.
    const valueCol = cols[1]!;
    expect(valueCol.type).toBe('number');
    expect(valueCol.align).toBe('end');
    expect(valueCol.id).toBe(r.columnLeaves[0]!.key);
  });

  it('omits frozen when freezeRowHeaders is false', () => {
    const cols = projectColumns(result(), { freezeRowHeaders: false });
    expect(cols[0]!.frozen).toBeUndefined();
  });
});

describe('projectRows', () => {
  it('produces flat records carrying header + cell + meta keys', () => {
    const r = result();
    const rows = projectRows(r);
    expect(rows).toHaveLength(r.matrix.length);
    const west = rows.find((row) => row['__h0'] === 'West')!;
    expect(west).toBeTruthy();
    // cell values are keyed by leaf key.
    const leafKey = r.columnLeaves.find((l) => l.path[0] === 'Q1' && !l.isTotal)!.key;
    expect(west[leafKey]).toBe(100);
    // grand total row carries the total meta flag.
    const grand = rows[rows.length - 1]!;
    expect(grand[PIVOT_META.total]).toBe(true);
    // unique ids.
    expect(new Set(rows.map((row) => row['id'])).size).toBe(rows.length);
  });
});

describe('leafHeader', () => {
  it('composes member path + value label', () => {
    const r = result();
    const q1 = r.columnLeaves.find((l) => l.path[0] === 'Q1' && !l.isTotal)!;
    expect(leafHeader(q1)).toContain('Q1');
    expect(leafHeader(q1)).toContain('Sum of amount');
    const total = r.columnLeaves.find((l) => l.isTotal)!;
    expect(leafHeader(total)).toContain('Total');
  });
});
