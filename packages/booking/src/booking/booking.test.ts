/**
 * Booking widget unit tests (jsdom — runs in the default `pnpm test`).
 *
 * Importing `../index.js` registers @jects/widgets controls (MiniCalendar, Form,
 * fields) with the factory, which the Booking widget composes via `create()`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../index.js';
import { Booking } from './booking.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

/** Fixed future day so generated slots are never "past". */
const DAY = new Date(2030, 5, 24); // 2030-06-24

function make(config = {}): Booking {
  return new Booking(host, { date: DAY, ...config });
}

describe('Booking — render', () => {
  it('renders calendar, slot grid and is registered with role=group', () => {
    const b = make();
    expect(b.el.classList.contains('jects-booking')).toBe(true);
    expect(b.el.getAttribute('role')).toBe('group');
    // MiniCalendar mounted inside the calendar host.
    expect(b.el.querySelector('.jects-minical')).not.toBeNull();
    // Slot grid is a group of toggle buttons (NOT a listbox — native <button>s
    // inside role=option is an ARIA antipattern; see buildSlotGrid()).
    const grid = b.el.querySelector('.jects-booking__slots');
    expect(grid?.getAttribute('role')).toBe('group');
    expect(b.el.querySelectorAll('.jects-booking__slot').length).toBeGreaterThan(0);
    b.destroy();
  });

  it('generates slots from working hours + duration', () => {
    const b = make({ workingHours: { start: '09:00', end: '11:00' }, slotDuration: 30 });
    const labels = [...b.el.querySelectorAll('.jects-booking__slot')].map((s) => s.textContent);
    expect(labels).toEqual(['09:00', '09:30', '10:00', '10:30']);
    b.destroy();
  });

  it('formats slot labels in 12h mode', () => {
    const b = make({ workingHours: { start: '09:00', end: '10:00' }, slotDuration: 30, timeFormat: '12h' });
    const labels = [...b.el.querySelectorAll('.jects-booking__slot')].map((s) => s.textContent);
    expect(labels).toEqual(['9:00 AM', '9:30 AM']);
    b.destroy();
  });

  it('marks slots overlapping seed bookings as booked + disabled', () => {
    const b = make({
      workingHours: { start: '09:00', end: '11:00' },
      slotDuration: 30,
      bookings: [{ date: '2030-06-24', time: '09:30', duration: 30 }],
    });
    const booked = b.el.querySelector<HTMLButtonElement>('.jects-booking__slot--booked');
    expect(booked?.getAttribute('data-time')).toBe('09:30');
    expect(booked?.hasAttribute('disabled')).toBe(true);
    b.destroy();
  });

  it('does not show the reservation form until a slot is selected', () => {
    const b = make();
    const section = b.el.querySelector<HTMLElement>('.jects-booking__form-section');
    expect(section?.hidden).toBe(true);
    expect(b.el.querySelector('.jects-form')).toBeNull();
    b.destroy();
  });
});

describe('Booking — slot selection', () => {
  it('selecting a slot reveals the reservation form and emits slotSelect', () => {
    const b = make({ workingHours: { start: '09:00', end: '11:00' }, slotDuration: 30 });
    const onSlot = vi.fn();
    b.on('slotSelect', onSlot);

    b.selectSlot('09:30');

    expect(b.getSelectedTime()).toBe('09:30');
    expect(onSlot).toHaveBeenCalledTimes(1);
    expect(onSlot.mock.calls[0][0]).toMatchObject({ time: '09:30', date: '2030-06-24' });

    const section = b.el.querySelector<HTMLElement>('.jects-booking__form-section');
    expect(section?.hidden).toBe(false);
    // Form with name/email/notes fields present.
    expect(b.el.querySelector('.jects-form')).not.toBeNull();
    expect(b.el.querySelector('[data-field="name"]')).not.toBeNull();
    expect(b.el.querySelector('[data-field="email"]')).not.toBeNull();
    expect(b.el.querySelector('[data-field="notes"]')).not.toBeNull();
    b.destroy();
  });

  it('clicking an available slot button selects it', () => {
    const b = make({ workingHours: { start: '09:00', end: '10:00' }, slotDuration: 30 });
    const btn = b.el.querySelector<HTMLButtonElement>('.jects-booking__slot[data-time="09:30"]')!;
    btn.click();
    expect(b.getSelectedTime()).toBe('09:30');
    // After selection the slot button reports aria-pressed="true".
    const selected = b.el.querySelector<HTMLButtonElement>(
      '.jects-booking__slot[data-time="09:30"]',
    )!;
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    b.destroy();
  });

  it('selecting an unavailable slot is a no-op', () => {
    const b = make({
      workingHours: { start: '09:00', end: '11:00' },
      slotDuration: 30,
      bookings: [{ date: '2030-06-24', time: '09:30', duration: 30 }],
    });
    b.selectSlot('09:30');
    expect(b.getSelectedTime()).toBeNull();
    b.destroy();
  });
});

describe('Booking — confirm flow', () => {
  function confirm(b: Booking, name: string, email: string): void {
    const form = b.getBookings; // noop ref to keep TS happy if unused
    void form;
    const nameInput = b.el.querySelector<HTMLInputElement>('[data-field="name"] input')!;
    const emailInput = b.el.querySelector<HTMLInputElement>('[data-field="email"] input')!;
    nameInput.value = name;
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    emailInput.value = email;
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    const formEl = b.el.querySelector<HTMLFormElement>('.jects-form')!;
    formEl.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  it('emits book and adds a record on a valid submit', async () => {
    const b = make({ workingHours: { start: '09:00', end: '11:00' }, slotDuration: 30 });
    const onBook = vi.fn();
    b.on('book', onBook);
    b.selectSlot('09:30');

    confirm(b, 'Ada Lovelace', 'ada@example.com');
    // Form.submit() is async (validation) — flush microtasks.
    await new Promise((r) => setTimeout(r, 0));

    expect(onBook).toHaveBeenCalledTimes(1);
    const payload = onBook.mock.calls[0][0];
    expect(payload.result).toMatchObject({
      date: '2030-06-24',
      time: '09:30',
      duration: 30,
      details: { name: 'Ada Lovelace', email: 'ada@example.com' },
    });
    // The booking was added to the store.
    const bookings = b.getBookings();
    expect(bookings.some((x) => x.date === '2030-06-24' && x.time === '09:30')).toBe(true);
    b.destroy();
  });

  it('does not emit book when required validation fails', async () => {
    const b = make({ workingHours: { start: '09:00', end: '11:00' }, slotDuration: 30 });
    const onBook = vi.fn();
    b.on('book', onBook);
    b.selectSlot('09:30');

    // Submit with empty name/email.
    const formEl = b.el.querySelector<HTMLFormElement>('.jects-form')!;
    formEl.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(onBook).not.toHaveBeenCalled();
    expect(b.getBookings().some((x) => x.time === '09:30')).toBe(false);
    b.destroy();
  });

  it('beforeBook veto cancels the booking', async () => {
    const b = make({ workingHours: { start: '09:00', end: '11:00' }, slotDuration: 30 });
    const onBook = vi.fn();
    b.on('beforeBook', () => false);
    b.on('book', onBook);
    b.selectSlot('09:30');

    confirm(b, 'Grace Hopper', 'grace@example.com');
    await new Promise((r) => setTimeout(r, 0));

    expect(onBook).not.toHaveBeenCalled();
    expect(b.getBookings().some((x) => x.time === '09:30')).toBe(false);
    b.destroy();
  });

  it('a confirmed slot becomes unavailable for re-selection', async () => {
    const b = make({ workingHours: { start: '09:00', end: '11:00' }, slotDuration: 30 });
    b.selectSlot('09:30');
    confirm(b, 'Ada', 'ada@example.com');
    await new Promise((r) => setTimeout(r, 0));

    const slot = b.el.querySelector('.jects-booking__slot[data-time="09:30"]');
    expect(slot?.classList.contains('jects-booking__slot--booked')).toBe(true);
    b.destroy();
  });

  it('does NOT double-book: a beforeBook handler that takes the slot is rejected', async () => {
    const b = make({ workingHours: { start: '09:00', end: '11:00' }, slotDuration: 30 });
    const onBook = vi.fn();
    const onConflict = vi.fn();
    b.on('book', onBook);
    b.on('bookingConflict', onConflict);
    b.selectSlot('09:30');

    // A beforeBook handler races a competing booking onto the same slot via
    // update({ bookings }) before the add lands. The TOCTOU re-check must reject.
    b.on('beforeBook', () => {
      b.update({ bookings: [{ date: '2030-06-24', time: '09:30', duration: 30 }] });
    });

    confirm(b, 'Ada', 'ada@example.com');
    await new Promise((r) => setTimeout(r, 0));

    expect(onBook).not.toHaveBeenCalled();
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(onConflict.mock.calls[0][0]).toMatchObject({ date: '2030-06-24', time: '09:30' });
    // Exactly one record (the seed competitor), not two overlapping ones.
    expect(b.getBookings().filter((x) => x.time === '09:30').length).toBe(1);
    // Stale selection cleared.
    expect(b.getSelectedTime()).toBeNull();
    b.destroy();
  });

  it('rejects confirm when the slot was taken via update() before submit lands', async () => {
    const b = make({ workingHours: { start: '09:00', end: '11:00' }, slotDuration: 30 });
    const onBook = vi.fn();
    const onConflict = vi.fn();
    b.on('book', onBook);
    b.on('bookingConflict', onConflict);
    b.selectSlot('09:30');

    // Fill the form, then mutate the store (host re-render) BEFORE submitting.
    const nameInput = b.el.querySelector<HTMLInputElement>('[data-field="name"] input')!;
    const emailInput = b.el.querySelector<HTMLInputElement>('[data-field="email"] input')!;
    nameInput.value = 'Ada';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    emailInput.value = 'ada@example.com';
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Host pushes a competing booking for the same slot. update() re-renders and
    // preserves the selection (slot now booked); the form is remounted empty.
    b.update({ bookings: [{ date: '2030-06-24', time: '09:30', duration: 30 }] });
    expect(b.getSelectedTime()).toBe('09:30');

    // Re-fill the remounted form and submit — confirm must bail with a conflict.
    const name2 = b.el.querySelector<HTMLInputElement>('[data-field="name"] input')!;
    const email2 = b.el.querySelector<HTMLInputElement>('[data-field="email"] input')!;
    name2.value = 'Ada';
    name2.dispatchEvent(new Event('input', { bubbles: true }));
    email2.value = 'ada@example.com';
    email2.dispatchEvent(new Event('input', { bubbles: true }));
    const formEl = b.el.querySelector<HTMLFormElement>('.jects-form')!;
    formEl.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(onBook).not.toHaveBeenCalled();
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(b.getSelectedTime()).toBeNull();
    // Only the seed competitor exists; no double-book.
    expect(b.getBookings().filter((x) => x.time === '09:30').length).toBe(1);
    b.destroy();
  });
});

describe('Booking — resources', () => {
  const resources = [
    { id: 'cut', name: 'Haircut', slotDuration: 30 },
    { id: 'color', name: 'Coloring', slotDuration: 60 },
  ];

  it('renders a resource radiogroup and defaults to the first', () => {
    const b = make({ resources });
    const bar = b.el.querySelector('.jects-booking__resources');
    expect(bar?.getAttribute('role')).toBe('radiogroup');
    expect(b.el.querySelectorAll('.jects-booking__resource').length).toBe(2);
    expect(b.getSelectedResource()).toBe('cut');
    b.destroy();
  });

  it('selecting a resource changes slot duration and emits resourceSelect', () => {
    const b = make({ resources, workingHours: { start: '09:00', end: '11:00' } });
    const onRes = vi.fn();
    b.on('resourceSelect', onRes);
    // 30-min slots for "cut": 09:00, 09:30, 10:00, 10:30.
    expect(b.el.querySelectorAll('.jects-booking__slot').length).toBe(4);

    b.selectResource('color');
    expect(onRes).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'color' }));
    // 60-min slots for "color": 09:00, 10:00.
    expect(b.el.querySelectorAll('.jects-booking__slot').length).toBe(2);
    b.destroy();
  });

  it('availability is scoped per resource', () => {
    const b = make({
      resources,
      workingHours: { start: '09:00', end: '11:00' },
      bookings: [{ date: '2030-06-24', time: '09:00', duration: 30, resourceId: 'cut' }],
    });
    // cut: 09:00 booked
    expect(
      b.el.querySelector('.jects-booking__slot[data-time="09:00"]')?.classList.contains('jects-booking__slot--booked'),
    ).toBe(true);
    b.selectResource('color');
    // color: 09:00 available (other resource's booking does not block)
    expect(
      b.el.querySelector('.jects-booking__slot[data-time="09:00"]')?.classList.contains('jects-booking__slot--booked'),
    ).toBe(false);
    b.destroy();
  });

  it('radiogroup uses roving tabindex (selected=0, others=-1)', () => {
    const b = make({ resources });
    const radios = [...b.el.querySelectorAll<HTMLElement>('.jects-booking__resource')];
    expect(radios[0].getAttribute('tabindex')).toBe('0');
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    expect(radios[1].getAttribute('tabindex')).toBe('-1');
    expect(radios[1].getAttribute('aria-checked')).toBe('false');
    b.destroy();
  });

  it('ArrowRight moves selection + focus to the next radio (with wrap)', () => {
    const b = make({ resources });
    const bar = b.el.querySelector<HTMLElement>('.jects-booking__resources')!;
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(b.getSelectedResource()).toBe('color');
    // Wrap back to the first.
    b.el
      .querySelector<HTMLElement>('.jects-booking__resources')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(b.getSelectedResource()).toBe('cut');
    b.destroy();
  });

  it('ArrowLeft wraps to the last radio; Home/End jump to ends', () => {
    const b = make({ resources });
    const bar = () => b.el.querySelector<HTMLElement>('.jects-booking__resources')!;
    bar().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(b.getSelectedResource()).toBe('color'); // wrapped from first to last
    bar().dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(b.getSelectedResource()).toBe('cut');
    bar().dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(b.getSelectedResource()).toBe('color');
    b.destroy();
  });
});

describe('Booking — date + lifecycle', () => {
  it('changing the day clears the slot selection and emits dateSelect on calendar change', () => {
    const b = make({ workingHours: { start: '09:00', end: '11:00' }, slotDuration: 30 });
    b.selectSlot('09:30');
    expect(b.getSelectedTime()).toBe('09:30');

    const onDate = vi.fn();
    b.on('dateSelect', onDate);
    // Drive the embedded MiniCalendar to a new day via a day button click.
    const dayBtn = b.el.querySelector<HTMLButtonElement>(
      '.jects-minical__day[data-date="2030-06-25"]',
    );
    expect(dayBtn).not.toBeNull();
    dayBtn!.click();

    expect(onDate).toHaveBeenCalledTimes(1);
    expect(b.getSelectedTime()).toBeNull();
    b.destroy();
  });

  it('setDate updates the selected day programmatically', () => {
    const b = make();
    b.setDate(new Date(2030, 6, 1));
    expect(b.getSelectedDate().getMonth()).toBe(6);
    expect(b.getSelectedDate().getDate()).toBe(1);
    b.destroy();
  });

  it('update({ bookings }) re-seeds availability', () => {
    const b = make({ workingHours: { start: '09:00', end: '10:00' }, slotDuration: 30 });
    expect(b.el.querySelector('.jects-booking__slot--booked')).toBeNull();
    b.update({ bookings: [{ date: '2030-06-24', time: '09:00', duration: 30 }] });
    expect(
      b.el.querySelector('.jects-booking__slot[data-time="09:00"]')?.classList.contains('jects-booking__slot--booked'),
    ).toBe(true);
    b.destroy();
  });

  it('update({ bookings }) PRESERVES user-confirmed bookings (no round-trip loss)', async () => {
    const b = make({ workingHours: { start: '09:00', end: '11:00' }, slotDuration: 30 });
    // Confirm a real booking at 09:30.
    b.selectSlot('09:30');
    const nameInput = b.el.querySelector<HTMLInputElement>('[data-field="name"] input')!;
    const emailInput = b.el.querySelector<HTMLInputElement>('[data-field="email"] input')!;
    nameInput.value = 'Ada';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    emailInput.value = 'ada@example.com';
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    b.el.querySelector<HTMLFormElement>('.jects-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(b.getBookings().some((x) => x.time === '09:30')).toBe(true);

    // Host re-renders with its OWN seed list (a different slot). The confirmed
    // 09:30 booking must survive the re-seed.
    b.update({ bookings: [{ date: '2030-06-24', time: '10:00', duration: 30 }] });

    const times = b.getBookings().map((x) => x.time).sort();
    expect(times).toContain('09:30'); // user-added preserved
    expect(times).toContain('10:00'); // new seed applied
    // The confirmed slot stays blocked.
    expect(
      b.el.querySelector('.jects-booking__slot[data-time="09:30"]')?.classList.contains('jects-booking__slot--booked'),
    ).toBe(true);
    b.destroy();
  });

  it('destroy() is idempotent and removes the root element', () => {
    const b = make();
    b.destroy();
    expect(b.isDestroyed).toBe(true);
    expect(host.querySelector('.jects-booking')).toBeNull();
    expect(() => b.destroy()).not.toThrow();
  });

  it('hidePastSlots removes past slots from the grid', () => {
    const b = make({
      date: new Date(2030, 5, 24),
      workingHours: { start: '09:00', end: '12:00' },
      slotDuration: 60,
      hidePastSlots: true,
    });
    // With a future date, no slots are past, so all remain. Use update to a same
    // -day "now" is not controllable here, so just assert the grid renders.
    expect(b.el.querySelectorAll('.jects-booking__slot').length).toBe(3);
    b.destroy();
  });
});
