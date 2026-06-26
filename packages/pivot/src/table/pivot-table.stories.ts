/**
 * PivotTable usage stories / docs examples.
 *
 * These are framework-free factory functions returning a configured
 * {@link PivotTable}. The docs shell mounts them into a host element.
 */

import { PivotTable } from './pivot-table.js';
import { makeNumberFormat } from '../engine/index.js';

interface Sale extends Record<string, unknown> {
  region: string;
  product: string;
  quarter: string;
  amount: number;
  units: number;
}

const SALES: Sale[] = [
  { region: 'West', product: 'Widget', quarter: 'Q1', amount: 1200, units: 12 },
  { region: 'West', product: 'Widget', quarter: 'Q2', amount: 1800, units: 18 },
  { region: 'West', product: 'Gadget', quarter: 'Q1', amount: 600, units: 4 },
  { region: 'East', product: 'Widget', quarter: 'Q1', amount: 2400, units: 24 },
  { region: 'East', product: 'Gadget', quarter: 'Q2', amount: 900, units: 6 },
  { region: 'North', product: 'Gadget', quarter: 'Q1', amount: 1500, units: 10 },
];

/** Basic cross-tab: region rows × quarter columns, sum of amount. */
export function basic(host: HTMLElement): PivotTable<Sale> {
  return new PivotTable<Sale>(host, {
    data: SALES,
    rows: ['region'],
    columns: ['quarter'],
    values: [{ field: 'amount', aggregator: 'sum' }],
  });
}

/** Multi-level tree mode with subtotals + grand totals. */
export function treeWithSubtotals(host: HTMLElement): PivotTable<Sale> {
  return new PivotTable<Sale>(host, {
    data: SALES,
    rows: ['region', 'product'],
    columns: ['quarter'],
    values: [{ field: 'amount', aggregator: 'sum' }],
    mode: 'tree',
    totals: { grand: true, rows: true, columns: true },
  });
}

/** Locale currency formatting + multiple value fields + average aggregator. */
export function currencyAndAverages(host: HTMLElement): PivotTable<Sale> {
  return new PivotTable<Sale>(host, {
    data: SALES,
    rows: ['product'],
    columns: ['region'],
    values: [
      { field: 'amount', aggregator: 'sum', label: 'Revenue' },
      { field: 'units', aggregator: 'average', label: 'Avg Units' },
    ],
    numberFormat: { locale: 'en-US', style: 'currency', currency: 'USD', maximumFractionDigits: 0 },
  });
}

/** Custom aggregator (range) registered via addMathMethod. */
export function customAggregator(host: HTMLElement): PivotTable<Sale> {
  const p = new PivotTable<Sale>(host, { data: SALES });
  p.addMathMethod('range', (values) => {
    const nums = values.map(Number).filter((n) => Number.isFinite(n));
    return nums.length ? Math.max(...nums) - Math.min(...nums) : null;
  });
  p.update({
    rows: ['region'],
    values: [{ field: 'amount', aggregator: 'range', label: 'Amount Range' }],
  });
  return p;
}

/** Custom cell template highlighting large values. */
export function customCellTemplate(host: HTMLElement): PivotTable<Sale> {
  const fmt = makeNumberFormat({ locale: 'en-US', maximumFractionDigits: 0 });
  return new PivotTable<Sale>(host, {
    data: SALES,
    rows: ['region'],
    columns: ['quarter'],
    values: [{ field: 'amount', aggregator: 'sum' }],
    cellTemplate: ({ value, el }) => {
      el.textContent = fmt(value);
      if ((value ?? 0) >= 2000) el.style.fontWeight = 'var(--jects-font-weight-bold)';
      return undefined;
    },
  });
}

export default { basic, treeWithSubtotals, currencyAndAverages, customAggregator, customCellTemplate };
