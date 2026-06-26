/**
 * Accessibility (axe-core) suite for PivotTable — runs in real Chromium via
 * `pnpm test:browser`. Asserts zero serious/critical violations on the config
 * panel + the composed Grid (Quality Gate Q2).
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { PivotTable } from './pivot-table.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

interface Sale extends Record<string, unknown> {
  region: string;
  product: string;
  quarter: string;
  amount: number;
  units: number;
}

const DATA: Sale[] = [
  { region: 'West', product: 'A', quarter: 'Q1', amount: 100, units: 1 },
  { region: 'West', product: 'B', quarter: 'Q2', amount: 200, units: 2 },
  { region: 'East', product: 'A', quarter: 'Q1', amount: 300, units: 3 },
  { region: 'East', product: 'B', quarter: 'Q2', amount: 400, units: 4 },
];

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '600px';
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('PivotTable a11y', () => {
  it('config panel + grid have no serious/critical violations', async () => {
    const p = new PivotTable<Sale>(host, {
      data: DATA,
      rows: ['region', 'product'],
      columns: ['quarter'],
      values: [{ field: 'amount', aggregator: 'sum' }],
    });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await expectNoA11yViolations(host);
    p.destroy();
  });

  it('panel exposes labelled grouping + listbox roles', async () => {
    const p = new PivotTable<Sale>(host, { data: DATA, rows: ['region'], values: ['amount'] });
    const panel = host.querySelector('.jects-pivot__panel')!;
    expect(panel.getAttribute('role')).toBe('group');
    expect(panel.getAttribute('aria-label')).toBeTruthy();
    const zones = host.querySelectorAll('.jects-pivot__zone[role="list"]');
    expect(zones.length).toBeGreaterThan(0);
    for (const z of Array.from(zones)) {
      expect(z.getAttribute('aria-label')).toBeTruthy();
    }
    await expectNoA11yViolations(host);
    p.destroy();
  });
});
