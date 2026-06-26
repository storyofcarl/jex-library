/** Route: calendar. */
import { el, card } from '../shell/dom.js';
import { exportMenu } from '../shell/export-menu.js';
import { section, Calendar } from '../shell/registry.js';

export function register() {
  section(
    'calendar',
    'Calendar',
    'A full calendar — day/week/month/year/agenda/resource/timeline views, RRULE recurrence, timezones, undo/redo, category & resource filtering, and ICS/Excel/print export.',
    (grid) => {
      grid.appendChild(card('Calendar — views · RRULE · timezone · undo/redo · export', (h) => {
        const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:.5rem;width:100%' });
        const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;flex-wrap:wrap;align-items:center' });
        const host = el('div', { style: 'height:var(--g-page-host);width:100%' });
        wrap.appendChild(bar); wrap.appendChild(host); h.appendChild(wrap);
        const today = new Date();
        const Y = today.getFullYear(), M = today.getMonth(), D = today.getDate();
        const at = (off, hr, mn = 0) => new Date(Y, M, D + off, hr, mn);
        const cal = new Calendar(host, {
          date: today,
          view: 'week',
          weekStart: 1,
          dayStartHour: 7,
          dayEndHour: 20,
          timeZone: 'America/New_York',
          locale: 'en-US',
          categories: [
            { id: 'work', name: 'Work', color: 'data-1' },
            { id: 'personal', name: 'Personal', color: 'data-2' },
            { id: 'travel', name: 'Travel', color: 'data-3' },
            { id: 'health', name: 'Health', color: 'data-4' },
          ],
          resources: [
            { id: 'a', name: 'Alice' },
            { id: 'b', name: 'Bob' },
          ],
          events: [
            { id: 1, title: 'Team standup', start: at(0, 9, 0), end: at(0, 9, 30), categoryId: 'work',
              resourceId: 'a', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
            { id: 2, title: 'Design review', start: at(0, 11, 0), end: at(0, 12, 30), categoryId: 'work', resourceId: 'b' },
            { id: 3, title: 'Lunch w/ Sam', start: at(1, 12, 30), end: at(1, 13, 30), categoryId: 'personal', resourceId: 'a' },
            { id: 4, title: 'Sprint planning', start: at(2, 14, 0), end: at(2, 16, 0), categoryId: 'work', resourceId: 'b' },
            { id: 5, title: 'Gym', start: at(0, 18, 0), end: at(0, 19, 0), categoryId: 'health', resourceId: 'a',
              recurrence: { freq: 'daily', interval: 2, count: 6 } },
            { id: 6, title: 'Conference', start: at(3, 0, 0), end: at(4, 23, 59), categoryId: 'travel', resourceId: 'b', allDay: true },
          ],
        });
        const btn = (label, onClick) => {
          const b = el('button', { class: 'jects-btn jects-btn--sm', text: label });
          b.addEventListener('click', () => { try { onClick(); } catch (e) { console.warn('CAL-DEMO feature failed:', e && e.message); } });
          bar.appendChild(b);
          return b;
        };
        const undo = btn('Undo', () => { cal.undo(); sync(); });
        const redo = btn('Redo', () => { cal.redo(); sync(); });
        const sync = () => { undo.disabled = !cal.canUndo(); redo.disabled = !cal.canRedo(); };
        sync();
        exportMenu(bar, [
          { label: 'ICS', onClick: () => cal.exportICS('calendar.ics') },
          { label: 'Excel', onClick: () => cal.exportExcel('calendar.xls') },
          { label: 'Print', onClick: () => cal.print() },
        ]);
        wrap.appendChild(el('div', { class: 'g-note', text: 'Switch views (incl. the new timeline), undo/redo edits, and export to ICS/Excel/print. The standup uses an RRULE string (FREQ=WEEKLY;BYDAY=MO,WE,FR); events render in the America/New_York timezone.' }));
      }, { block: true }));
    },
    { wide: true },
  );
}
