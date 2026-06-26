/** Workflow: Kanban ↔ Gantt (shared task model). */
import { el, card } from '../shell/dom.js';
import { DAY } from '../shell/data.js';
import { section, Button, TaskBoard, Gantt, WEEK_AND_DAY } from '../shell/registry.js';

export function register() {
  section(
    'flow-planning',
    'Kanban ↔ Gantt (shared task model)',
    'ONE array of task objects is the single source of truth. A Kanban board and a Gantt chart are two views of those SAME tasks. Move a card between columns (or click “Advance a task”) and the task’s status updates — the Gantt repaints that task’s % complete AND its label live. Dragging a task in the Gantt reflects its new dates back onto the card (bonus).',
    (grid) => {
      grid.appendChild(card('Kanban + Gantt over one shared task store — a status change in one repaints the other', (h) => {
        const T0 = Date.UTC(2026, 5, 1);
        const seed = [
          ['t1', 'Research spike', 'done', 0, 4],
          ['t2', 'API design', 'done', 4, 3],
          ['t3', 'Backend build', 'doing', 7, 8],
          ['t4', 'Frontend build', 'doing', 9, 8],
          ['t5', 'Integration', 'todo', 17, 4],
          ['t6', 'QA & UAT', 'todo', 21, 5],
          ['t7', 'Launch', 'review', 26, 2],
        ];
        const model = seed.map(([id, base, status, off, dur]) => ({
          id, base, status,
          start: T0 + off * DAY, end: T0 + (off + dur) * DAY, duration: dur * DAY,
        }));
        const byId = new Map(model.map((m) => [m.id, m]));
        const deps = [
          { id: 'p1', fromId: 't1', toId: 't2', type: 'FS' },
          { id: 'p2', fromId: 't2', toId: 't3', type: 'FS' },
          { id: 'p3', fromId: 't2', toId: 't4', type: 'FS' },
          { id: 'p4', fromId: 't3', toId: 't5', type: 'FS' },
          { id: 'p5', fromId: 't4', toId: 't5', type: 'FS' },
          { id: 'p6', fromId: 't5', toId: 't6', type: 'FS' },
          { id: 'p7', fromId: 't6', toId: 't7', type: 'FS' },
        ];

        const ORDER = ['todo', 'doing', 'review', 'done'];
        const LABEL = { todo: 'To Do', doing: 'In Progress', review: 'Review', done: 'Done' };
        const PCT = { todo: 0, doing: 50, review: 80, done: 100 };
        const ganttName = (m) => `${m.base} · ${LABEL[m.status]}`;

        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.6rem;width:100%' });
        const bar = el('div', { class: 'g-flow-toolbar' });
        const flow = el('div', { class: 'g-flow is-stack' });
        const kanbanPanel = el('div', { class: 'g-flow__panel' });
        const ganttPanel = el('div', { class: 'g-flow__panel' });
        kanbanPanel.appendChild(el('h4', { text: 'Kanban — status board (drag cards or use the toolbar)' }));
        ganttPanel.appendChild(el('h4', { text: 'Gantt — same tasks, % complete + label track status' }));
        const kanbanHost = el('div', { class: 'g-flow-host', style: 'height:320px' });
        const ganttHost = el('div', { class: 'g-flow-host', style: 'height:340px' });
        kanbanPanel.appendChild(kanbanHost);
        ganttPanel.appendChild(ganttHost);
        flow.appendChild(kanbanPanel);
        flow.appendChild(ganttPanel);
        const cap = el('div', { class: 'g-note' });
        wrap.appendChild(bar);
        wrap.appendChild(flow);
        wrap.appendChild(cap);
        h.appendChild(wrap);

        const board = new TaskBoard(kanbanHost, {
          columns: [
            { id: 'todo', title: 'To Do', color: 1 },
            { id: 'doing', title: 'In Progress', color: 3 },
            { id: 'review', title: 'Review', color: 4 },
            { id: 'done', title: 'Done', color: 5 },
          ],
          cards: model.map((m, i) => ({ id: m.id, column: m.status, order: i, title: m.base,
            tags: [{ text: LABEL[m.status], color: 1 + (i % 7) }] })),
        });

        const gantt = new Gantt(ganttHost, {
          projectStart: T0,
          preset: { ...WEEK_AND_DAY, pxPerUnit: 22 },
          columns: [
            { field: 'name', header: 'Task', width: 220 },
            { field: 'percentDone', header: '% Done', width: 72 },
          ],
          tasks: model.map((m) => ({ id: m.id, name: ganttName(m),
            start: m.start, end: m.end, duration: m.duration, percentDone: PCT[m.status] })),
          dependencies: deps,
        });

        const counts = () => ORDER.map((c) => `${LABEL[c]} ${model.filter((m) => m.status === c).length}`).join(' · ');
        const updateCap = (msg) => {
          cap.textContent = (msg ? msg + ' ' : '')
            + `Shared model status: ${counts()}. Done = ${model.filter((m) => m.status === 'done').length}/${model.length}.`;
        };
        updateCap();

        let applying = false;
        board.on('cardMove', (e) => {
          const col = e.to && e.to.column;
          if (col == null) return;
          applying = true;
          try {
            for (const c of e.cards) {
              const m = byId.get(c.id);
              if (!m) continue;
              m.status = col;
              gantt.updateTask(c.id, { name: ganttName(m), percentDone: PCT[col] });
            }
          } finally { applying = false; }
          updateCap(`Moved “${(e.cards[0] || {}).title}” → ${LABEL[col] || col}; Gantt repainted.`);
        });

        gantt.on('taskChange', (e) => {
          if (applying || !e || !e.task) return;
          const m = byId.get(e.task.id);
          if (!m) return;
          if (e.task.start != null) m.start = e.task.start;
          if (e.task.end != null) m.end = e.task.end;
          try { board.applyCardEdit(e.task.id, { description: 'Finish ' + new Date(m.end).toISOString().slice(0, 10) }); } catch (_) {}
          updateCap('Gantt edit reflected onto the card.');
        });

        const advance = () => {
          for (let i = 0; i < ORDER.length - 1; i++) {
            const m = model.find((x) => x.status === ORDER[i]);
            if (m) { board.moveCard(m.id, { column: ORDER[i + 1] }); return m.id; }
          }
          return null;
        };
        const advBtn = new Button(bar, { text: 'Advance a task →', variant: 'primary', size: 'sm', icon: 'chevron-right' });
        advBtn.el.addEventListener('click', () => { if (!advance()) updateCap('All tasks are Done.'); });
        bar.appendChild(el('span', { class: 'g-note', text: 'Click to promote the earliest-stage task to the next column — watch the Gantt label + % complete update.' }));

        window.__JECTS_FLOW_PLANNING__ = { board, gantt, model, byId, advance, ganttName };
      }, { block: true }));
    },
    { wide: true },
  );
}
