/** Route: to-do (enterprise task manager). */
import { el, card } from '../shell/dom.js';
import { section, TodoList } from '../shell/registry.js';

export function register() {
  section(
    'todo',
    'To-Do',
    'An enterprise task manager (Asana / ClickUp / Monday-class): a configurable workflow with List + Board views, sort · group-by · multi-criteria filter · search, rich tasks (assignees, tags, custom fields, due-status, recurrence), a detail editor, multi-select + bulk actions, undo/redo, and JSON/CSV export.',
    (grid) => {
      grid.appendChild(card('Task manager — List/Board/Calendar/Timeline/Table · comments · timer · deps', (h) => {
        const host = el('div', { style: 'height:var(--g-page-host);width:100%' });
        h.appendChild(host);
        new TodoList(host, {
          statuses: [
            { id: 'todo', label: 'To do', color: 'var(--jects-data-1)', isDone: false },
            { id: 'doing', label: 'In progress', color: 'var(--jects-data-2)', isDone: false, wipLimit: 2 },
            { id: 'review', label: 'In review', color: 'var(--jects-data-3)', isDone: false, wipLimit: 3 },
            { id: 'done', label: 'Done', color: 'var(--jects-data-4)', isDone: true },
          ],
          assignees: ['KM', 'Alex', 'Sam', 'Jo'],
          customFieldDefs: [
            { id: 'sprint', label: 'Sprint', type: 'select', options: ['S-24', 'S-25', 'S-26'], showOnRow: true },
            { id: 'points', label: 'Story points', type: 'number', showOnRow: true },
          ],
          view: 'list',
          groupBy: 'status',
          boardSwimlane: 'assignee',
          tableColumns: [
            { field: 'title', width: 220 }, { field: 'status' }, { field: 'priority' },
            { field: 'assignees' }, { field: 'due' }, { field: 'cf:points', label: 'Pts' },
          ],
          sortBy: [{ field: 'priority', dir: 'desc' }, { field: 'due', dir: 'asc' }],
          savedFilters: [
            { id: 'mine', name: 'My high-priority', filters: { assignees: ['KM'], priority: ['high'] } },
            { id: 'duesoon', name: 'Due soon', filters: { due: 'soon' } },
          ],
          now: () => new Date(2026, 5, 25),
          tasks: [
            {
              id: 'launch', title: 'Launch checklist', status: 'doing', priority: 'high',
              startDate: '2026-06-22', due: '2026-06-30',
              assignees: ['KM'], tags: [{ text: 'release', color: 'var(--jects-cmyk-magenta)' }],
              customFields: { sprint: 'S-25', points: 8 },
              estimate: 16, timeSpent: 6,
              comments: [
                { id: 'c1', author: 'KM', text: 'Pinged @Alex about the QA gate', createdAt: Date.UTC(2026, 5, 24, 9), mentions: ['Alex'] },
                { id: 'c2', author: 'Alex', text: 'On it — blocked by the signup fix', createdAt: Date.UTC(2026, 5, 24, 10) },
              ],
              attachments: [{ id: 'a1', name: 'launch-plan.pdf', type: 'application/pdf', size: 248000 }],
              children: [
                { id: 'copy', title: 'Finalize landing copy', status: 'done', assignees: ['Sam'], startDate: '2026-06-22', due: '2026-06-24' },
                { id: 'qa', title: 'QA the signup flow', status: 'review', startDate: '2026-06-25', due: '2026-06-27', priority: 'high', assignees: ['Alex'], dependencies: { blockedBy: ['bugfix'] } },
                {
                  id: 'assets', title: 'Marketing assets', status: 'doing', assignees: ['Jo'], startDate: '2026-06-24', due: '2026-06-29',
                  children: [
                    { id: 'og', title: 'OG image', status: 'done' },
                    { id: 'video', title: 'Demo video', status: 'todo', priority: 'medium', due: '2026-06-30' },
                  ],
                },
              ],
            },
            { id: 'ship', title: 'v1.0 release', status: 'todo', milestone: true, due: '2026-07-01', priority: 'high', assignees: ['KM'] },
            { id: 'standup', title: 'Daily standup notes', status: 'todo', due: '2026-06-25', priority: 'low',
              assignees: ['KM'], recurrence: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', tags: [{ text: 'ritual' }] },
            { id: 'invoices', title: 'Send invoices', status: 'done', assignees: ['Sam'], customFields: { sprint: 'S-24', points: 3 } },
            { id: 'roadmap', title: 'Draft Q3 roadmap', status: 'todo', startDate: '2026-06-26', due: '2026-07-05', priority: 'medium',
              assignees: ['Jo', 'KM'], tags: [{ text: 'planning', color: 'var(--jects-cmyk-cyan)' }], customFields: { sprint: 'S-26', points: 13 } },
            { id: 'bugfix', title: 'Fix calendar popup z-order', status: 'review', startDate: '2026-06-25', due: '2026-06-26', priority: 'high',
              assignees: ['Alex'], tags: [{ text: 'p1', color: 'var(--jects-cmyk-magenta)' }], customFields: { sprint: 'S-25', points: 2 }, dependencies: { blocks: ['qa'] } },
          ],
        });
        h.appendChild(el('div', { class: 'g-note', text: 'Five views from the toolbar: List (grouped, multi-sort), Board (WIP limits + assignee swimlanes + drag), Calendar (by due date), Timeline (start→due bars with dependency arrows), and a configurable Table. Open any task for inline pickers, comments with @mentions, an activity log, attachments, a start/stop time tracker (estimate vs spent), dependency chains with cycle detection, and custom fields. Multi-select for bulk actions, Ctrl+Z/Y undo, recurring tasks, milestones, saved filters, and JSON/CSV import & export.' }));
      }, { block: true }));
    },
    { wide: true },
  );
}
