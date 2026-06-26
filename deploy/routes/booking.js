/** Route: booking. */
import { el, card } from '../shell/dom.js';
import { section, Booking } from '../shell/registry.js';

export function register() {
  section(
    'booking',
    'Booking',
    'An enterprise scheduling widget (Calendly / Acuity / Bryntum-class): multiple services (price · duration · buffers · notice · horizon), per-resource availability rules with blackout dates, group capacity + waitlist, DST-correct timezones with a display selector, recurring series, a month/week overview, manage (reschedule/cancel), undo/redo + multi-select, ICS export and reminders.',
    (grid) => {
      grid.appendChild(card('Scheduling — services · availability · timezone · capacity · manage · ICS', (h) => {
        const host = el('div', { style: 'height:var(--g-page-host);width:100%;overflow:auto' });
        h.appendChild(host);
        const today = new Date(2026, 5, 25); // gallery "now"
        const day = new Date(2026, 5, 29); // Mon 29 Jun 2026 — future weekday → slots open
        new Booking(host, {
          date: day,
          minDate: today,
          timeFormat: '12h',
          locale: 'en-US',
          slotsHeading: 'Choose a time',
          services: [
            { id: 'consult', name: 'Intro consultation', duration: 30, price: 0, description: 'Free 30-minute intro call', bufferAfter: 10, minNotice: 120 },
            { id: 'demo', name: 'Product demo', duration: 60, price: 150, currency: 'USD', description: 'Guided 1:1 product walkthrough', bufferBefore: 5, bufferAfter: 10 },
            { id: 'workshop', name: 'Group workshop', duration: 90, price: 75, currency: 'USD', description: 'Hands-on class — up to 6 seats', capacity: 6, waitlist: true },
          ],
          resources: [
            { id: 'alex', name: 'Alex Rivera' },
            { id: 'sam', name: 'Sam Chen' },
          ],
          availability: {
            weekly: {
              1: [{ start: '09:00', end: '17:00' }],
              2: [{ start: '09:00', end: '17:00' }],
              3: [{ start: '09:00', end: '13:00' }],
              4: [{ start: '09:00', end: '17:00' }],
              5: [{ start: '10:00', end: '15:00' }],
            },
            blackouts: ['2026-07-03'],
            perResource: {
              sam: { weekly: { 1: [{ start: '12:00', end: '18:00' }], 4: [{ start: '12:00', end: '18:00' }] } },
            },
          },
          timeZone: 'America/New_York',
          timezones: ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo'],
          waitlist: true,
          reminderLeadMinutes: [1440, 60],
          icsExport: true,
          manageable: true,
          toolbar: true,
          showCalendarView: true,
          bookings: [
            { date: '2026-06-25', time: '10:00' },
            { date: '2026-06-25', time: '13:30' },
            { date: '2026-06-25', time: '14:00' },
          ],
          onBook: (result) => console.log('[gallery] booked:', result),
        });
        h.appendChild(el('div', { class: 'g-note', text: 'Pick a service (price/duration shown) and a staff member, switch the display timezone, then choose an open slot — availability follows per-weekday hours, buffers, advance-notice and blackout dates; full group slots offer a waitlist. The toolbar adds undo/redo and a manage panel to reschedule/cancel; after booking you get an "Add to calendar" (.ics) action. The month overview below mirrors the bookings.' }));
      }, { block: true }));
    },
    { wide: true },
  );
}
