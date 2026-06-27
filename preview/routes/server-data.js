/** Route: server-side data — Grid over a simulated async backend. */
import { el, card } from '../shell/dom.js';
import { genGridRows } from '../shell/data.js';
import { section, Button, Grid } from '../shell/registry.js';

export function register() {
  section(
    'server-data',
    'Server-side data',
    'A Grid over a simulated REST/GraphQL backend. The mock server holds 100,000 rows; sorting, filtering and pagination all happen server-side and the client receives exactly one page per request (~150 ms latency). Only one page is ever in the DOM. Every server call is recorded in the Request log on the right — the proof that the grid fetches a page at a time, never the whole set.',
    (grid) => {
      grid.appendChild(card('Grid ↔ simulated server (server-side sort · filter · paging)', (h) => {
        const PAGE_SIZE = 50;
        const TOTAL = 100_000;
        const BACKEND = genGridRows(TOTAL);

        async function queryServer({ page, pageSize, sort, filter }) {
          await new Promise((r) => setTimeout(r, 150)); // artificial latency
          let working = BACKEND;
          if (filter && filter.value) {
            const needle = String(filter.value).toLowerCase();
            working = working.filter((row) => String(row[filter.field] ?? '').toLowerCase().includes(needle));
          }
          if (sort && sort.field) {
            const dir = sort.dir === 'desc' ? -1 : 1;
            working = working.slice().sort((a, b) => {
              const av = a[sort.field], bv = b[sort.field];
              if (av < bv) return -1 * dir;
              if (av > bv) return 1 * dir;
              return 0;
            });
          }
          const total = working.length;
          const start = page * pageSize;
          const rows = working.slice(start, start + pageSize);
          return { rows, total };
        }

        const layout = el('div', { style: 'display:flex;gap:.75rem;width:100%;flex-wrap:wrap' });
        const left = el('div', { style: 'flex:1 1 520px;min-width:320px;display:flex;flex-direction:column;gap:.5rem' });
        const right = el('div', { style: 'flex:1 1 300px;min-width:280px;display:flex;flex-direction:column;gap:.4rem' });
        layout.appendChild(left);
        layout.appendChild(right);
        h.appendChild(layout);

        const controls = el('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap;align-items:center' });
        const pager = el('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin-top:.25rem' });
        const gridHost = el('div', { class: 'g-host-grid' });
        left.appendChild(controls);
        left.appendChild(gridHost);
        left.appendChild(pager);

        right.appendChild(el('div', { class: 'g-card__hd', style: 'padding:0', text: 'Request log' }));
        const logEl = el('div', {
          style: 'flex:1 1 auto;min-height:260px;max-height:380px;overflow:auto;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--jects-muted,#1b1b1f);border:1px solid var(--jects-border,#3a3a42);border-radius:var(--jects-radius,8px);padding:.5rem',
        });
        right.appendChild(logEl);

        let state = { page: 0, pageSize: PAGE_SIZE, sort: { field: 'id', dir: 'asc' }, filter: { field: 'name', value: '' } };
        let total = TOTAL;
        let callNo = 0;

        function logCall(req, latency, rowsReturned, totalCount) {
          callNo++;
          const line = el('div', { style: 'padding:.2rem 0;border-bottom:1px solid var(--jects-border,#33333a)' });
          line.appendChild(el('div', { style: 'font-weight:600',
            text: '#' + callNo + ' page=' + req.page + ' size=' + req.pageSize }));
          line.appendChild(el('div', {
            text: 'sort=' + (req.sort && req.sort.field ? req.sort.field + ' ' + req.sort.dir : '—')
              + ' · filter=' + (req.filter && req.filter.value ? req.filter.field + '~"' + req.filter.value + '"' : '—') }));
          line.appendChild(el('div', {
            text: 'latency=' + latency + 'ms · rows=' + rowsReturned + ' · total=' + totalCount.toLocaleString() }));
          logEl.insertBefore(line, logEl.firstChild);
        }

        const dataGrid = new Grid(gridHost, {
          data: [],
          columns: [
            { field: 'id', header: 'ID', type: 'number', width: 90, align: 'end' },
            { field: 'name', header: 'Name', flex: 1, minWidth: 160 },
            { field: 'dept', header: 'Department', width: 150 },
            { field: 'status', header: 'Status', width: 120 },
            { field: 'salary', header: 'Salary ($)', type: 'number', width: 130, align: 'end' },
            { field: 'hired', header: 'Hired', type: 'date', width: 130 },
          ],
        });

        const pageInfo = el('span', { class: 'g-note' });
        let busy = false;

        async function refresh() {
          if (busy) return;
          busy = true;
          const req = { page: state.page, pageSize: state.pageSize, sort: state.sort, filter: state.filter };
          const t0 = performance.now();
          const { rows, total: t } = await queryServer(req);
          const latency = Math.round(performance.now() - t0);
          total = t;
          dataGrid.update({ data: rows }); // only this page enters the DOM
          logCall(req, latency, rows.length, total);
          const pages = Math.max(1, Math.ceil(total / state.pageSize));
          const from = total === 0 ? 0 : state.page * state.pageSize + 1;
          const to = Math.min(total, (state.page + 1) * state.pageSize);
          pageInfo.textContent = total === 0
            ? 'No matching rows.'
            : 'Showing ' + from.toLocaleString() + '–' + to.toLocaleString() + ' of ' + total.toLocaleString()
              + ' (page ' + (state.page + 1) + ' / ' + pages.toLocaleString() + ')';
          prevBtn.el[state.page <= 0 ? 'setAttribute' : 'removeAttribute']('disabled', 'disabled');
          nextBtn.el[state.page >= pages - 1 ? 'setAttribute' : 'removeAttribute']('disabled', 'disabled');
          busy = false;
        }

        controls.appendChild(el('label', { class: 'g-note', text: 'Filter' }));
        const filterField = el('select', { class: 'jects-select__control', style: 'min-width:120px', 'aria-label': 'Filter field' });
        [['name', 'Name'], ['dept', 'Department'], ['status', 'Status']].forEach(([v, l]) => {
          filterField.appendChild(el('option', { value: v, text: l }));
        });
        const filterValue = el('input', { class: 'jects-textfield__input', type: 'search', placeholder: 'contains…', style: 'min-width:160px' });
        controls.appendChild(filterField);
        controls.appendChild(filterValue);
        let filterTimer = null;
        const applyFilter = () => {
          state.filter = { field: filterField.value, value: filterValue.value.trim() };
          state.page = 0;
          refresh();
        };
        filterField.addEventListener('change', applyFilter);
        filterValue.addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(applyFilter, 250); });

        controls.appendChild(el('label', { class: 'g-note', style: 'margin-left:.5rem', text: 'Sort' }));
        const sortField = el('select', { class: 'jects-select__control', style: 'min-width:120px', 'aria-label': 'Sort field' });
        [['id', 'ID'], ['name', 'Name'], ['salary', 'Salary'], ['hired', 'Hired']].forEach(([v, l]) => {
          sortField.appendChild(el('option', { value: v, text: l }));
        });
        controls.appendChild(sortField);
        const sortDirBtn = new Button(controls, { text: 'Asc ↑', variant: 'secondary', size: 'sm' });
        sortField.addEventListener('change', () => { state.sort = { field: sortField.value, dir: state.sort.dir }; state.page = 0; refresh(); });
        sortDirBtn.el.addEventListener('click', () => {
          state.sort = { field: state.sort.field, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' };
          sortDirBtn.el.textContent = state.sort.dir === 'asc' ? 'Asc ↑' : 'Desc ↓';
          state.page = 0; refresh();
        });

        const prevBtn = new Button(pager, { text: '‹ Prev', variant: 'secondary', size: 'sm' });
        const nextBtn = new Button(pager, { text: 'Next ›', variant: 'secondary', size: 'sm' });
        prevBtn.el.addEventListener('click', () => { if (state.page > 0) { state.page--; refresh(); } });
        nextBtn.el.addEventListener('click', () => {
          const pages = Math.max(1, Math.ceil(total / state.pageSize));
          if (state.page < pages - 1) { state.page++; refresh(); }
        });
        pager.appendChild(pageInfo);

        h.appendChild(el('div', { class: 'g-note', style: 'margin-top:.5rem',
          text: 'This models a real backend (REST/GraphQL): queryServer({ page, pageSize, sort, filter }) applies sort + filter + pagination server-side against a 100,000-row store and returns one page (~150 ms latency). The grid only ever holds that one page in the DOM — paging, sorting and filtering each issue a fresh server call (see the Request log). The grid package also exposes infiniteLoadFeature, whose loadRange(request) → { rows, totalCount } callback is this same server seam wired to scroll-driven prefetch instead of an explicit pager.' }));

        window.__JECTS_SERVER_DATA__ = { grid: dataGrid, queryServer, getState: () => state, getLog: () => logEl };
        refresh();
      }, { block: true }));
    },
    { wide: true },
  );
}
