/** Route: spreadsheet. */
import { el, card } from '../shell/dom.js';
import { enterpriseSwap } from '../shell/enterprise.js';
import { genBudgetSheet } from '../shell/data.js';
import { section, Button, Spreadsheet } from '../shell/registry.js';

export function register() {
  section(
    'spreadsheet',
    'Spreadsheet',
    'A formula-driven spreadsheet with live recalc — data validation, conditional formatting, real OOXML XLSX export, named ranges, sort/filter, comments, an embedded chart and cell protection.',
    (grid) => {
      grid.appendChild(card('Spreadsheet — full enterprise workbook (validation · conditional formats · XLSX · named ranges · sort/filter · comments · embedded chart · protection)', (h) => {
        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.5rem;width:100%' });
        const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;flex-wrap:wrap;align-items:center' });
        const host = el('div', { class: 'g-host-grid', style: 'min-height:340px' });
        const statusEl = el('div', { class: 'g-note', style: 'min-height:1.2em' });
        wrap.appendChild(bar);
        wrap.appendChild(host);
        wrap.appendChild(statusEl);
        h.appendChild(wrap);
        const setStatus = (m) => { statusEl.textContent = m; };
        const warn = (label, e) => console.warn('SHEET-DEMO feature failed:', label, e && e.message);

        const ss = new Spreadsheet(host, {
          maxRows: 16,
          sheets: [
            {
              id: 'sales',
              name: 'Sales',
              rowCount: 50,
              colCount: 8,
              cells: {
                '0,0': { value: 'Region', style: { bold: true } },
                '0,1': { value: 'Rep', style: { bold: true } },
                '0,2': { value: 'Status', style: { bold: true } },
                '0,3': { value: 'Units', style: { bold: true } },
                '0,4': { value: 'Revenue', style: { bold: true } },
                '1,0': { value: 'North' }, '1,1': { value: 'Ana' }, '1,2': { value: 'Won' },
                '1,3': { value: 120 }, '1,4': { value: 5400, format: { type: 'currency', numberFormat: '#,##0' } },
                '2,0': { value: 'South' }, '2,1': { value: 'Ben' }, '2,2': { value: 'Open' },
                '2,3': { value: 64 }, '2,4': { value: 2100, format: { type: 'currency', numberFormat: '#,##0' } },
                '3,0': { value: 'East' }, '3,1': { value: 'Cara' }, '3,2': { value: 'Won' },
                '3,3': { value: 210 }, '3,4': { value: 8900, format: { type: 'currency', numberFormat: '#,##0' } },
                '4,0': { value: 'West' }, '4,1': { value: 'Dev' }, '4,2': { value: 'Open' },
                '4,3': { value: 38 }, '4,4': { value: 1500, format: { type: 'currency', numberFormat: '#,##0' } },
                '5,0': { value: 'Central' }, '5,1': { value: 'Eve' }, '5,2': { value: 'Won' },
                '5,3': { value: 155 }, '5,4': { value: 6700, format: { type: 'currency', numberFormat: '#,##0' } },
                '6,0': { value: 'Total', style: { bold: true } },
                '6,3': { formula: 'SUM(D2:D6)', style: { bold: true } },
                '6,4': { formula: 'SUM(E2:E6)', format: { type: 'currency', numberFormat: '#,##0' }, style: { bold: true } },
              },
            },
            {
              id: 'summary',
              name: 'Summary',
              rowCount: 20,
              colCount: 6,
              cells: {
                '0,0': { value: 'Metric', style: { bold: true } },
                '0,1': { value: 'Value', style: { bold: true } },
                '1,0': { value: 'Total revenue (named range)' },
                '1,1': { formula: 'SUM(Revenue)', format: { type: 'currency', numberFormat: '#,##0' } },
                '2,0': { value: 'Average deal' },
                '2,1': { formula: 'AVERAGE(Revenue)', format: { type: 'currency', numberFormat: '#,##0' } },
              },
            },
          ],
        });

        const api = ss.getApi();
        const sheetGrid = ss.getGrid();
        const rng = (top, left, bottom, right) => ({ top, left, bottom, right });

        try { ss.defineName('Revenue', 'Sales!E2:E6'); } catch (e) { warn('defineName', e); }

        try {
          ss.setValidation({ kind: 'list', values: ['Won', 'Open', 'Lost'] }, rng(1, 2, 5, 2));
        } catch (e) { warn('setValidation', e); }
        try {
          ss.on('editRejected', (ev) => setStatus('Edit rejected (' + ev.reason + ')' + (ev.message ? ': ' + ev.message : '')));
        } catch (e) { warn('on editRejected', e); }

        try {
          ss.addConditionalFormat({ kind: 'dataBar', colorToken: '--jects-cmyk-cyan' }, rng(1, 4, 5, 4));
        } catch (e) { warn('addConditionalFormat dataBar', e); }
        try {
          ss.addConditionalFormat(
            { kind: 'cellValue', op: '>=', value: 6000, style: { backgroundToken: '--jects-cmyk-yellow-soft', bold: true } },
            rng(1, 4, 5, 4),
          );
        } catch (e) { warn('addConditionalFormat cellValue', e); }
        try {
          ss.addConditionalFormat(
            { kind: 'colorScale', minToken: '--jects-destructive', midToken: '--jects-warning', maxToken: '--jects-success' },
            rng(1, 3, 5, 3),
          );
        } catch (e) { warn('addConditionalFormat colorScale', e); }

        try { ss.setComment({ row: 0, col: 4 }, 'Net revenue, USD — booked deals only.'); } catch (e) { warn('setComment', e); }

        try { ss.setFrozen({ rows: 1, cols: 0 }); } catch (e) { warn('setFrozen', e); }

        const tb = (text, onClick, variant = 'secondary', icon) => {
          const b = new Button(bar, icon ? { text, icon, variant, size: 'sm' } : { text, variant, size: 'sm' });
          b.el.addEventListener('click', onClick);
          return b;
        };

        tb('Sort by revenue', () => {
          try { ss.sortRange({ column: 4, dir: 'desc' }, rng(1, 0, 5, 4)); setStatus('Sorted rows by Revenue (desc).'); }
          catch (e) { warn('sortRange', e); }
        }, 'outline', 'filter');

        tb('Filter: Won only', () => {
          try { ss.applyFilter(2, (v) => v === 'Won', rng(1, 0, 5, 4)); setStatus('Filtered to Status = Won.'); }
          catch (e) { warn('applyFilter', e); }
        }, 'outline', 'filter');

        tb('Clear filter', () => {
          try { ss.clearFilter(); setStatus('Filter cleared.'); } catch (e) { warn('clearFilter', e); }
        }, 'ghost');

        let chartInserted = false;
        tb('Insert chart', () => {
          if (chartInserted) return;
          try {
            ss.insertChart(rng(0, 0, 5, 4), { type: 'bar' });
            chartInserted = true;
            setStatus('Embedded bar chart inserted from the Region × Revenue range.');
          } catch (e) { warn('insertChart', e); }
        }, 'outline', 'check');

        tb('Export XLSX', () => {
          try {
            const blob = ss.exportXlsxBlob();
            const url = URL.createObjectURL(blob);
            const a = el('a', { href: url, download: 'sales.xlsx' });
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setStatus('Exported sales.xlsx (' + blob.size + ' bytes).');
          } catch (e) { warn('exportXlsxBlob', e); }
        }, 'secondary', 'arrow-down');

        let prot = false;
        tb('Protect sheet', (ev) => {
          prot = !prot;
          try {
            if (prot) {
              ss.setCellsLocked(false, rng(0, 0, 5, 4)); // open the body
              ss.setCellsLocked(true, rng(6, 0, 6, 4));   // lock the totals
              ss.setSheetProtected(true);
              setStatus('Sheet protected — the Total row is locked (editing it is vetoed).');
            } else {
              ss.setSheetProtected(false);
              setStatus('Sheet unprotected.');
            }
          } catch (e) { warn('protection', e); }
          ev.currentTarget?.setAttribute?.('aria-pressed', String(prot));
        }, 'ghost');

        tb('Fill series', () => {
          try {
            api.setValue({ sheet: 'sales', row: 1, col: 6 }, 1);
            api.setValue({ sheet: 'sales', row: 2, col: 6 }, 2);
            sheetGrid.update({});
            ss.fillTo(rng(1, 6, 2, 6), { row: 5, col: 6 });
            setStatus('Filled an arithmetic series (1,2,3,4,5) down column G.');
          } catch (e) { warn('fillTo', e); }
        }, 'ghost');

        enterpriseSwap(bar, host, {
          key: 'spreadsheet',
          count: '~10,000 cells + formulas',
          status: setStatus,
          build: (bigHost) => {
            const budget = genBudgetSheet(700);
            new Spreadsheet(bigHost, {
              maxRows: 28,
              sheets: [{
                id: 'budget',
                name: 'Budget',
                rowCount: budget.rowCount,
                colCount: budget.colCount,
                cells: budget.cells,
              }],
            });
          },
        });

        h.appendChild(el('div', { class: 'g-note', text: 'A live enterprise workbook. The Status column is a validated dropdown (invalid input is vetoed); the Units column carries a red→amber→green color scale and Revenue carries data-bars plus a high-value highlight; E1 has a comment. The named range Revenue feeds =SUM(Revenue) on the Summary tab. Use the toolbar to sort, filter, insert a chart, protect the sheet (the Total row locks), fill a series, and export a real .xlsx.' }));
      }, { block: true }));
    },
    { wide: true },
  );
}
