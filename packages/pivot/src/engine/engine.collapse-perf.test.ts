import { describe, it, expect } from 'vitest';
import { PivotEngine } from './engine.js';

interface Sale {
  region: string;
  product: string;
  quarter: string;
  amount: number;
}

const DATA: Sale[] = [
  { region: 'West', product: 'A', quarter: 'Q1', amount: 100 },
  { region: 'West', product: 'A', quarter: 'Q2', amount: 200 },
  { region: 'West', product: 'B', quarter: 'Q1', amount: 50 },
  { region: 'East', product: 'A', quarter: 'Q1', amount: 300 },
  { region: 'East', product: 'B', quarter: 'Q2', amount: 400 },
];

describe('PivotEngine — collapsible row nodes', () => {
  it('prunes the descendants of a collapsed row node but keeps its subtotal', () => {
    const engine = new PivotEngine(DATA);
    const full = engine.compute({
      rows: ['region', 'product'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      mode: 'tree',
      totals: { grand: true, rows: true, columns: false },
    });
    const westNode = full.rowTree.find((n) => n.label === 'West')!;
    expect(westNode).toBeTruthy();

    const collapsed = engine.compute({
      rows: ['region', 'product'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      mode: 'tree',
      totals: { grand: true, rows: true, columns: false },
      collapse: { rows: [westNode.key] },
    });
    const leafKey = collapsed.columnLeaves[0]!.key;

    // West's product children (A, B) must NOT appear under West anymore.
    const westChildren = collapsed.matrix.filter(
      (r) => r.headers[0] === 'West' && r.depth === 1,
    );
    expect(westChildren).toHaveLength(0);

    // The West subtotal row is still present, flagged collapsed, with its total.
    const westRow = collapsed.matrix.find((r) => r.headers[0] === 'West' && r.depth === 0)!;
    expect(westRow.collapsed).toBe(true);
    expect(westRow.collapsible).toBe(true);
    expect(westRow.nodeKey).toBe(westNode.key);
    expect(westRow.cells[leafKey]).toBe(350); // 100+200+50 — total still reconciles.

    // East is untouched (its product children remain).
    const eastChildren = collapsed.matrix.filter(
      (r) => r.headers[0] === 'East' && r.depth === 1,
    );
    expect(eastChildren.length).toBeGreaterThan(0);

    // Grand total unchanged by collapsing.
    const grand = collapsed.matrix[collapsed.matrix.length - 1]!;
    expect(grand.cells[leafKey]).toBe(1050);
  });

  it('rowExpandLevel auto-collapses every node at/below the level', () => {
    const engine = new PivotEngine(DATA);
    const result = engine.compute({
      rows: ['region', 'product'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      mode: 'tree',
      totals: { grand: false, rows: true, columns: false },
      collapse: { rowExpandLevel: 0 },
    });
    // expandLevel 0 collapses every depth-0 group, so only region rows remain.
    expect(result.matrix.every((r) => r.depth === 0)).toBe(true);
    const collapsibleRows = result.matrix.filter((r) => r.collapsible);
    expect(collapsibleRows.length).toBeGreaterThan(0);
    expect(collapsibleRows.every((r) => r.collapsed)).toBe(true);
  });

  it('collapses a column node, pruning its child leaves while totals reconcile', () => {
    const engine = new PivotEngine(DATA);
    const full = engine.compute({
      rows: ['region'],
      columns: ['quarter', 'product'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      mode: 'flat',
      totals: { grand: false, rows: false, columns: false },
    });
    const q1Node = full.columnTree.find((n) => n.label === 'Q1')!;
    // Q1 has product children (A, B) → multiple leaves under it.
    const q1LeafCount = full.columnLeaves.filter((l) => l.path[0] === 'Q1').length;
    expect(q1LeafCount).toBeGreaterThan(1);

    const collapsed = engine.compute({
      rows: ['region'],
      columns: ['quarter', 'product'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      mode: 'flat',
      totals: { grand: false, rows: false, columns: false },
      collapse: { columns: [q1Node.key] },
    });
    const q1Leaves = collapsed.columnLeaves.filter((l) => l.path[0] === 'Q1');
    // Collapsed → exactly one Q1 leaf (the Q1 aggregate), not one per product.
    expect(q1Leaves).toHaveLength(1);
    const west = collapsed.matrix.find((r) => r.headers[0] === 'West')!;
    // West Q1 total = 100 (A) + 50 (B) = 150 — still reconciles.
    expect(west.cells[q1Leaves[0]!.key]).toBe(150);
  });
});

describe('PivotEngine — large-data performance (single-pass bucketing)', () => {
  it('builds a 100k-row pivot under a sane time bound', () => {
    const regions = ['North', 'South', 'East', 'West'];
    const products = ['A', 'B', 'C', 'D', 'E'];
    const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
    const big: Sale[] = [];
    for (let i = 0; i < 100_000; i++) {
      big.push({
        region: regions[i % regions.length]!,
        product: products[i % products.length]!,
        quarter: quarters[i % quarters.length]!,
        amount: (i % 97) + 1,
      });
    }
    const engine = new PivotEngine(big);
    const start = Date.now();
    const result = engine.compute({
      rows: ['region', 'product'],
      columns: ['quarter'],
      values: [
        { field: 'amount', aggregator: 'sum' },
        { field: 'amount', aggregator: 'average', label: 'Avg' },
      ],
      mode: 'tree',
      totals: { grand: true, rows: true, columns: true },
    });
    const elapsed = Date.now() - start;
    // The matrix is well-formed and the grand total sums every row.
    const grand = result.matrix[result.matrix.length - 1]!;
    const totalLeaf = result.columnLeaves.find((l) => l.isTotal && l.valueIndex === 0)!;
    const expectedSum = big.reduce((a, r) => a + r.amount, 0);
    expect(grand.cells[totalLeaf.key]).toBe(expectedSum);
    // Generous bound — the old O(rows×leaves×depth) path blew well past this.
    expect(elapsed).toBeLessThan(4000);
  });

  it('matches the naive per-subset aggregation on a small dataset', () => {
    // Cross-check the bucketed result against an independent ground truth.
    const engine = new PivotEngine(DATA);
    const result = engine.compute({
      rows: ['region', 'product'],
      columns: ['quarter'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      mode: 'flat',
      totals: { grand: false, rows: false, columns: false },
    });
    for (const leaf of result.columnLeaves) {
      for (const row of result.matrix) {
        // Independently recompute the expected sum by filtering the raw data.
        const expected = DATA.filter(
          (d) =>
            row.headers[0] === d.region &&
            row.headers[1] === d.product &&
            (leaf.path.length === 0 || leaf.path[0] === d.quarter),
        ).reduce((a, d) => a + d.amount, 0);
        expect(row.cells[leaf.key] ?? 0).toBe(expected);
      }
    }
  });
});
