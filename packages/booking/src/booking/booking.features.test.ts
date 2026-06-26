/**
 * Widget-level tests for the parity features wired into Booking: services,
 * timezone display, availability rules, capacity + waitlist, the manage panel
 * (cancel/reschedule), undo/redo + multi-select bulk delete, ICS export and the
 * confirmation banner. Runs in jsdom via the default `pnpm test`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../index.js';
import { Booking } from './booking.js';

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

const DAY = new Date(2030, 5, 24); // 2030-06-24 (Monday)

/** Form submit is async (validation) — fill, submit, then flush microtasks. */
async function fillAndSubmit(b: Booking): Promise<void> {
  const name = b.el.querySelector<HTMLInputElement>('[data-field="name"] input')!;
  const email = b.el.querySelector<HTMLInputElement>('[data-field="email"] input')!;
  name.value = 'Ada';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  email.value = 'ada@example.com';
  email.dispatchEvent(new Event('input', { bubbles: true }));
  b.el.querySelector<HTMLFormElement>('.jects-form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
}

describe('Booking — services', () => {
  const services = [
    { id: 'cut', name: 'Haircut', duration: 30 },
    { id: 'color', name: 'Coloring', duration: 60, fields: [{ name: 'shade', control: 'text', label: 'Shade' }] },
  ];

  it('renders a service selector and defaults to the first', () => {
    const b = new Booking(host, { date: DAY, services, workingHours: { start: '09:00', end: '10:00' } });
    expect(b.el.querySelector('.jects-booking__services')?.getAttribute('role')).toBe('radiogroup');
    expect(b.getSelectedService()).toBe('cut');
    // cut = 30 min ⇒ 2 slots in a 1-hour window.
    expect(b.el.querySelectorAll('.jects-booking__slot').length).toBe(2);
    b.destroy();
  });

  it('selecting a service changes duration and emits serviceSelect', () => {
    const b = new Booking(host, { date: DAY, services, workingHours: { start: '09:00', end: '10:00' } });
    const spy = vi.fn();
    b.on('serviceSelect', spy);
    b.selectService('color'); // 60 min ⇒ 1 slot
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ serviceId: 'color' }));
    expect(b.el.querySelectorAll('.jects-booking__slot').length).toBe(1);
    b.destroy();
  });

  it('per-service intake fields appear in the form', () => {
    const b = new Booking(host, { date: DAY, services, workingHours: { start: '09:00', end: '11:00' } });
    b.selectService('color');
    b.selectSlot('09:00');
    expect(b.el.querySelector('[data-field="shade"]')).not.toBeNull();
    b.destroy();
  });
});

describe('Booking — availability rules', () => {
  it('uses weekly ranges (split shift) instead of workingHours', () => {
    const b = new Booking(host, {
      date: DAY,
      slotDuration: 60,
      availability: {
        weekly: { 1: [{ start: '09:00', end: '11:00' }, { start: '14:00', end: '15:00' }] },
      },
    });
    const labels = [...b.el.querySelectorAll('.jects-booking__slot')].map((s) => s.textContent);
    expect(labels).toEqual(['09:00', '10:00', '14:00']);
    b.destroy();
  });

  it('a blackout day shows no times', () => {
    const b = new Booking(host, {
      date: DAY,
      slotDuration: 60,
      availability: { weekly: { 1: [{ start: '09:00', end: '12:00' }] }, blackouts: ['2030-06-24'] },
    });
    expect(b.el.querySelector('.jects-booking__empty')).not.toBeNull();
    b.destroy();
  });
});

describe('Booking — timezone display', () => {
  it('renders slot labels converted to the display zone', () => {
    const b = new Booking(host, {
      date: DAY,
      slotDuration: 60,
      workingHours: { start: '09:00', end: '10:00' },
      timeZone: 'America/New_York',
      timezones: ['America/New_York', 'Europe/London'],
    });
    expect(b.el.querySelector('.jects-booking__slot')?.textContent).toBe('09:00');
    b.setTimeZone('Europe/London'); // +5h in summer
    expect(b.getDisplayTimeZone()).toBe('Europe/London');
    expect(b.el.querySelector('.jects-booking__slot')?.textContent).toBe('14:00');
    b.destroy();
  });
});

describe('Booking — capacity + waitlist', () => {
  it('shows remaining seats and stays bookable until full', () => {
    const b = new Booking(host, {
      date: DAY,
      slotDuration: 60,
      workingHours: { start: '09:00', end: '10:00' },
      capacity: 2,
      bookings: [{ date: '2030-06-24', time: '09:00' }],
    });
    const slot = b.el.querySelector('.jects-booking__slot')!;
    expect(slot.querySelector('.jects-booking__slot-seats')?.textContent).toBe('1 seat left');
    b.destroy();
  });

  it('offers a waitlist for a full slot and records an entry', async () => {
    const b = new Booking(host, {
      date: DAY,
      slotDuration: 60,
      workingHours: { start: '09:00', end: '10:00' },
      capacity: 1,
      waitlist: true,
      bookings: [{ date: '2030-06-24', time: '09:00' }],
    });
    const slot = b.el.querySelector('.jects-booking__slot[data-time="09:00"]')!;
    expect(slot.classList.contains('jects-booking__slot--waitlist')).toBe(true);
    const spy = vi.fn();
    b.on('waitlist', spy);
    b.selectSlot('09:00'); // enters waitlist mode (slot is full)
    await fillAndSubmit(b);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(b.getWaitlist().countForSlot({ date: '2030-06-24', time: '09:00' })).toBe(1);
    b.destroy();
  });
});

describe('Booking — confirmation banner + ICS', () => {
  it('shows a banner after booking and exports valid ICS', async () => {
    const b = new Booking(host, {
      date: DAY,
      slotDuration: 60,
      workingHours: { start: '09:00', end: '11:00' },
      timeZone: 'UTC',
    });
    b.selectSlot('09:00');
    await fillAndSubmit(b);
    expect(b.el.querySelector('.jects-booking__banner')?.textContent).toContain('09:00');
    const ics = b.exportIcs();
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('DTSTART:20300624T090000Z');
    b.destroy();
  });
});

describe('Booking — manage, undo/redo, multi-select', () => {
  async function bookOne(b: Booking, time: string): Promise<void> {
    b.selectSlot(time);
    await fillAndSubmit(b);
  }

  it('lists confirmed bookings in the manage panel and cancels one', async () => {
    const b = new Booking(host, { date: DAY, slotDuration: 60, workingHours: { start: '09:00', end: '12:00' } });
    await bookOne(b, '09:00');
    const row = b.el.querySelector('.jects-booking__manage-row');
    expect(row).not.toBeNull();
    const id = b.getManagedBookings().find((r) => r.time === '09:00')!.id as string;
    const spy = vi.fn();
    b.on('cancel', spy);
    b.cancelBooking(id);
    expect(spy).toHaveBeenCalledTimes(1);
    // Cancelled ⇒ slot is bookable again.
    expect(
      b.el.querySelector('.jects-booking__slot[data-time="09:00"]')?.classList.contains('jects-booking__slot--booked'),
    ).toBe(false);
    b.destroy();
  });

  it('undo restores a cancelled booking; undo of a booking removes it', async () => {
    const b = new Booking(host, { date: DAY, slotDuration: 60, workingHours: { start: '09:00', end: '12:00' } });
    await bookOne(b, '09:00');
    expect(b.getManagedBookings().some((r) => r.time === '09:00')).toBe(true);
    // Undo the booking ⇒ removed.
    b.undo();
    expect(b.getManagedBookings().some((r) => r.time === '09:00')).toBe(false);
    // Redo ⇒ back.
    b.redo();
    expect(b.getManagedBookings().some((r) => r.time === '09:00')).toBe(true);
    b.destroy();
  });

  it('multi-select + bulk delete (undoable)', async () => {
    const b = new Booking(host, { date: DAY, slotDuration: 60, workingHours: { start: '09:00', end: '12:00' } });
    await bookOne(b, '09:00');
    await bookOne(b, '10:00');
    b.selectAllBookings();
    expect(b.getSelection().size).toBe(2);
    const spy = vi.fn();
    b.on('bulkDelete', spy);
    b.deleteSelected();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(b.getManagedBookings().length).toBe(0);
    b.undo(); // bulk delete is undoable
    expect(b.getManagedBookings().length).toBe(2);
    b.destroy();
  });

  it('reschedule moves a booking to a new slot', async () => {
    const b = new Booking(host, { date: DAY, slotDuration: 60, workingHours: { start: '09:00', end: '12:00' } });
    await bookOne(b, '09:00');
    const id = b.getManagedBookings().find((r) => r.time === '09:00')!.id as string;
    const spy = vi.fn();
    b.on('reschedule', spy);
    b.rescheduleBooking(id, '2030-06-24', '11:00');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(b.getManagedBookings().find((r) => String(r.id) === id)?.time).toBe('11:00');
    b.destroy();
  });
});

describe('Booking — recurring series', () => {
  it('previews and books a daily series, skipping unavailable days', () => {
    const b = new Booking(host, {
      date: DAY,
      slotDuration: 60,
      // Only Mondays available ⇒ a daily series will skip non-Mondays.
      availability: { weekly: { 1: [{ start: '09:00', end: '10:00' }] } },
    });
    const preview = b.previewSeries({ freq: 'daily', count: 3 }, '09:00');
    expect(preview.map((p) => p.available)).toEqual([true, false, false]);
    const booked = b.bookSeries({ freq: 'weekly', interval: 1, count: 2 }, { name: 'Ada', email: 'a@b.com' }, '09:00');
    expect(booked.length).toBe(2); // two consecutive Mondays
    expect(booked.map((r) => r.date)).toEqual(['2030-06-24', '2030-07-01']);
    b.destroy();
  });
});

describe('Booking — back-compat (zero new config)', () => {
  it('a plain Booking still renders + books', async () => {
    const b = new Booking(host, { date: DAY, workingHours: { start: '09:00', end: '10:00' }, slotDuration: 30 });
    expect(b.el.querySelectorAll('.jects-booking__slot').length).toBe(2);
    const spy = vi.fn();
    b.on('book', spy);
    b.selectSlot('09:00');
    await fillAndSubmit(b);
    expect(spy).toHaveBeenCalledTimes(1);
    b.destroy();
  });
});
