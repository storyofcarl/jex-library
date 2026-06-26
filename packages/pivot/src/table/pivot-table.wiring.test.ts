import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PivotTable } from './pivot-table.js';
import type { ConditionalRule } from '../engine/index.js';

interface Sale extends Record<string, unknown> {
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

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

/** All rendered value-cell elements (excluding the leading row-header columns). */
function valueCells(host: HTMLElement, rowHeaderCount: number): HTMLElement[] {
  const out: HTMLElement[] = [];
  host.querySelectorAll<HTMLElement>('.jects-grid__row').forEach((row) => {
    row.querySelectorAll<HTMLElement>('.jects-grid__cell').forEach((cell) => {
      const ci = Number(cell.dataset['colIndex'] ?? '-1');
      if (ci >= rowHeaderCount) out.push(cell);
    });
  });
  return out;
}

/* ── Gap 6: cellTemplate + numberFormat actually flow to rendered cells ── */

describe('PivotTable wiring: cellTemplate', () => {
  it('renders the configured cellTemplate into value cells', () => {
    const p = new PivotTable<Sale>(host, {
      data: DATA,
      rows: ['region'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      totals: false,
      cellTemplate: ({ value, el }) => {
        el.classList.add('tmpl-marker');
        return `★${value ?? 0}`;
      },
    });
    p.getGrid()!.refresh();
    const cells = valueCells(host, 1);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.some((c) => c.classList.contains('tmpl-marker'))).toBe(true);
    expect(cells.some((c) => c.textContent?.includes('★'))).toBe(true);
    p.destroy();
  });
});

describe('PivotTable wiring: numberFormat', () => {
  it('formats value cells with the configured Intl options', () => {
    const p = new PivotTable<Sale>(host, {
      data: DATA,
      rows: ['region'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      totals: false,
      numberFormat: { locale: 'en-US', style: 'currency', currency: 'USD', maximumFractionDigits: 0 },
    });
    p.getGrid()!.refresh();
    const cells = valueCells(host, 1);
    // West = 350 → "$350"; East = 700 → "$700".
    const text = cells.map((c) => c.textContent).join('|');
    expect(text).toContain('$350');
    expect(text).toContain('$700');
    p.destroy();
  });
});

/* ── Gap 1: conditional formatting applied + recomputes on data change ── */

describe('PivotTable wiring: conditional formatting', () => {
  const rules: ConditionalRule[] = [
    { kind: 'cellValue', op: 'gt', value: 500, class: 'cf-big' },
  ];

  it('adds the rule class to cells whose value crosses the threshold', () => {
    const p = new PivotTable<Sale>(host, {
      data: DATA,
      rows: ['region'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      totals: false,
      conditionalFormat: rules,
    });
    p.getGrid()!.refresh();
    const cells = valueCells(host, 1);
    // East = 700 (> 500) → flagged; West = 350 → not.
    const big = cells.filter((c) => c.classList.contains('cf-big'));
    expect(big.length).toBe(1);
    expect(big[0]!.textContent).toContain('700');
    p.destroy();
  });

  it('recomputes the conditional decoration when the data changes', () => {
    const p = new PivotTable<Sale>(host, {
      data: DATA,
      rows: ['region'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      totals: false,
      conditionalFormat: rules,
    });
    p.getGrid()!.refresh();
    expect(valueCells(host, 1).filter((c) => c.classList.contains('cf-big')).length).toBe(1);

    // After replacing data so West also exceeds 500, both cells flag.
    p.setData([
      ...DATA,
      { region: 'West', product: 'C', quarter: 'Q3', amount: 999, units: 9 },
    ]);
    p.getGrid()!.refresh();
    const flagged = valueCells(host, 1).filter((c) => c.classList.contains('cf-big'));
    expect(flagged.length).toBe(2);
    p.destroy();
  });

  it('applies inline styles from a colorScale rule', () => {
    const p = new PivotTable<Sale>(host, {
      data: DATA,
      rows: ['region'],
      columns: ['quarter'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      mode: 'flat',
      totals: false,
      conditionalFormat: [{ kind: 'colorScale', min: '#ffffff', max: '#000000' }],
    });
    p.getGrid()!.refresh();
    const styled = valueCells(host, 1).filter((c) => c.style.backgroundColor !== '');
    expect(styled.length).toBeGreaterThan(0);
    p.destroy();
  });
});

/* ── Gap 2: collapsible header toggle (widget) ── */

describe('PivotTable wiring: collapsible headers', () => {
  it('renders a collapse toggle on group rows and hides descendants when toggled', () => {
    const p = new PivotTable<Sale>(host, {
      data: DATA,
      rows: ['region', 'product'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      mode: 'tree',
      totals: { grand: false, rows: true, columns: false },
    });
    p.getGrid()!.refresh();
    // A toggle exists for the group (region) rows.
    const toggle = host.querySelector<HTMLButtonElement>('.jects-pivot__toggle');
    expect(toggle).toBeTruthy();
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');

    const before = p.getResult()!.matrix.length;
    toggle!.click();
    const after = p.getResult()!.matrix.length;
    // Collapsing a region prunes its product children → fewer matrix rows.
    expect(after).toBeLessThan(before);
    // The toggled node is now tracked as collapsed.
    expect(p.getCollapsed('rows').length).toBe(1);
    p.destroy();
  });

  it('toggleNode(rows, key) collapses programmatically and emits toggle', () => {
    const p = new PivotTable<Sale>(host, {
      data: DATA,
      rows: ['region', 'product'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      mode: 'tree',
      totals: { grand: false, rows: true, columns: false },
    });
    const node = p.getResult()!.rowTree.find((n) => n.label === 'West')!;
    let evt: { collapsed: boolean; nodeKey: string } | undefined;
    p.on('toggle', (e) => (evt = e));
    p.toggleNode('rows', node.key, true);
    expect(evt?.collapsed).toBe(true);
    expect(evt?.nodeKey).toBe(node.key);
    const westChildren = p
      .getResult()!
      .matrix.filter((r) => r.headers[0] === 'West' && r.depth === 1);
    expect(westChildren).toHaveLength(0);
    p.destroy();
  });
});

/* ── Gap 3: filter-panel operator editor ── */

describe('PivotTable wiring: filter operator editor', () => {
  it('renders an operator select + value input on a Filters chip', () => {
    const p = new PivotTable<Sale>(host, {
      data: DATA,
      rows: ['region'],
      values: ['amount'],
      filters: [{ field: 'quarter', operator: 'eq', value: 'Q1' }],
      totals: false,
    });
    const zone = host.querySelector('.jects-pivot__zone--filters')!;
    expect(zone.querySelector('.jects-pivot__chip-op')).toBeTruthy();
    expect(zone.querySelector('.jects-pivot__chip-value')).toBeTruthy();
    p.destroy();
  });

  it('does not hardcode notempty: dropping on Filters uses defaultFilterOperator', () => {
    const p = new PivotTable<Sale>(host, {
      data: DATA,
      rows: ['region'],
      values: ['amount'],
      defaultFilterOperator: 'contains',
      totals: false,
    });
    p.moveField('quarter', 'source', 'filters');
    expect(p.getPivotConfig().filters?.[0]?.operator).toBe('contains');
    p.destroy();
  });

  it('choosing an operator + value filters the matrix', () => {
    const p = new PivotTable<Sale>(host, {
      data: DATA,
      rows: ['region'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      filters: [{ field: 'quarter', operator: 'eq', value: 'Q1' }],
      totals: { grand: true, rows: false, columns: false },
    });
    const grandKey = () => p.getResult()!.columnLeaves[0]!.key;
    const grandOf = () => p.getResult()!.matrix[p.getResult()!.matrix.length - 1]!.cells[grandKey()];
    // Q1 rows only: 100 + 50 + 300 = 450.
    expect(grandOf()).toBe(450);

    const zone = host.querySelector('.jects-pivot__zone--filters')!;
    const op = zone.querySelector<HTMLSelectElement>('.jects-pivot__chip-op')!;
    const val = zone.querySelector<HTMLInputElement>('.jects-pivot__chip-value')!;
    // Switch to "ne" Q1 → keep only non-Q1 rows: 200 + 400 = 600.
    op.value = 'ne';
    op.dispatchEvent(new Event('change'));
    const zone2 = host.querySelector('.jects-pivot__zone--filters')!;
    const val2 = zone2.querySelector<HTMLInputElement>('.jects-pivot__chip-value')!;
    val2.value = 'Q1';
    val2.dispatchEvent(new Event('change'));
    expect(grandOf()).toBe(600);
    void val;
    p.destroy();
  });
});
