/** Workflow: Grid → Chart (selection drives the chart). */
import { el, card } from '../shell/dom.js';
import { section, Grid, Chart } from '../shell/registry.js';

export function register() {
  section(
    'flow-data',
    'Grid → Chart',
    'A data Grid and a Chart over ONE row set. Select rows in the grid (checkboxes, or click a row) and the chart plots exactly the selected products across the quarters — driven by the grid’s real selectionChange event. With nothing selected the chart shows every row; select one and it narrows live.',
    (grid) => {
      grid.appendChild(card('Grid selection drives the Chart — the chart plots the selected rows', (h) => {
        const ROWS = [
          { id: 'widget', name: 'Widget', q1: 120, q2: 180, q3: 150, q4: 210 },
          { id: 'gadget', name: 'Gadget', q1: 90, q2: 70, q3: 130, q4: 160 },
          { id: 'gizmo', name: 'Gizmo', q1: 60, q2: 110, q3: 95, q4: 140 },
          { id: 'sprocket', name: 'Sprocket', q1: 200, q2: 150, q3: 175, q4: 120 },
          { id: 'doohickey', name: 'Doohickey', q1: 40, q2: 85, q3: 120, q4: 95 },
        ];
        const QCATS = ['Q1', 'Q2', 'Q3', 'Q4'];

        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.6rem;width:100%' });
        const flow = el('div', { class: 'g-flow' });
        const gridPanel = el('div', { class: 'g-flow__panel' });
        const chartPanel = el('div', { class: 'g-flow__panel' });
        gridPanel.appendChild(el('h4', { text: 'Grid — select rows (checkbox or row click)' }));
        chartPanel.appendChild(el('h4', { text: 'Chart — plots the selected rows' }));
        const gridHost = el('div', { class: 'g-flow-host', style: 'height:300px' });
        const chartHost = el('div', { class: 'g-host-chart' });
        gridPanel.appendChild(gridHost);
        chartPanel.appendChild(chartHost);
        flow.appendChild(gridPanel);
        flow.appendChild(chartPanel);
        const cap = el('div', { class: 'g-note' });
        wrap.appendChild(flow);
        wrap.appendChild(cap);
        h.appendChild(wrap);

        const dataGrid = new Grid(gridHost, {
          data: ROWS,
          selection: 'multi',
          features: { selectionColumn: { headerCheckbox: true }, sort: { multi: false } },
          columns: [
            { field: 'name', header: 'Product', flex: 1, minWidth: 120, sortable: true },
            { field: 'q1', header: 'Q1', type: 'number', width: 70, align: 'end' },
            { field: 'q2', header: 'Q2', type: 'number', width: 70, align: 'end' },
            { field: 'q3', header: 'Q3', type: 'number', width: 70, align: 'end' },
            { field: 'q4', header: 'Q4', type: 'number', width: 70, align: 'end' },
          ],
        });

        const chart = new Chart(chartHost, { type: 'bar', height: 300, legend: true,
          categories: QCATS, series: [] });

        function syncChart() {
          let rows = [];
          try { rows = dataGrid.selection.getSelectedRows() || []; } catch (_) { rows = []; }
          const selected = rows.length > 0;
          const plot = selected ? rows : ROWS;
          chart.update({ categories: QCATS, series: plot.map((r) => ({ name: r.name, data: [r.q1, r.q2, r.q3, r.q4] })) });
          cap.textContent = selected
            ? `Charting ${plot.length} selected product(s): ${plot.map((r) => r.name).join(', ')}. Clear the selection to show all.`
            : `No selection — charting all ${ROWS.length} products. Select rows to filter the chart live.`;
        }
        dataGrid.on('selectionChange', syncChart);
        syncChart();

        window.__JECTS_FLOW_DATA__ = { grid: dataGrid, chart, syncChart, ROWS };
      }, { block: true }));
    },
    { wide: true },
  );
}
