/** Route: pivot. */
import { el, card } from '../shell/dom.js';
import { proofPanel } from '../shell/proof-card.js';
import { exportMenu } from '../shell/export-menu.js';
import { enterpriseSwap } from '../shell/enterprise.js';
import { sales, genPivotRecords } from '../shell/data.js';
import { section, Button, PivotTable, AggregatorRegistry } from '../shell/registry.js';

export function register() {
  section(
    'pivot',
    'Pivot',
    'A drag-and-drop pivot table that aggregates a flat dataset into a cross-tab — conditional formatting, collapsible groups, filter operator editor, custom aggregators, tree/flat modes and OOXML XLSX export.',
    (grid) => {
      grid.appendChild(el('p', { class: 'g-lede', style: 'margin-top:0',
        text: 'Scenario: a flat sales feed collapsed into a cross-tab — drag dimensions and measures, format the cells, then export the cube.' }));
      grid.appendChild(proofPanel({ title: 'Pivot — at a glance', items: [
        ['Model', 'dimensions · measures · aggregations'],
        ['Aggregators', 'built-in + custom'],
        ['Layout', 'tree / flat + collapsible groups'],
        ['Cells', 'conditional formatting + filter editor'],
        ['Export', 'OOXML XLSX'],
      ] }));

      grid.appendChild(card('PivotTable — enterprise (data-bar conditional format · collapsible groups · filter operator editor · multi-value + custom aggregator · tree/flat · OOXML XLSX export)', (h) => {
        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.5rem;width:100%' });
        const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;flex-wrap:wrap;align-items:center' });
        const host = el('div', { class: 'g-host-grid' });
        const statusEl = el('div', { class: 'g-note', style: 'min-height:1.2em' });
        wrap.appendChild(bar);
        wrap.appendChild(host);
        wrap.appendChild(statusEl);
        h.appendChild(wrap);
        const setStatus = (m) => { statusEl.textContent = m; };
        const warn = (label, e) => console.warn('PIVOT-DEMO feature failed:', label, e && e.message);

        const aggregators = new AggregatorRegistry();
        try {
          aggregators.add('avgTicket', (values) => {
            const nums = values.map(Number).filter((n) => Number.isFinite(n));
            return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
          });
        } catch (e) { warn('aggregator registry', e); }

        const pivot = new PivotTable(host, {
          aggregators,
          data: sales,
          fields: [
            { field: 'region', label: 'Region' },
            { field: 'product', label: 'Product' },
            { field: 'quarter', label: 'Quarter' },
            { field: 'amount', label: 'Amount', aggregator: 'sum' },
            { field: 'units', label: 'Units', aggregator: 'sum' },
          ],
          rows: ['region', 'product'],
          columns: ['quarter'],
          values: [
            { field: 'amount', aggregator: 'sum', label: 'Revenue' },
            { field: 'amount', aggregator: 'avgTicket', label: 'Avg ticket' },
          ],
          filters: [{ field: 'region', operator: 'in', values: ['West', 'East', 'North'] }],
          defaultFilterOperator: 'notempty',
          mode: 'tree',
          totals: { grand: true, rows: true, columns: true },
          numberFormat: { locale: 'en-US', style: 'currency', currency: 'USD', maximumFractionDigits: 0 },
          conditionalFormat: [
            { kind: 'dataBar', color: 'var(--jex-color-accent, #6366f1)', field: 'amount' },
            { kind: 'colorScale', min: '#eef2ff', max: '#c7d2fe', field: 'amount' },
          ],
          cellTemplate: ({ value, leaf }) => {
            const n = value == null ? '—' : Math.round(value).toLocaleString('en-US');
            return leaf.isTotal ? `Σ ${n}` : n;
          },
        });

        const tb = (text, onClick, variant = 'secondary', icon) => {
          const b = new Button(bar, icon ? { text, icon, variant, size: 'sm' } : { text, variant, size: 'sm' });
          b.el.addEventListener('click', onClick);
          return b;
        };

        let allCollapsed = false;
        tb('Collapse all', () => {
          try {
            const res = pivot.getResult();
            const topKeys = (res ? res.matrix : [])
              .filter((r) => r.collapsible && r.depth === 0 && r.nodeKey)
              .map((r) => r.nodeKey);
            allCollapsed = !allCollapsed;
            topKeys.forEach((k) => pivot.toggleNode('rows', k, allCollapsed));
            setStatus(allCollapsed
              ? `Collapsed ${topKeys.length} region group(s). Collapsed keys: ${pivot.getCollapsed('rows').length}.`
              : 'Expanded all region groups.');
          } catch (e) { warn('toggleNode', e); }
        }, 'outline', 'chevron-down');

        let flat = false;
        tb('Tree / flat', () => {
          try { flat = !flat; pivot.update({ mode: flat ? 'flat' : 'tree' }); setStatus(`Layout: ${flat ? 'flat' : 'tree'}.`); }
          catch (e) { warn('mode toggle', e); }
        }, 'outline', 'menu');

        exportMenu(bar, [
          { label: '.xlsx (OOXML)', onClick: () => {
            try { pivot.exportXlsx('pivot.xlsx'); setStatus('Exported pivot.xlsx (OOXML).'); }
            catch (e) { warn('exportXlsx', e); }
          } },
          { label: '.xls (legacy)', onClick: () => {
            try { pivot.exportXls('pivot.xls'); setStatus('Exported pivot.xls (legacy).'); }
            catch (e) { warn('exportXls', e); }
          } },
        ], { variant: 'outline' });

        enterpriseSwap(bar, host, {
          key: 'pivot',
          count: '100,000 source records',
          status: setStatus,
          build: (bigHost) => {
            const records = genPivotRecords(100_000);
            new PivotTable(bigHost, {
              data: records,
              fields: [
                { field: 'region', label: 'Region' },
                { field: 'product', label: 'Product' },
                { field: 'channel', label: 'Channel' },
                { field: 'quarter', label: 'Quarter' },
                { field: 'amount', label: 'Amount', aggregator: 'sum' },
                { field: 'units', label: 'Units', aggregator: 'sum' },
              ],
              rows: ['region', 'product'],
              columns: ['quarter'],
              values: [
                { field: 'amount', aggregator: 'sum', label: 'Revenue' },
                { field: 'amount', aggregator: 'average', label: 'Avg deal' },
              ],
              mode: 'tree',
              totals: { grand: true, rows: true, columns: true },
              numberFormat: { locale: 'en-US', style: 'currency', currency: 'USD', maximumFractionDigits: 0 },
            });
          },
        });

        h.appendChild(el('div', { class: 'g-note', text: 'Region × Quarter cross-tab: Revenue (data-bar + color-scale conditional format) and an Avg-ticket column from a custom aggregator. Use the row ▾ toggles (or "Collapse all") to fold Region groups, the Filters chip’s operator/value editor to filter, "Tree / flat" to relayout, and "Export .xlsx" for a true OOXML workbook. Drag the field chips between zones to re-pivot live.' }));
      }, { block: true }));
    },
    { wide: true },
  );
}
