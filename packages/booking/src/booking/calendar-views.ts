/**
 * calendar-views — week/month booking views alongside the slot picker: a compact
 * calendar of existing bookings. Pure grid math (`monthMatrix`, `weekDays`,
 * `summarizeByDay`) plus a lightweight `BookingCalendarView` widget that renders a
 * month or week grid with per-day booking counts and emits `daySelect`.
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  createEl,
  register,
} from '@jects/core';
import type { ExistingBooking } from './slots.js';

/** Local `YYYY-MM-DD` for a Date. */
function isoOf(d: Date): string {
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * A 6×7 month grid (always 42 cells) of Dates, starting on `weekStart`
 * (0=Sun..6, default 0). Leading/trailing cells spill into adjacent months.
 */
export function monthMatrix(year: number, month: number, weekStart = 0): Date[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const start = new Date(year, month, 1 - offset);
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) {
      row.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d));
    }
    weeks.push(row);
  }
  return weeks;
}

/** The 7 days of the week containing `date`, starting on `weekStart`. */
export function weekDays(date: Date, weekStart = 0): Date[] {
  const offset = (date.getDay() - weekStart + 7) % 7;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}

/** Count bookings per `YYYY-MM-DD`. */
export function summarizeByDay(bookings: ExistingBooking[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const b of bookings) map.set(b.date, (map.get(b.date) ?? 0) + 1);
  return map;
}

/** Which view the calendar renders. */
export type BookingCalendarMode = 'month' | 'week';

export interface BookingCalendarConfig extends WidgetConfig {
  /** Anchor day (the month/week shown). Defaults to today. */
  date?: Date;
  /** `'month'` (default) or `'week'`. */
  mode?: BookingCalendarMode;
  /** Bookings to summarise per day. */
  bookings?: ExistingBooking[];
  /** First day of the week (0=Sun..6). Default 0. */
  weekStart?: number;
  /** Accessible name. */
  ariaLabel?: string;
}

export interface BookingCalendarEvents extends WidgetEvents {
  daySelect: { date: string; view: BookingCalendarView };
}

/** A compact month/week overview of bookings. */
export class BookingCalendarView extends Widget<BookingCalendarConfig, BookingCalendarEvents> {
  protected override defaults(): Partial<BookingCalendarConfig> {
    return { mode: 'month', bookings: [], weekStart: 0, ariaLabel: 'Bookings calendar' };
  }

  protected buildEl(): HTMLElement {
    const el = createEl('div', { className: 'jects-booking-cal' });
    el.addEventListener('click', (e) => this.handleClick(e));
    return el;
  }

  protected override render(): void {
    const cfg = this.config;
    this.el.className = ['jects-booking-cal', cfg.cls ?? ''].filter(Boolean).join(' ');
    this.el.setAttribute('role', 'grid');
    if (cfg.ariaLabel) this.el.setAttribute('aria-label', cfg.ariaLabel);
    this.el.replaceChildren();

    const anchor = cfg.date ?? new Date();
    const weekStart = cfg.weekStart ?? 0;
    const counts = summarizeByDay(cfg.bookings ?? []);
    const todayIso = isoOf(new Date());

    const rows =
      (cfg.mode ?? 'month') === 'week'
        ? [weekDays(anchor, weekStart)]
        : monthMatrix(anchor.getFullYear(), anchor.getMonth(), weekStart);

    for (const week of rows) {
      const rowEl = createEl('div', { className: 'jects-booking-cal__row', attrs: { role: 'row' } });
      for (const day of week) {
        const iso = isoOf(day);
        const inMonth = (cfg.mode ?? 'month') === 'week' || day.getMonth() === anchor.getMonth();
        const count = counts.get(iso) ?? 0;
        const cell = createEl('button', {
          className: [
            'jects-booking-cal__day',
            inMonth ? '' : 'jects-booking-cal__day--outside',
            iso === todayIso ? 'jects-booking-cal__day--today' : '',
            count > 0 ? 'jects-booking-cal__day--has' : '',
          ]
            .filter(Boolean)
            .join(' '),
          attrs: {
            type: 'button',
            role: 'gridcell',
            'data-date': iso,
            'aria-label': `${iso}${count > 0 ? `, ${count} booking${count === 1 ? '' : 's'}` : ''}`,
          },
        });
        const num = createEl('span', { className: 'jects-booking-cal__num' });
        num.textContent = String(day.getDate());
        cell.append(num);
        if (count > 0) {
          const badge = createEl('span', { className: 'jects-booking-cal__badge' });
          badge.textContent = String(count);
          cell.append(badge);
        }
        rowEl.append(cell);
      }
      this.el.append(rowEl);
    }
  }

  private handleClick(e: Event): void {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.jects-booking-cal__day');
    if (cell && this.el.contains(cell)) {
      const date = cell.getAttribute('data-date');
      if (date) this.emit('daySelect', { date, view: this });
    }
  }
}

register(
  'bookingcalendar',
  BookingCalendarView as unknown as new (
    host: HTMLElement | string,
    config?: Record<string, unknown>,
  ) => BookingCalendarView,
);
