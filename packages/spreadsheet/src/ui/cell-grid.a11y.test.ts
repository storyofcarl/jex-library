/**
 * axe-core accessibility suite for the composable UI parts (Quality Gate Q2):
 * CellGrid, FormulaBar, SheetTabs. Runs in the real-browser Vitest context
 * (`pnpm test:browser`); excluded from the default jsdom run.
 *
 * Mounts each public component and asserts zero serious/critical violations,
 * following the widgets `*.a11y.test.ts` pattern.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CellGrid } from './cell-grid.js';
import { FormulaBar } from './formula-bar.js';
import { SheetTabs } from './sheet-tabs.js';
import { createSpreadsheetApi, defaultWorkbook } from './engine.js';
import type { SpreadsheetApi } from '../contract.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;
let api: SpreadsheetApi;

beforeEach(() => {
  host = document.createElement('div');
  host.style.height = '480px';
  host.style.width = '640px';
  document.body.appendChild(host);
  api = createSpreadsheetApi(defaultWorkbook());
});
afterEach(() => {
  host.remove();
});

describe('CellGrid a11y', () => {
  it('has no serious/critical axe violations', async () => {
    const grid = new CellGrid(host, { api });
    api.setCellInput({ sheet: api.getActiveSheet().id, row: 0, col: 0 }, 'Hello');
    grid.update({});
    await expectNoA11yViolations(host);
    grid.destroy();
  });

  it('exposes a valid grid > rowgroup > row > gridcell hierarchy', async () => {
    const grid = new CellGrid(host, { api });
    const root = host.querySelector('[role="grid"]') as HTMLElement;
    expect(root).toBeTruthy();
    // Body rows must live inside a rowgroup, not a roleless div.
    const rowgroups = root.querySelectorAll(':scope > [role="rowgroup"]');
    expect(rowgroups.length).toBeGreaterThanOrEqual(1);
    const bodyRow = root.querySelector('[role="rowgroup"] [role="row"] [role="gridcell"]');
    expect(bodyRow).toBeTruthy();
    grid.destroy();
  });

  it('tracks the active cell via aria-activedescendant + roving tabindex', async () => {
    const grid = new CellGrid(host, { api });
    grid.setActive({ row: 1, col: 2 });
    const root = host.querySelector('[role="grid"]') as HTMLElement;
    const adId = root.getAttribute('aria-activedescendant');
    expect(adId).toBeTruthy();
    const activeCell = document.getElementById(adId as string);
    expect(activeCell?.getAttribute('role')).toBe('gridcell');
    expect(activeCell?.getAttribute('data-row')).toBe('1');
    expect(activeCell?.getAttribute('data-col')).toBe('2');
    expect(activeCell?.getAttribute('tabindex')).toBe('0');
    grid.destroy();
  });
});

describe('FormulaBar a11y', () => {
  it('has no serious/critical axe violations', async () => {
    const bar = new FormulaBar(host, { name: 'A1', value: '=SUM(A1:A3)' });
    await expectNoA11yViolations(host);
    bar.destroy();
  });
});

describe('SheetTabs a11y', () => {
  it('has no serious/critical axe violations', async () => {
    api.addSheet('Data');
    const tabs = new SheetTabs(host, { api });
    tabs.update({});
    await expectNoA11yViolations(host);
    tabs.destroy();
  });
});
