import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { monthMatrix, weekDays, summarizeByDay, BookingCalendarView } from './calendar-views.js';

describe('grid math', () => {
  it('monthMatrix is always 6×7 and starts on the week-start', () => {
    const m = monthMatrix(2030, 5, 0); // June 2030, week starts Sunday
    expect(m.length).toBe(6);
    expect(m[0]!.length).toBe(7);
    expect(m[0]![0]!.getDay()).toBe(0);
  });
  it('weekDays returns the 7 days of the containing week', () => {
    const days = weekDays(new Date(2030, 5, 24), 1); // Mon-start
    expect(days.length).toBe(7);
    expect(days[0]!.getDay()).toBe(1);
  });
  it('summarizeByDay counts bookings per day', () => {
    const map = summarizeByDay([
      { date: '2030-06-24', time: '09:00' },
      { date: '2030-06-24', time: '10:00' },
      { date: '2030-06-25', time: '09:00' },
    ]);
    expect(map.get('2030-06-24')).toBe(2);
    expect(map.get('2030-06-25')).toBe(1);
  });
});

describe('BookingCalendarView widget', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => host.remove());

  it('renders a month grid with booking badges and emits daySelect', () => {
    const view = new BookingCalendarView(host, {
      date: new Date(2030, 5, 24),
      bookings: [{ date: '2030-06-24', time: '09:00' }],
    });
    expect(view.el.getAttribute('role')).toBe('group');
    expect(view.el.querySelector('.jects-booking-cal__grid')?.getAttribute('role')).toBe('grid');
    expect(view.el.querySelectorAll('.jects-booking-cal__row').length).toBe(6);
    // A visible caption + weekday header anchor the grid so it is not mistaken
    // for a stray, unlabelled table.
    expect(view.el.querySelector('.jects-booking-cal__caption')?.textContent).toBe('June 2030');
    expect(view.el.querySelectorAll('.jects-booking-cal__weekday').length).toBe(7);
    const cell = view.el.querySelector<HTMLElement>('.jects-booking-cal__day[data-date="2030-06-24"]')!;
    expect(cell.querySelector('.jects-booking-cal__badge')?.textContent).toBe('1');

    const spy = vi.fn();
    view.on('daySelect', spy);
    cell.click();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ date: '2030-06-24' }));
    view.destroy();
  });

  it('week mode renders a single row', () => {
    const view = new BookingCalendarView(host, { date: new Date(2030, 5, 24), mode: 'week' });
    expect(view.el.querySelectorAll('.jects-booking-cal__row').length).toBe(1);
    view.destroy();
  });
});
