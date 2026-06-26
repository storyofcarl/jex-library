/**
 * Booking stories — framework-free "stories" used by the docs app and as a
 * canonical usage example. Each story returns a host-mounting function.
 */
import { Booking, type BookingConfig } from './booking.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Booking;
}

const story = (name: string, config: BookingConfig): Story => ({
  name,
  render: (host) => new Booking(host, config),
});

// A stable "tomorrow" so stories always show a future, fully-available day.
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const stories: Story[] = [
  story('Default (9–5, 30 min)', {
    date: tomorrow,
    workingHours: { start: '09:00', end: '17:00' },
    slotDuration: 30,
  }),
  story('With existing bookings', {
    date: tomorrow,
    workingHours: { start: '09:00', end: '13:00' },
    slotDuration: 30,
    bookings: [
      { date: iso(tomorrow), time: '09:30', duration: 30 },
      { date: iso(tomorrow), time: '11:00', duration: 60 },
    ],
  }),
  story('12-hour labels', {
    date: tomorrow,
    workingHours: { start: '08:00', end: '12:00' },
    slotDuration: 30,
    timeFormat: '12h',
  }),
  story('With services (resources)', {
    date: tomorrow,
    workingHours: { start: '09:00', end: '17:00' },
    slotDuration: 30,
    resources: [
      { id: 'consult', name: 'Consultation', slotDuration: 30 },
      { id: 'session', name: 'Full session', slotDuration: 60 },
    ],
  }),
  story('Hourly slots with a gap', {
    date: tomorrow,
    workingHours: { start: '09:00', end: '17:00' },
    slotDuration: 45,
    slotGap: 15,
  }),
  story('Extra reservation field (phone)', {
    date: tomorrow,
    workingHours: { start: '10:00', end: '14:00' },
    slotDuration: 60,
    extraFields: [{ name: 'phone', control: 'text', label: 'Phone' }],
  }),
];
