/** Workflow: Pivot → Chart dashboard (shared dataset). */
import { el, card } from '../shell/dom.js';
import { section, Button, PivotTable, Chart } from '../shell/registry.js';

export function register() {
  section(
    'flow-analytics',
    'Pivot → Chart dashboard',
    'One source dataset feeds a live Pivot cross-tab AND a Chart. The chart is rendered from the pivot’s CURRENT aggregates (read back via pivot.getResult()) — switch the measure or the row dimension and BOTH the cross-tab and the chart recompute from the same numbers. The chart is never a separate hardcoded series.',
    (grid) => {
      grid.appendChild(card('Pivot ↔ Chart — one dataset, the chart plots the pivot’s aggregates', (h) => {
        const SRC = [];
        const regions = ['West', 'East', 'North', 'South'];
        const products = ['Widget', 'Gadget', 'Gizmo'];
        const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        let seed = 7;
        const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        for (const region of regions) {
          for (const product of products) {
            for (const quarter of quarters) {
              SRC.push({ region, product, quarter,
                amount: 400 + Math.round(rand() * 3600),
                units: 4 + Math.round(rand() * 60) });
            }
          }
        }

        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.6rem;width:100%' });
        const bar = el('div', { class: 'g-flow-toolbar' });
        const flow = el('div', { class: 'g-flow' });
        const pivotPanel = el('div', { class: 'g-flow__panel' });
        const chartPanel = el('div', { class: 'g-flow__panel' });
        pivotPanel.appendChild(el('h4', { text: 'Pivot cross-tab (source of truth)' }));
        chartPanel.appendChild(el('h4', { text: 'Chart (rendered from pivot.getResult())' }));
        const pivotHost = el('div', { class: 'g-flow-host g-flow-host--scroll' });
        const chartHost = el('div', { class: 'g-host-chart' });
        pivotPanel.appendChild(pivotHost);
        chartPanel.appendChild(chartHost);
        flow.appendChild(pivotPanel);
        flow.appendChild(chartPanel);
        const cap = el('div', { class: 'g-note' });
        wrap.appendChild(bar);
        wrap.appendChild(flow);
        wrap.appendChild(cap);
        h.appendChild(wrap);

        const MEASURES = { amount: 'Revenue ($)', units: 'Units' };
        let measure = 'amount';
        let dimension = 'region';

        const pivot = new PivotTable(pivotHost, {
          data: SRC,
          fields: [
            { field: 'region', label: 'Region' },
            { field: 'product', label: 'Product' },
            { field: 'quarter', label: 'Quarter' },
            { field: 'amount', label: 'Revenue', aggregator: 'sum' },
            { field: 'units', label: 'Units', aggregator: 'sum' },
          ],
          rows: [dimension],
          columns: ['quarter'],
          values: [{ field: measure, aggregator: 'sum', label: MEASURES[measure] }],
          mode: 'flat',
          totals: { grand: false, rows: false, columns: false },
        });

        const chart = new Chart(chartHost, { type: 'bar', height: 300, legend: true,
          categories: [], series: [] });

        function chartFromPivot() {
          const res = pivot.getResult();
          if (!res) return;
          const leaves = res.columnLeaves.filter((l) => !l.isTotal);
          const categories = leaves.map((l) => l.path[l.path.length - 1] || l.valueLabel);
          const rows = res.matrix.filter((r) => !r.isTotal && r.depth === 0);
          const series = rows.map((r) => ({
            name: r.headers.filter(Boolean).join(' / ') || '—',
            data: leaves.map((l) => Number(r.cells[l.key] ?? 0)),
          }));
          chart.update({ categories, series });
          cap.textContent = `Chart shows ${series.length} ${dimension}(s) × ${categories.length} quarters of `
            + `${MEASURES[measure]}, computed live from the pivot’s aggregates. Toggle the measure or dimension — the cross-tab re-pivots and the chart redraws from the same numbers.`;
        }
        chartFromPivot();

        const tb = (label, onClick, pressed) => {
          const b = new Button(bar, { text: label, variant: pressed ? 'primary' : 'outline', size: 'sm' });
          b.el.setAttribute('aria-pressed', String(!!pressed));
          b.el.addEventListener('click', onClick);
          return b;
        };
        bar.appendChild(el('span', { class: 'g-note', text: 'Measure:' }));
        const measBtns = {};
        const setMeasure = (m) => {
          measure = m;
          pivot.update({ values: [{ field: measure, aggregator: 'sum', label: MEASURES[measure] }] });
          Object.entries(measBtns).forEach(([k, b]) => {
            const on = k === m; b.el.setAttribute('aria-pressed', String(on));
            b.update ? b.update({ variant: on ? 'primary' : 'outline' }) : 0;
          });
          chartFromPivot();
        };
        measBtns.amount = tb('Revenue', () => setMeasure('amount'), true);
        measBtns.units = tb('Units', () => setMeasure('units'), false);

        bar.appendChild(el('span', { class: 'g-note', text: 'Group rows by:' }));
        const dimBtns = {};
        const setDim = (d) => {
          dimension = d;
          pivot.update({ rows: [dimension] });
          Object.entries(dimBtns).forEach(([k, b]) => {
            const on = k === d; b.el.setAttribute('aria-pressed', String(on));
            b.update ? b.update({ variant: on ? 'primary' : 'outline' }) : 0;
          });
          chartFromPivot();
        };
        dimBtns.region = tb('Region', () => setDim('region'), true);
        dimBtns.product = tb('Product', () => setDim('product'), false);

        window.__JECTS_FLOW_ANALYTICS__ = { pivot, chart, chartFromPivot, setMeasure, setDim };
      }, { block: true }));
    },
    { wide: true },
  );
}
