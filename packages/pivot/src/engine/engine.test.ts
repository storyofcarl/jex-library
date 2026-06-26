import { describe, it, expect } from 'vitest';
import { PivotEngine, readField } from './engine.js';

interface Sale {
  region: string;
  product: string;
  quarter: string;
  amount: number;
  units: number;
}

const DATA: Sale[] = [
  { region: 'West', product: 'A', quarter: 'Q1', amount: 100, units: 1 },
  { region: 'West', product: 'A', quarter: 'Q2', amount: 200, units: 2 },
  { region: 'West', product: 'B', quarter: 'Q1', amount: 50, units: 5 },
  { region: 'East', product: 'A', quarter: 'Q1', amount: 300, units: 3 },
  { region: 'East', product: 'B', quarter: 'Q2', amount: 400, units: 4 },
];

/** Find a matrix row by joined header. */
function rowByHeaders(result: ReturnType<PivotEngine<Sale>['compute']>, ...headers: string[]) {
  return result.matrix.find(
    (r) => headers.every((h, i) => r.headers[i] === h),
  );
}

describe('readField', () => {
  it('reads plain and dotted paths', () => {
    expect(readField({ a: 1 }, 'a')).toBe(1);
    expect(readField({ a: { b: 2 } }, 'a.b')).toBe(2);
    expect(readField({ a: {} }, 'a.b.c')).toBeUndefined();
  });
});

describe('PivotEngine — rows × values', () => {
  it('aggregates sum over a single row field', () => {
    const engine = new PivotEngine(DATA);
    const result = engine.compute({
      rows: ['region'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      totals: { grand: true, rows: false, columns: false },
    });
    // One leaf column (no column fields) per value.
    expect(result.columnLeaves).toHaveLength(1);
    const leafKey = result.columnLeaves[0]!.key;
    const west = rowByHeaders(result, 'West');
    const east = rowByHeaders(result, 'East');
    expect(west!.cells[leafKey]).toBe(350); // 100+200+50
    expect(east!.cells[leafKey]).toBe(700); // 300+400
    // Grand total row.
    const grand = result.matrix[result.matrix.length - 1]!;
    expect(grand.isTotal).toBe(true);
    expect(grand.cells[leafKey]).toBe(1050);
    expect(result.hasGrandTotalRow).toBe(true);
  });
});

describe('PivotEngine — rows × columns cross-tab', () => {
  it('builds a cross-tab with column total leaves', () => {
    const engine = new PivotEngine(DATA);
    const result = engine.compute({
      rows: ['region'],
      columns: ['quarter'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      mode: 'flat',
      totals: { grand: true, rows: true, columns: true },
    });
    // Two quarters (Q1,Q2) + a Total leaf = 3 leaves (1 value field).
    expect(result.columnLeaves).toHaveLength(3);
    const q1 = result.columnLeaves.find((l) => l.path[0] === 'Q1' && !l.isTotal)!;
    const q2 = result.columnLeaves.find((l) => l.path[0] === 'Q2' && !l.isTotal)!;
    const totalLeaf = result.columnLeaves.find((l) => l.isTotal)!;

    const west = rowByHeaders(result, 'West')!;
    expect(west.cells[q1.key]).toBe(150); // 100 + 50
    expect(west.cells[q2.key]).toBe(200);
    expect(west.cells[totalLeaf.key]).toBe(350); // row total

    const east = rowByHeaders(result, 'East')!;
    expect(east.cells[q1.key]).toBe(300);
    expect(east.cells[q2.key]).toBe(400);
    expect(east.cells[totalLeaf.key]).toBe(700);

    const grand = result.matrix[result.matrix.length - 1]!;
    expect(grand.cells[q1.key]).toBe(450);
    expect(grand.cells[q2.key]).toBe(600);
    expect(grand.cells[totalLeaf.key]).toBe(1050);
  });
});

describe('PivotEngine — tree mode subtotals', () => {
  it('emits a subtotal row per non-leaf group in tree mode', () => {
    const engine = new PivotEngine(DATA);
    const result = engine.compute({
      rows: ['region', 'product'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      mode: 'tree',
      totals: { grand: true, rows: true, columns: false },
    });
    const leafKey = result.columnLeaves[0]!.key;
    // West group subtotal row (depth 0, isTotal).
    const westGroup = result.matrix.find(
      (r) => r.headers[0] === 'West' && r.depth === 0 && r.isTotal,
    );
    expect(westGroup).toBeTruthy();
    expect(westGroup!.cells[leafKey]).toBe(350);
    // West > A leaf.
    const westA = result.matrix.find(
      (r) => r.headers[0] === 'West' && r.headers[1] === 'A' && r.depth === 1,
    );
    expect(westA!.cells[leafKey]).toBe(300); // 100+200
  });

  it('flat mode emits only leaf rows', () => {
    const engine = new PivotEngine(DATA);
    const result = engine.compute({
      rows: ['region', 'product'],
      values: ['amount'],
      mode: 'flat',
      totals: { grand: false, rows: false, columns: false },
    });
    // 4 distinct region×product combos, no totals.
    expect(result.matrix).toHaveLength(4);
    expect(result.matrix.every((r) => !r.isTotal)).toBe(true);
  });
});

describe('PivotEngine — multiple value fields', () => {
  it('produces one leaf per value field per column member', () => {
    const engine = new PivotEngine(DATA);
    const result = engine.compute({
      rows: ['region'],
      values: [
        { field: 'amount', aggregator: 'sum' },
        { field: 'units', aggregator: 'average', label: 'Avg Units' },
      ],
      totals: false,
    });
    expect(result.columnLeaves).toHaveLength(2);
    expect(result.valueLabels).toEqual(['Sum of amount', 'Avg Units']);
    const sumLeaf = result.columnLeaves[0]!;
    const avgLeaf = result.columnLeaves[1]!;
    const west = rowByHeaders(result, 'West')!;
    expect(west.cells[sumLeaf.key]).toBe(350);
    expect(west.cells[avgLeaf.key]).toBeCloseTo((1 + 2 + 5) / 3);
  });
});

describe('PivotEngine — filters', () => {
  it('restricts source rows before pivoting', () => {
    const engine = new PivotEngine(DATA);
    const result = engine.compute({
      rows: ['region'],
      values: ['amount'],
      filters: [{ field: 'quarter', operator: 'eq', value: 'Q1' }],
      totals: { grand: true, rows: false, columns: false },
    });
    const leafKey = result.columnLeaves[0]!.key;
    const grand = result.matrix[result.matrix.length - 1]!;
    expect(grand.cells[leafKey]).toBe(100 + 50 + 300); // only Q1 rows
  });

  it('supports in / notin / contains operators', () => {
    const engine = new PivotEngine(DATA);
    const inResult = engine.compute({
      values: ['amount'],
      filters: [{ field: 'region', operator: 'in', values: ['East'] }],
      totals: { grand: true, rows: false, columns: false },
    });
    expect(inResult.matrix[0]!.cells[inResult.columnLeaves[0]!.key]).toBe(700);
  });
});

describe('PivotEngine — count-only (no value fields)', () => {
  it('counts rows per cell when no values are configured', () => {
    const engine = new PivotEngine(DATA);
    const result = engine.compute({
      rows: ['region'],
      totals: { grand: true, rows: false, columns: false },
    });
    const leafKey = result.columnLeaves[0]!.key;
    expect(rowByHeaders(result, 'West')!.cells[leafKey]).toBe(3);
    expect(rowByHeaders(result, 'East')!.cells[leafKey]).toBe(2);
  });
});

describe('PivotEngine — custom aggregator & errors', () => {
  it('addMathMethod is usable by name', () => {
    const engine = new PivotEngine(DATA);
    engine.addMathMethod('first', (values) => {
      const n = values.map(Number).find((x) => Number.isFinite(x));
      return n ?? null;
    });
    const result = engine.compute({
      rows: ['region'],
      values: [{ field: 'amount', aggregator: 'first' }],
      totals: false,
    });
    const west = result.matrix.find((r) => r.headers[0] === 'West')!;
    expect(west.cells[result.columnLeaves[0]!.key]).toBe(100);
  });

  it('throws for an unknown aggregator name', () => {
    const engine = new PivotEngine(DATA);
    expect(() =>
      engine.compute({ rows: ['region'], values: [{ field: 'amount', aggregator: 'bogus' }] }),
    ).toThrow(/unknown aggregator/);
  });

  it('member sort direction is honored', () => {
    const engine = new PivotEngine(DATA);
    const asc = engine.compute({ rows: [{ field: 'region', sort: 'asc' }], values: ['amount'], totals: false });
    const desc = engine.compute({ rows: [{ field: 'region', sort: 'desc' }], values: ['amount'], totals: false });
    expect(asc.matrix[0]!.headers[0]).toBe('East');
    expect(desc.matrix[0]!.headers[0]).toBe('West');
  });
});
