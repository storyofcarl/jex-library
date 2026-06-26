/** Route: gantt. */
import { el, card } from '../shell/dom.js';
import { exportMenu } from '../shell/export-menu.js';
import { enterpriseSwap } from '../shell/enterprise.js';
import { DAY, HOUR, genGanttProject } from '../shell/data.js';
import {
  section, Button, Gantt, GanttProgressLineFeature, GanttIndicatorsFeature,
  MultiBaselineCompare, ProjectLines, GanttExportMenu, GanttUndoRedo,
  GanttRollupFeature, GanttSegmentedTasksFeature, ResourceHistogram,
  ResourceUtilizationView, PertView, DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
  rollupColumn, ganttToMsProjectXml, WEEK_AND_DAY,
} from '../shell/registry.js';

export function register() {
  section(
    'gantt',
    'Gantt',
    'A full enterprise project plan — WBS task tree, critical path, baselines, dependencies, resource histogram & utilization, undo/redo, PERT view, rollups, a progress line, and PDF/PNG/Excel/MS-Project export.',
    (grid) => {
      grid.appendChild(card('Gantt — full enterprise project plan (critical path · resources · histogram · undo · PERT · exports)', (h) => {
        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.5rem;width:100%' });
        const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;flex-wrap:wrap;align-items:center' });
        const host = el('div', { style: 'height:var(--g-page-host);width:100%' });
        const panels = el('div', { style: 'display:flex;gap:.5rem;width:100%;flex-wrap:wrap' });
        const histHost = el('div', { style: 'flex:1 1 320px;min-width:280px;height:180px;overflow:auto' });
        const utilHost = el('div', { style: 'flex:1 1 320px;min-width:280px;height:180px;overflow:auto' });
        panels.appendChild(histHost);
        panels.appendChild(utilHost);
        const pertHost = el('div', { style: 'display:none;height:300px;width:100%;border-top:1px solid var(--jects-border,#3a3a42)' });
        const statusEl = el('div', { class: 'g-note', style: 'min-height:1.2em' });
        wrap.appendChild(bar);
        wrap.appendChild(host);
        wrap.appendChild(panels);
        wrap.appendChild(pertHost);
        wrap.appendChild(statusEl);
        h.appendChild(wrap);

        const T0 = Date.UTC(2026, 5, 1); // Mon 1 Jun 2026
        const STATUS = T0 + 24 * DAY;    // "today" / status date
        const ganttPreset = { ...WEEK_AND_DAY, pxPerUnit: 20 };
        const HPD = 8 * HOUR; // working hours/day → effort in ms

        const t = (id, name, parentId, offDays, durDays, percentDone, extra = {}) => ({
          id, name, parentId,
          start: T0 + offDays * DAY,
          duration: durDays * DAY,
          end: T0 + (offDays + durDays) * DAY,
          percentDone,
          effort: durDays * HPD,
          ...extra,
        });

        const tasks = [
          { id: 'd', name: 'Discovery', expanded: true, rollup: true },
          t('d1', 'Stakeholder interviews', 'd', 0, 3, 1, { rollup: true }),
          t('d2', 'Requirements doc', 'd', 3, 4, 1, { deadline: T0 + 6 * DAY, rollup: true }),
          t('d3', 'Tech spike', 'd', 3, 3, 1),
          { id: 'g', name: 'Design', expanded: true, rollup: true },
          t('g1', 'UX wireframes', 'g', 7, 5, 0.9),
          t('g2', 'Visual design', 'g', 10, 5, 0.6),
          t('g3', 'Design review', 'g', 15, 1, 0, { constraintType: 'mustStartOn', constraintDate: T0 + 15 * DAY }),
          { id: 'b', name: 'Build', expanded: true, rollup: true },
          t('b1', 'Frontend', 'b', 16, 12, 0.45, {
            segments: [
              { id: 'b1s1', start: T0 + 16 * DAY, end: T0 + 22 * DAY },
              { id: 'b1s2', start: T0 + 25 * DAY, end: T0 + 30 * DAY },
            ],
          }),
          t('b2', 'Backend / API', 'b', 16, 14, 0.5),
          t('b3', 'Integration', 'b', 30, 4, 0, { deadline: T0 + 33 * DAY }),
          { id: 'l', name: 'Launch', expanded: true, rollup: true },
          t('l1', 'QA & UAT', 'l', 34, 6, 0),
          t('l2', 'Deploy to prod', 'l', 40, 2, 0),
          { id: 'm', name: 'Go-live', parentId: 'l', start: T0 + 42 * DAY, milestone: true, rollup: true },
        ];

        const dependencies = [
          { id: 'k1', fromId: 'd1', toId: 'd2', type: 'FS' },
          { id: 'k2', fromId: 'd1', toId: 'd3', type: 'SS' },
          { id: 'k3', fromId: 'd2', toId: 'g1', type: 'FS' },
          { id: 'k4', fromId: 'g1', toId: 'g2', type: 'SS', lag: 3 * DAY },
          { id: 'k5', fromId: 'g2', toId: 'g3', type: 'FS' },
          { id: 'k6', fromId: 'g3', toId: 'b1', type: 'FS' },
          { id: 'k7', fromId: 'g3', toId: 'b2', type: 'FS' },
          { id: 'k8', fromId: 'b1', toId: 'b3', type: 'FS' },
          { id: 'k9', fromId: 'b2', toId: 'b3', type: 'FS' },
          { id: 'k10', fromId: 'b3', toId: 'l1', type: 'FS' },
          { id: 'k11', fromId: 'l1', toId: 'l2', type: 'FS' },
          { id: 'k12', fromId: 'l2', toId: 'm', type: 'FS' },
        ];

        const columns = [
          ...DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
          { field: 'effort', header: 'Effort', width: 80 },
          rollupColumn({ kind: 'summary', field: 'percentDone', aggregation: 'avg', header: 'Rollup %' }),
        ];

        const resources = [
          { id: 'ana', name: 'Ana Pereira', capacity: 1 },
          { id: 'ben', name: 'Ben Cohen', capacity: 1 },
          { id: 'cara', name: 'Cara Singh', capacity: 1 },
          { id: 'dev', name: 'Dev Team', capacity: 4 },
          { id: 'qa', name: 'QA Team', capacity: 3 },
        ];
        const assignments = [
          ['d1', 'ana', 100], ['d2', 'ana', 100], ['d3', 'ben', 100],
          ['g1', 'cara', 100], ['g2', 'cara', 80], ['g3', 'ana', 100],
          ['b1', 'dev', 100], ['b2', 'dev', 100], ['b3', 'dev', 100],
          ['l1', 'qa', 100], ['l2', 'ben', 100],
          ['g2', 'ana', 80],
        ].map(([taskId, resourceId, units], i) => ({ id: 'as' + i, taskId, resourceId, units }));

        const gantt = new Gantt(host, {
          projectStart: T0,
          preset: ganttPreset,
          showCriticalPath: true,
          columns,
          tasks,
          dependencies,
          resources,
          assignments,
        });

        try {
          gantt.captureBaseline('plan', 'As-planned');
          gantt.updateTaskSpan('g2', { start: T0 + 11 * DAY, end: T0 + 16 * DAY }); // slipped
          gantt.captureBaseline('rev2', 'Re-plan');
          gantt.showBaseline('plan');
        } catch (e) { console.warn('Gantt demo: baseline unavailable —', e && e.message); }

        try {
          gantt.use(new GanttProgressLineFeature({ statusDate: STATUS, label: 'Status' }));
        } catch (e) { console.warn('Gantt demo: progressLine unavailable —', e && e.message); }

        try { gantt.use(new GanttIndicatorsFeature()); } catch (e) { console.warn('Gantt demo: indicators unavailable —', e && e.message); }

        try { gantt.use(new GanttRollupFeature({ mode: 'always' })); } catch (e) { console.warn('Gantt demo: rollups unavailable —', e && e.message); }

        try { gantt.use(new GanttSegmentedTasksFeature()); } catch (e) { console.warn('Gantt demo: segmentedTasks unavailable —', e && e.message); }

        try {
          gantt.use(new MultiBaselineCompare({
            initialBaselines: [
              { id: 'plan', name: 'As-planned', active: true },
              { id: 'rev2', name: 'Re-plan', active: false },
            ],
          }));
        } catch (e) { console.warn('Gantt demo: multiBaseline unavailable —', e && e.message); }

        let projLines = null;
        try {
          projLines = new ProjectLines({
            axis: gantt.timeline.axis,
            lines: [
              { id: 'status', date: STATUS, label: 'Status', kind: 'status' },
              { id: 'target', date: T0 + 42 * DAY, label: 'Target go-live', kind: 'deadline' },
            ],
          });
          let lineObserver = null;
          const mountLines = () => {
            if (!projLines) return false;
            const root = gantt.el || gantt.timeline.el;
            const bars = root?.querySelector?.('.jects-gantt__bars');
            if (!bars) return false;
            if (projLines.el.parentElement !== bars) bars.appendChild(projLines.el);
            try { projLines.setHeight(bars.scrollHeight || 360); } catch (_) {}
            try { projLines.refresh(); } catch (_) {}
            if (!lineObserver && window.MutationObserver) {
              lineObserver = new MutationObserver(() => {
                if (projLines && projLines.el.parentElement !== bars) {
                  bars.appendChild(projLines.el);
                  try { projLines.setHeight(bars.scrollHeight || 360); projLines.refresh(); } catch (_) {}
                }
              });
              lineObserver.observe(bars, { childList: true });
            }
            return true;
          };
          let tries = 0;
          const tryMount = () => {
            if (mountLines() || tries++ > 120) return;
            setTimeout(tryMount, 50);
          };
          tryMount();
          gantt.on('scheduleChange', mountLines);
        } catch (e) { console.warn('Gantt demo: projectLines unavailable —', e && e.message); }

        let undoFeat = null;
        try { undoFeat = gantt.use(new GanttUndoRedo({ toolbar: false })); } catch (e) { console.warn('Gantt demo: undo unavailable —', e && e.message); }

        try { gantt.use(new GanttExportMenu({ filename: 'project-plan' })); } catch (e) { console.warn('Gantt demo: exportMenu unavailable —', e && e.message); }

        let hist = null;
        try {
          if (gantt.resources) {
            hist = new ResourceHistogram(histHost, {
              api: gantt.resources,
              axis: gantt.timeline.axis,
              getTaskSpan: (id) => gantt.getTask(id),
              bucketMs: DAY,
              label: 'Resource histogram',
            });
            hist.refresh();
          } else {
            histHost.appendChild(el('div', { class: 'g-note', text: 'Histogram needs a resource layer.' }));
          }
        } catch (e) { console.warn('Gantt demo: histogram unavailable —', e && e.message); }

        let util = null;
        try {
          if (gantt.resources) {
            util = new ResourceUtilizationView(utilHost, {
              api: gantt.resources,
              tasks: gantt,
              unit: 'week',
              cellMode: 'percent',
              label: 'Resource utilization',
            });
          }
        } catch (e) { console.warn('Gantt demo: utilization unavailable —', e && e.message); }

        try {
          gantt.on('scheduleChange', () => { try { hist?.refresh(); } catch (_) {} });
          gantt.on('taskChange', () => { try { hist?.refresh(); } catch (_) {} });
        } catch (e) { console.warn('Gantt demo: events unavailable —', e && e.message); }

        let pert = null;
        const ensurePert = () => {
          if (pert) return pert;
          try {
            pert = PertView.fromGantt(pertHost, gantt, { tasks, dependencies, showCriticalPath: true });
          } catch (_) { pert = null; }
          return pert;
        };

        /* ── Toolbar ──────────────────────────────────────────────────── */
        const tb = (text, onClick, variant = 'secondary', icon) => {
          const b = new Button(bar, icon ? { text, icon, variant, size: 'sm' } : { text, variant, size: 'sm' });
          b.el.addEventListener('click', onClick);
          return b;
        };

        let cpOn = true;
        tb('Critical path', (e) => {
          cpOn = !cpOn;
          try { gantt.setCriticalPathVisible(cpOn); } catch (_) {}
          e.currentTarget?.setAttribute?.('aria-pressed', String(cpOn));
        }, 'outline', 'check');

        let blOn = true;
        tb('Baseline', () => {
          blOn = !blOn;
          try { gantt.showBaseline(blOn ? 'plan' : null); } catch (_) {}
        }, 'outline', 'filter');

        const undoBtn = tb('Undo', () => { try { undoFeat?.undo(); } catch (_) {} syncUndo(); }, 'ghost', 'chevron-left');
        const redoBtn = tb('Redo', () => { try { undoFeat?.redo(); } catch (_) {} syncUndo(); }, 'ghost', 'chevron-right');
        function syncUndo() {
          try {
            undoBtn.el.disabled = !(undoFeat?.canUndo);
            redoBtn.el.disabled = !(undoFeat?.canRedo);
          } catch (_) {}
        }
        try { gantt.on('stmChange', syncUndo); } catch (_) {}
        try { gantt.on('scheduleChange', syncUndo); gantt.on('taskChange', syncUndo); } catch (_) {}
        syncUndo();

        tb('Edit task (QA)', () => {
          try { gantt.updateTaskSpan('l1', { start: T0 + 34 * DAY, end: T0 + 41 * DAY }); } catch (_) {}
          syncUndo();
        }, 'ghost');

        let alap = false;
        tb('ASAP / ALAP', (e) => {
          alap = !alap;
          try {
            gantt.reschedule({
              direction: alap ? 'backward' : 'forward',
              projectStart: T0,
              projectEnd: T0 + 42 * DAY,
            });
          } catch (_) {}
          e.currentTarget?.setAttribute?.('aria-pressed', String(alap));
          statusEl.textContent = alap ? 'Scheduling mode: ALAP (backward from deadline)' : 'Scheduling mode: ASAP (forward from project start)';
          try { hist?.refresh(); } catch (_) {}
        }, 'outline');

        const splitFeat = () => gantt.features?.get?.('segmentedTasks');
        tb('Split / Join', () => {
          try {
            const f = splitFeat();
            if (!f) return;
            if (f.segmentsOf('b1').length > 1) f.joinAll('b1');
            else f.split('b1', T0 + 23 * DAY);
            hist?.refresh();
          } catch (_) {}
        }, 'ghost');

        let pertOn = false;
        tb('PERT view', (e) => {
          pertOn = !pertOn;
          if (pertOn) {
            host.style.display = 'none';
            panels.style.display = 'none';
            pertHost.style.display = '';
            const p = ensurePert();
            try { p?.refresh?.(); p?.zoomToFit?.(); } catch (_) {}
          } else {
            host.style.display = '';
            panels.style.display = 'flex';
            pertHost.style.display = 'none';
          }
          e.currentTarget?.setAttribute?.('aria-pressed', String(pertOn));
        }, 'outline');

        tb('Expand utilization', () => { try { util?.expandAll(); } catch (_) {} }, 'ghost');

        exportMenu(bar, [
          { label: 'CSV', onClick: () => { try { gantt.exportCsvDownload?.('project-plan.csv'); } catch (_) {} } },
          { label: 'Excel', onClick: () => { try { gantt.exportXlsxDownload?.('project-plan.xlsx'); } catch (_) {} } },
          { label: 'PNG', onClick: () => { try { gantt.exportPng?.({ download: 'project-plan.png' }); } catch (_) {} } },
          { label: 'PDF', onClick: () => { try { gantt.exportPdf?.({ page: 'A4', orientation: 'landscape', fitToWidth: true, download: 'project-plan.pdf' }); } catch (_) {} } },
          { label: 'ICS', onClick: () => { try { gantt.exportIcs?.({ download: true, fileName: 'project-plan' }); } catch (_) {} } },
          { label: 'MS-Project', onClick: () => {
            try {
              const xml = ganttToMsProjectXml(gantt, { baselines: [] });
              const blob = new Blob([xml], { type: 'application/xml' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'project-plan.xml';
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 0);
            } catch (_) {}
          } },
          { label: 'Print', onClick: () => {
            try {
              const menu = gantt.features?.get?.('gantt-export-menu');
              if (menu?.exportFormat) menu.exportFormat('print');
              else window.print();
            } catch (_) { try { window.print(); } catch (__) {} }
          } },
        ]);

        enterpriseSwap(bar, host, {
          key: 'gantt',
          count: '1,000 tasks · ~2,000 deps',
          status: (m) => { statusEl.textContent = m; },
          alsoHide: [panels, pertHost],
          build: (bigHost) => {
            const proj = genGanttProject(1000);
            const big = new Gantt(bigHost, {
              projectStart: proj.T0,
              preset: { ...WEEK_AND_DAY, pxPerUnit: 12 },
              columns: DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
              tasks: proj.tasks,
              dependencies: proj.dependencies,
            });
            try {
              big.captureBaseline('plan', 'As-planned');
              big.updateTaskSpan('l10', { start: proj.T0 + 24 * DAY, end: proj.T0 + 30 * DAY });
              big.showBaseline('plan');
            } catch (_) {}
          },
        });

        statusEl.textContent = 'Scheduling mode: ASAP (forward from project start)';

        h.appendChild(el('div', { class: 'g-note', text: 'A full enterprise plan: rich grid (WBS · effort · predecessors/successors · rolled-up %), summary roll-up markers, FS/SS deps, a split Frontend task, deadline/constraint indicators, baseline + multi-baseline compare, status line, and project marker lines. Below the chart, the Resource Histogram (capacity vs allocation, sharing the chart axis) sits beside the Resource Utilization grid. The toolbar drives undo/redo (STM), an explicit ASAP/ALAP reschedule, split/join, a PERT network-diagram view, utilization drill-down, and exports to CSV / Excel / PNG / PDF / ICS / MS-Project plus Print (unified Export menu floats top-right of the chart).' }));
      }, { block: true }));
    },
    { wide: true },
  );
}
