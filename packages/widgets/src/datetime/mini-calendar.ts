/**
 * MiniCalendar — a compact month grid with keyboard navigation, selected/today
 * marking, min/max bounds and a configurable week start.
 *
 * - role="grid" with role="row"/"gridcell" cells; ARIA selected/disabled state.
 * - Keyboard: arrows move by day/week, Home/End to row ends, PageUp/PageDown by
 *   month, Enter/Space select the focused day.
 * - Emits a vetoable `beforeChange` then `change` when a day is selected.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';
import {
  type WeekStart,
  MONTH_NAMES,
  WEEKDAY_NAMES,
  startOfDay,
  isSameDay,
  isSameMonth,
  addDays,
  addMonths,
  clampDate,
  isDisabledDay,
  buildMonthMatrix,
  weekdayHeaders,
  formatISODate,
} from './date-utils.js';

export interface MiniCalendarConfig extends WidgetConfig {
  /** Currently selected date (null = none). */
  value?: Date | null | undefined;
  /** Month the grid displays initially (defaults to value or today). */
  viewDate?: Date | undefined;
  /** Earliest selectable day (inclusive). */
  min?: Date | null | undefined;
  /** Latest selectable day (inclusive). */
  max?: Date | null | undefined;
  /** First column of the week: 0 = Sunday (default), 1 = Monday. */
  weekStart?: WeekStart | undefined;
  /** Selection change convenience handler. */
  onChange?: (value: Date) => void;
}

export interface MiniCalendarEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel selecting a day. */
  beforeChange: { value: Date; calendar: MiniCalendar };
  /** Fired after a day is selected. */
  change: { value: Date; calendar: MiniCalendar };
  /** Fired when the displayed month changes. */
  navigate: { viewDate: Date; calendar: MiniCalendar };
}

const today = (): Date => startOfDay(new Date());

export class MiniCalendar extends Widget<MiniCalendarConfig, MiniCalendarEvents> {
  /** Month currently shown in the grid. */
  private declare view: Date;
  /** The day cell that owns roving tabindex / receives focus. */
  private declare focusDate: Date;

  protected override defaults(): Partial<MiniCalendarConfig> {
    return { value: null, weekStart: 0, min: null, max: null };
  }

  protected buildEl(): HTMLElement {
    // Initialise view/focus here (runs during super(), before render).
    this.syncViewFromConfig();
    const el = createEl('div', { className: 'jects-minical' });
    el.addEventListener('click', (e) => this.handleClick(e));
    el.addEventListener('keydown', (e) => this.handleKeydown(e));
    return el;
  }

  /** Initialise view/focus from config. */
  private syncViewFromConfig(): void {
    const { value, viewDate } = this.config;
    const base = viewDate ?? value ?? today();
    this.view = new Date(base.getFullYear(), base.getMonth(), 1);
    this.focusDate = clampDate(value ?? today(), this.config.min, this.config.max);
  }

  protected override render(): void {
    const { value = null, min = null, max = null, weekStart = 0 } = this.config;
    const monthLabel = `${MONTH_NAMES[this.view.getMonth()]} ${this.view.getFullYear()}`;
    const titleId = `${this.id}-title`;

    const headerLabels = weekdayHeaders(weekStart);
    const headers = headerLabels
      .map((h, i) => {
        const full = WEEKDAY_NAMES[(weekStart + i) % 7];
        return `<div class="jects-minical__weekday" role="columnheader" aria-label="${full}">${h}</div>`;
      })
      .join('');

    const cells = buildMonthMatrix(this.view, weekStart);
    let rows = '';
    for (let r = 0; r < 6; r++) {
      let row = '';
      for (let c = 0; c < 7; c++) {
        const d = cells[r * 7 + c]!;
        row += this.renderCell(d, value, min, max);
      }
      rows += `<div class="jects-minical__row" role="row">${row}</div>`;
    }

    this.el.className = ['jects-minical', this.config.cls ?? ''].filter(Boolean).join(' ');
    this.el.removeAttribute('role');
    this.el.removeAttribute('aria-label');
    // jects-safe-html: monthLabel from MONTH_NAMES constants + numeric year; headers/rows from weekday constants + numeric cells; ids internal
    this.el.innerHTML = `
      <div class="jects-minical__header">
        <button type="button" class="jects-minical__nav jects-minical__nav--prev" data-nav="-1" aria-label="Previous month">&#8249;</button>
        <div class="jects-minical__title" id="${titleId}" aria-live="polite">${monthLabel}</div>
        <button type="button" class="jects-minical__nav jects-minical__nav--next" data-nav="1" aria-label="Next month">&#8250;</button>
      </div>
      <div class="jects-minical__grid" role="grid" aria-labelledby="${titleId}">
        <div class="jects-minical__weekdays" role="row">${headers}</div>
        ${rows}
      </div>`;
  }

  private renderCell(d: Date, value: Date | null, min: Date | null, max: Date | null): string {
    const outside = !isSameMonth(d, this.view);
    const disabled = isDisabledDay(d, min, max);
    const selected = isSameDay(d, value);
    const isToday = isSameDay(d, today());
    const isFocus = isSameDay(d, this.focusDate);
    const classes = [
      'jects-minical__day',
      outside ? 'jects-minical__day--outside' : '',
      disabled ? 'jects-minical__day--disabled' : '',
      selected ? 'jects-minical__day--selected' : '',
      isToday ? 'jects-minical__day--today' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const label = `${WEEKDAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    // role="gridcell" lives on the wrapping cell (carrying selection state); the
    // interactive <button> is the cell's content with a proper accessible name.
    return (
      `<div class="jects-minical__cell" role="gridcell" aria-selected="${selected ? 'true' : 'false'}">` +
      `<button type="button" class="${classes}" ` +
      `data-date="${formatISODate(d)}" ` +
      `tabindex="${isFocus ? '0' : '-1'}" ` +
      `aria-label="${label}" ` +
      `${disabled ? 'aria-disabled="true" disabled' : ''} ` +
      `${isToday ? 'aria-current="date"' : ''}>` +
      `<span class="jects-minical__day-num">${d.getDate()}</span></button></div>`
    );
  }

  private parseCellDate(el: Element | null): Date | null {
    const iso = el?.getAttribute('data-date');
    if (!iso) return null;
    const [y, m, day] = iso.split('-').map(Number);
    return new Date(y!, m! - 1, day!);
  }

  private handleClick(e: Event): void {
    const target = e.target as HTMLElement;
    const nav = target.closest('[data-nav]') as HTMLElement | null;
    if (nav) {
      this.shiftMonth(Number(nav.getAttribute('data-nav')));
      return;
    }
    const cell = target.closest('.jects-minical__day') as HTMLElement | null;
    if (!cell || cell.hasAttribute('disabled')) return;
    const d = this.parseCellDate(cell);
    if (d) this.select(d);
  }

  /** Move the displayed month by `delta`, keeping focus in range. */
  private shiftMonth(delta: number): void {
    this.view = addMonths(this.view, delta);
    this.focusDate = clampDate(this.focusDate, this.config.min, this.config.max);
    // Keep the focus date within the shown month if it drifted out.
    if (!isSameMonth(this.focusDate, this.view)) {
      this.focusDate = new Date(this.view.getFullYear(), this.view.getMonth(), 1);
    }
    this.render();
    this.emit('navigate', { viewDate: this.view, calendar: this });
    this.focusActiveCell();
  }

  private handleKeydown(e: KeyboardEvent): void {
    let next: Date | null = null;
    // Column of the focused day within its rendered week row, relative to the
    // configured week start (matches how buildMonthMatrix lays out the grid).
    const weekStart = this.config.weekStart ?? 0;
    const col = (this.focusDate.getDay() - weekStart + 7) % 7;
    switch (e.key) {
      case 'ArrowLeft':
        next = addDays(this.focusDate, -1);
        break;
      case 'ArrowRight':
        next = addDays(this.focusDate, 1);
        break;
      case 'ArrowUp':
        next = addDays(this.focusDate, -7);
        break;
      case 'ArrowDown':
        next = addDays(this.focusDate, 7);
        break;
      case 'Home':
        next = addDays(this.focusDate, -col);
        break;
      case 'End':
        next = addDays(this.focusDate, 6 - col);
        break;
      case 'PageUp':
        next = addMonths(this.focusDate, -1);
        break;
      case 'PageDown':
        next = addMonths(this.focusDate, 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!isDisabledDay(this.focusDate, this.config.min, this.config.max)) this.select(this.focusDate);
        return;
      default:
        return;
    }
    e.preventDefault();
    this.moveFocus(next);
  }

  /** Move keyboard focus to a new day, switching months as needed. */
  private moveFocus(d: Date): void {
    this.focusDate = clampDate(d, this.config.min, this.config.max);
    if (!isSameMonth(this.focusDate, this.view)) {
      this.view = new Date(this.focusDate.getFullYear(), this.focusDate.getMonth(), 1);
      this.emit('navigate', { viewDate: this.view, calendar: this });
    }
    this.render();
    this.focusActiveCell();
  }

  private focusActiveCell(): void {
    const cell = this.el.querySelector<HTMLElement>('.jects-minical__day[tabindex="0"]');
    cell?.focus();
  }

  /** Select a day, firing the vetoable beforeChange then change. */
  select(d: Date): void {
    const day = startOfDay(d);
    if (isDisabledDay(day, this.config.min, this.config.max)) return;
    if (this.emit('beforeChange', { value: day, calendar: this }) === false) return;
    this.config = { ...this.config, value: day };
    this.focusDate = day;
    if (!isSameMonth(day, this.view)) this.view = new Date(day.getFullYear(), day.getMonth(), 1);
    this.render();
    this.config.onChange?.(day);
    this.emit('change', { value: day, calendar: this });
  }

  /** Currently selected date (or null). */
  getValue(): Date | null {
    return this.config.value ?? null;
  }

  /** Programmatically set the view to a given month. */
  goToMonth(d: Date): void {
    this.view = new Date(d.getFullYear(), d.getMonth(), 1);
    this.render();
    this.emit('navigate', { viewDate: this.view, calendar: this });
  }

  override update(patch: Partial<MiniCalendarConfig>): this {
    super.update(patch);
    if ('value' in patch || 'viewDate' in patch) {
      this.syncViewFromConfig();
      this.render();
    }
    return this;
  }
}

register(
  'minicalendar',
  MiniCalendar as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => MiniCalendar,
);
