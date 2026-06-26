/** Route: performance — live, measured benchmarks. */
import { el, card } from '../shell/dom.js';
import { DAY, genGridRows, genPivotRecords, genSchedulerData, genGanttProject } from '../shell/data.js';
import {
  section, Button, Grid, PivotTable, Scheduler, Gantt,
  HOUR_AND_DAY, WEEK_AND_DAY, DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
} from '../shell/registry.js';

export function register() {
  section(
    'performance',
    'Performance',
    'Live, measured benchmarks — not synthetic claims. On open this page builds each heavy module against a large dataset, times the build+render with performance.now(), then samples ~30 animation frames while scrolling to derive average frame time and FPS. Numbers reflect THIS browser and CPU right now; press “Re-run benchmarks” to measure again.',
    (grid) => {
      grid.appendChild(card('Live benchmark results', (h) => {
        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.75rem;width:100%' });
        const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.5rem;flex-wrap:wrap;align-items:center' });
        const statusEl = el('div', { class: 'g-note', style: 'min-height:1.2em' });
        const sandbox = el('div', {
          style: 'position:relative;height:420px;width:100%;overflow:hidden;border:1px solid var(--jects-border,#3a3a42);border-radius:var(--jects-radius,8px)',
        });
        const tableWrap = el('div', { style: 'width:100%;overflow:auto' });

        wrap.appendChild(bar);
        wrap.appendChild(statusEl);
        wrap.appendChild(tableWrap);
        wrap.appendChild(el('div', { class: 'g-note', style: 'margin-top:.25rem',
          text: 'Methodology: Measured live in your browser just now — numbers depend on your device/CPU; this is not a synthetic claim. Build+render is wall time around the component constructor (performance.now()). Avg frame is the mean of ~30 requestAnimationFrame deltas captured while driving a scroll/update loop; ~FPS = 1000 / avg-frame-ms, capped at 60 (the display refresh ceiling).' }));
        wrap.appendChild(sandbox);
        h.appendChild(wrap);

        const setStatus = (m) => { statusEl.textContent = m; };

        function renderTable(results) {
          const thead = el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'Module' }),
              el('th', { text: 'Dataset' }),
              el('th', { style: 'text-align:right', text: 'Build+render (ms)' }),
              el('th', { style: 'text-align:right', text: 'Avg frame (ms)' }),
              el('th', { style: 'text-align:right', text: '~FPS' }),
            ]),
          ]);
          const tbody = el('tbody', {}, results.map((r) => el('tr', {}, [
            el('td', { text: r.module }),
            el('td', { text: r.dataset }),
            el('td', { style: 'text-align:right;font-variant-numeric:tabular-nums', text: String(r.buildMs) }),
            el('td', { style: 'text-align:right;font-variant-numeric:tabular-nums', text: r.frameMs.toFixed(1) }),
            el('td', { style: 'text-align:right;font-variant-numeric:tabular-nums', text: String(r.fps) }),
          ])));
          const table = el('table', { class: 'g-perf-table', style: 'width:100%;border-collapse:collapse' }, [thead, tbody]);
          tableWrap.replaceChildren(table);
        }

        function sampleFrames(tick, frames = 30) {
          return new Promise((resolve) => {
            const deltas = [];
            let last = performance.now();
            let i = 0;
            function step(now) {
              deltas.push(now - last);
              last = now;
              try { tick(i); } catch (_) {}
              i++;
              if (i < frames) requestAnimationFrame(step);
              else {
                const use = deltas.length > 1 ? deltas.slice(1) : deltas;
                const avg = use.reduce((a, b) => a + b, 0) / use.length;
                resolve(avg);
              }
            }
            requestAnimationFrame((t) => { last = t; requestAnimationFrame(step); });
          });
        }

        function scrollerIn(host) {
          const cands = host.querySelectorAll('*');
          for (const node of cands) {
            if (node.scrollHeight - node.clientHeight > 40) return node;
          }
          return host;
        }

        async function benchOne({ module, dataset, rows, mount }) {
          setStatus('Benchmarking ' + module + ' (' + dataset + ')…');
          sandbox.replaceChildren();
          const host = el('div', { style: 'position:absolute;inset:0;width:100%;height:100%;overflow:auto' });
          sandbox.appendChild(host);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const t0 = performance.now();
          mount(host);
          const buildMs = Math.round(performance.now() - t0);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const sc = scrollerIn(host);
          const max = Math.max(0, sc.scrollHeight - sc.clientHeight);
          const frameMs = await sampleFrames((i) => {
            if (max > 0) sc.scrollTop = Math.round((i % 30) / 29 * max);
          }, 30);
          const fps = Math.min(60, Math.round(1000 / Math.max(frameMs, 0.001)));
          return { module, dataset, rows, buildMs, frameMs, fps };
        }

        function suite() {
          return [
            {
              module: 'Grid', dataset: '100,000 rows', rows: 100_000,
              mount: (host) => {
                new Grid(host, {
                  data: genGridRows(100_000),
                  selection: 'multi',
                  features: { sort: { multi: true }, filter: true, columnResize: true },
                  columns: [
                    { field: 'id', header: 'ID', type: 'number', width: 80, sortable: true, frozen: 'left' },
                    { field: 'name', header: 'Name', flex: 1, minWidth: 160, sortable: true, filterable: true },
                    { field: 'dept', header: 'Department', width: 150, sortable: true, filterable: true },
                    { field: 'status', header: 'Status', width: 120, sortable: true, filterable: true },
                    { field: 'salary', header: 'Salary ($)', type: 'number', width: 120, align: 'end', sortable: true },
                    { field: 'hired', header: 'Hired', type: 'date', width: 130, sortable: true },
                    { field: 'progress', header: 'Progress %', type: 'number', width: 120, align: 'end', sortable: true },
                  ],
                });
              },
            },
            {
              module: 'Pivot', dataset: '50,000 source records', rows: 50_000,
              mount: (host) => {
                new PivotTable(host, {
                  data: genPivotRecords(50_000),
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
                  values: [{ field: 'amount', aggregator: 'sum', label: 'Revenue' }],
                  mode: 'tree',
                  totals: { grand: true, rows: true, columns: true },
                });
              },
            },
            {
              module: 'Scheduler', dataset: '100 resources × ~2,000 events', rows: 2_000,
              mount: (host) => {
                host.style.height = '100%';
                const data = genSchedulerData(100, 20);
                new Scheduler(host, {
                  resources: data.resources,
                  events: data.events,
                  preset: HOUR_AND_DAY,
                  range: { start: data.base, end: data.base + DAY * 20 },
                  panEnabled: true,
                  infiniteScroll: true,
                });
              },
            },
            {
              module: 'Gantt', dataset: '1,000 tasks · ~2,000 deps', rows: 1_000,
              mount: (host) => {
                host.style.height = '100%';
                const proj = genGanttProject(1000);
                new Gantt(host, {
                  projectStart: proj.T0,
                  preset: { ...WEEK_AND_DAY, pxPerUnit: 12 },
                  columns: DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
                  tasks: proj.tasks,
                  dependencies: proj.dependencies,
                });
              },
            },
          ];
        }

        let running = false;
        async function runAll() {
          if (running) return (window.__JECTS_PERF__ && window.__JECTS_PERF__.results) || [];
          running = true;
          rerunBtn.el.setAttribute('disabled', 'disabled');
          const results = [];
          try {
            for (const spec of suite()) {
              const r = await benchOne(spec);
              results.push(r);
              renderTable(results); // progressive — each row appears as it lands
            }
            sandbox.replaceChildren(); // free the last (heavy) component
            window.__JECTS_PERF__ = { runAt: Date.now(), results: results.map((r) => ({
              module: r.module, rows: r.rows, buildMs: r.buildMs, frameMs: r.frameMs, fps: r.fps,
            })) };
            setStatus('Done — measured ' + results.length + ' modules live on this device at '
              + new Date(window.__JECTS_PERF__.runAt).toLocaleTimeString() + '.');
          } catch (e) {
            setStatus('Benchmark error: ' + (e && e.message ? e.message : String(e)));
            console.error('[gallery] performance bench failed:', e);
          } finally {
            running = false;
            rerunBtn.el.removeAttribute('disabled');
          }
          return (window.__JECTS_PERF__ && window.__JECTS_PERF__.results) || [];
        }

        window.__runJectsBench = () => runAll();

        const rerunBtn = new Button(bar, { text: 'Re-run benchmarks', variant: 'primary', size: 'sm', icon: 'arrow-down' });
        rerunBtn.el.addEventListener('click', () => { window.__runJectsBench(); });

        renderTable([]);
        setStatus('Running benchmarks on this device…');
        requestAnimationFrame(() => requestAnimationFrame(() => { window.__runJectsBench(); }));
      }, { block: true }));
    },
    { wide: true },
  );
}
