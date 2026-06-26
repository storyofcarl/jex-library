/** Workflow: live collaboration (simulated remote provider). */
import { el, card } from '../shell/dom.js';
import { section, Button, TaskBoard } from '../shell/registry.js';

export function register() {
  section(
    'realtime',
    'Live collaboration',
    "A TaskBoard wired to a simulated multi-user data provider. Press Start — the board updates on its own (cards move, arrive, get reassigned and relabelled, as if teammates were collaborating) through the board's real dataProvider.subscribe() surface. Every remote event is logged to the activity feed. Pause genuinely stops the stream.",
    (grid) => {
      grid.appendChild(card('Real-time board — simulated remote provider via subscribe()', (h) => {
        const COLUMNS = [
          { id: 'backlog', title: 'Backlog', color: 1 },
          { id: 'todo', title: 'To Do', color: 2 },
          { id: 'doing', title: 'In Progress', color: 3, limit: 5 },
          { id: 'review', title: 'Review', color: 4 },
          { id: 'done', title: 'Done', color: 5 },
        ];
        const COL_TITLE = Object.fromEntries(COLUMNS.map((c) => [c.id, c.title || c.id]));
        const TEAM = ['Alex', 'Brook', 'Casey', 'Devon', 'Erin'];
        const INITIALS = { Alex: 'AX', Brook: 'BR', Casey: 'CY', Devon: 'DV', Erin: 'ER' };
        const LABELS = [
          { text: 'feature', color: 2 }, { text: 'bug', color: 6 }, { text: 'chore', color: 7 },
          { text: 'p1', color: 4 }, { text: 'perf', color: 3 }, { text: 'design', color: 1 },
        ];
        const VERBS = ['Implement', 'Fix', 'Refactor', 'Polish', 'Wire up', 'Tune', 'Audit', 'Ship', 'Document'];
        const NOUNS = ['search', 'flaky test', 'data store', 'drag handles', 'webhooks', 'cache layer',
          'a11y pass', 'export', 'onboarding', 'rate limiter', 'theme tokens'];
        const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
        const newTitle = () => rand(VERBS) + ' ' + rand(NOUNS);

        const MIN_CARDS = 6, MAX_CARDS = 16;
        let nextId = 1000; // ids for remotely-arriving cards

        const seed = [];
        for (let i = 0; i < 9; i++) {
          const who = rand(TEAM);
          seed.push({
            id: i + 1, column: COLUMNS[i % COLUMNS.length].id, order: i,
            title: newTitle(), assignee: who, avatar: INITIALS[who],
            tags: [rand(LABELS)], progress: (i * 17) % 101,
          });
        }

        const provider = {
          board: null,
          onRemote: null,
          onActivity: null,
          timer: null,
          load() { return Promise.resolve(seed.map((c) => ({ ...c }))); },
          sync() { return Promise.resolve(); }, // local drags would POST here; no-op for the sim
          subscribe(onRemote) {
            this.onRemote = onRemote;
            return () => { this.onRemote = null; this.stop(); };
          },
          start() {
            if (this.timer) return;
            const tick = () => { this.emitOne(); this.timer = setTimeout(tick, 1500 + Math.random() * 1000); };
            this.timer = setTimeout(tick, 1500 + Math.random() * 1000);
          },
          stop() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } },
          log(msg) { if (this.onActivity) this.onActivity(msg); },
          emitOne() {
            if (!this.onRemote || !this.board) return;
            const cards = this.board.store.toArray();
            const actor = rand(TEAM);
            let action;
            if (cards.length <= MIN_CARDS) action = Math.random() < 0.45 ? 'add' : 'move';
            else if (cards.length >= MAX_CARDS) action = Math.random() < 0.5 ? 'remove' : 'move';
            else { const r = Math.random(); action = r < 0.55 ? 'move' : r < 0.78 ? 'edit' : r < 0.9 ? 'add' : 'remove'; }
            if (!cards.length) action = 'add';

            if (action === 'add') {
              const id = ++nextId;
              const who = rand(TEAM);
              const col = rand(COLUMNS);
              const card = {
                id, column: col.id, order: Date.now(), title: newTitle(),
                assignee: who, avatar: INITIALS[who], tags: [rand(LABELS)], progress: 0,
              };
              this.onRemote({ action: 'add', id, card });
              this.log(actor + ' added “' + card.title + '” to ' + col.title);
              return;
            }
            const t = rand(cards);
            const name = t.title || ('Card ' + t.id);
            if (action === 'remove') {
              this.onRemote({ action: 'remove', id: t.id });
              this.log(actor + ' archived “' + name + '”');
              return;
            }
            if (action === 'edit') {
              const kind = rand(['assignee', 'label', 'progress']);
              if (kind === 'assignee') {
                const who = rand(TEAM);
                this.onRemote({ action: 'update', id: t.id, card: { assignee: who, avatar: INITIALS[who] } });
                this.log(actor + ' assigned “' + name + '” to ' + who);
              } else if (kind === 'label') {
                const lab = rand(LABELS);
                this.onRemote({ action: 'update', id: t.id, card: { tags: [lab] } });
                this.log(actor + ' labelled “' + name + '” ' + lab.text);
              } else {
                const p = Math.min(100, (t.progress || 0) + 10 + Math.floor(Math.random() * 30));
                this.onRemote({ action: 'update', id: t.id, card: { progress: p } });
                this.log(actor + ' moved “' + name + '” to ' + p + '%');
              }
              return;
            }
            const to = rand(COLUMNS.filter((c) => c.id !== t.column)) || rand(COLUMNS);
            this.onRemote({ action: 'update', id: t.id, card: { column: to.id, order: Date.now() } });
            this.log(actor + ' moved “' + name + '” to ' + to.title);
          },
        };

        /* ── chrome: Live indicator + Start/Pause + per-column counts ── */
        const bar = el('div', { class: 'g-host-toolbar g-rt-bar' });
        const dot = el('span', { class: 'g-rt-dot', 'aria-hidden': 'true' });
        const indText = el('span', { class: 'g-rt-indicator-text', text: 'Paused' });
        const indicator = el('span', { class: 'g-rt-indicator', 'data-rt-live': 'false', role: 'status' }, [dot, indText]);
        bar.appendChild(indicator);
        const toggleBtn = new Button(bar, { text: 'Start', variant: 'primary', size: 'sm' });
        toggleBtn.el.setAttribute('data-rt-toggle', '');
        const counts = el('span', { class: 'g-note g-rt-counts', 'data-rt-counts': '' });
        bar.appendChild(counts);

        const host = el('div', { style: 'height:var(--g-page-host);width:100%' });
        const feed = el('ul', { class: 'g-rt-feed', 'data-rt-feed': '', 'aria-label': 'Activity feed' });
        const feedWrap = el('div', { class: 'g-rt-feedwrap' }, [
          el('div', { class: 'g-rt-feedhd', text: 'Activity' }),
          feed,
        ]);
        const layout = el('div', { class: 'g-rt-layout' }, [
          el('div', { class: 'g-rt-boardwrap' }, [host]),
          feedWrap,
        ]);
        h.appendChild(bar);
        h.appendChild(layout);

        const board = new TaskBoard(host, {
          toolbar: true,
          searchPlaceholder: 'Search cards…',
          columns: COLUMNS,
          dataProvider: provider,
        });
        provider.board = board;

        const rtState = (window.__JECTS_REALTIME__ = window.__JECTS_REALTIME__ || { live: false, events: 0, total: 0, counts: {} });

        function updateCounts() {
          try {
            const arr = board.store.toArray();
            const per = {};
            for (const c of COLUMNS) per[c.id] = 0;
            for (const c of arr) if (per[c.column] != null) per[c.column]++;
            counts.textContent = COLUMNS.map((c) => COL_TITLE[c.id] + ' ' + per[c.id]).join(' · ') + ' · ' + arr.length + ' cards';
            rtState.counts = per;
            rtState.total = arr.length;
          } catch (_) { /* store not ready yet */ }
        }

        let feedCount = 0;
        provider.onActivity = (msg) => {
          feedCount++;
          rtState.events = feedCount;
          const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const li = el('li', { class: 'g-rt-event' }, [
            el('span', { class: 'g-rt-event-time', text: time }),
            el('span', { class: 'g-rt-event-msg', text: msg }),
          ]);
          feed.insertBefore(li, feed.firstChild);
          while (feed.childElementCount > 40) feed.removeChild(feed.lastChild);
          updateCounts();
        };

        let live = false;
        const setLive = (on) => {
          live = on;
          rtState.live = on;
          indicator.setAttribute('data-rt-live', String(on));
          indText.textContent = on ? 'Live' : 'Paused';
          toggleBtn.el.textContent = on ? 'Pause' : 'Start';
          if (on) provider.start(); else provider.stop();
        };
        toggleBtn.el.addEventListener('click', () => setLive(!live));

        setTimeout(updateCounts, 60);
        setTimeout(updateCounts, 450);
      }, { block: true }));
    },
    { wide: true },
  );
}
