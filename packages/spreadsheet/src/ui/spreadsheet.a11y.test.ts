/**
 * axe-core accessibility suite (Quality Gate Q2). Runs in the real-browser
 * Vitest context (`pnpm test:browser`); excluded from the default jsdom run.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { Spreadsheet } from './spreadsheet.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  host.style.height = '480px';
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Spreadsheet a11y', () => {
  it('has no serious/critical axe violations (full chrome)', async () => {
    const ss = new Spreadsheet(host, {});
    ss.getApi().setCellInput({ sheet: ss.getApi().getActiveSheet().id, row: 0, col: 0 }, 'Hello');
    ss.getGrid().update({});
    await expectNoA11yViolations(host);
    ss.destroy();
  });

  it('has no violations for a bare grid', async () => {
    const ss = new Spreadsheet(host, { toolbar: false, formulaBar: false, sheetTabs: false });
    await expectNoA11yViolations(host);
    ss.destroy();
  });
});
