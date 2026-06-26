/** Route: data grid. */
import { el, card } from '../shell/dom.js';
import { exportMenu } from '../shell/export-menu.js';
import { enterpriseSwap } from '../shell/enterprise.js';
import { genGridRows } from '../shell/data.js';
import {
  section, Button, Grid, TreeStore,
  summaryFeature, editingFeature, columnStateFeature, columnPickerFeature,
  filterBarFeature, filterMenuFeature, filterFacetFeature, undoRedoFeature,
  rowExpanderFeature, tooltipFeature, exportFeature, pdfExportFeature, fillFeature,
  headerGroupsFeature,
} from '../shell/registry.js';

export function register() {
  section('grid', 'Data Grid', 'Virtualized grid with sortable / filterable columns, inline editing, selection, and tree mode.', (grid) => {
    const firsts = ['Ada', 'Alan', 'Grace', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken'];
    const lasts = ['Lovelace', 'Turing', 'Hopper', 'Torvalds', 'Hamilton', 'Ritchie', 'Liskov', 'Thompson'];
    const depts = ['Engineering', 'Design', 'Product', 'Research'];
    const rows = Array.from({ length: 500 }, (_, i) => ({
      id: i + 1,
      name: `${firsts[i % firsts.length]} ${lasts[(i * 3) % lasts.length]}`,
      dept: depts[i % depts.length],
      salary: 60000 + ((i * 1234) % 90000),
      active: i % 3 !== 0,
    }));

    grid.appendChild(card('Enterprise grid — full featureset (selection · grouping · summaries · export · undo · master-detail · responsive · state)', (h) => {
      const warn = (label, e) => console.warn('GRID-DEMO feature failed:', label, e && e.message);

      const DAY_MS = 24 * 60 * 60 * 1000;
      const grades = ['L3', 'L4', 'L5', 'L6'];
      const erows = rows.map((r, i) => ({
        ...r,
        grade: grades[i % grades.length],
        hired: new Date(Date.UTC(2015 + (i % 9), i % 12, 1 + (i % 27))),
        rating: 1 + (i % 5),
        bonus: 2000 + ((i * 311) % 12000),
        note: `${r.name} — ${r.dept} (${grades[i % grades.length]})`,
      }));

      const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.5rem;width:100%' });
      const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;flex-wrap:wrap;align-items:center' });
      const host = el('div', { class: 'g-host-grid' });
      const statusEl = el('div', { class: 'g-note', style: 'min-height:1.2em' });
      wrap.appendChild(bar);
      wrap.appendChild(host);
      wrap.appendChild(statusEl);
      h.appendChild(wrap);
      const setStatus = (m) => { statusEl.textContent = m; };
      const money = (v) => (v == null ? '' : '$' + Number(v).toLocaleString('en-US'));

      let expander;

      const grid2 = new Grid(host, {
        data: erows,
        selection: 'multi',
        editing: { enabled: true, trigger: 'dblclick' },
        features: {
          sort: { multi: true },
          filter: true,
          columnResize: true,
          columnReorder: true,
          clipboard: true,
          selectionColumn: { headerCheckbox: true },
          responsive: {
            breakpoints: [
              { maxWidth: 820, hide: ['grade'] },
              { maxWidth: 680, hide: ['grade', 'bonus'] },
            ],
          },
          group: {
            aggregations: { salary: 'sum', bonus: 'avg', rating: 'avg', id: 'count' },
            footerAggregations: { salary: 'sum', bonus: 'avg', rating: 'avg', id: 'count' },
          },
        },
        columns: [
          { id: '__expander', header: '', type: 'template', width: 40, align: 'center', frozen: 'left', responsivePriority: 120,
            renderer: (ctx) => {
              const open = expander && expander.isExpanded && expander.isExpanded(ctx.row.id);
              const b = el('button', { class: 'jects-grid__tree-toggle', 'aria-label': open ? 'Collapse detail' : 'Expand detail' });
              b.type = 'button';
              b.dataset.expanderToggle = '';
              b.textContent = open ? '▾' : '▸';
              b.addEventListener('click', (e) => { e.stopPropagation(); try { expander && expander.toggle(ctx.row.id); } catch (_) {} });
              ctx.el.replaceChildren(b);
            } },
          { field: 'id', header: 'ID', type: 'number', width: 64, sortable: true, frozen: 'left', responsivePriority: 100 },
          { field: 'name', header: 'Name', group: 'Person', flex: 1, minWidth: 130, sortable: true, filterable: true, frozen: 'left', responsivePriority: 90,
            tooltip: (ctx) => `Employee #${ctx.row.id}: ${ctx.value}` },
          { field: 'dept', header: 'Department', group: 'Person', flex: 1, minWidth: 120, sortable: true, filterable: true, responsivePriority: 80 },
          { field: 'grade', header: 'Grade', group: 'Person', width: 80, sortable: true, filterable: true, responsivePriority: 20 },
          { field: 'salary', header: 'Salary', group: 'Compensation', type: 'number', width: 110, align: 'end', sortable: true, filterable: true, responsivePriority: 70,
            meta: { format: { grouping: true } } },
          { field: 'bonus', header: 'Bonus', group: 'Compensation', type: 'number', width: 100, align: 'end', sortable: true, responsivePriority: 30,
            meta: { format: { grouping: true } } },
          { field: 'hired', header: 'Hired', group: 'Record', type: 'date', width: 120, sortable: true, responsivePriority: 40 },
          { field: 'rating', header: 'Rating', group: 'Record', type: 'rating', width: 120, align: 'center', sortable: true, responsivePriority: 50, meta: { rating: { max: 5 } } },
          { field: 'active', header: 'Active', group: 'Record', type: 'check', width: 80, align: 'center', responsivePriority: 60 },
          { header: 'Actions', type: 'action', width: 96, align: 'center', responsivePriority: 110,
            meta: { actions: [
              { key: 'star', label: 'Rate', onClick: (ctx) => { try { ctx.api.store.update(ctx.row.id, { rating: 5 }); setStatus('Set rating to 5 for ' + ctx.row.name); } catch (_) {} } },
              { key: 'toggle', label: 'Toggle', onClick: (ctx) => { try { ctx.api.store.update(ctx.row.id, { active: !ctx.row.active }); setStatus('Toggled active for ' + ctx.row.name); } catch (_) {} } },
            ] } },
        ],
      });

      let summary, picker, state, fmenu, undo, rowEdit;
      try { grid2.use(headerGroupsFeature()); } catch (e) { warn('headerGroups', e); }
      try {
        summary = grid2.use(summaryFeature({
          label: 'Totals',
          aggregations: { salary: 'sum', bonus: 'avg', rating: 'avg', id: 'count' },
          format: (v, id) => (id === 'salary' || id === 'bonus') ? money(v) : (v == null ? '' : (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : String(v))),
        }));
      } catch (e) { warn('summary', e); }
      try { rowEdit = grid2.use(editingFeature({ rowEdit: true, trigger: 'manual' })); } catch (e) { warn('editing(rowEdit)', e); }
      try { state = grid2.use(columnStateFeature({ storageKey: 'jects-gallery-grid-state' })); } catch (e) { warn('columnState', e); }
      try { picker = grid2.use(columnPickerFeature({ title: 'Columns' })); } catch (e) { warn('columnPicker', e); }
      try { grid2.use(filterBarFeature()); } catch (e) { warn('filterBar', e); }
      try { fmenu = grid2.use(filterMenuFeature()); } catch (e) { warn('filterMenu', e); }
      try { grid2.use(filterFacetFeature()); } catch (e) { warn('filterFacet', e); }
      try { undo = grid2.use(undoRedoFeature()); } catch (e) { warn('undoRedo', e); }
      try { grid2.use(fillFeature()); } catch (e) { warn('fill', e); }
      try {
        grid2.use(tooltipFeature({ showOnOverflow: true }));
      } catch (e) { warn('tooltip', e); }
      try {
        expander = grid2.use(rowExpanderFeature({
          column: false,
          detailHeight: 96,
          renderer: (ctx) => {
            const d = el('div', { class: 'g-grid-detail', style: 'display:flex;flex-direction:column;gap:.25rem;padding:.5rem .75rem;font-size:.85em;line-height:1.5' });
            d.appendChild(el('div', { html: `<strong>${ctx.row.name}</strong> &middot; ${ctx.row.dept} &middot; grade ${ctx.row.grade}` }));
            d.appendChild(el('div', { text: `Salary ${money(ctx.row.salary)} · bonus ${money(ctx.row.bonus)} · rating ${ctx.row.rating}/5 · ${ctx.row.active ? 'active' : 'inactive'}` }));
            d.appendChild(el('div', { text: `Hired ${new Date(ctx.row.hired).toISOString().slice(0, 10)}` }));
            return d;
          },
        }));
        grid2.refresh();
      } catch (e) { warn('rowExpander', e); }
      let exporter, pdf;
      try { exporter = grid2.features.get('export') || grid2.use(exportFeature({ fileName: 'employees' })); } catch (e) { warn('export', e); }
      try { pdf = grid2.use(pdfExportFeature({ fileName: 'employees', title: 'Employees' })); } catch (e) { warn('pdfExport', e); }

      /* ── Interactive toolbar ──────────────────────────────────────────── */
      const tb = (text, onClick, variant = 'secondary') => {
        const b = new Button(bar, { text, variant, size: 'sm' });
        b.el.addEventListener('click', (e) => { try { onClick(e); } catch (err) { warn('toolbar:' + text, err); } });
        return b;
      };

      let grouped = false;
      tb('Group by dept', () => {
        const gf = grid2.features.get('group');
        if (!gf) return;
        grouped = !grouped;
        gf.setGroups(grouped ? ['dept'] : []);
        setStatus(grouped ? 'Grouped by Department (per-group + footer aggregates).' : 'Ungrouped.');
      }, 'outline');

      tb('Columns…', () => { if (picker && picker.toggle) picker.toggle(120, 120); setStatus('Toggled column picker.'); }, 'outline');
      tb('Filter menu', () => { if (fmenu && fmenu.openFor) fmenu.openFor('salary', 160, 140); setStatus('Opened filter operator menu for Salary.'); }, 'outline');
      tb('Row edit', () => { if (rowEdit && rowEdit.start) { rowEdit.start({ rowIndex: 0, colIndex: 2 }); setStatus('Started row edit on first row.'); } }, 'outline');

      let allExpanded = false;
      tb('Expand all', (e) => {
        if (!expander) return;
        allExpanded = !allExpanded;
        if (allExpanded) { expander.expandAll && expander.expandAll(); }
        else { expander.collapseAll && expander.collapseAll(); }
        e.currentTarget?.setAttribute?.('aria-pressed', String(allExpanded));
        setStatus(allExpanded ? 'Expanded all detail rows.' : 'Collapsed all detail rows.');
      }, 'outline');

      exportMenu(bar, [
        { label: 'CSV', onClick: () => { if (exporter && exporter.downloadCsv) exporter.downloadCsv(); setStatus('Exported CSV.'); } },
        { label: 'Excel', onClick: () => { if (exporter && exporter.downloadExcel) exporter.downloadExcel(); setStatus('Exported Excel (.xls).'); } },
        { label: 'PDF', onClick: () => { if (pdf && pdf.downloadPdf) pdf.downloadPdf(); setStatus('Exported PDF.'); } },
      ]);

      tb('Save state', () => { if (state && state.persistNow) state.persistNow(); setStatus('Saved column/sort/filter/group state.'); });
      tb('Restore state', () => {
        if (state && state.getState && state.applyState) { state.applyState(state.getState()); setStatus('Restored persisted state.'); }
      });
      tb('Undo', () => { if (undo && undo.undo) undo.undo(); setStatus('Undo.'); });
      tb('Redo', () => { if (undo && undo.redo) undo.redo(); setStatus('Redo.'); });

      // ── Enterprise scale: swap to a virtualized 100,000-row dataset on demand. ──
      enterpriseSwap(bar, host, {
        key: 'grid',
        count: '100,000 rows',
        status: setStatus,
        build: (bigHost) => {
          const big = genGridRows(100_000);
          new Grid(bigHost, {
            data: big,
            selection: 'multi',
            features: {
              sort: { multi: true },
              filter: true,
              columnResize: true,
              columnReorder: true,
              clipboard: true,
              selectionColumn: { headerCheckbox: true },
            },
            columns: [
              { field: 'id', header: 'ID', type: 'number', width: 80, sortable: true, frozen: 'left' },
              { field: 'name', header: 'Name', flex: 1, minWidth: 170, sortable: true, filterable: true, frozen: 'left' },
              { field: 'dept', header: 'Department', width: 150, sortable: true, filterable: true },
              { field: 'status', header: 'Status', width: 120, sortable: true, filterable: true },
              { field: 'salary', header: 'Salary ($)', type: 'number', width: 120, align: 'end', sortable: true, filterable: true, meta: { format: { grouping: true } } },
              { field: 'hired', header: 'Hired', type: 'date', width: 130, sortable: true },
              { field: 'progress', header: 'Progress %', type: 'number', width: 120, align: 'end', sortable: true, meta: { format: { grouping: false } } },
            ],
          });
        },
      });

      h.appendChild(el('div', { class: 'g-note', text: 'Typed columns by type (number/text/date/rating/check/action) with frozen left columns and a multi-level (grouped) header. Checkbox selection, range copy/paste + fill handle, multi-sort, filter bar + operator menu + faceted filter, grouping with per-group & footer aggregates, cell + row editing, master-detail row expander (click the ▸ to open a detail row), cell tooltips, column-state persistence, undo/redo, responsive column auto-hide, and CSV/Excel/PDF export — driven from the toolbar above. The engine virtualizes 50k+ rows — only visible rows are in the DOM.' }));
    }, { block: true }));

    grid.appendChild(card('Tree mode (hierarchical rows)', (h) => {
      const host = el('div', { class: 'g-host-grid' });
      h.appendChild(host);
      const treeRows = [
        { id: 'eng', name: 'Engineering', count: 42, children: [
          { id: 'fe', name: 'Frontend', count: 18, children: [
            { id: 'fe-a', name: 'Web Platform', count: 9 },
            { id: 'fe-b', name: 'Design Systems', count: 9 },
          ] },
          { id: 'be', name: 'Backend', count: 24 },
        ] },
        { id: 'design', name: 'Design', count: 12, children: [
          { id: 'ux', name: 'UX', count: 7 },
          { id: 'brand', name: 'Brand', count: 5 },
        ] },
      ];
      new Grid(host, {
        data: new TreeStore({ data: treeRows }),
        treeMode: true,
        columns: [
          { field: 'name', header: 'Team', type: 'tree', flex: 1 },
          { field: 'count', header: 'Headcount', type: 'number', width: 130, align: 'end' },
        ],
      });
    }, { block: true }));
  }, { wide: true });
}
