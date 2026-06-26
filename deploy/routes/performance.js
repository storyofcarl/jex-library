/** Route: performance — live, measured benchmarks. */
import { el, card } from '../shell/dom.js';
import {
  DAY, genGridRows, genPivotRecords, genSchedulerData, genGanttProject,
  genBudgetSheet, genDiagramGraph, genKanbanCards,
} from '../shell/data.js';
import {
  section, Button, Grid, PivotTable, Scheduler, Gantt,
  Spreadsheet, Diagram, TaskBoard, Calendar, Chart,
  HOUR_AND_DAY, WEEK_AND_DAY, DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
} from '../shell/registry.js';

/* Per-module build+render budgets (ms), realistic ceilings for a modern laptop.
   A row passes when its averaged build time is at or under its budget. */
const BUDGETS = {
  Grid: 180,
  Pivot: 180,
  Scheduler: 450,
  Gantt: 600,
  Spreadsheet: 320,
  Diagram: 400,
  Kanban: 260,
  Calendar: 220,
  Charts: 160,
};

export function register() {
  section(
    'performance',
    'Performance',
    'Live, measured benchmarks — not synthetic claims. On open this page builds each heavy module against a large dataset, times build+render with performance.now() averaged over N=3 runs, then samples ~60 animation frames during a scroll/update loop to derive p50 / p95 / p99 frame times, FPS, heap and interaction latency. Numbers reflect THIS browser and CPU right now; press “Re-run benchmarks” to measure again.',
    (grid) => {
      grid.appendChild(card('Live benchmark results', (h) => {
        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.75rem;width:100%' });
        const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.5rem;flex-wrap:wrap;align-items:center' });
        const statusEl = el('div', { class: 'g-note', style: 'min-height:1.2em' });
        const machineEl = el('div', { class: 'g-note', style: 'min-height:1.2em;opacity:.85' });
        const sandbox = el('div', {
          style: 'position:relative;height:420px;width:100%;overflow:hidden;border:1px solid var(--jects-border,#3a3a42);border-radius:var(--jects-radius,8px)',
        });
        const tableWrap = el('div', { style: 'width:100%;overflow:auto' });

        wrap.appendChild(bar);
        wrap.appendChild(machineEl);
        wrap.appendChild(statusEl);
        wrap.appendChild(tableWrap);
        wrap.appendChild(el('div', { class: 'g-note', style: 'margin-top:.25rem',
          text: 'Methodology: Measured live in your browser just now on this device — N=3 averaged, not a synthetic claim. Build avg is wall time around the component constructor (performance.now()), averaged over 3 runs with the component destroyed between runs. Frame p50/p95/p99 are percentiles of ~60 requestAnimationFrame deltas captured while driving a scroll/update loop (the warm-up frame is dropped); ~FPS = 1000 / p50, capped at 60 (the display refresh ceiling). Memory is performance.memory.usedJSHeapSize (Chromium only). Interaction is the wall time of one representative scroll/update step. Budget is a per-module build-time ceiling; Pass = build avg within budget.' }));
        wrap.appendChild(sandbox);
        h.appendChild(wrap);

        const setStatus = (m) => { statusEl.textContent = m; };

        // Machine / browser line.
        (function showMachine() {
          const nav = (typeof navigator !== 'undefined') ? navigator : {};
          const parts = [];
          if (nav.hardwareConcurrency) parts.push(nav.hardwareConcurrency + ' logical cores');
          if (nav.deviceMemory) parts.push(nav.deviceMemory + ' GB device memory');
          parts.push(nav.userAgent || 'unknown user agent');
          machineEl.textContent = 'This device: ' + parts.join(' · ');
        })();

        function machineInfo() {
          const nav = (typeof navigator !== 'undefined') ? navigator : {};
          return {
            userAgent: nav.userAgent || null,
            hardwareConcurrency: nav.hardwareConcurrency || null,
            deviceMemory: nav.deviceMemory || null,
          };
        }

        function heapMB() {
          try {
            const m = performance.memory;
            if (m && typeof m.usedJSHeapSize === 'number') {
              return Math.round((m.usedJSHeapSize / (1024 * 1024)) * 10) / 10;
            }
          } catch (_) {}
          return null;
        }

        function renderTable(results) {
          const thead = el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'Module' }),
              el('th', { text: 'Dataset' }),
              el('th', { style: 'text-align:right', text: 'Build avg (ms)' }),
              el('th', { style: 'text-align:right', text: 'Frame p50/p95/p99 (ms)' }),
              el('th', { style: 'text-align:right', text: '~FPS' }),
              el('th', { style: 'text-align:right', text: 'Memory (MB)' }),
              el('th', { style: 'text-align:right', text: 'Interaction (ms)' }),
              el('th', { style: 'text-align:right', text: 'Budget (ms)' }),
              el('th', { style: 'text-align:center', text: 'Pass' }),
            ]),
          ]);
          const numTd = (txt) => el('td', { style: 'text-align:right;font-variant-numeric:tabular-nums', text: txt });
          const tbody = el('tbody', {}, results.map((r) => {
            if (r.skipped) {
              return el('tr', {}, [
                el('td', { text: r.module }),
                el('td', { text: r.dataset }),
                el('td', { colspan: '6', style: 'opacity:.8',
                  text: 'skipped — ' + (r.error || 'unavailable') }),
                el('td', { style: 'text-align:center' }, [
                  el('span', { class: 'jects-status-chip', 'data-tone': 'warn', text: 'Skipped' }),
                ]),
              ]);
            }
            const frames = r.frameP50.toFixed(1) + ' / ' + r.frameP95.toFixed(1) + ' / ' + r.frameP99.toFixed(1);
            return el('tr', {}, [
              el('td', { text: r.module }),
              el('td', { text: r.dataset }),
              numTd(String(r.buildMs)),
              numTd(frames),
              numTd(String(r.fps)),
              numTd(r.memMB == null ? '—' : String(r.memMB)),
              numTd(r.interactionMs == null ? '—' : r.interactionMs.toFixed(1)),
              numTd(String(r.budgetMs)),
              el('td', { style: 'text-align:center' }, [
                el('span', {
                  class: 'jects-status-chip',
                  'data-tone': r.pass ? 'ok' : 'risk',
                  text: r.pass ? 'Pass' : 'Over',
                }),
              ]),
            ]);
          }));
          const table = el('table', { class: 'g-perf-table', style: 'width:100%;border-collapse:collapse' }, [thead, tbody]);
          tableWrap.replaceChildren(table);
        }

        // Sample ~`frames` rAF deltas while driving `tick`. Returns the kept
        // deltas (warm-up frame dropped) for percentile computation.
        function sampleFrames(tick, frames = 60) {
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
              else resolve(deltas.length > 1 ? deltas.slice(1) : deltas);
            }
            requestAnimationFrame((t) => { last = t; requestAnimationFrame(step); });
          });
        }

        function percentile(sorted, p) {
          if (!sorted.length) return 0;
          const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1));
          return sorted[idx];
        }

        function scrollerIn(host) {
          const cands = host.querySelectorAll('*');
          for (const node of cands) {
            if (node.scrollHeight - node.clientHeight > 40) return node;
          }
          return host;
        }

        // Build into the (clipped) sandbox once; returns { inst, buildMs }.
        async function buildOnce(mount) {
          sandbox.replaceChildren();
          const host = el('div', { style: 'position:absolute;inset:0;width:100%;height:100%;overflow:auto' });
          sandbox.appendChild(host);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const t0 = performance.now();
          const inst = mount(host);
          const buildMs = performance.now() - t0;
          return { inst, host, buildMs };
        }

        function destroyInst(inst) {
          try {
            if (inst && typeof inst.destroy === 'function') inst.destroy();
          } catch (_) {}
        }

        async function benchOne({ module, dataset, rows, mount }, N = 3) {
          setStatus('Benchmarking ' + module + ' (' + dataset + ')…');
          // Averaged build+render over N runs, destroying between runs.
          const builds = [];
          let liveHost = null;
          let liveInst = null;
          for (let run = 0; run < N; run++) {
            const built = await buildOnce(mount);
            builds.push(built.buildMs);
            if (run < N - 1) {
              destroyInst(built.inst);
              sandbox.replaceChildren();
            } else {
              liveHost = built.host;
              liveInst = built.inst;
            }
          }
          const buildMs = Math.round(builds.reduce((a, b) => a + b, 0) / builds.length);

          // Frame sampling over the last (still-live) instance.
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const sc = scrollerIn(liveHost);
          const max = Math.max(0, sc.scrollHeight - sc.clientHeight);

          // Interaction latency: time one representative scroll/update step.
          const ti0 = performance.now();
          if (max > 0) sc.scrollTop = Math.round(max / 2);
          await new Promise((r) => requestAnimationFrame(r));
          const interactionMs = performance.now() - ti0;

          const deltas = await sampleFrames((i) => {
            if (max > 0) sc.scrollTop = Math.round((i % 60) / 59 * max);
          }, 60);
          const sorted = deltas.slice().sort((a, b) => a - b);
          const frameP50 = percentile(sorted, 50);
          const frameP95 = percentile(sorted, 95);
          const frameP99 = percentile(sorted, 99);
          const fps = Math.min(60, Math.round(1000 / Math.max(frameP50, 0.001)));
          const memMB = heapMB();

          destroyInst(liveInst);

          const budgetMs = BUDGETS[module] != null ? BUDGETS[module] : 9999;
          const pass = buildMs <= budgetMs;
          return {
            module, dataset, rows, buildMs,
            frameMs: frameP50, // back-compat: existing readers expect frameMs = p50
            frameP50, frameP95, frameP99, fps, memMB, interactionMs, budgetMs, pass,
          };
        }

        function suite() {
          return [
            {
              module: 'Grid', dataset: '100,000 rows', rows: 100_000,
              mount: (host) => new Grid(host, {
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
              }),
            },
            {
              module: 'Pivot', dataset: '50,000 source records', rows: 50_000,
              mount: (host) => new PivotTable(host, {
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
              }),
            },
            {
              module: 'Scheduler', dataset: '100 resources × ~2,000 events', rows: 2_000,
              mount: (host) => {
                host.style.height = '100%';
                const data = genSchedulerData(100, 20);
                return new Scheduler(host, {
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
                return new Gantt(host, {
                  projectStart: proj.T0,
                  preset: { ...WEEK_AND_DAY, pxPerUnit: 12 },
                  columns: DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
                  tasks: proj.tasks,
                  dependencies: proj.dependencies,
                });
              },
            },
            {
              module: 'Spreadsheet', dataset: '~1,000 rows × 14 cols (formulas)', rows: 1_000,
              mount: (host) => {
                host.style.height = '100%';
                const sheet = genBudgetSheet(1000);
                return new Spreadsheet(host, {
                  maxRows: 24,
                  sheets: [{
                    id: 'budget', name: 'Budget',
                    rowCount: sheet.rowCount, colCount: sheet.colCount, cells: sheet.cells,
                  }],
                });
              },
            },
            {
              module: 'Diagram', dataset: '600 nodes · ~599 connectors', rows: 600,
              mount: (host) => {
                host.style.height = '100%';
                const g = genDiagramGraph(600);
                return new Diagram(host, {
                  mode: 'flowchart',
                  editable: true,
                  grid: true,
                  shapes: g.shapes,
                  connectors: g.connectors,
                });
              },
            },
            {
              module: 'Kanban', dataset: '2,000 cards · 5 columns × 3 lanes', rows: 2_000,
              mount: (host) => {
                host.style.height = '100%';
                const colIds = ['backlog', 'todo', 'doing', 'review', 'done'];
                const laneIds = ['fe', 'be', 'qa'];
                return new TaskBoard(host, {
                  toolbar: true,
                  sortable: true,
                  sortField: 'order',
                  columns: colIds.map((id, i) => ({ id, title: id, color: i + 1 })),
                  lanes: laneIds.map((id) => ({ id, title: id })),
                  cards: genKanbanCards(2000, colIds, laneIds),
                });
              },
            },
            {
              module: 'Calendar', dataset: '1 month · ~1,000 events', rows: 1_000,
              mount: (host) => {
                host.style.height = '100%';
                const base = new Date(2026, 5, 1);
                const Y = base.getFullYear(), M = base.getMonth();
                const cats = ['work', 'personal', 'travel', 'health'];
                const events = [];
                for (let i = 0; i < 1000; i++) {
                  const day = 1 + (i % 28);
                  const hr = 7 + (i % 11);
                  const s = new Date(Y, M, day, hr, 0);
                  const e = new Date(Y, M, day, hr + 1, 0);
                  events.push({
                    id: i + 1, title: 'Event ' + (i + 1), start: s, end: e,
                    categoryId: cats[i % cats.length],
                  });
                }
                return new Calendar(host, {
                  date: base, view: 'month', weekStart: 1,
                  categories: [
                    { id: 'work', name: 'Work', color: 'data-1' },
                    { id: 'personal', name: 'Personal', color: 'data-2' },
                    { id: 'travel', name: 'Travel', color: 'data-3' },
                    { id: 'health', name: 'Health', color: 'data-4' },
                  ],
                  events,
                });
              },
            },
            {
              module: 'Charts', dataset: 'line · 2 series × 2,000 points', rows: 2_000,
              mount: (host) => {
                host.style.height = '100%';
                const N = 2000;
                const cats = Array.from({ length: N }, (_, i) => 't' + i);
                const a = Array.from({ length: N }, (_, i) => 100 + Math.round(40 * Math.sin(i / 12)));
                const b = Array.from({ length: N }, (_, i) => 80 + Math.round(30 * Math.cos(i / 17)));
                return new Chart(host, {
                  type: 'line', height: 380, categories: cats,
                  series: [{ name: 'A', data: a }, { name: 'B', data: b }],
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
              let r;
              try {
                r = await benchOne(spec);
              } catch (e) {
                // One module failing must not abort the whole run — record + continue.
                console.error('[gallery] performance bench failed for ' + spec.module + ':', e);
                r = {
                  module: spec.module, dataset: spec.dataset, rows: spec.rows,
                  skipped: true, error: (e && e.message ? e.message : String(e)),
                  buildMs: null, frameMs: null, frameP50: null, frameP95: null, frameP99: null,
                  fps: null, memMB: null, interactionMs: null,
                  budgetMs: BUDGETS[spec.module] != null ? BUDGETS[spec.module] : null, pass: false,
                };
              }
              results.push(r);
              renderTable(results); // progressive — each row appears as it lands
            }
            sandbox.replaceChildren(); // free the last (heavy) component
            window.__JECTS_PERF__ = {
              runAt: Date.now(),
              machine: machineInfo(),
              results: results.map((r) => ({
                module: r.module, rows: r.rows, buildMs: r.buildMs, frameMs: r.frameMs,
                frameP50: r.frameP50, frameP95: r.frameP95, frameP99: r.frameP99,
                fps: r.fps, memMB: r.memMB, interactionMs: r.interactionMs,
                budgetMs: r.budgetMs, pass: r.pass, skipped: !!r.skipped,
              })),
            };
            const ok = results.filter((r) => !r.skipped).length;
            const skipped = results.length - ok;
            setStatus('Done — measured ' + ok + ' modules live on this device at '
              + new Date(window.__JECTS_PERF__.runAt).toLocaleTimeString()
              + (skipped ? (' · ' + skipped + ' skipped') : '') + '.');
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
        // Auto-run once after first paint. A setTimeout fallback ensures it fires
        // even when rAF is throttled (e.g. headless / backgrounded tabs).
        let autoStarted = false;
        const autoRun = () => { if (autoStarted) return; autoStarted = true; window.__runJectsBench(); };
        requestAnimationFrame(() => requestAnimationFrame(autoRun));
        setTimeout(autoRun, 200);
      }, { block: true }));
    },
    { wide: true },
  );
}
