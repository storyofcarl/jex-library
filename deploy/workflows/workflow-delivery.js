/**
 * Flagship workflow: Workflow Delivery.
 *
 * ONE shared set of work items is rendered three ways — Kanban cards (LEFT),
 * Gantt tasks (CENTER) and Scheduler assignments (BOTTOM) — telling the
 * "card → task → assignment" story over a single source of truth. A right-hand
 * inspector shows the focused item's todo-style detail (assignee, status,
 * estimate, subtasks, comments, dependencies). Clicking a Kanban card OR a Gantt
 * task focuses that item in the inspector; moving a card updates its status,
 * repaints the Gantt and recomputes the KPI strip.
 *
 * This is a route module in the gallery's `register()` style: it does NOT run at
 * import time — the build closure runs lazily on first activation. It loads each
 * module independently (try/catch per module) so a single failure degrades to a
 * `.g-note` instead of blanking the page.
 */
import { el } from '../shell/dom.js';
import {
  section, ensureCss,
  loadWidgets, loadKanban, loadGantt, loadScheduler, loadTimeline, loadTodo,
} from '../shell/registry.js';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/* Status model shared by every view. Column order == workflow order. */
const STATUS_ORDER = ['backlog', 'doing', 'review', 'done'];
const STATUS_LABEL = { backlog: 'Backlog', doing: 'In Progress', review: 'Review', done: 'Done' };
const STATUS_PCT = { backlog: 0, doing: 45, review: 85, done: 100 };
const STATUS_TONE = { backlog: 'warn', doing: 'warn', review: 'warn', done: 'ok' };
const STATUS_COLOR = { backlog: 1, doing: 3, review: 4, done: 5 };

/* Teams (kanban swimlanes) and assignees (scheduler / gantt resources). */
const TEAMS = [
  { id: 'product', title: 'Product' },
  { id: 'eng', title: 'Engineering' },
];
const PEOPLE = [
  { id: 'maya', name: 'Maya Ortiz', team: 'product' },
  { id: 'theo', name: 'Theo Park', team: 'eng' },
  { id: 'lena', name: 'Lena Schmidt', team: 'eng' },
  { id: 'raj', name: 'Raj Patel', team: 'product' },
];
const personName = (id) => (PEOPLE.find((p) => p.id === id) || {}).name || id;

export function register() {
  section(
    'workflow-delivery',
    'Workflow Delivery',
    'One shared set of work items, four live views: a Kanban board, a Gantt plan, a Scheduler of assignments and a task inspector — card → task → assignment over a single source of truth.',
    (grid) => {
      buildApp(grid).catch((err) => {
        grid.appendChild(el('div', { class: 'g-note', text: 'Workflow Delivery failed to build: ' + (err && err.message ? err.message : String(err)) }));
        console.error('[workflow-delivery] build failed:', err);
      });
    },
    { wide: true },
  );
}

/* The single source of truth — work items shared across every view. */
function makeItems() {
  const T0 = Date.UTC(2026, 5, 22); // Mon 22 Jun 2026
  const at = (d, h = 9) => T0 + d * DAY + h * HOUR;
  return [
    {
      id: 'w1', title: 'Design tokens audit', status: 'done', team: 'product', assignee: 'maya',
      estimate: 8, offDay: 0, durDays: 3, deps: [],
      subtasks: [{ t: 'Light ramp', done: true }, { t: 'Dark ramp', done: true }],
      comments: 4, start: at(0), end: at(2, 17),
    },
    {
      id: 'w2', title: 'API contract', status: 'done', team: 'eng', assignee: 'theo',
      estimate: 12, offDay: 0, durDays: 4, deps: [],
      subtasks: [{ t: 'OpenAPI draft', done: true }, { t: 'Review with FE', done: true }],
      comments: 6, start: at(0, 13), end: at(3, 17),
    },
    {
      id: 'w3', title: 'Board engine build', status: 'doing', team: 'eng', assignee: 'lena',
      estimate: 20, offDay: 3, durDays: 6, deps: ['w2'],
      subtasks: [{ t: 'Drag & drop', done: true }, { t: 'WIP limits', done: true }, { t: 'Undo/redo', done: false }],
      comments: 9, start: at(3), end: at(8, 17),
    },
    {
      id: 'w4', title: 'Scheduler timeline', status: 'doing', team: 'eng', assignee: 'theo',
      estimate: 18, offDay: 4, durDays: 6, deps: ['w2'],
      subtasks: [{ t: 'Shared axis', done: true }, { t: 'Recurrence', done: false }],
      comments: 3, start: at(4), end: at(9, 17),
    },
    {
      id: 'w5', title: 'Inspector + activity', status: 'review', team: 'product', assignee: 'raj',
      estimate: 10, offDay: 8, durDays: 3, deps: ['w3'],
      subtasks: [{ t: 'Detail layout', done: true }, { t: 'Comments', done: true }],
      comments: 5, start: at(8), end: at(10, 17),
    },
    {
      id: 'w6', title: 'Cross-view wiring', status: 'backlog', team: 'eng', assignee: 'lena',
      estimate: 14, offDay: 11, durDays: 4, deps: ['w3', 'w4', 'w5'],
      subtasks: [{ t: 'Click → inspect', done: false }, { t: 'Move → repaint', done: false }],
      comments: 1, start: at(11), end: at(14, 17),
    },
    {
      id: 'w7', title: 'QA & UAT', status: 'backlog', team: 'product', assignee: 'maya',
      estimate: 16, offDay: 15, durDays: 5, deps: ['w6'],
      subtasks: [{ t: 'Test plan', done: false }, { t: 'Sign-off', done: false }],
      comments: 0, start: at(15), end: at(19, 17),
    },
  ];
}

async function buildApp(grid) {
  ensureCss('widgets');
  const items = makeItems();
  const byId = new Map(items.map((it) => [it.id, it]));

  /* ── module load (independent; per-module degradation) ─────────────── */
  const loaded = { widgets: false, kanban: false, gantt: false, scheduler: false, todo: false };
  const reg = await import('../shell/registry.js');
  const tryLoad = async (key, loader) => {
    try { await loader(); loaded[key] = true; }
    catch (e) { console.warn('[workflow-delivery] module "' + key + '" failed to load:', e && e.message); }
  };
  await Promise.all([
    tryLoad('widgets', loadWidgets),
    tryLoad('kanban', loadKanban),
    tryLoad('gantt', () => Promise.all([loadGantt(), loadTimeline()])),
    tryLoad('scheduler', () => Promise.all([loadScheduler(), loadTimeline()])),
    tryLoad('todo', loadTodo),
  ]);

  /* ── chrome: hero + KPI strip + app shell grid ────────────────────── */
  const hero = el('div', { class: 'jects-module-hero' }, [
    el('h3', { text: 'Delivery control room' }),
    el('p', { text: 'The same seven work items flow through every pane. Focus one to inspect it; move a card to advance it everywhere.' }),
  ]);
  grid.appendChild(hero);

  const kpiStrip = el('div', { class: 'jects-kpi-strip', style: 'margin-bottom:.85rem' });
  grid.appendChild(kpiStrip);

  const shell = el('div', {
    class: 'jects-app-shell',
    style: 'grid-template-columns: minmax(280px, 1.15fr) minmax(320px, 1.5fr) minmax(240px, 0.95fr); grid-template-rows: auto 360px 240px;',
  });
  grid.appendChild(shell);

  /* command bar (spans the top row) */
  const cmdbar = el('div', { class: 'jects-commandbar' });
  const cmdTitle = el('div', { class: 'jects-commandbar__title', text: 'Sprint 26 · Workflow Delivery' });
  cmdbar.appendChild(cmdTitle);
  shell.appendChild(cmdbar);

  /* panes */
  const kanbanPane = el('div', { class: 'jects-app-pane', style: 'display:flex;flex-direction:column' });
  const ganttPane = el('div', { class: 'jects-app-pane', style: 'display:flex;flex-direction:column' });
  // tabindex=0 + label: the inspector is a scroll container whose content isn't
  // otherwise focusable, so keyboard users need it focusable to scroll (axe
  // scrollable-region-focusable).
  const inspectorPane = el('div', { class: 'jects-app-pane jects-app-pane--muted', tabindex: '0', 'aria-label': 'Task inspector' });
  const schedulerPane = el('div', { class: 'jects-app-pane', style: 'grid-column: 1 / -1; display:flex;flex-direction:column' });
  shell.appendChild(kanbanPane);
  shell.appendChild(ganttPane);
  shell.appendChild(inspectorPane);
  shell.appendChild(schedulerPane);

  const paneHeading = (txt) => el('div', {
    style: 'padding:.45rem .7rem;font-size:var(--jects-font-size-xs,.75rem);font-weight:650;text-transform:uppercase;letter-spacing:.04em;color:oklch(var(--jects-muted-foreground));border-bottom:1px solid oklch(var(--jects-border))',
    text: txt,
  });
  const note = (host, txt) => host.appendChild(el('div', { class: 'g-note', style: 'padding:.7rem', text: txt }));

  /* ── inspector: render a focused item's todo-style detail ─────────── */
  const inspectorBody = el('div');
  inspectorPane.appendChild(el('h4', { text: 'Task inspector', style: 'padding:.85rem .95rem 0' }));
  inspectorPane.appendChild(inspectorBody);

  const chip = (status) =>
    el('span', { class: 'jects-status-chip', 'data-tone': STATUS_TONE[status] || 'warn', text: STATUS_LABEL[status] || status });

  const renderInspector = (id, source) => {
    const it = byId.get(id);
    inspectorBody.replaceChildren();
    if (!it) {
      inspectorBody.appendChild(el('p', { class: 'g-note', style: 'padding:.95rem', text: 'Click a Kanban card or a Gantt task to inspect it.' }));
      return;
    }
    const blocked = it.deps.some((d) => (byId.get(d) || {}).status !== 'done');
    const head = el('div', { style: 'padding:0 .95rem' }, [
      el('div', { style: 'font-weight:650;font-size:1rem;margin:.2rem 0 .5rem', text: it.title }),
      el('div', { style: 'display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.7rem' }, [
        chip(it.status),
        blocked
          ? el('span', { class: 'jects-status-chip', 'data-tone': 'risk', text: 'Blocked' })
          : el('span', { class: 'jects-status-chip', 'data-tone': 'ok', text: 'Ready' }),
      ]),
    ]);
    const done = it.subtasks.filter((s) => s.done).length;
    const dl = el('dl', {}, [
      el('dt', { text: 'Assignee' }), el('dd', { text: personName(it.assignee) }),
      el('dt', { text: 'Team' }), el('dd', { text: (TEAMS.find((t) => t.id === it.team) || {}).title || it.team }),
      el('dt', { text: 'Estimate' }), el('dd', { text: it.estimate + ' h' }),
      el('dt', { text: 'Progress' }), el('dd', { text: STATUS_PCT[it.status] + ' %' }),
      el('dt', { text: 'Subtasks' }), el('dd', { text: done + ' / ' + it.subtasks.length }),
      el('dt', { text: 'Comments' }), el('dd', { text: String(it.comments) }),
      el('dt', { text: 'Depends on' }), el('dd', { text: it.deps.length ? it.deps.map((d) => (byId.get(d) || {}).title || d).join(', ') : '—' }),
    ]);
    const subs = el('div', { style: 'padding:.2rem .95rem .95rem' }, [
      el('h4', { text: 'Subtasks', style: 'margin:.9rem 0 .4rem' }),
      el('ul', { style: 'list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.3rem' },
        it.subtasks.map((s) => el('li', {
          style: 'display:flex;gap:.45rem;align-items:center;font-size:var(--jects-font-size-sm)',
        }, [
          el('span', { text: s.done ? '☑' : '☐', style: 'opacity:.75' }),
          el('span', { text: s.t, style: s.done ? 'text-decoration:line-through;opacity:.65' : '' }),
        ]))),
      source ? el('p', { class: 'g-note', style: 'margin-top:.7rem', text: 'Focused from the ' + source + '.' }) : null,
    ]);
    inspectorBody.append(head, el('div', { style: 'padding:0 .95rem' }, [dl]), subs);
  };

  /* ── KPI strip (recomputed on status change) ──────────────────────── */
  const renderKpis = () => {
    const total = items.length;
    const inProg = items.filter((it) => it.status === 'doing' || it.status === 'review').length;
    const done = items.filter((it) => it.status === 'done').length;
    const blocked = items.filter((it) => it.status !== 'done' && it.deps.some((d) => (byId.get(d) || {}).status !== 'done')).length;
    const kpi = (value, label, tone) => el('div', { class: 'jects-kpi' }, [
      el('div', { class: 'jects-kpi__value', text: String(value) }),
      el('div', { class: 'jects-kpi__label' }, [
        tone ? el('span', { class: 'jects-status-chip', 'data-tone': tone, text: label }) : el('span', { text: label }),
      ]),
    ]);
    kpiStrip.replaceChildren(
      kpi(total, 'Total items'),
      kpi(inProg, 'In progress', 'warn'),
      kpi(blocked, 'Blocked', blocked ? 'risk' : 'ok'),
      kpi(done, 'Done', 'ok'),
    );
  };
  renderKpis();
  renderInspector(null);

  /* ── LEFT: Kanban board ───────────────────────────────────────────── */
  let board = null;
  kanbanPane.appendChild(paneHeading('Board · drag to advance'));
  const kanbanHost = el('div', { style: 'flex:1;min-height:0' });
  kanbanPane.appendChild(kanbanHost);
  if (loaded.kanban) {
    try {
      board = new reg.TaskBoard(kanbanHost, {
        sortable: true,
        sortField: 'order',
        columns: STATUS_ORDER.map((id, i) => ({
          id, title: STATUS_LABEL[id], color: STATUS_COLOR[id],
          limit: id === 'doing' ? 3 : id === 'review' ? 2 : undefined,
        })),
        lanes: TEAMS,
        cards: items.map((it, i) => ({
          id: it.id, column: it.status, lane: it.team, order: i,
          title: it.title, assignee: it.assignee, avatar: personName(it.assignee).split(' ').map((w) => w[0]).join(''),
          progress: STATUS_PCT[it.status],
          tags: [{ text: personName(it.assignee).split(' ')[0], color: 2 }, { text: it.estimate + 'h', color: 6 }],
          comments: it.comments ? Array.from({ length: it.comments }, () => ({ author: personName(it.assignee), text: '…' })) : [],
        })),
      });
    } catch (e) { board = null; note(kanbanHost, 'Kanban board unavailable: ' + (e && e.message)); }
  } else {
    note(kanbanHost, 'Kanban module did not load.');
  }

  /* ── CENTER: Gantt plan ───────────────────────────────────────────── */
  let gantt = null;
  ganttPane.appendChild(paneHeading('Plan · same items as tasks'));
  const ganttHost = el('div', { style: 'flex:1;min-height:0' });
  ganttPane.appendChild(ganttHost);
  const ganttName = (it) => it.title + ' · ' + STATUS_LABEL[it.status];
  if (loaded.gantt) {
    try {
      gantt = new reg.Gantt(ganttHost, {
        projectStart: items[0].start,
        preset: { ...reg.WEEK_AND_DAY, pxPerUnit: 22 },
        showCriticalPath: true,
        columns: [
          { field: 'name', header: 'Task', width: 200 },
          { field: 'percentDone', header: '% Done', width: 72 },
        ],
        tasks: items.map((it) => ({
          id: it.id, name: ganttName(it),
          start: it.start, end: it.end, duration: it.durDays * DAY,
          percentDone: STATUS_PCT[it.status] / 100, effort: it.estimate * HOUR,
        })),
        dependencies: items.flatMap((it) =>
          it.deps.map((from, i) => ({ id: it.id + '-' + from, fromId: from, toId: it.id, type: 'FS' }))),
        resources: PEOPLE.map((p) => ({ id: p.id, name: p.name, capacity: 1 })),
        assignments: items.map((it, i) => ({ id: 'ag' + i, taskId: it.id, resourceId: it.assignee, units: 100 })),
      });
    } catch (e) { gantt = null; note(ganttHost, 'Gantt unavailable: ' + (e && e.message)); }
  } else {
    note(ganttHost, 'Gantt module did not load.');
  }

  /* ── BOTTOM: Scheduler of assignments ─────────────────────────────── */
  schedulerPane.appendChild(paneHeading('Assignments · who is on what, when'));
  const schedHost = el('div', { style: 'flex:1;min-height:0' });
  schedulerPane.appendChild(schedHost);
  if (loaded.scheduler) {
    try {
      const base = items[0].start;
      new reg.Scheduler(schedHost, {
        resources: PEOPLE.map((p) => ({ id: p.id, name: p.name, role: (TEAMS.find((t) => t.id === p.team) || {}).title })),
        events: items.map((it) => ({
          id: 's-' + it.id, resourceId: it.assignee, name: it.title,
          startDate: it.start, endDate: it.end,
          eventColor: it.status === 'done' ? 'cyan' : it.status === 'review' ? 'magenta' : 'yellow',
        })),
        calendar: { weekendDays: [0, 6], dayStartHour: 9, dayEndHour: 17 },
        showNonWorkingTime: true,
        preset: reg.WEEK_AND_DAY,
        range: { start: base, end: base + DAY * 21 },
        editable: true,
        panEnabled: true,
        infiniteScroll: true,
        eventTooltip: (e) => e.name ?? null,
      });
    } catch (e) { note(schedHost, 'Scheduler unavailable: ' + (e && e.message)); }
  } else {
    note(schedHost, 'Scheduler module did not load.');
  }

  /* ── cross-interactions ───────────────────────────────────────────── */
  let applying = false;

  // Click a Kanban card → focus it in the inspector (selectionChange { ids }).
  if (board) {
    try {
      board.on('selectionChange', (e) => {
        const id = e && e.ids && e.ids[0];
        if (id != null) renderInspector(id, 'board');
      });
    } catch (e) { console.warn('[workflow-delivery] kanban selectionChange wiring failed:', e && e.message); }

    // Bonus: moving a card advances its status → repaint Gantt + KPIs.
    try {
      board.on('cardMove', (e) => {
        const col = e && e.to && e.to.column;
        if (col == null) return;
        applying = true;
        try {
          for (const c of e.cards) {
            const it = byId.get(c.id);
            if (!it) continue;
            it.status = col;
            if (gantt) { try { gantt.updateTask(it.id, { name: ganttName(it), percentDone: STATUS_PCT[col] / 100 }); } catch (_) {} }
          }
        } finally { applying = false; }
        renderKpis();
        const moved = byId.get((e.cards[0] || {}).id);
        if (moved) renderInspector(moved.id, 'board');
        cmdTitle.textContent = 'Sprint 26 · moved “' + ((e.cards[0] || {}).title || '') + '” → ' + (STATUS_LABEL[col] || col);
      });
    } catch (e) { console.warn('[workflow-delivery] kanban cardMove wiring failed:', e && e.message); }
  }

  // Click a Gantt task bar → focus it in the inspector (taskClick { task }).
  if (gantt) {
    try {
      gantt.on('taskClick', (e) => {
        const id = e && e.task && e.task.id;
        if (id != null) renderInspector(id, 'plan');
      });
    } catch (e) { console.warn('[workflow-delivery] gantt taskClick wiring failed:', e && e.message); }
  }

  // Seed the inspector with the first in-progress item so the panel is never empty.
  const seed = items.find((it) => it.status === 'doing') || items[0];
  if (seed) renderInspector(seed.id);

  grid.appendChild(el('div', { class: 'g-note', style: 'margin-top:.75rem',
    text: 'Cross-interaction: clicking a Kanban card (selectionChange) or a Gantt task bar (taskClick) focuses that item in the inspector. Dragging a card to a new column (cardMove) advances its status — the Gantt task’s % complete + label repaint and the KPI strip recomputes, all from the one shared item array.' }));
}
