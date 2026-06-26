/** Route: scheduler. */
import { el, card } from '../shell/dom.js';
import { enterpriseSwap } from '../shell/enterprise.js';
import { DAY, HOUR, genSchedulerData } from '../shell/data.js';
import { section, Button, Scheduler, SchedulerStm, HOUR_AND_DAY } from '../shell/registry.js';

export function register() {
  section(
    'scheduler',
    'Scheduler',
    'A resource scheduler on a shared timeline engine — non-working-time shading, multi-assignment, visual + editable dependencies, global & per-resource time ranges, RRULE recurrence, travel time, the event editor, undo/redo and orientation + zoom controls.',
    (grid) => {
      grid.appendChild(card('Scheduler — non-working shading · multi-assignment · editable deps · editor · undo/redo · orientation + zoom', (h) => {
        const bar = el('div', { class: 'g-host-toolbar', style: 'display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;margin-bottom:.5rem' });
        h.appendChild(bar);
        const status = el('span', { class: 'g-note', style: 'margin-left:.5rem;align-self:center' });
        const host = el('div', { style: 'height:var(--g-page-host);width:100%' });
        h.appendChild(host);
        const base = Date.UTC(2026, 5, 22); // Monday
        const sched = new Scheduler(host, {
          resources: [
            { id: 'r1', name: 'Alice Nguyen', role: 'Lead', capacity: 1 },
            { id: 'r2', name: 'Bob Martin', role: 'Field', capacity: 1 },
            { id: 'r3', name: 'Carol Diaz', role: 'Field', capacity: 2 },
            { id: 'r4', name: 'Dave Okafor', role: 'Install', capacity: 1 },
            { id: 'r5', name: 'Erin Walsh', role: 'Survey', capacity: 1 },
            { id: 'r6', name: 'Frank Li', role: 'Support', capacity: 1 },
          ],
          events: [
            { id: 'e1', resourceId: 'r1', name: 'Design review', startDate: base + HOUR * 9, endDate: base + HOUR * 12 },
            { id: 'e2', resourceId: 'r1', name: 'Build', startDate: base + HOUR * 13, endDate: base + HOUR * 17, eventColor: 'cyan' },
            { id: 'e3', resourceId: 'r2', name: 'QA pass (on-site)', startDate: base + DAY + HOUR * 9, endDate: base + DAY + HOUR * 15, eventColor: 'magenta', preTravelTime: HOUR, postTravelTime: HOUR },
            { id: 'e4', resourceId: 'r3', name: 'Standup', startDate: base + HOUR * 9, endDate: base + HOUR * 10, recurrenceRule: 'FREQ=DAILY;COUNT=5' },
            { id: 'e5', resourceId: 'r4', name: 'Equipment install', startDate: base + HOUR * 10, endDate: base + HOUR * 15, eventColor: 'yellow' },
            { id: 'e6', resourceId: 'r5', name: 'Site survey', startDate: base + DAY + HOUR * 9, endDate: base + DAY + HOUR * 12 },
            { id: 'e7', resourceId: 'r6', name: 'Customer call-out', startDate: base + HOUR * 14, endDate: base + HOUR * 16, eventColor: 'cyan' },
            { id: 'e8', resourceId: 'r4', name: 'Handover', startDate: base + DAY * 2 + HOUR * 11, endDate: base + DAY * 2 + HOUR * 13 },
            { id: 'e9', name: 'Joint rollout (2 crew)', startDate: base + DAY * 2 + HOUR * 9, endDate: base + DAY * 2 + HOUR * 12, eventColor: 'magenta' },
          ],
          assignments: [
            { id: 'a1', eventId: 'e9', resourceId: 'r1' },
            { id: 'a2', eventId: 'e9', resourceId: 'r3' },
            { id: 'a3', eventId: 'e4', resourceId: 'r3' },
          ],
          dependencies: [
            { id: 'd1', fromId: 'e1', toId: 'e2', type: 'FS' },
            { id: 'd2', fromId: 'e2', toId: 'e9', type: 'FS' },
          ],
          dependenciesEditable: true,
          calendar: { weekendDays: [0, 6], dayStartHour: 9, dayEndHour: 17 },
          showNonWorkingTime: true,
          timeRanges: [
            { id: 'tr1', startDate: base + HOUR * 12, endDate: base + HOUR * 13, name: 'Lunch' },
            { id: 'tr2', startDate: base + DAY + HOUR * 15, endDate: base + DAY + HOUR * 17, name: 'Sprint review' },
          ],
          resourceTimeRanges: [
            { id: 'rtr1', resourceId: 'r2', startDate: base + HOUR * 9, endDate: base + HOUR * 18, name: 'PTO' },
          ],
          preset: HOUR_AND_DAY,
          range: { start: base, end: base + DAY * 7 },
          creatable: true,
          editable: true,
          panEnabled: true,
          infiniteScroll: true,
          eventTooltip: (e) => e.name ?? null,
        });

        const tb = (text, onClick, variant = 'secondary') => {
          const b = new Button(bar, { text, variant, size: 'sm' });
          b.el.addEventListener('click', onClick);
          return b;
        };
        const warn = (label, e) => console.warn('SCHED-DEMO feature failed:', label, e && e.message);

        tb('Zoom in', () => { try { sched.zoomIn(); status.textContent = 'Zoomed in.'; } catch (e) { warn('zoomIn', e); } }, 'outline');
        tb('Zoom out', () => { try { sched.zoomOut(); status.textContent = 'Zoomed out.'; } catch (e) { warn('zoomOut', e); } }, 'outline');

        let vertical = false;
        const orientBtn = tb('Orientation: horizontal', () => {
          vertical = !vertical;
          try {
            sched.update({ orientation: vertical ? 'vertical' : 'horizontal' });
            orientBtn.el.textContent = 'Orientation: ' + (vertical ? 'vertical' : 'horizontal');
          } catch (e) { warn('orientation', e); }
        }, 'outline');

        tb('Edit event', () => {
          try { sched.editEvent(sched.getEventStore().getById('e2')); status.textContent = 'Opened the event editor.'; }
          catch (e) { warn('editEvent', e); }
        }, 'ghost');

        let stm = null;
        const undoBtn = tb('Undo', () => { try { stm && stm.undo(); } catch (e) { warn('undo', e); } }, 'ghost');
        const redoBtn = tb('Redo', () => { try { stm && stm.redo(); } catch (e) { warn('redo', e); } }, 'ghost');
        try {
          stm = new SchedulerStm({
            stores: [
              { name: 'events', store: sched.getEventStore() },
              { name: 'dependencies', store: sched.getDependencyStore() },
            ],
          });
          const syncStm = () => { undoBtn.el.disabled = !stm.canUndo; redoBtn.el.disabled = !stm.canRedo; };
          stm.on('change', syncStm); syncStm();
        } catch (e) { warn('stm', e); undoBtn.el.disabled = true; redoBtn.el.disabled = true; }
        bar.appendChild(status);

        enterpriseSwap(bar, host, {
          key: 'scheduler',
          count: '100 resources × ~2,000 events',
          build: (bigHost) => {
            const data = genSchedulerData(100, 20);
            new Scheduler(bigHost, {
              resources: data.resources,
              events: data.events,
              preset: HOUR_AND_DAY,
              range: { start: data.base, end: data.base + DAY * 20 },
              panEnabled: true,
              infiniteScroll: true,
              eventTooltip: (e) => e.name ?? null,
            });
          },
        });
      }, { block: true }));
    },
    { wide: true },
  );
}
