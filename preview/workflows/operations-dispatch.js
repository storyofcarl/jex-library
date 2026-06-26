/** Route: operations-dispatch — a flagship cross-module "Operations Dispatch" workspace.
 *
 * One shared dataset (field technicians + a day's jobs) drives every pane:
 *   LEFT   — a Grid of technicians with live capacity / status chips
 *   CENTER — the Scheduler (resources × time), the dispatch centerpiece
 *   RIGHT  — an "Unplanned jobs" dispatch queue
 *   BOTTOM — a computed per-tech utilization strip + a Calendar of the day's plan
 *
 * Cross-interaction: clicking an unplanned job ASSIGNS it — a real event is pushed
 * into the Scheduler's EventStore (.add) for a chosen technician at the next free
 * slot, the job leaves the queue, the Calendar gains a matching event, and the
 * KPIs + utilization bars recompute. Clicking any Scheduler event populates the
 * right-hand inspector. All engine wiring uses the real public API.
 */
import { el } from '../shell/dom.js';
import {
  section, ensureCss,
  loadScheduler, loadGrid, loadCalendar, loadCore,
  Scheduler, Grid, Calendar, HOUR_AND_DAY,
} from '../shell/registry.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export function register() {
  section(
    'operations-dispatch',
    'Operations Dispatch',
    'A live field-service dispatch board: one shared roster + job set drives a technician grid, a resource-by-time scheduler, an unplanned-jobs queue, and a utilization plan — click a queued job to dispatch it across every pane at once.',
    build,
    { wide: true },
  );
}

async function build(grid) {
  ensureCss('scheduler'); ensureCss('grid'); ensureCss('calendar');
  // Load engines up front; each pane still guards its own construction.
  await Promise.allSettled([loadScheduler(), loadGrid(), loadCalendar(), loadCore()]);

  /* ─────────────────────────── shared dataset ─────────────────────────── */
  const base = Date.UTC(2026, 5, 26); // a single day: Fri 26 Jun 2026 (UTC midnight)
  const dayStart = 8, dayEnd = 18;    // working window 08:00–18:00

  // Field technicians / resources — capacity = jobs they can hold this shift.
  const technicians = [
    { id: 'r1', name: 'Alice Nguyen', role: 'Lead Tech', skill: 'Electrical', capacity: 4, status: 'available' },
    { id: 'r2', name: 'Bob Martin', role: 'Field Tech', skill: 'HVAC', capacity: 3, status: 'available' },
    { id: 'r3', name: 'Carol Diaz', role: 'Field Tech', skill: 'Plumbing', capacity: 4, status: 'available' },
    { id: 'r4', name: 'Dave Okafor', role: 'Installer', skill: 'Install', capacity: 3, status: 'on-route' },
    { id: 'r5', name: 'Erin Walsh', role: 'Surveyor', skill: 'Survey', capacity: 2, status: 'available' },
    { id: 'r6', name: 'Frank Li', role: 'Support', skill: 'Electrical', capacity: 3, status: 'off-shift' },
  ];

  // Jobs already scheduled on the board (resourceId + span).
  const scheduledJobs = [
    { id: 'j1', resourceId: 'r1', name: 'Panel upgrade — 14 Oak St', startH: 9, durH: 3, color: 'cyan' },
    { id: 'j2', resourceId: 'r1', name: 'Breaker swap — Depot', startH: 13, durH: 2, color: 'cyan' },
    { id: 'j3', resourceId: 'r2', name: 'AC service — Riverside', startH: 9, durH: 4, color: 'magenta' },
    { id: 'j4', resourceId: 'r3', name: 'Leak repair — Elm Ct', startH: 10, durH: 2, color: 'yellow' },
    { id: 'j5', resourceId: 'r4', name: 'Meter install — Hill Rd', startH: 11, durH: 3, color: 'cyan' },
    { id: 'j6', resourceId: 'r5', name: 'Site survey — Bayfront', startH: 9, durH: 3, color: 'magenta' },
  ];

  // The dispatch queue — unplanned jobs awaiting assignment.
  const unplannedJobs = [
    { id: 'u1', name: 'Emergency outage — 7 Pine', skill: 'Electrical', durH: 2, priority: 'High' },
    { id: 'u2', name: 'Thermostat fault — Mall', skill: 'HVAC', durH: 1, priority: 'Med' },
    { id: 'u3', name: 'Pipe burst — Cedar Apts', skill: 'Plumbing', durH: 3, priority: 'High' },
    { id: 'u4', name: 'Fixture install — Suite 9', skill: 'Install', durH: 2, priority: 'Low' },
    { id: 'u5', name: 'Inspection — Warehouse B', skill: 'Survey', durH: 2, priority: 'Med' },
  ];

  // Mutable plan state: counts of jobs assigned per technician (seed from scheduled).
  const assignedCount = new Map(technicians.map((t) => [t.id, 0]));
  for (const j of scheduledJobs) assignedCount.set(j.resourceId, (assignedCount.get(j.resourceId) || 0) + 1);
  // Track the next free hour per tech so dispatched jobs stack rather than overlap.
  const nextFreeHour = new Map(technicians.map((t) => [t.id, dayStart]));
  for (const j of scheduledJobs) {
    nextFreeHour.set(j.resourceId, Math.max(nextFreeHour.get(j.resourceId), j.startH + j.durH));
  }

  /* ─────────────────────────── shell scaffold ─────────────────────────── */
  const hero = el('div', { class: 'jects-module-hero' }, [
    el('h3', { text: 'Field-service control room' }),
    el('p', { text: 'Six technicians, a shift of work, and a live queue — dispatch jobs and watch the grid, scheduler, calendar and utilization plan stay in lockstep.' }),
  ]);
  grid.appendChild(hero);

  const kpiStrip = el('div', { class: 'jects-kpi-strip', style: 'margin-bottom:.85rem' });
  grid.appendChild(kpiStrip);
  const kpi = (label) => {
    const value = el('div', { class: 'jects-kpi__value', text: '—' });
    kpiStrip.appendChild(el('div', { class: 'jects-kpi' }, [value, el('div', { class: 'jects-kpi__label', text: label })]));
    return value;
  };
  const kTech = kpi('Technicians on shift');
  const kScheduled = kpi('Scheduled jobs');
  const kUnplanned = kpi('Unplanned jobs');
  const kUtil = kpi('Avg utilization');

  const shell = el('div', {
    class: 'jects-app-shell',
    style: 'grid-template-columns: 250px minmax(0,1fr) 280px; grid-template-rows: auto minmax(0,1fr) auto;',
  });
  grid.appendChild(shell);

  // Command bar (spans all columns).
  const cmd = el('div', { class: 'jects-commandbar' }, [
    el('span', { class: 'jects-commandbar__title', text: 'Dispatch board · Fri 26 Jun 2026' }),
  ]);
  const cmdStatus = el('span', { class: 'g-note', style: 'margin:0' });
  cmd.appendChild(cmdStatus);
  shell.appendChild(cmd);
  const setStatus = (m) => { cmdStatus.textContent = m; };

  // Pane hosts with explicit heights; panes scroll.
  const leftPane = el('div', { class: 'jects-app-pane jects-app-pane--muted', style: 'height:440px' });
  const centerPane = el('div', { class: 'jects-app-pane', style: 'height:440px' });
  const rightPane = el('div', { class: 'jects-app-pane jects-app-pane--muted', style: 'height:440px;display:flex;flex-direction:column' });
  shell.appendChild(leftPane);
  shell.appendChild(centerPane);
  shell.appendChild(rightPane);

  // Bottom strip (spans all columns): utilization + calendar.
  const bottomPane = el('div', { class: 'jects-app-pane', style: 'grid-column:1 / -1;display:grid;grid-template-columns: 320px minmax(0,1fr);min-height:0' });
  const utilHost = el('div', { class: 'jects-app-pane--muted', style: 'height:300px;overflow:auto;padding:.85rem .95rem;border-right:1px solid oklch(var(--jects-border))' });
  const calHost = el('div', { style: 'height:300px;overflow:auto' });
  bottomPane.appendChild(utilHost);
  bottomPane.appendChild(calHost);
  shell.appendChild(bottomPane);

  const note = (host, msg) => host.appendChild(el('div', { class: 'g-note', text: msg }));

  /* ─────────────────────────── CENTER: Scheduler ──────────────────────── */
  let sched = null;
  try {
    const schedHost = el('div', { style: 'height:100%;width:100%' });
    centerPane.appendChild(schedHost);
    sched = new Scheduler(schedHost, {
      resources: technicians.map((t) => ({ id: t.id, name: t.name, role: t.role, capacity: t.capacity })),
      events: scheduledJobs.map((j) => ({
        id: j.id, resourceId: j.resourceId, name: j.name,
        startDate: base + j.startH * HOUR, endDate: base + (j.startH + j.durH) * HOUR,
        eventColor: j.color,
      })),
      calendar: { dayStartHour: dayStart, dayEndHour: dayEnd },
      showNonWorkingTime: true,
      preset: HOUR_AND_DAY,
      range: { start: base, end: base + DAY },
      creatable: true,
      editable: true,
      panEnabled: true,
      eventTooltip: (e) => e.name ?? null,
    });
    // Cross-interaction (B): clicking a scheduler event shows its detail in the inspector.
    sched.on('eventClick', ({ event, resource }) => {
      showInspector(event, resource);
      setStatus('Selected job: ' + (event.name || event.id));
    });
  } catch (e) {
    note(centerPane, 'Scheduler unavailable: ' + (e && e.message ? e.message : e));
    console.warn('[operations-dispatch] scheduler failed:', e);
  }

  /* ─────────────────────────── LEFT: technician Grid ──────────────────── */
  let techGrid = null;
  const STATUS_TONE = { available: 'ok', 'on-route': 'warn', 'off-shift': 'risk' };
  const techRow = (t) => {
    const used = assignedCount.get(t.id) || 0;
    return { ...t, load: used + ' / ' + t.capacity };
  };
  try {
    const gridHost = el('div', { style: 'height:100%;width:100%' });
    leftPane.appendChild(gridHost);
    techGrid = new Grid(gridHost, {
      data: technicians.map(techRow),
      selection: 'single',
      features: { sort: { multi: false } },
      columns: [
        { field: 'name', header: 'Technician', flex: 1, minWidth: 120, sortable: true },
        { field: 'skill', header: 'Skill', width: 92, sortable: true },
        { field: 'load', header: 'Load', width: 64, align: 'center' },
        {
          field: 'status', header: 'Status', width: 96, type: 'template',
          renderer: (ctx) => {
            const chip = el('span', { class: 'jects-status-chip', text: ctx.value });
            chip.dataset.tone = STATUS_TONE[ctx.value] || 'warn';
            ctx.el.replaceChildren(chip);
          },
        },
      ],
    });
  } catch (e) {
    // Fallback: a styled resource list so the pane is never blank.
    note(leftPane, 'Grid unavailable — list fallback.');
    const list = el('div', { style: 'padding:.5rem' });
    for (const t of technicians) {
      const tone = STATUS_TONE[t.status] || 'warn';
      list.appendChild(el('div', { style: 'display:flex;justify-content:space-between;gap:.4rem;padding:.35rem 0;border-bottom:1px solid oklch(var(--jects-border))' }, [
        el('span', { text: t.name }),
        (() => { const c = el('span', { class: 'jects-status-chip', text: t.status }); c.dataset.tone = tone; return c; })(),
      ]));
    }
    leftPane.appendChild(list);
    console.warn('[operations-dispatch] grid failed:', e);
  }
  // Refresh the technician grid's load/status cells after a dispatch.
  function refreshTechGrid() {
    if (!techGrid) return;
    try {
      for (const t of technicians) {
        const store = techGrid.store || (techGrid.api && techGrid.api.store);
        if (store && store.update) store.update(t.id, techRow(t));
      }
      if (techGrid.refresh) techGrid.refresh();
    } catch (e) { console.warn('[operations-dispatch] tech grid refresh failed:', e); }
  }

  /* ─────────────────────────── BOTTOM: Calendar of the plan ───────────── */
  let cal = null;
  try {
    cal = new Calendar(calHost, {
      date: new Date(2026, 5, 26),
      view: 'day',
      dayStartHour: dayStart,
      dayEndHour: dayEnd,
      toolbar: true,
      categories: [
        { id: 'planned', name: 'Planned', color: 'data-1' },
        { id: 'dispatched', name: 'Dispatched', color: 'data-3' },
      ],
      events: scheduledJobs.map((j) => ({
        id: j.id, title: j.name,
        start: new Date(2026, 5, 26, j.startH, 0),
        end: new Date(2026, 5, 26, j.startH + j.durH, 0),
        categoryId: 'planned',
      })),
    });
  } catch (e) {
    note(calHost, 'Calendar unavailable: ' + (e && e.message ? e.message : e));
    console.warn('[operations-dispatch] calendar failed:', e);
  }

  /* ─────────────────────────── BOTTOM: utilization bars ───────────────── */
  utilHost.appendChild(el('h4', { class: 'jects-inspector', style: 'padding:0;background:none;margin:0 0 .6rem', text: 'Crew utilization' }));
  const utilBars = el('div', { style: 'display:flex;flex-direction:column;gap:.55rem' });
  utilHost.appendChild(utilBars);
  function renderUtil() {
    utilBars.replaceChildren();
    for (const t of technicians) {
      const used = assignedCount.get(t.id) || 0;
      const pct = Math.min(100, Math.round((used / t.capacity) * 100));
      const tone = pct >= 100 ? 'risk' : pct >= 75 ? 'warn' : 'ok';
      const fill = el('div', {
        style: `height:100%;width:${pct}%;border-radius:999px;background:oklch(var(--jects-data-${tone === 'risk' ? 3 : tone === 'warn' ? 4 : 2}));transition:width .25s`,
      });
      const track = el('div', { style: 'height:8px;border-radius:999px;background:var(--jects-surface-3);overflow:hidden' }, [fill]);
      utilBars.appendChild(el('div', {}, [
        el('div', { style: 'display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:.2rem' }, [
          el('span', { text: t.name }),
          el('span', { style: 'font-variant-numeric:tabular-nums', text: used + '/' + t.capacity + ' · ' + pct + '%' }),
        ]),
        track,
      ]));
    }
  }

  /* ─────────────────────────── RIGHT: dispatch queue ──────────────────── */
  const queueHead = el('div', { style: 'padding:.7rem .8rem;font-weight:650;border-bottom:1px solid oklch(var(--jects-border));flex:0 0 auto' }, [
    'Unplanned jobs ',
    (() => { const c = el('span', { class: 'jects-status-chip', text: String(unplannedJobs.length) }); c.dataset.tone = 'warn'; c.id = 'op-queue-count'; return c; })(),
  ]);
  rightPane.appendChild(queueHead);
  const queueList = el('div', { style: 'overflow:auto;padding:.5rem;display:flex;flex-direction:column;gap:.45rem' });
  rightPane.appendChild(queueList);

  // Inspector lives below the queue (right pane), shown on scheduler event click.
  const inspector = el('div', { class: 'jects-inspector', style: 'border-top:1px solid oklch(var(--jects-border));flex:0 0 auto' });
  rightPane.appendChild(inspector);
  function showInspector(event, resource) {
    inspector.replaceChildren(
      el('h4', { text: 'Job detail' }),
      el('dl', {}, [
        el('dt', { text: 'Job' }), el('dd', { text: event.name || String(event.id) }),
        el('dt', { text: 'Technician' }), el('dd', { text: resource ? resource.name : '—' }),
        el('dt', { text: 'Start' }), el('dd', { text: fmtTime(event.startDate) }),
        el('dt', { text: 'End' }), el('dd', { text: fmtTime(event.endDate) }),
      ]),
    );
  }
  function fmtTime(ms) {
    if (ms == null) return '—';
    const d = new Date(ms);
    return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  }
  // Default inspector hint.
  inspector.appendChild(el('h4', { text: 'Job detail' }));
  inspector.appendChild(el('div', { class: 'g-note', style: 'margin:0', text: 'Click a job on the board to inspect it, or dispatch a queued job →' }));

  // Pick the best-fit available technician for a job's skill (else any available).
  function pickTechnician(job) {
    const usable = technicians.filter((t) => t.status !== 'off-shift');
    const bySkill = usable.filter((t) => t.skill === job.skill && (assignedCount.get(t.id) || 0) < t.capacity);
    const pool = bySkill.length ? bySkill : usable.filter((t) => (assignedCount.get(t.id) || 0) < t.capacity);
    if (!pool.length) return null;
    // Least-loaded first.
    pool.sort((a, b) => (assignedCount.get(a.id) || 0) - (assignedCount.get(b.id) || 0));
    return pool[0];
  }

  // Cross-interaction (A): dispatch a queued job → real EventStore.add + cascade.
  function dispatchJob(job, cardEl) {
    const tech = pickTechnician(job);
    if (!tech) { setStatus('No technician with free capacity for ' + job.name + '.'); return; }
    const startH = Math.min(nextFreeHour.get(tech.id), dayEnd - job.durH);
    const startMs = base + startH * HOUR;
    const endMs = startMs + job.durH * HOUR;
    let ok = false;
    if (sched) {
      try {
        // Real Scheduler API: push the event into the live EventStore → auto-repaints.
        sched.getEventStore().add({
          id: 'd-' + job.id, resourceId: tech.id, name: job.name,
          startDate: startMs, endDate: endMs, eventColor: 'green',
        });
        ok = true;
      } catch (e) { console.warn('[operations-dispatch] eventStore.add failed:', e); }
    }
    if (!ok) { setStatus('Could not add the job to the scheduler.'); return; }

    // Mirror into the Calendar plan (real Calendar.addEvent).
    if (cal) {
      try {
        cal.addEvent({
          id: 'd-' + job.id, title: job.name + ' — ' + tech.name,
          start: new Date(2026, 5, 26, startH, 0),
          end: new Date(2026, 5, 26, startH + job.durH, 0),
          categoryId: 'dispatched',
        });
      } catch (e) { console.warn('[operations-dispatch] calendar.addEvent failed:', e); }
    }

    // Update plan state + remove the job from the queue.
    assignedCount.set(tech.id, (assignedCount.get(tech.id) || 0) + 1);
    nextFreeHour.set(tech.id, startH + job.durH);
    const idx = unplannedJobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) unplannedJobs.splice(idx, 1);
    cardEl.remove();

    refreshTechGrid();
    renderUtil();
    refreshKpis();
    setStatus('Dispatched "' + job.name + '" to ' + tech.name + ' at ' + String(startH).padStart(2, '0') + ':00.');
  }

  function renderQueue() {
    queueList.replaceChildren();
    if (!unplannedJobs.length) {
      queueList.appendChild(el('div', { class: 'g-note', text: 'Queue clear — every job is dispatched.' }));
      return;
    }
    const PRIO_TONE = { High: 'risk', Med: 'warn', Low: 'ok' };
    for (const job of unplannedJobs) {
      const card = el('button', {
        type: 'button',
        class: 'jects-app-pane',
        style: 'text-align:left;cursor:pointer;border:1px solid oklch(var(--jects-border));border-radius:.45rem;padding:.55rem .6rem;background:var(--jects-surface-1);display:flex;flex-direction:column;gap:.35rem;width:100%',
      });
      card.appendChild(el('div', { style: 'font-weight:600;font-size:.85rem', text: job.name }));
      const meta = el('div', { style: 'display:flex;gap:.3rem;align-items:center;flex-wrap:wrap' });
      const pchip = el('span', { class: 'jects-status-chip', text: job.priority });
      pchip.dataset.tone = PRIO_TONE[job.priority] || 'warn';
      meta.appendChild(pchip);
      meta.appendChild(el('span', { class: 'g-note', style: 'margin:0', text: job.skill + ' · ' + job.durH + 'h' }));
      card.appendChild(meta);
      card.appendChild(el('span', { class: 'g-note', style: 'margin:0;font-size:.72rem', text: 'Click to dispatch →' }));
      card.addEventListener('click', () => dispatchJob(job, card));
      queueList.appendChild(card);
    }
  }

  /* ─────────────────────────── KPIs ───────────────────────────────────── */
  function refreshKpis() {
    const onShift = technicians.filter((t) => t.status !== 'off-shift').length;
    let scheduled = 0;
    if (sched) { try { scheduled = sched.getEventStore().count; } catch (_) { scheduled = scheduledJobs.length; } }
    else scheduled = scheduledJobs.length;
    const totalCap = technicians.reduce((s, t) => s + t.capacity, 0);
    const totalUsed = [...assignedCount.values()].reduce((s, n) => s + n, 0);
    const util = totalCap ? Math.round((totalUsed / totalCap) * 100) : 0;
    kTech.textContent = String(onShift);
    kScheduled.textContent = String(scheduled);
    kUnplanned.textContent = String(unplannedJobs.length);
    kUtil.textContent = util + '%';
    const qc = document.getElementById('op-queue-count');
    if (qc) qc.textContent = String(unplannedJobs.length);
  }

  // Initial paint.
  renderQueue();
  renderUtil();
  refreshKpis();
  setStatus('Ready — ' + unplannedJobs.length + ' jobs awaiting dispatch.');
}
