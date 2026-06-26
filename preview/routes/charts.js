/** Route: charts. */
import { el, card } from '../shell/dom.js';
import { proofPanel } from '../shell/proof-card.js';
import { triggerBtn } from '../shell/export-menu.js';
import { months } from '../shell/data.js';
import { section, Chart } from '../shell/registry.js';

export function register() {
  section('charts', 'Charts', 'Thirteen chart types rendered with the house CMYK data ramp (data-1 … data-8), plus interactive zoom/pan/crosshair, numeric & bubble axes, gradients, a live streaming feed, and PDF export.', (grid) => {
    grid.appendChild(el('p', { class: 'g-lede', style: 'margin-top:0',
      text: 'Scenario: a dashboard’s worth of business charts on one themed data ramp — interactive, streaming-capable, exportable.' }));
    grid.appendChild(proofPanel({ title: 'Charts — at a glance', items: [
      ['Types', 'line · bar · area · pie · scatter · bubble (+more)'],
      ['Axes', 'numeric · time · category'],
      ['Interaction', 'zoom · pan · crosshair · annotations'],
      ['Live', 'streaming data feed'],
      ['Export', 'PDF'],
    ] }));

    const chartHost = () => el('div', { class: 'g-host-chart' });
    const make = (label, config) => card(label, (h) => {
      const host = chartHost();
      h.appendChild(host);
      new Chart(host, { height: 260, ...config });
    }, { block: true });

    grid.appendChild(make('Line', { type: 'line', categories: months, series: [
      { name: 'Revenue', data: [12, 19, 15, 22, 18, 25] }, { name: 'Cost', data: [8, 11, 9, 13, 12, 15] },
    ] }));
    grid.appendChild(make('Spline', { type: 'spline', categories: months, series: [{ name: 'Sessions', data: [30, 45, 38, 60, 52, 70] }] }));
    grid.appendChild(make('Bar', { type: 'bar', categories: months, series: [
      { name: 'A', data: [5, 8, 6, 9, 7, 10] }, { name: 'B', data: [3, 5, 4, 6, 5, 7] },
    ] }));
    grid.appendChild(make('Stacked bar', { type: 'bar', stacked: true, categories: months, series: [
      { name: 'Online', data: [5, 8, 6, 9, 7, 10] }, { name: 'Retail', data: [3, 5, 4, 6, 5, 7] },
    ] }));
    grid.appendChild(make('Horizontal bar', { type: 'horizontalBar', categories: ['North', 'South', 'East', 'West'], series: [{ name: 'Units', data: [40, 25, 33, 18] }] }));
    grid.appendChild(make('Area', { type: 'area', categories: months, series: [{ name: 'Traffic', data: [10, 22, 18, 30, 26, 35] }] }));
    grid.appendChild(make('Spline area', { type: 'splineArea', categories: months, series: [{ name: 'Load', data: [10, 22, 18, 30, 26, 35] }] }));
    grid.appendChild(make('Pie', { type: 'pie', categories: ['Cyan', 'Magenta', 'Yellow', 'Key'], data: [30, 25, 20, 25] }));
    grid.appendChild(make('Donut', { type: 'donut', categories: ['Cyan', 'Magenta', 'Yellow', 'Key'], data: [30, 25, 20, 25], innerRadius: 0.62 }));
    grid.appendChild(make('Radar', { type: 'radar', categories: ['Speed', 'Power', 'Range', 'Agility', 'Defense'], series: [
      { name: 'Alpha', data: [80, 65, 70, 90, 60] }, { name: 'Beta', data: [60, 80, 85, 55, 75] },
    ] }));
    grid.appendChild(make('Scatter', { type: 'scatter', categories: months, series: [{ name: 'Points', data: [12, 5, 18, 9, 22, 14] }] }));
    grid.appendChild(make('Treemap', { type: 'treemap', categories: ['Search', 'Social', 'Direct', 'Email', 'Referral'], data: [50, 30, 20, 12, 8] }));
    grid.appendChild(make('Heatmap', { type: 'heatmap', categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], series: [
      { name: 'wk', data: [], matrix: [[1, 3, 2, 5, 4], [2, 4, 6, 3, 1], [5, 2, 3, 4, 6]] },
    ] }));
    grid.appendChild(make('Combination (bar + line)', { categories: months, series: [
      { name: 'Volume', data: [5, 8, 6, 9, 7, 10], type: 'bar' }, { name: 'Trend', data: [4, 6, 5, 8, 6, 9], type: 'line' },
    ] }));
    grid.appendChild(make('Dual axes', { type: 'line', categories: months, yAxis: [{ title: 'Revenue' }, { title: 'Rate' }], series: [
      { name: 'Revenue', data: [120, 190, 150, 220, 180, 250], axis: 'left' },
      { name: 'Conversion %', data: [2.1, 3.4, 2.8, 4.0, 3.2, 4.6], axis: 'right' },
    ] }));

    /* ── NEW parity features ──────────────────────────────────────────── */

    grid.appendChild(make('Bubble', { type: 'bubble', xAxis: { type: 'linear' }, yAxis: { title: 'Margin %' }, series: [
      { name: 'Segments', points: [
        { x: 12, y: 8, size: 30 }, { x: 28, y: 22, size: 90 }, { x: 45, y: 15, size: 55 },
        { x: 62, y: 30, size: 120 }, { x: 80, y: 19, size: 70 }, { x: 95, y: 27, size: 40 },
      ] },
    ] }));

    grid.appendChild(make('Numeric X scatter', { type: 'scatter', xAxis: { type: 'linear', title: 'Latency (ms)' }, yAxis: { title: 'Throughput' }, series: [
      { name: 'Samples', points: [
        { x: 5, y: 40 }, { x: 18, y: 32 }, { x: 33, y: 55 }, { x: 51, y: 47 },
        { x: 74, y: 68 }, { x: 96, y: 61 }, { x: 120, y: 80 },
      ] },
    ] }));

    grid.appendChild(make('Interactive (zoom · pan · crosshair)', {
      type: 'line', categories: months,
      series: [{ name: 'Revenue', data: [120, 190, 150, 220, 180, 250] }],
      zoom: { type: 'x', wheel: true, drag: true },
      pan: true,
      crosshair: { x: true, y: true, snap: true },
      annotations: [{ value: 200, axis: 'y', label: 'Target', color: '#e2477f' }],
      dataLabels: { show: true },
    }));

    grid.appendChild(make('Gradient area', { type: 'area', categories: months, series: [
      { name: 'Flow', data: [10, 22, 18, 30, 26, 35], gradient: { direction: 'vertical', from: '#19b6c4', to: 'rgba(25,182,196,0.05)' } },
    ] }));

    grid.appendChild(card('Streaming (live feed)', (h) => {
      const host = chartHost();
      h.appendChild(host);
      const WINDOW = 24; // grow up to this length, then slide (shift) the window
      const seed = [8, 12, 9, 14, 11, 16];
      const chart = new Chart(host, { height: 260, type: 'spline', categories: months.slice(), series: [{ name: 'Live', data: seed.slice() }] });
      let n = seed.length;
      let phase = seed.length;
      const id = setInterval(() => {
        if (!host.isConnected) { clearInterval(id); return; } // demo cleanup — no leak
        try {
          const next = 12 + Math.round(8 * Math.sin(phase / 2) + (Math.random() * 6 - 3));
          chart.addPoint(0, next, { shift: n >= WINDOW });
          if (n < WINDOW) n += 1;
          phase += 1;
        } catch (e) { console.warn('CHART-DEMO streaming failed:', e && e.message); clearInterval(id); }
      }, 1000);
    }, { block: true }));

    grid.appendChild(card('PDF export', (h) => {
      const host = chartHost();
      h.appendChild(host);
      const chart = new Chart(host, { height: 220, type: 'bar', categories: months, series: [
        { name: 'Revenue', data: [12, 19, 15, 22, 18, 25] },
      ] });
      h.appendChild(triggerBtn('Export PDF', async () => {
        try {
          const blob = await chart.pdf();
          const url = URL.createObjectURL(blob);
          const a = el('a', { href: url, download: 'chart.pdf' });
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) { console.warn('CHART-DEMO pdf export failed:', e && e.message); }
      }));
    }, { block: true }));
  }, { wide: false });
}
