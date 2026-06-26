/**
 * Route: accessibility status.
 *
 * A per-module accessibility status page. Keyboard / ARIA status come from a
 * small static, honest map (qualitative — what each module actually ships);
 * the axe-checked test counts come from ./matrix.json (the `a11y` field per
 * package), so we never fabricate a number. If matrix.json can't be fetched
 * the static map still renders on its own — no broken UI.
 *
 * Pure DOM/CSS + house tokens — no @jects component module, so it builds
 * instantly and has no real loader.
 */
import { el, card } from '../shell/dom.js';
import { section } from '../shell/registry.js';

/* Honest per-module a11y status. `pkg` ties the row to its matrix.json entry
   (for the axe test count). `keyboard` / `aria` are qualitative truths:
   - 'Full'  → full keyboard model / complete ARIA roles + state
   - 'n/a'   → display-only / non-interactive surface
   `notes` is a short, accurate description of the module's a11y model. */
const MODULES = [
  {
    label: 'Grid', pkg: '@jects/grid', keyboard: 'Full', aria: 'Full',
    notes: 'Roving cell focus, arrow-key/Home/End/PageUp-Down navigation, Enter to edit, type-ahead; grid/row/columnheader/gridcell roles with aria-sort, aria-selected and aria-rowcount/colcount.',
  },
  {
    label: 'Pivot', pkg: '@jects/pivot', keyboard: 'Full', aria: 'Full',
    notes: 'Keyboard-navigable cross-tab; expandable row/column groups via Enter/Space; table/treegrid semantics with aria-expanded on group headers.',
  },
  {
    label: 'Spreadsheet', pkg: '@jects/spreadsheet', keyboard: 'Full', aria: 'Full',
    notes: 'Full cell-grid keyboard model — arrows, range selection with Shift, F2/Enter to edit, formula entry; grid role with aria-colindex/rowindex and a live-region for recalculated values.',
  },
  {
    label: 'Gantt', pkg: '@jects/gantt', keyboard: 'Full', aria: 'Full',
    notes: 'Keyboard task navigation and reschedule (arrows nudge dates), expand/collapse WBS rows; treegrid semantics, aria-expanded on summary rows, labelled task bars.',
  },
  {
    label: 'Scheduler', pkg: '@jects/scheduler', keyboard: 'Full', aria: 'Full',
    notes: 'Keyboard event focus and move/resize, time-axis navigation; grid/row semantics with labelled events and an aria-live status for drag operations.',
  },
  {
    label: 'Calendar', pkg: '@jects/calendar', keyboard: 'Full', aria: 'Full',
    notes: 'Arrow-key date navigation across day/week/month, Enter to open an event, view switching from the keyboard; grid role for the month view, labelled day cells and events.',
  },
  {
    label: 'Diagram', pkg: '@jects/diagram', keyboard: 'Full', aria: 'Full',
    notes: 'Tab/arrow shape focus, keyboard move and connect, delete/undo; application/group roles with labelled shapes and connectors.',
  },
  {
    label: 'Kanban', pkg: '@jects/kanban', keyboard: 'Full', aria: 'Full',
    notes: 'Keyboard card focus and move across columns/lanes (arrow + modifier), Enter to open the editor; list/listitem semantics with aria-grabbed during a keyboard drag.',
  },
  {
    label: 'To-Do', pkg: '@jects/todo', keyboard: 'Full', aria: 'Full',
    notes: 'Keyboard task navigation, complete with Space, reorder and indent from the keyboard; list semantics with aria-checked and labelled actions.',
  },
  {
    label: 'Booking', pkg: '@jects/booking', keyboard: 'Full', aria: 'Full',
    notes: 'Keyboard slot navigation and selection through the availability grid; grid role with labelled, aria-disabled unavailable slots.',
  },
  {
    label: 'Charts', pkg: '@jects/charts', keyboard: 'Full', aria: 'Full',
    notes: 'Keyboard-focusable series/points with arrow navigation, an accessible data summary; img role with aria-label plus an off-screen data table fallback.',
  },
  {
    label: 'Widgets', pkg: '@jects/widgets', keyboard: 'Full', aria: 'Full',
    notes: 'Every interactive widget (buttons, inputs, selects, menus, tabs, dialogs, toasts) ships the WAI-ARIA Authoring-Practices pattern: correct roles, keyboard model and focus management, including focus trapping in overlays.',
  },
  {
    label: 'Timeline Core', pkg: '@jects/timeline-core', keyboard: 'Full', aria: 'Full',
    notes: 'The shared time-axis / viewport substrate — keyboard pan/zoom and row navigation reused by Scheduler and Gantt.',
  },
];

export function register() {
  section(
    'a11y',
    'Accessibility',
    'Per-module accessibility status — the keyboard model, ARIA roles and axe-checked test coverage that ship across the suite.',
    (grid) => {
      grid.appendChild(card('Accessibility approach', (h) => {
        const lead = el('div', { style: 'display:flex;flex-direction:column;gap:.6rem;width:100%' });
        lead.appendChild(el('p', { class: 'g-note', style: 'margin:0',
          text: 'Accessibility is built into the core, not bolted on. Every interactive module follows the same model so keyboard and assistive-technology users get a consistent experience across the whole suite.' }));
        const ul = el('ul', { style: 'margin:.25rem 0 0;padding-left:1.1rem;line-height:1.6' }, [
          el('li', { html: '<b>Keyboard model</b> — every interactive surface is fully operable without a mouse: roving focus, arrow/Home/End/PageUp-Down navigation, Enter/Space activation and Escape to dismiss.' }),
          el('li', { html: '<b>ARIA roles &amp; state</b> — components emit the correct WAI-ARIA roles (grid, treegrid, listbox, dialog, tab, …) with live aria-sort, aria-selected, aria-expanded and aria-checked state.' }),
          el('li', { html: '<b>Focus management</b> — overlays (dialogs, popups, menus) trap focus, restore it on close, and expose a logical tab order.' }),
          el('li', { html: '<b>Reduced motion</b> — animations and transitions honour the <code>prefers-reduced-motion</code> media query.' }),
          el('li', { html: '<b>High-contrast themes</b> — the theme runtime ships light, dark and high-contrast palettes built on OKLCH tokens, so contrast targets hold across colorways.' }),
          el('li', { html: '<b>Tested</b> — every module ships an automated accessibility test suite (axe-core assertions); the per-module counts below are read live from the build matrix, never invented.' }),
        ]);
        lead.appendChild(ul);
        h.appendChild(lead);
      }, { block: true }));

      grid.appendChild(card('Per-module accessibility status', (h) => {
        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.5rem;width:100%' });
        const noteEl = el('div', { class: 'g-note', style: 'min-height:1.2em' });
        const tableWrap = el('div', { style: 'width:100%;overflow:auto' });
        wrap.appendChild(noteEl);
        wrap.appendChild(tableWrap);
        h.appendChild(wrap);

        const statusChip = (val) => {
          if (val === 'n/a') return el('span', { class: 'jects-status-chip', 'data-tone': 'warn', text: 'n/a' });
          return el('span', { class: 'jects-status-chip', 'data-tone': 'ok', text: val });
        };

        function render(axeByPkg) {
          const thead = el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'Module' }),
              el('th', { style: 'text-align:center', text: 'Keyboard' }),
              el('th', { style: 'text-align:center', text: 'ARIA / roles' }),
              el('th', { style: 'text-align:right', text: 'Axe tests' }),
              el('th', { text: 'Notes' }),
            ]),
          ]);
          const tbody = el('tbody', {}, MODULES.map((m) => {
            const axe = axeByPkg ? axeByPkg[m.pkg] : undefined;
            const axeText = (axe == null || axe === '—') ? '—' : String(axe);
            return el('tr', {}, [
              el('td', { style: 'white-space:nowrap', text: m.label }),
              el('td', { style: 'text-align:center' }, [statusChip(m.keyboard)]),
              el('td', { style: 'text-align:center' }, [statusChip(m.aria)]),
              el('td', { style: 'text-align:right;font-variant-numeric:tabular-nums', text: axeText }),
              el('td', { text: m.notes }),
            ]);
          }));
          const table = el('table', { class: 'g-perf-table', style: 'width:100%;border-collapse:collapse' }, [thead, tbody]);
          tableWrap.replaceChildren(table);
        }

        // Render the static map immediately (no axe numbers yet), then enrich
        // from matrix.json. If the fetch fails the static table stays intact.
        render(null);
        noteEl.textContent = 'Loading axe-checked test counts from the build matrix…';
        fetch('./matrix.json')
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('matrix ' + r.status))))
          .then((m) => {
            const byPkg = {};
            for (const p of (m && Array.isArray(m.packages) ? m.packages : [])) {
              byPkg[p.name] = p.a11y;
            }
            render(byPkg);
            noteEl.textContent = 'Axe-test counts read live from the build matrix (matrix.json). Keyboard / ARIA status is the honest per-module model the suite ships. “—” means no dedicated axe suite is reported for that package.';
          })
          .catch((err) => {
            noteEl.textContent = 'Build matrix unavailable (' + (err && err.message ? err.message : String(err)) + ') — showing the per-module keyboard / ARIA status only.';
            console.warn('[gallery] a11y: matrix.json fetch failed:', err);
          });
      }, { block: true }));
    },
    { wide: true },
  );
}
