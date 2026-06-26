import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { register, create, isRegistered } from '@jects/core';
import { PivotTable } from './pivot-table.js';

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

describe('PivotTable: structure', () => {
  it('builds root, config panel, and a composed Grid', () => {
    const p = new PivotTable<Sale>(host, {
      data: DATA,
      rows: ['region'],
      columns: ['quarter'],
      values: [{ field: 'amount', aggregator: 'sum' }],
    });
    const root = host.querySelector('.jects-pivot')!;
    expect(root).toBeTruthy();
    expect(root.querySelector('.jects-pivot__panel')).toBeTruthy();
    // The Grid was composed inside the grid container.
    expect(root.querySelector('.jects-pivot__grid .jects-grid')).toBeTruthy();
    expect(p.getGrid()).not.toBeNull();
    p.destroy();
  });

  it('hides the panel when showPanel is false', () => {
    const p = new PivotTable<Sale>(host, { data: DATA, rows: ['region'], showPanel: false });
    expect(host.querySelector('.jects-pivot__panel')).toBeNull();
    p.destroy();
  });

  it('renders drop zones for each axis + a source list', () => {
    const p = new PivotTable<Sale>(host, { data: DATA });
    expect(host.querySelector('.jects-pivot__zone--rows')).toBeTruthy();
    expect(host.querySelector('.jects-pivot__zone--columns')).toBeTruthy();
    expect(host.querySelector('.jects-pivot__zone--values')).toBeTruthy();
    expect(host.querySelector('.jects-pivot__zone--filters')).toBeTruthy();
    expect(host.querySelector('.jects-pivot__zone--source')).toBeTruthy();
    p.destroy();
  });
});

describe('PivotTable: computation', () => {
  it('computes a result and exposes it via getResult', () => {
    const p = new PivotTable<Sale>(host, {
      data: DATA,
      rows: ['region'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      totals: { grand: true, rows: false, columns: false },
    });
    const result = p.getResult()!;
    expect(result).toBeTruthy();
    const leafKey = result.columnLeaves[0]!.key;
    const west = result.matrix.find((r) => r.headers[0] === 'West')!;
    expect(west.cells[leafKey]).toBe(350);
    p.destroy();
  });

  it('emits beforePivot (vetoable) and pivot events', () => {
    const p = new PivotTable<Sale>(host, { data: DATA, rows: ['region'], values: ['amount'] });
    let pivots = 0;
    let befores = 0;
    p.on('pivot', () => pivots++);
    p.on('beforePivot', () => {
      befores++;
    });
    p.refresh();
    expect(befores).toBeGreaterThan(0);
    expect(pivots).toBeGreaterThan(0);
    p.destroy();
  });

  it('vetoes recompute when a beforePivot handler returns false', () => {
    const p = new PivotTable<Sale>(host, { data: DATA, rows: ['region'], values: ['amount'] });
    const before = p.getResult();
    p.on('beforePivot', () => false);
    let pivoted = false;
    p.on('pivot', () => (pivoted = true));
    p.setAxis('columns', ['quarter']);
    expect(pivoted).toBe(false);
    // result unchanged (no new column field applied).
    expect(p.getResult()).toBe(before);
    p.destroy();
  });
});

describe('PivotTable: axis manipulation', () => {
  it('setAxis reassigns fields and recomputes', () => {
    const p = new PivotTable<Sale>(host, { data: DATA, values: ['amount'] });
    p.setAxis('rows', ['product']);
    const result = p.getResult()!;
    const headers = result.matrix.map((r) => r.headers[0]);
    expect(headers).toContain('A');
    expect(headers).toContain('B');
    p.destroy();
  });

  it('moveField moves a field between axes and updates the panel', () => {
    const p = new PivotTable<Sale>(host, { data: DATA, values: ['amount'] });
    p.moveField('region', 'source', 'rows');
    expect(host.querySelector('.jects-pivot__zone--rows .jects-pivot__chip')).toBeTruthy();
    expect(p.getPivotConfig().rows).toHaveLength(1);
    // move to columns
    p.moveField('region', 'rows', 'columns');
    expect(p.getPivotConfig().rows).toHaveLength(0);
    expect(p.getPivotConfig().columns).toHaveLength(1);
    p.destroy();
  });

  it('a chip remove button detaches the field', () => {
    const p = new PivotTable<Sale>(host, { data: DATA, rows: ['region'], values: ['amount'] });
    const removeBtn = host.querySelector<HTMLButtonElement>(
      '.jects-pivot__zone--rows .jects-pivot__chip-remove',
    )!;
    expect(removeBtn).toBeTruthy();
    removeBtn.click();
    expect(p.getPivotConfig().rows).toHaveLength(0);
    p.destroy();
  });

  it('changing a value chip aggregator recomputes', () => {
    const p = new PivotTable<Sale>(host, {
      data: DATA,
      rows: ['region'],
      values: [{ field: 'amount', aggregator: 'sum' }],
      totals: false,
    });
    const sel = host.querySelector<HTMLSelectElement>(
      '.jects-pivot__zone--values .jects-pivot__chip-agg',
    )!;
    sel.value = 'max';
    sel.dispatchEvent(new Event('change'));
    const result = p.getResult()!;
    const west = result.matrix.find((r) => r.headers[0] === 'West')!;
    expect(west.cells[result.columnLeaves[0]!.key]).toBe(200); // max of West amounts
    p.destroy();
  });
});

describe('PivotTable: data + custom aggregators + export', () => {
  it('setData replaces the dataset and recomputes', () => {
    const p = new PivotTable<Sale>(host, { data: DATA, rows: ['region'], values: ['amount'], totals: false });
    p.setData([{ region: 'North', product: 'A', quarter: 'Q1', amount: 999, units: 1 }]);
    const result = p.getResult()!;
    expect(result.matrix.find((r) => r.headers[0] === 'North')).toBeTruthy();
    p.destroy();
  });

  it('addMathMethod registers a custom aggregator usable by name', () => {
    const p = new PivotTable<Sale>(host, { data: DATA });
    p.addMathMethod('first', (values) => {
      const n = values.map(Number).find((x) => Number.isFinite(x));
      return n ?? null;
    });
    p.update({ rows: ['region'], values: [{ field: 'amount', aggregator: 'first' }], totals: false });
    const result = p.getResult()!;
    const west = result.matrix.find((r) => r.headers[0] === 'West')!;
    expect(west.cells[result.columnLeaves[0]!.key]).toBe(100);
    p.destroy();
  });

  it('exports CSV and Excel XML strings', () => {
    const p = new PivotTable<Sale>(host, {
      data: DATA,
      rows: ['region'],
      columns: ['quarter'],
      values: ['amount'],
    });
    const csv = p.toCsv();
    expect(csv).toContain('West');
    expect(csv).toContain('\r\n');
    const xml = p.toExcelXml();
    expect(xml).toContain('<Worksheet ss:Name="Pivot">');
    p.destroy();
  });
});

describe('PivotTable: factory + lifecycle', () => {
  it('is registered with the factory', () => {
    expect(isRegistered('pivottable')).toBe(true);
    const w = create({ type: 'pivottable', data: DATA, rows: ['region'], values: ['amount'] }, host) as PivotTable;
    expect(w).toBeInstanceOf(PivotTable);
    w.destroy();
  });

  it('destroy() tears down the Grid and is idempotent', () => {
    const p = new PivotTable<Sale>(host, { data: DATA, rows: ['region'], values: ['amount'] });
    expect(p.getGrid()).not.toBeNull();
    p.destroy();
    expect(p.isDestroyed).toBe(true);
    expect(p.getGrid()).toBeNull();
    // second destroy must not throw.
    expect(() => p.destroy()).not.toThrow();
  });

  it('register is a stable export', () => {
    expect(typeof register).toBe('function');
  });
});

describe('PivotTable: keyboard field reassignment (a11y)', () => {
  function key(el: Element, k: string): void {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  }
  function chip(host: HTMLElement, field: string, axis: string): HTMLElement {
    return host.querySelector<HTMLElement>(
      `.jects-pivot__chip[data-field="${field}"][data-axis="${axis}"]`,
    )!;
  }

  it('moves a field between zones with the keyboard alone', () => {
    const p = new PivotTable<Sale>(host, {
      data: DATA,
      rows: ['region'],
      values: [{ field: 'amount', aggregator: 'sum' }],
    });
    // `product` starts in the source list.
    const src = chip(host, 'product', 'source');
    expect(src).toBeTruthy();
    expect(src.getAttribute('aria-grabbed')).toBe('false');

    // Pick it up.
    key(src, 'Enter');
    expect(chip(host, 'product', 'source').getAttribute('aria-grabbed')).toBe('true');

    // Choose a target zone then confirm (KEYBOARD_AXES = rows,columns,values,
    // filters,source; one ArrowDown from 'source' wraps to 'rows').
    key(chip(host, 'product', 'source'), 'ArrowDown');
    key(chip(host, 'product', 'source'), 'Enter');

    // `product` is now a Rows field, reflected in both the panel and the config.
    expect(chip(host, 'product', 'rows')).toBeTruthy();
    expect(host.querySelector('.jects-pivot__chip[data-field="product"][data-axis="source"]')).toBeNull();
    expect(p.getPivotConfig().rows.map((f) => f.field)).toContain('product');
    p.destroy();
  });

  it('Escape cancels a pick-up without moving the field', () => {
    const p = new PivotTable<Sale>(host, { data: DATA, rows: ['region'], values: ['amount'] });
    const src = chip(host, 'product', 'source');
    key(src, 'Enter'); // grab
    key(chip(host, 'product', 'source'), 'ArrowDown'); // target rows
    key(chip(host, 'product', 'source'), 'Escape'); // cancel
    expect(chip(host, 'product', 'source').getAttribute('aria-grabbed')).toBe('false');
    expect(p.getPivotConfig().rows.map((f) => f.field)).not.toContain('product');
    p.destroy();
  });

  it('exposes a polite live region that announces a pick-up', () => {
    const p = new PivotTable<Sale>(host, { data: DATA, rows: ['region'], values: ['amount'] });
    const live = host.querySelector('.jects-pivot__live')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    key(chip(host, 'product', 'source'), 'Enter');
    expect(live.textContent).toContain('grabbed');
    p.destroy();
  });
});
