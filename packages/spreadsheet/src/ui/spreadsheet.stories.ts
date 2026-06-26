/**
 * Usage stories for the Spreadsheet UI. These are framework-free factory
 * functions returning a mounted widget — the docs shell renders them, and they
 * double as copy-paste examples.
 */

import { Spreadsheet } from './spreadsheet.js';
import { createSpreadsheetApi } from './engine.js';
import type { WorkbookModel } from '../contract.js';

/** A blank workbook spreadsheet with the full chrome (toolbar + formula bar + tabs). */
export function basic(host: HTMLElement): Spreadsheet {
  return new Spreadsheet(host, {});
}

/** A spreadsheet seeded with data and formulas. */
export function withData(host: HTMLElement): Spreadsheet {
  const workbook: WorkbookModel = {
    sheets: [
      {
        id: 'sheet-1',
        name: 'Budget',
        rowCount: 50,
        colCount: 8,
        cells: {
          '0,0': { value: 'Item', style: { bold: true } },
          '0,1': { value: 'Cost', style: { bold: true } },
          '1,0': { value: 'Rent' },
          '1,1': { value: 1200, format: { type: 'currency', numberFormat: '#,##0.00' } },
          '2,0': { value: 'Food' },
          '2,1': { value: 450, format: { type: 'currency', numberFormat: '#,##0.00' } },
          '3,0': { value: 'Total', style: { bold: true } },
          '3,1': { formula: 'SUM(B2:B3)', format: { type: 'currency', numberFormat: '#,##0.00' } },
        },
      },
    ],
    activeSheet: 'sheet-1',
    calcMode: 'auto',
  };
  return new Spreadsheet(host, { workbook });
}

/** Driving an externally-constructed engine API (the production seam). */
export function externalEngine(host: HTMLElement): Spreadsheet {
  const api = createSpreadsheetApi();
  api.setCellInput({ sheet: api.getActiveSheet().id, row: 0, col: 0 }, '=1+2*3');
  return new Spreadsheet(host, { api });
}

/** A minimal, chrome-less grid (no toolbar/formula-bar/tabs). */
export function bareGrid(host: HTMLElement): Spreadsheet {
  return new Spreadsheet(host, { toolbar: false, formulaBar: false, sheetTabs: false });
}
