/**
 * DateTimeField — a combined date + time control composing a DatePicker and a
 * TimePicker. Its value is a single Date (date + time-of-day). Self-contained:
 * it owns child widgets and merges their changes into one value.
 *
 * - Emits `input` while either child edits and a vetoable `beforeChange` then
 *   `change` when the combined value changes.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';
import { DatePicker } from './date-picker.js';
import { TimePicker } from './time-picker.js';
import { type WeekStart, type TimeValue, startOfDay } from './date-utils.js';

export interface DateTimeFieldConfig extends WidgetConfig {
  /** Combined value (null = empty). */
  value?: Date | null | undefined;
  /** Earliest selectable day. */
  min?: Date | null | undefined;
  /** Latest selectable day. */
  max?: Date | null | undefined;
  /** Week start for the date calendar. */
  weekStart?: WeekStart | undefined;
  /** 12-hour time display (default) or 24-hour. */
  hour12?: boolean | undefined;
  /** Minute step for the time picker. */
  step?: number | undefined;
  /** Disabled state. */
  disabled?: boolean;
  /** Value-change convenience handler. */
  onChange?: ((value: Date | null) => void) | undefined;
}

export interface DateTimeFieldEvents extends WidgetEvents {
  /** Fired while either child is edited. */
  input: { value: Date | null; field: DateTimeField };
  /** Vetoable: return `false` to reject the combined value. */
  beforeChange: { value: Date | null; field: DateTimeField };
  /** Fired after the combined value changes. */
  change: { value: Date | null; field: DateTimeField };
}

export class DateTimeField extends Widget<DateTimeFieldConfig, DateTimeFieldEvents> {
  private declare datePart: DatePicker;
  private declare timePart: TimePicker;
  /** Date portion (midnight) currently held; null when no date chosen. */
  private declare datePortion: Date | null;
  /** Time portion currently held. */
  private declare timePortion: TimeValue;

  protected override defaults(): Partial<DateTimeFieldConfig> {
    return { value: null, weekStart: 0, hour12: true, step: 1, min: null, max: null };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-datetimefield', attrs: { role: 'group', 'aria-label': 'Date and time' } });
    const dateHost = createEl('div', { className: 'jects-datetimefield__date' });
    const timeHost = createEl('div', { className: 'jects-datetimefield__time' });
    root.append(dateHost, timeHost);

    const v = this.config.value ?? null;
    this.datePortion = v ? startOfDay(v) : null;
    this.timePortion = v ? { hours: v.getHours(), minutes: v.getMinutes() } : { hours: 0, minutes: 0 };

    this.datePart = new DatePicker(dateHost, {
      value: this.datePortion,
      min: this.config.min,
      max: this.config.max,
      weekStart: this.config.weekStart,
      disabled: this.config.disabled ?? false,
    });
    this.timePart = new TimePicker(timeHost, {
      value: this.timePortion,
      hour12: this.config.hour12,
      step: this.config.step,
      disabled: this.config.disabled ?? false,
    });

    this.datePart.on('change', ({ value }) => {
      this.datePortion = value;
      this.recombine();
    });
    this.timePart.on('change', ({ value }) => {
      this.timePortion = value;
      this.recombine();
    });

    this.track(() => this.datePart.destroy());
    this.track(() => this.timePart.destroy());
    return root;
  }

  protected override render(): void {
    const disabled = this.config.disabled ?? false;
    this.el.className = ['jects-datetimefield', disabled ? 'jects-datetimefield--disabled' : '', this.config.cls ?? '']
      .filter(Boolean)
      .join(' ');
  }

  /** Merge date + time parts into a single Date and commit when changed. */
  private recombine(): void {
    const combined = this.composeValue();
    this.emit('input', { value: combined, field: this });
    const current = this.config.value ?? null;
    // No net change vs the committed value: revert internal/child state so a
    // child that already committed its own edit doesn't leave us desynced.
    if (sameInstant(current, combined)) {
      this.revertToConfigValue();
      return;
    }
    if (this.emit('beforeChange', { value: combined, field: this }) === false) {
      // Vetoed: the children have already committed their edits, so roll their
      // values (and our portions) back to the last committed config.value.
      this.revertToConfigValue();
      return;
    }
    this.config = { ...this.config, value: combined };
    this.config.onChange?.(combined);
    this.emit('change', { value: combined, field: this });
  }

  /**
   * Recompute datePortion/timePortion from the committed config.value and push
   * them back into the child widgets, so internal state, children, and config
   * stay consistent after a vetoed or no-op recombine.
   */
  private revertToConfigValue(): void {
    const v = this.config.value ?? null;
    this.datePortion = v ? startOfDay(v) : null;
    this.timePortion = v ? { hours: v.getHours(), minutes: v.getMinutes() } : { hours: 0, minutes: 0 };
    this.datePart.update({ value: this.datePortion });
    this.timePart.update({ value: this.timePortion });
  }

  private composeValue(): Date | null {
    if (!this.datePortion) return null;
    return new Date(
      this.datePortion.getFullYear(),
      this.datePortion.getMonth(),
      this.datePortion.getDate(),
      this.timePortion.hours,
      this.timePortion.minutes,
      0,
      0,
    );
  }

  /** Current combined value (or null). */
  getValue(): Date | null {
    return this.config.value ?? null;
  }

  override update(patch: Partial<DateTimeFieldConfig>): this {
    super.update(patch);
    if ('value' in patch) {
      const v = patch.value ?? null;
      this.datePortion = v ? startOfDay(v) : null;
      this.timePortion = v ? { hours: v.getHours(), minutes: v.getMinutes() } : { hours: 0, minutes: 0 };
      this.datePart.update({ value: this.datePortion });
      this.timePart.update({ value: this.timePortion });
    }
    if ('disabled' in patch) {
      this.datePart.update({ disabled: patch.disabled ?? false });
      this.timePart.update({ disabled: patch.disabled ?? false });
    }
    return this;
  }
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.getTime() === b.getTime();
}

register(
  'datetimefield',
  DateTimeField as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => DateTimeField,
);
