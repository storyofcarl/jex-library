/**
 * Workflow: Analytics Workspace — a flagship, multi-pane operational analytics
 * app built from FOUR Jects modules over ONE shared dataset:
 *
 *   - Pivot  (center)  — the cross-tab "source of truth" cube.
 *   - Chart  (right)   — bound to the Pivot's CURRENT aggregates (pivot.getResult()).
 *   - KPIs   (top)     — total / average / top region / growth, computed from the data.
 *   - Sheet  (bottom)  — a tiny seeded "forecast model" workbook (cells + a =SUM).
 *
 * The command bar carries the real cross-interaction: switching the active
 * MEASURE (Revenue ↔ Units) or the row DIMENSION (Region ↔ Product ↔ Channel)
 * re-pivots the cube via the engine's `update()` API and redraws the Chart from
 * the same numbers via `chart.update({ categories, series })`. Switching the
 * chart TYPE (bar ↔ line ↔ area) re-renders the chart only.
 *
 * This module is self-contained: it does its own `ensureCss` + `await import`
 * of every package (try/catch per module → a `.g-note` on failure, never blank),
 * because it is not wired into the registry's SECTION_LOADERS.
 */
import { el } from '../shell/dom.js';
import { section, ensureCss } from '../shell/registry.js';

/* ── shared operational dataset (deterministic, ~60 rows) ──────────────────
   region × product × channel × quarter, with amount + units measures. */
function buildDataset() {
  const regions = ['West', 'East', 'North', 'South', 'Central'];
  const products = ['Widget', 'Gadget', 'Gizmo'];
  const channels = ['Online', 'Retail', 'Partner'];
  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  let seed = 1337;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const rows = [];
  for (const region of regions) {
    for (const product of products) {
      // one record per region×product, assigned a channel + a quarter so the
      // cube has every quarter populated and dimensions cross cleanly.
      for (let q = 0; q < quarters.length; q++) {
        rows.push({
          region,
          product,
          channel: channels[(rows.length) % channels.length],
          quarter: quarters[q],
          amount: 600 + Math.round(rand() * 5400),
          units: 6 + Math.round(rand() * 70),
        });
      }
    }
  }
  return rows;
}

const MEASURES = { amount: 'Revenue', units: 'Units' };
const DIMENSIONS = { region: 'Region', product: 'Product', channel: 'Channel' };

function money(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
}

/* ── KPI computation from the shared data ─────────────────────────────────── */
function computeKpis(data) {
  const total = data.reduce((a, r) => a + r.amount, 0);
  const avg = data.length ? total / data.length : 0;
  // total revenue per region → top region.
  const byRegion = {};
  for (const r of data) byRegion[r.region] = (byRegion[r.region] || 0) + r.amount;
  let topRegion = '—', topVal = -Infinity;
  for (const [k, v] of Object.entries(byRegion)) if (v > topVal) { topVal = v; topRegion = k; }
  // growth Q4 vs Q1 across the whole dataset.
  const q = (name) => data.filter((r) => r.quarter === name).reduce((a, r) => a + r.amount, 0);
  const q1 = q('Q1'), q4 = q('Q4');
  const growth = q1 ? ((q4 - q1) / q1) * 100 : 0;
  return { total, avg, topRegion, topVal, growth, regionCount: Object.keys(byRegion).length };
}

export function register() {
  section(
    'analytics-workspace',
    'Analytics Workspace',
    'A flagship operational analytics app — KPIs, a Pivot cube, a live Chart and a forecast spreadsheet, all driven by one shared dataset and a single command bar.',
    (grid) => {
      // Defer the whole build so we can await dynamic imports per module.
      const root = el('div', { style: 'width:100%' });
      grid.appendChild(root);

      (async () => {
        const data = buildDataset();

        /* ── lazy-load every engine; each failure degrades to a note ──────── */
        let PivotTable = null, Chart = null, Grid = null, Spreadsheet = null;
        const loadNotes = [];
        async function load(pkg, spec, pick) {
          try {
            ensureCss(pkg);
            const m = await import(/* @vite-ignore */ spec);
            return pick(m);
          } catch (e) {
            loadNotes.push(pkg + ': ' + (e && e.message ? e.message : String(e)));
            return null;
          }
        }
        [PivotTable, Chart, Grid, Spreadsheet] = await Promise.all([
          load('pivot', '@jects/pivot', (m) => m.PivotTable),
          load('charts', '@jects/charts', (m) => m.Chart),
          load('grid', '@jects/grid', (m) => m.Grid),
          load('spreadsheet', '@jects/spreadsheet', (m) => m.Spreadsheet),
        ]);

        if (loadNotes.length) {
          root.appendChild(el('div', { class: 'g-note',
            style: 'color:oklch(var(--jects-destructive))',
            text: 'Some modules failed to load: ' + loadNotes.join(' · ') }));
        }

        /* ── hero band ────────────────────────────────────────────────────── */
        const hero = el('div', { class: 'jects-module-hero' }, [
          el('h3', { text: 'Regional sales — operational workspace' }),
          el('p', { text: 'One dataset of ' + data.length + ' sales records flows into every pane. '
            + 'The Pivot is the cube of record; the Chart plots the Pivot’s live aggregates; the KPIs and forecast read the same numbers.' }),
        ]);
        root.appendChild(hero);

        /* ── KPI strip (computed) ─────────────────────────────────────────── */
        const k = computeKpis(data);
        const kpiStrip = el('div', { class: 'jects-kpi-strip', style: 'margin-bottom:.85rem' });
        const kpi = (value, label) => el('div', { class: 'jects-kpi' }, [
          el('div', { class: 'jects-kpi__value', text: value }),
          el('div', { class: 'jects-kpi__label', text: label }),
        ]);
        kpiStrip.appendChild(kpi(money(k.total), 'Total revenue'));
        kpiStrip.appendChild(kpi(money(k.avg), 'Average / record'));
        kpiStrip.appendChild(kpi(k.topRegion + ' · ' + money(k.topVal), 'Top region'));
        const growthChip = el('span', { class: 'jects-status-chip',
          'data-tone': k.growth >= 0 ? 'ok' : 'risk',
          text: (k.growth >= 0 ? '▲ ' : '▼ ') + k.growth.toFixed(1) + '%' });
        const growthCard = el('div', { class: 'jects-kpi' }, [
          el('div', { class: 'jects-kpi__value' }, [growthChip]),
          el('div', { class: 'jects-kpi__label', text: 'Growth (Q4 vs Q1)' }),
        ]);
        kpiStrip.appendChild(growthCard);
        root.appendChild(kpiStrip);

        /* ── app shell: command bar + left wells + center pivot + right chart + bottom sheet ── */
        const shell = el('div', { class: 'jects-app-shell',
          style: 'grid-template-columns: 230px 1fr 420px; '
            + 'grid-template-rows: auto 420px 260px; '
            + 'grid-template-areas: "bar bar bar" "wells pivot chart" "sheet sheet sheet";' });
        root.appendChild(shell);

        /* command bar (cross-interaction controls) */
        const bar = el('div', { class: 'jects-commandbar', style: 'grid-area:bar' });
        bar.appendChild(el('span', { class: 'jects-commandbar__title', text: 'Sales analytics' }));
        shell.appendChild(bar);

        /* left field wells */
        const wells = el('div', { class: 'jects-app-pane jects-app-pane--muted jects-inspector',
          style: 'grid-area:wells' });
        shell.appendChild(wells);

        /* center pivot */
        const pivotPane = el('div', { class: 'jects-app-pane', style: 'grid-area:pivot;padding:.5rem' });
        const pivotHost = el('div', { style: 'width:100%;height:100%;min-height:360px;overflow:auto' });
        pivotPane.appendChild(pivotHost);
        shell.appendChild(pivotPane);

        /* right chart */
        const chartPane = el('div', { class: 'jects-app-pane jects-app-pane--muted',
          style: 'grid-area:chart;display:flex;flex-direction:column;padding:.6rem' });
        chartPane.appendChild(el('h4', { style: 'margin:.1rem 0 .5rem;font-size:var(--jects-font-size-sm);'
          + 'color:oklch(var(--jects-muted-foreground));text-transform:uppercase;letter-spacing:.04em',
          text: 'Chart — from pivot.getResult()' }));
        const chartHost = el('div', { style: 'width:100%;height:320px' });
        chartPane.appendChild(chartHost);
        const chartCap = el('div', { class: 'g-note', style: 'margin-top:.5rem' });
        chartPane.appendChild(chartCap);
        shell.appendChild(chartPane);

        /* bottom forecast spreadsheet */
        const sheetPane = el('div', { class: 'jects-app-pane', style: 'grid-area:sheet;display:flex;flex-direction:column;padding:.6rem' });
        sheetPane.appendChild(el('h4', { style: 'margin:.1rem 0 .5rem;font-size:var(--jects-font-size-sm);'
          + 'color:oklch(var(--jects-muted-foreground));text-transform:uppercase;letter-spacing:.04em',
          text: 'Forecast model — live =SUM' }));
        const sheetHost = el('div', { style: 'width:100%;flex:1;min-height:180px;overflow:auto' });
        sheetPane.appendChild(sheetHost);
        shell.appendChild(sheetPane);

        /* ── state for the cross-interaction ──────────────────────────────── */
        let measure = 'amount';
        let dimension = 'region';
        let chartType = 'bar';

        /* ── Pivot (center) — the cube of record ──────────────────────────── */
        let pivot = null;
        if (PivotTable) {
          try {
            pivot = new PivotTable(pivotHost, {
              data,
              fields: [
                { field: 'region', label: 'Region' },
                { field: 'product', label: 'Product' },
                { field: 'channel', label: 'Channel' },
                { field: 'quarter', label: 'Quarter' },
                { field: 'amount', label: 'Revenue', aggregator: 'sum' },
                { field: 'units', label: 'Units', aggregator: 'sum' },
              ],
              rows: [dimension],
              columns: ['quarter'],
              values: [{ field: measure, aggregator: 'sum', label: MEASURES[measure] }],
              mode: 'tree',
              totals: { grand: true, rows: true, columns: true },
              numberFormat: { locale: 'en-US', maximumFractionDigits: 0 },
              conditionalFormat: [
                { kind: 'dataBar', color: 'var(--jects-cmyk-cyan, #19b6c4)', field: 'amount' },
              ],
            });
          } catch (e) {
            pivotHost.appendChild(el('div', { class: 'g-note', text: 'Pivot failed: ' + (e && e.message) }));
          }
        } else {
          pivotHost.appendChild(el('div', { class: 'g-note', text: 'Pivot module unavailable.' }));
        }

        /* ── Chart (right) — bound to the pivot’s current aggregates ──────── */
        let chart = null;
        if (Chart) {
          try {
            chart = new Chart(chartHost, { type: chartType, height: 320, legend: true,
              categories: [], series: [] });
          } catch (e) {
            chartHost.appendChild(el('div', { class: 'g-note', text: 'Chart failed: ' + (e && e.message) }));
          }
        } else {
          chartHost.appendChild(el('div', { class: 'g-note', text: 'Chart module unavailable.' }));
        }

        /* Read the pivot’s live result and drive the chart from THE SAME numbers. */
        function chartFromPivot() {
          if (!chart) return;
          let categories = [];
          let series = [];
          if (pivot && typeof pivot.getResult === 'function') {
            const res = pivot.getResult();
            if (res) {
              const leaves = (res.columnLeaves || []).filter((l) => !l.isTotal);
              categories = leaves.map((l) => (l.path && l.path[l.path.length - 1]) || l.valueLabel || '');
              const rows = (res.matrix || []).filter((r) => !r.isTotal && r.depth === 0);
              series = rows.map((r) => ({
                name: (r.headers || []).filter(Boolean).join(' / ') || '—',
                data: leaves.map((l) => Number((r.cells && r.cells[l.key]) ?? 0)),
              }));
            }
          }
          // Fallback: if the pivot is unavailable, aggregate the raw data ourselves
          // so the chart is never blank.
          if (!series.length) {
            const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
            categories = quarters;
            const groups = {};
            for (const row of data) {
              const key = row[dimension];
              (groups[key] || (groups[key] = {}));
              groups[key][row.quarter] = (groups[key][row.quarter] || 0) + row[measure];
            }
            series = Object.entries(groups).map(([name, byQ]) => ({
              name, data: quarters.map((qq) => byQ[qq] || 0),
            }));
          }
          try {
            chart.update({ type: chartType, categories, series });
          } catch (e) {
            console.warn('ANALYTICS-WORKSPACE chart.update failed:', e && e.message);
          }
          chartCap.textContent = 'Plotting ' + series.length + ' ' + DIMENSIONS[dimension].toLowerCase()
            + '(s) × ' + categories.length + ' quarters of ' + MEASURES[measure]
            + ', computed live from the pivot cube.';
        }
        chartFromPivot();

        /* ── command-bar controls (the real cross-interaction) ────────────── */
        const groupBtn = (label, on, onClick) => {
          const b = el('button', { type: 'button',
            class: 'jects-status-chip',
            'data-tone': on ? 'ok' : '',
            'aria-pressed': String(on),
            style: 'cursor:pointer;border:1px solid oklch(var(--jects-border));'
              + (on ? '' : 'background:var(--jects-surface-2)'),
            text: label });
          b.addEventListener('click', onClick);
          return b;
        };

        function rebuildBar() {
          // wipe the controls (keep the title)
          [...bar.querySelectorAll('[data-ctl]')].forEach((n) => n.remove());
          const add = (node) => { node.setAttribute('data-ctl', ''); bar.appendChild(node); };

          add(el('span', { class: 'g-note', text: 'Measure:', style: 'margin-left:.4rem' }));
          for (const [m, lbl] of Object.entries(MEASURES)) {
            add(groupBtn(lbl, measure === m, () => setMeasure(m)));
          }
          add(el('span', { class: 'g-note', text: 'Group by:', style: 'margin-left:.5rem' }));
          for (const [d, lbl] of Object.entries(DIMENSIONS)) {
            add(groupBtn(lbl, dimension === d, () => setDimension(d)));
          }
          add(el('span', { class: 'g-note', text: 'Chart:', style: 'margin-left:.5rem' }));
          for (const t of ['bar', 'line', 'area']) {
            add(groupBtn(t, chartType === t, () => setChartType(t)));
          }
        }

        function setMeasure(m) {
          measure = m;
          if (pivot) {
            try { pivot.update({ values: [{ field: measure, aggregator: 'sum', label: MEASURES[measure] }] }); }
            catch (e) { console.warn('ANALYTICS-WORKSPACE pivot measure update failed:', e && e.message); }
          }
          chartFromPivot();
          rebuildBar();
        }
        function setDimension(d) {
          dimension = d;
          if (pivot) {
            try { pivot.update({ rows: [dimension] }); }
            catch (e) { console.warn('ANALYTICS-WORKSPACE pivot rows update failed:', e && e.message); }
          }
          chartFromPivot();
          rebuildBar();
        }
        function setChartType(t) {
          chartType = t;
          chartFromPivot();
          rebuildBar();
        }
        rebuildBar();

        /* ── left field wells (mirrors the pivot config, live labels) ─────── */
        function renderWells() {
          wells.replaceChildren();
          const wellGroup = (title, chips) => {
            const box = el('div', { style: 'margin-bottom:.85rem' });
            box.appendChild(el('h4', { text: title }));
            const row = el('div', { style: 'display:flex;flex-wrap:wrap;gap:.35rem' });
            for (const c of chips) {
              row.appendChild(el('span', { class: 'jects-status-chip', 'data-tone': c.tone || '', text: c.text }));
            }
            box.appendChild(row);
            return box;
          };
          wells.appendChild(wellGroup('Rows', [{ text: DIMENSIONS[dimension], tone: 'ok' }]));
          wells.appendChild(wellGroup('Columns', [{ text: 'Quarter' }]));
          wells.appendChild(wellGroup('Measure', [{ text: MEASURES[measure], tone: 'ok' }]));
          wells.appendChild(wellGroup('Available fields',
            Object.values(DIMENSIONS).concat(['Quarter']).map((t) => ({ text: t }))));
        }
        // re-render wells whenever state changes by wrapping the setters.
        const _sm = setMeasure, _sd = setDimension;
        setMeasure = (m) => { _sm(m); renderWells(); };
        setDimension = (d) => { _sd(d); renderWells(); };
        renderWells();

        /* ── bottom: forecast spreadsheet (seeded; one =SUM) ──────────────── */
        if (Spreadsheet) {
          try {
            const fmt = { type: 'currency', numberFormat: '#,##0' };
            new Spreadsheet(sheetHost, {
              maxRows: 8,
              sheets: [{
                id: 'forecast',
                name: 'Forecast',
                rowCount: 8,
                colCount: 5,
                cells: {
                  '0,0': { value: 'Quarter', style: { bold: true } },
                  '0,1': { value: 'Actual', style: { bold: true } },
                  '0,2': { value: 'Growth %', style: { bold: true } },
                  '0,3': { value: 'Forecast', style: { bold: true } },
                  // seed actuals from the shared data per quarter.
                  '1,0': { value: 'Q1' }, '1,1': { value: dataQuarterTotal(data, 'Q1'), format: fmt },
                  '1,2': { value: 0.05 }, '1,3': { formula: 'B2*(1+C2)', format: fmt },
                  '2,0': { value: 'Q2' }, '2,1': { value: dataQuarterTotal(data, 'Q2'), format: fmt },
                  '2,2': { value: 0.08 }, '2,3': { formula: 'B3*(1+C3)', format: fmt },
                  '3,0': { value: 'Q3' }, '3,1': { value: dataQuarterTotal(data, 'Q3'), format: fmt },
                  '3,2': { value: 0.06 }, '3,3': { formula: 'B4*(1+C4)', format: fmt },
                  '4,0': { value: 'Q4' }, '4,1': { value: dataQuarterTotal(data, 'Q4'), format: fmt },
                  '4,2': { value: 0.10 }, '4,3': { formula: 'B5*(1+C5)', format: fmt },
                  '5,0': { value: 'Total', style: { bold: true } },
                  '5,1': { formula: 'SUM(B2:B5)', format: fmt, style: { bold: true } },
                  '5,3': { formula: 'SUM(D2:D5)', format: fmt, style: { bold: true } },
                },
              }],
            });
          } catch (e) {
            sheetHost.appendChild(el('div', { class: 'g-note', text: 'Forecast sheet failed: ' + (e && e.message) }));
          }
        } else {
          sheetHost.appendChild(el('div', { class: 'g-note', text: 'Spreadsheet module unavailable.' }));
        }

        // (Grid is loaded as a shared dependency of the workspace; reserved for a
        // detail-drill pane. We surface its availability in the inspector wells.)
        wells.appendChild(el('div', { class: 'g-note', style: 'margin-top:.5rem',
          text: 'Modules: Pivot' + (pivot ? ' ✓' : ' ✗') + ' · Chart' + (chart ? ' ✓' : ' ✗')
            + ' · Sheet' + (Spreadsheet ? ' ✓' : ' ✗') + ' · Grid' + (Grid ? ' ✓' : ' ✗') }));

        // expose for harness/manual verification.
        if (typeof window !== 'undefined') {
          window.__JECTS_ANALYTICS_WORKSPACE__ = { data, pivot, chart, chartFromPivot,
            setMeasure: (m) => setMeasure(m), setDimension: (d) => setDimension(d), setChartType };
        }
      })().catch((err) => {
        root.appendChild(el('div', { class: 'g-note',
          style: 'color:oklch(var(--jects-destructive))',
          text: 'Analytics Workspace failed to build: ' + (err && err.message ? err.message : String(err)) }));
        console.error('[analytics-workspace] build failed:', err);
      });
    },
    { wide: true },
  );
}

/* helper: sum of `amount` for a quarter across the shared dataset. */
function dataQuarterTotal(data, quarter) {
  return data.filter((r) => r.quarter === quarter).reduce((a, r) => a + r.amount, 0);
}
