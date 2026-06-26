/**
 * Workflow: Planning Control Center.
 *
 * A flagship, app-shaped route: ONE shared in-module project dataset feeds five
 * @jects engines arranged like real project-planning software — a command bar
 * with KPIs, a left task Grid, a center Gantt timeline, a right Inspector, and a
 * bottom row with a resource Scheduler and a "schedule risk by department"
 * Chart, plus a small blocked-dates Calendar. "One model, many views."
 *
 * Cross-interaction: clicking a Gantt task bar (taskClick) OR clicking a Grid
 * row (cellClick) selects that task across the app — it repaints the Inspector
 * (name, owner, dept, dates, % done, cost, status) and highlights the owning
 * resource row in the Scheduler.
 *
 * Engines are imported lazily via bare specifiers (resolved by the page
 * importmap) and EACH construction is wrapped in try/catch so one failing pane
 * renders a `.g-note` instead of blanking the demo.
 */
import { el } from '../shell/dom.js';
import { section, ensureCss } from '../shell/registry.js';

/* ── shared dataset: one small, realistic delivery project ─────────────── */
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 5, 1); // Mon 1 Jun 2026 — project start
const STATUS = T0 + 18 * DAY; // status / "today"

// Departments → resource lanes.
const RESOURCES = [
  { id: 'eng', name: 'Engineering', dept: 'Engineering' },
  { id: 'des', name: 'Design', dept: 'Design' },
  { id: 'qa', name: 'Quality', dept: 'Quality' },
];

// 6 leaf tasks + phase parents. off/dur in days; cost in USD.
// risk: 'ok' | 'warn' | 'risk' drives the status chips + the risk chart.
const TASKS = [
  { id: 'p1', name: 'Discovery', parentId: null, phase: true },
  { id: 't1', name: 'Requirements & specs', parentId: 'p1', resId: 'eng', owner: 'Ana Pereira',
    off: 0, dur: 5, percent: 100, cost: 18000, risk: 'ok' },
  { id: 't2', name: 'UX wireframes', parentId: 'p1', resId: 'des', owner: 'Cara Singh',
    off: 3, dur: 6, percent: 90, cost: 22000, risk: 'warn' },
  { id: 'p2', name: 'Build', parentId: null, phase: true },
  { id: 't3', name: 'Visual design', parentId: 'p2', resId: 'des', owner: 'Cara Singh',
    off: 9, dur: 5, percent: 60, cost: 16000, risk: 'ok' },
  { id: 't4', name: 'Frontend build', parentId: 'p2', resId: 'eng', owner: 'Ben Cohen',
    off: 12, dur: 12, percent: 40, cost: 48000, risk: 'risk' },
  { id: 't5', name: 'Backend / API', parentId: 'p2', resId: 'eng', owner: 'Ana Pereira',
    off: 12, dur: 14, percent: 35, cost: 52000, risk: 'risk' },
  { id: 'p3', name: 'Launch', parentId: null, phase: true },
  { id: 't6', name: 'QA & UAT', parentId: 'p3', resId: 'qa', owner: 'Dana Roy',
    off: 26, dur: 6, percent: 0, cost: 20000, risk: 'warn' },
];

const DEPENDENCIES = [
  { id: 'k1', fromId: 't1', toId: 't2', type: 'FS' },
  { id: 'k2', fromId: 't2', toId: 't3', type: 'FS' },
  { id: 'k3', fromId: 't3', toId: 't4', type: 'FS' },
  { id: 'k4', fromId: 't3', toId: 't5', type: 'FS' },
  { id: 'k5', fromId: 't4', toId: 't6', type: 'FS' },
  { id: 'k6', fromId: 't5', toId: 't6', type: 'FS' },
];

const LEAVES = TASKS.filter((t) => !t.phase);
const byId = new Map(TASKS.map((t) => [t.id, t]));
const resById = new Map(RESOURCES.map((r) => [r.id, r]));

const fmtMoney = (v) => '$' + Number(v || 0).toLocaleString('en-US');
const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const taskStart = (t) => T0 + t.off * DAY;
const taskEnd = (t) => T0 + (t.off + t.dur) * DAY;
const RISK_TONE = { ok: 'ok', warn: 'warn', risk: 'risk' };
const RISK_LABEL = { ok: 'On track', warn: 'Watch', risk: 'At risk' };

/* Tasks shaped for the Gantt (phases as summary parents). */
function ganttTasks() {
  return TASKS.map((t) => {
    if (t.phase) return { id: t.id, name: t.name, parentId: t.parentId, expanded: true };
    return {
      id: t.id, name: t.name, parentId: t.parentId,
      start: taskStart(t), end: taskEnd(t), duration: t.dur * DAY,
      percentDone: t.percent, effort: t.dur * 8 * HOUR,
    };
  });
}

export function register() {
  section(
    'planning-control-center',
    'Planning Control Center',
    'A single project model rendered as real planning software — task grid, Gantt timeline, live inspector, resource scheduler and risk analytics, all wired to one shared dataset.',
    async (grid) => {
      ensureCss('gantt');
      ensureCss('grid');
      ensureCss('scheduler');
      ensureCss('calendar');
      ensureCss('charts');

      // Lazy-load each engine independently; a missing one must not abort the rest.
      const [ganttMod, gridMod, schedMod, calMod, chartMod] = await Promise.all([
        import('@jects/gantt').catch((e) => ({ __err: e })),
        import('@jects/grid').catch((e) => ({ __err: e })),
        import('@jects/scheduler').catch((e) => ({ __err: e })),
        import('@jects/calendar').catch((e) => ({ __err: e })),
        import('@jects/charts').catch((e) => ({ __err: e })),
      ]);
      const Gantt = ganttMod && ganttMod.Gantt;
      const Grid = gridMod && gridMod.Grid;
      const Scheduler = schedMod && schedMod.Scheduler;
      const Calendar = calMod && calMod.Calendar;
      const Chart = chartMod && chartMod.Chart;

      /* ── module hero ──────────────────────────────────────────────── */
      const hero = el('div', { class: 'jects-module-hero' }, [
        el('h3', { text: 'Acme Platform v2 — delivery plan' }),
        el('p', { text: 'One model, many views: every pane below reads from the same task, resource and cost dataset. Click any task in the Gantt or the grid to drive the inspector and highlight its resource.' }),
      ]);
      grid.appendChild(hero);

      /* ── KPI strip ────────────────────────────────────────────────── */
      const nTasks = LEAVES.length;
      const pctComplete = Math.round(LEAVES.reduce((s, t) => s + t.percent, 0) / nTasks);
      const atRisk = LEAVES.filter((t) => t.risk === 'risk').length;
      const totalCost = LEAVES.reduce((s, t) => s + t.cost, 0);
      const kpi = (value, label) => el('div', { class: 'jects-kpi' }, [
        el('div', { class: 'jects-kpi__value', text: value }),
        el('div', { class: 'jects-kpi__label', text: label }),
      ]);
      const kpiStrip = el('div', { class: 'jects-kpi-strip', style: 'margin-bottom:.85rem' }, [
        kpi(String(nTasks), 'Tasks'),
        kpi(pctComplete + '%', '% complete'),
        kpi(String(atRisk), 'At-risk tasks'),
        kpi(fmtMoney(totalCost), 'Total cost'),
      ]);
      grid.appendChild(kpiStrip);

      /* ── app shell layout ─────────────────────────────────────────── */
      const shell = el('div', { class: 'jects-app-shell' });
      shell.style.gridTemplate = [
        '"command command command" auto',
        '"tasks   timeline inspect" minmax(300px, auto)',
        '"bottomL bottomR  inspect" minmax(280px, auto)',
        '/ minmax(240px, 1fr) minmax(360px, 1.8fr) minmax(240px, 0.9fr)',
      ].join('\n');
      grid.appendChild(shell);

      // Command bar.
      const command = el('div', { class: 'jects-commandbar', style: 'grid-area:command' }, [
        el('span', { class: 'jects-commandbar__title', text: 'Planning Control Center' }),
        el('span', { class: 'jects-status-chip', 'data-tone': 'ok', text: 'Status date · ' + fmtDate(STATUS) }),
        el('span', { class: 'jects-status-chip', 'data-tone': atRisk ? 'risk' : 'ok',
          text: atRisk + ' at risk' }),
      ]);
      shell.appendChild(command);

      // Panes.
      const tasksPane = el('div', { class: 'jects-app-pane', style: 'grid-area:tasks' });
      const timelinePane = el('div', { class: 'jects-app-pane', style: 'grid-area:timeline' });
      const inspectPane = el('div', { class: 'jects-app-pane jects-app-pane--muted', style: 'grid-area:inspect' });
      const bottomLPane = el('div', { class: 'jects-app-pane', style: 'grid-area:bottomL' });
      const bottomRPane = el('div', { class: 'jects-app-pane jects-app-pane--muted', style: 'grid-area:bottomR' });
      shell.appendChild(tasksPane);
      shell.appendChild(timelinePane);
      shell.appendChild(inspectPane);
      shell.appendChild(bottomLPane);
      shell.appendChild(bottomRPane);

      const paneHead = (host, text) => host.appendChild(el('div', {
        style: 'padding:.5rem .75rem 0;font-size:var(--jects-font-size-xs);text-transform:uppercase;letter-spacing:.04em;color:oklch(var(--jects-muted-foreground))',
        text,
      }));
      const paneNote = (host, msg) => host.appendChild(el('div', { class: 'g-note', style: 'padding:.75rem', text: msg }));

      /* ── inspector (right) ────────────────────────────────────────── */
      paneHead(inspectPane, 'Inspector');
      const inspector = el('div', { class: 'jects-inspector' });
      inspectPane.appendChild(inspector);

      let scheduler = null; // forward refs for cross-interaction
      const HILITE_BG = 'oklch(var(--jects-data-3, var(--jects-accent)) / 0.22)';

      function highlightResource(resId) {
        try {
          const root = scheduler && (scheduler.el || scheduler.element);
          if (!root || !root.querySelectorAll) return;
          // Clear any prior highlight, then tint the matching resource lane(s).
          root.querySelectorAll('[data-pcc-hilite]').forEach((n) => {
            n.style.background = ''; n.removeAttribute('data-pcc-hilite');
          });
          if (!resId) return;
          // Resource rows/lanes expose their id on a data attribute in the engine DOM.
          root.querySelectorAll('[data-resource-id="' + resId + '"]').forEach((n) => {
            n.style.background = HILITE_BG; n.setAttribute('data-pcc-hilite', '');
          });
        } catch (_) { /* highlight is best-effort chrome */ }
      }

      function renderInspector(taskId) {
        const t = taskId && byId.get(taskId);
        inspector.replaceChildren();
        inspector.appendChild(el('h4', { text: t && !t.phase ? 'Task detail' : 'Select a task' }));
        if (!t || t.phase) {
          inspector.appendChild(el('p', { style: 'margin:0;color:oklch(var(--jects-muted-foreground))',
            text: 'Click a task bar in the Gantt or a row in the task grid to inspect it.' }));
          highlightResource(null);
          return;
        }
        const res = resById.get(t.resId);
        const dl = el('dl');
        const row = (k, v) => { dl.appendChild(el('dt', { text: k })); dl.appendChild(el('dd', {}, [v])); };
        row('Task', document.createTextNode(t.name));
        row('Owner', document.createTextNode(t.owner));
        row('Department', document.createTextNode(res ? res.dept : '—'));
        row('Start', document.createTextNode(fmtDate(taskStart(t))));
        row('Finish', document.createTextNode(fmtDate(taskEnd(t))));
        row('% done', document.createTextNode(t.percent + '%'));
        row('Cost', document.createTextNode(fmtMoney(t.cost)));
        const chip = el('span', { class: 'jects-status-chip', 'data-tone': RISK_TONE[t.risk], text: RISK_LABEL[t.risk] });
        row('Status', chip);
        inspector.appendChild(dl);
        highlightResource(t.resId);
      }
      renderInspector(null);

      // Shared selection entry point used by both Gantt and Grid.
      let gridApi = null;
      function selectTask(taskId, fromGrid) {
        renderInspector(taskId);
        if (!fromGrid && gridApi && taskId) {
          try { gridApi.selectRows ? gridApi.selectRows([taskId]) : gridApi.store && gridApi.store.select && gridApi.store.select(taskId); } catch (_) {}
        }
      }

      /* ── left: task Grid ──────────────────────────────────────────── */
      paneHead(tasksPane, 'Project tasks');
      if (!Grid) {
        paneNote(tasksPane, 'Grid module failed to load: ' + ((gridMod && gridMod.__err && gridMod.__err.message) || 'unavailable'));
      } else {
        try {
          const gridHost = el('div', { style: 'height:300px;width:100%' });
          tasksPane.appendChild(gridHost);
          const gridRows = LEAVES.map((t) => ({
            id: t.id, name: t.name, owner: t.owner,
            dept: (resById.get(t.resId) || {}).dept || '',
            percent: t.percent, cost: t.cost, risk: RISK_LABEL[t.risk],
          }));
          gridApi = new Grid(gridHost, {
            data: gridRows,
            selection: 'single',
            features: { sort: { multi: false } },
            columns: [
              { field: 'name', header: 'Task', flex: 1, minWidth: 130, sortable: true },
              { field: 'owner', header: 'Owner', width: 110, sortable: true },
              { field: 'dept', header: 'Dept', width: 100, sortable: true },
              { field: 'percent', header: '%', type: 'number', width: 60, align: 'end', sortable: true },
              { field: 'cost', header: 'Cost', type: 'number', width: 90, align: 'end', sortable: true,
                meta: { format: { grouping: true } } },
              { field: 'risk', header: 'Status', width: 90 },
            ],
          });
          // Grid → app cross-interaction (cellClick gives the data row).
          try {
            gridApi.on('cellClick', (e) => { const r = e && e.row; if (r) selectTask(r.id, true); });
          } catch (_) {
            try { gridApi.on('selectionChange', (e) => {
              const id = e && e.selectedIds && e.selectedIds[0]; if (id) selectTask(id, true);
            }); } catch (__) {}
          }
        } catch (e) {
          paneNote(tasksPane, 'Grid pane error: ' + (e && e.message ? e.message : String(e)));
        }
      }

      /* ── center: Gantt timeline ───────────────────────────────────── */
      paneHead(timelinePane, 'Schedule');
      if (!Gantt) {
        paneNote(timelinePane, 'Gantt module failed to load: ' + ((ganttMod && ganttMod.__err && ganttMod.__err.message) || 'unavailable'));
      } else {
        try {
          const ganttHost = el('div', { style: 'height:300px;width:100%' });
          timelinePane.appendChild(ganttHost);
          const gantt = new Gantt(ganttHost, {
            projectStart: T0,
            showCriticalPath: true,
            tasks: ganttTasks(),
            dependencies: DEPENDENCIES,
            columns: [
              { field: 'name', header: 'Task', flex: 1, minWidth: 140 },
              { field: 'percentDone', header: '%', width: 56, align: 'end' },
            ],
          });
          // Gantt → app cross-interaction (taskClick gives the task model).
          try {
            gantt.on('taskClick', (e) => {
              const t = e && e.task; const id = t && (t.id != null ? t.id : t.data && t.data.id);
              if (id != null) selectTask(id, false);
            });
          } catch (_) { /* event surface absent — leave Gantt read-only */ }
        } catch (e) {
          paneNote(timelinePane, 'Gantt pane error: ' + (e && e.message ? e.message : String(e)));
        }
      }

      /* ── bottom-left: resource Scheduler (utilization lane view) ──── */
      paneHead(bottomLPane, 'Resource load');
      if (!Scheduler) {
        paneNote(bottomLPane, 'Scheduler module failed to load: ' + ((schedMod && schedMod.__err && schedMod.__err.message) || 'unavailable'));
      } else {
        try {
          const schedHost = el('div', { style: 'height:240px;width:100%' });
          bottomLPane.appendChild(schedHost);
          const events = LEAVES.map((t) => ({
            id: 'ev-' + t.id, resourceId: t.resId, name: t.name,
            startDate: taskStart(t), endDate: taskEnd(t),
            eventColor: t.risk === 'risk' ? 'magenta' : (t.risk === 'warn' ? 'yellow' : 'cyan'),
          }));
          scheduler = new Scheduler(schedHost, {
            resources: RESOURCES.map((r) => ({ id: r.id, name: r.dept })),
            events,
            range: { start: T0, end: T0 + 34 * DAY },
            editable: false,
            creatable: false,
            eventTooltip: (ev) => ev.name || null,
          });
        } catch (e) {
          paneNote(bottomLPane, 'Scheduler pane error: ' + (e && e.message ? e.message : String(e)));
        }
      }

      /* ── bottom-right: schedule risk by department (Chart) ────────── */
      paneHead(bottomRPane, 'Schedule risk by department');
      if (!Chart) {
        paneNote(bottomRPane, 'Charts module failed to load: ' + ((chartMod && chartMod.__err && chartMod.__err.message) || 'unavailable'));
      } else {
        try {
          const chartHost = el('div', { style: 'height:210px;width:100%' });
          bottomRPane.appendChild(chartHost);
          // Stack at-risk vs watch vs on-track counts per department.
          const depts = RESOURCES.map((r) => r.dept);
          const count = (dept, risk) => LEAVES.filter((t) => (resById.get(t.resId) || {}).dept === dept && t.risk === risk).length;
          new Chart(chartHost, {
            type: 'bar', stacked: true, height: 180,
            categories: depts,
            series: [
              { name: 'On track', data: depts.map((d) => count(d, 'ok')) },
              { name: 'Watch', data: depts.map((d) => count(d, 'warn')) },
              { name: 'At risk', data: depts.map((d) => count(d, 'risk')) },
            ],
          });

          // A small blocked-dates Calendar tucked beside the chart (aspirational
          // 5th module — omitted gracefully on failure, never blanks the pane).
          if (Calendar) {
            try {
              const calHead = el('div', {
                style: 'padding:.5rem .75rem 0;font-size:var(--jects-font-size-xs);text-transform:uppercase;letter-spacing:.04em;color:oklch(var(--jects-muted-foreground))',
                text: 'Blocked dates',
              });
              bottomRPane.appendChild(calHead);
              const calHost = el('div', { style: 'height:230px;width:100%' });
              bottomRPane.appendChild(calHost);
              new Calendar(calHost, {
                view: 'month',
                views: ['month'],
                date: new Date(STATUS),
                editable: false,
                toolbar: true,
                miniCalendar: false,
                events: [
                  { id: 'blk1', title: 'Code freeze', start: new Date(T0 + 24 * DAY), end: new Date(T0 + 26 * DAY), allDay: true },
                  { id: 'blk2', title: 'Release window', start: new Date(T0 + 32 * DAY), end: new Date(T0 + 34 * DAY), allDay: true },
                ],
              });
            } catch (ce) {
              console.warn('PCC: calendar pane omitted —', ce && ce.message);
            }
          }
        } catch (e) {
          paneNote(bottomRPane, 'Chart pane error: ' + (e && e.message ? e.message : String(e)));
        }
      }

      // Caption.
      grid.appendChild(el('div', { class: 'g-note', style: 'margin-top:.85rem',
        text: 'Five @jects engines (Gantt · Grid · Scheduler · Charts · Calendar) over one shared project model. Selecting a task in the Gantt or the grid repaints the inspector and highlights the owning department lane in the resource view.' }));
    },
    { wide: true },
  );
}
