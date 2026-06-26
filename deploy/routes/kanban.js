/** Route: kanban. */
import { el, card } from '../shell/dom.js';
import { exportMenu } from '../shell/export-menu.js';
import { enterpriseSwap } from '../shell/enterprise.js';
import { genKanbanCards } from '../shell/data.js';
import { section, Button, TaskBoard } from '../shell/registry.js';

export function register() {
  section(
    'kanban',
    'Kanban',
    'A TaskBoard — columns + swimlanes, WIP limits, rich cards (cover/tags/assignee/attachments/comments/votes/links), drag-and-drop, undo/redo, sort, filter and export.',
    (grid) => {
      grid.appendChild(card('Kanban board — rich cards, WIP + swimlanes, undo/sort/filter/export', (h) => {
        const host = el('div', { style: 'height:var(--g-page-host);width:100%' });
        const cover = (a, b) =>
          'data:image/svg+xml;utf8,' +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="96">` +
              `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
              `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>` +
              `</linearGradient></defs><rect width="280" height="96" fill="url(#g)"/></svg>`,
          );

        h.appendChild(host);
        const board = new TaskBoard(host, {
          toolbar: true,
          searchPlaceholder: 'Search cards…',
          undoRedo: true,
          sortable: true,
          sortField: 'order',
          filters: [
            { id: 'mine', label: 'Assignee: KM', test: (c) => c.assignee === 'KM' },
            { id: 'voted', label: 'Voted', test: (c) => !!(c.votes && c.votes.voted) },
            { id: 'p1', label: 'High priority', test: (c) => (c.tags || []).some((t) => t.text === 'p1') },
          ],
          columns: [
            { id: 'backlog', title: 'Backlog', color: 1 },
            { id: 'todo', title: 'To Do', color: 2 },
            { id: 'doing', title: 'In Progress', color: 3, limit: 3 }, // WIP limit (soft)
            { id: 'review', title: 'Review', color: 4, limit: 2, strictLimit: true }, // WIP (hard veto)
            { id: 'done', title: 'Done', color: 5 },
          ],
          lanes: [
            { id: 'fe', title: 'Frontend' },
            { id: 'be', title: 'Backend' },
          ],
          cards: [
            {
              id: 1, column: 'backlog', lane: 'fe', order: 0, priority: 2,
              title: 'Design tokens audit', description: 'Verify OKLCH ramps render token-pure.',
              cover: cover('#6d8bd8', '#a7c0f0'),
              tags: [{ text: 'design', color: 1 }, { text: 'p2', color: 4 }],
              avatar: 'KM', assignee: 'KM', progress: 10, due: '2026-07-10',
              attachments: [{ name: 'spec.pdf', size: 184320 }],
              comments: [{ author: 'AB', text: 'Ramp 5 looks off in dark mode.', time: '2026-06-20' }],
              votes: { count: 3, voted: false }, links: [6],
            },
            {
              id: 2, column: 'todo', lane: 'fe', order: 0, priority: 1,
              title: 'Drag-and-drop polish', description: 'Auto-scroll + multiselect refinements.',
              cover: cover('#3fa796', '#9fd9cf'),
              tags: [{ text: 'feature', color: 2 }],
              avatar: 'KM', assignee: 'KM', progress: 0, due: '2026-06-30',
              votes: { count: 5, voted: true }, links: [3, 4],
              attachments: [{ name: 'flow.mp4', size: 2400000 }, { name: 'notes.txt', size: 1024 }],
            },
            {
              id: 3, column: 'doing', lane: 'be', order: 0, priority: 3,
              title: 'WIP limit enforcement', description: 'Soft flag + strict veto.',
              tags: [{ text: 'core', color: 3 }, { text: 'p1', color: 6 }],
              avatar: 'AB', assignee: 'AB', progress: 60, due: '2026-07-05',
              comments: [
                { author: 'KM', text: 'Strict mode should reject the drop.', time: '2026-06-22' },
                { author: 'AB', text: 'Done — emits limitReject.', time: '2026-06-23' },
              ],
              votes: { count: 1, voted: false },
            },
            {
              id: 4, column: 'doing', lane: 'be', order: 1, priority: 1,
              title: 'Inline quick-edit', description: 'Rename a card in place.',
              avatar: 'KM', assignee: 'KM', progress: 30, due: '2026-07-15',
              votes: { count: 0, voted: false },
            },
            {
              id: 5, column: 'review', lane: 'be', order: 0, priority: 3,
              title: 'A11y axe pass', description: 'Keyboard move + live region.',
              cover: cover('#c8783c', '#f0c79a'),
              tags: [{ text: 'a11y', color: 5 }, { text: 'p1', color: 6 }],
              avatar: 'AB', assignee: 'AB', progress: 90, due: '2026-06-28',
              attachments: [{ name: 'axe-report.html', size: 51200 }],
              votes: { count: 8, voted: false }, links: [3],
            },
            {
              id: 6, column: 'done', lane: 'be', order: 0, priority: 1,
              title: 'Token-pure CSS', description: 'No hard-coded colors.',
              tags: [{ text: 'chore', color: 7 }],
              progress: 100, due: '2026-06-10',
              bodyItems: [{ text: 'Merged in #142' }],
              comments: [{ author: 'KM', text: 'LGTM 🎉', time: '2026-06-11' }],
              votes: { count: 2, voted: false },
            },
          ],
        });

        const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;margin-bottom:.5rem' });
        const status = el('span', { class: 'g-note', style: 'margin-left:.5rem' });
        const tb = (text, onClick, variant = 'secondary') => {
          const b = new Button(bar, { text, variant, size: 'sm' });
          b.el.addEventListener('click', onClick);
          return b;
        };

        const SORTS = ['order', 'priority', 'title', 'votes', 'due'];
        let si = 0;
        const sortBtn = tb('Sort: order', () => {
          si = (si + 1) % SORTS.length;
          try {
            board.setSortField(SORTS[si]);
            sortBtn.el.textContent = 'Sort: ' + board.getSortField();
          } catch (e) { console.warn('KANBAN-DEMO feature failed:', e && e.message); }
        }, 'outline');

        const filterBtn = (id, label) =>
          tb(label, (ev) => {
            try {
              board.toggleFilter(id);
              ev.currentTarget?.setAttribute?.('aria-pressed', String(board.getActiveFilters().includes(id)));
            } catch (e) { console.warn('KANBAN-DEMO feature failed:', e && e.message); }
          }, 'ghost');
        filterBtn('mine', 'Filter: KM');
        filterBtn('voted', 'Filter: voted');

        tb('Vote ↑ (card 1)', () => {
          try { board.toggleVote(1); } catch (e) { console.warn('KANBAN-DEMO feature failed:', e && e.message); }
        }, 'ghost');

        const undoBtn = tb('Undo', () => { try { board.undo(); } catch (e) { console.warn('KANBAN-DEMO feature failed:', e && e.message); } });
        const redoBtn = tb('Redo', () => { try { board.redo(); } catch (e) { console.warn('KANBAN-DEMO feature failed:', e && e.message); } });
        const syncHistory = () => {
          try {
            undoBtn.el.disabled = !board.canUndo();
            redoBtn.el.disabled = !board.canRedo();
          } catch (e) { console.warn('KANBAN-DEMO feature failed:', e && e.message); }
        };
        try { board.on('historyChange', syncHistory); } catch (e) { console.warn('KANBAN-DEMO feature failed:', e && e.message); }
        syncHistory();

        const exportItem = (fmt) => ({
          label: fmt.toUpperCase(),
          onClick: () => {
            try {
              const out = board.export({ format: fmt });
              status.textContent = fmt.toUpperCase() + ' export: ' + out.length + ' chars';
              console.log('[KANBAN-DEMO] export ' + fmt + ':', out.slice(0, 120));
            } catch (e) { console.warn('KANBAN-DEMO feature failed:', e && e.message); }
          },
        });
        exportMenu(bar, [exportItem('json'), exportItem('csv')]);

        enterpriseSwap(bar, host, {
          key: 'kanban',
          count: '500 cards',
          status: (m) => { status.textContent = m; },
          build: (bigHost) => {
            const columns = [
              { id: 'backlog', title: 'Backlog', color: 1 },
              { id: 'todo', title: 'To Do', color: 2 },
              { id: 'doing', title: 'In Progress', color: 3 },
              { id: 'review', title: 'Review', color: 4 },
              { id: 'done', title: 'Done', color: 5 },
            ];
            const lanes = [{ id: 'fe', title: 'Frontend' }, { id: 'be', title: 'Backend' }];
            const cards = genKanbanCards(500, columns.map((c) => c.id), lanes.map((l) => l.id));
            new TaskBoard(bigHost, {
              toolbar: true,
              searchPlaceholder: 'Search cards…',
              sortable: true,
              sortField: 'order',
              columns,
              lanes,
              cards,
            });
          },
        });

        bar.appendChild(status);
        h.insertBefore(bar, h.firstChild);
      }, { block: true }));
    },
    { wide: true },
  );
}
