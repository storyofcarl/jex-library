/**
 * TimePicker — hour/minute spinbuttons with 12/24-hour display and a minute step.
 *
 * - Hours and minutes are `role="spinbutton"` with aria-valuemin/max/now/text.
 * - In 12-hour mode an AM/PM toggle button (`aria-pressed`) is shown.
 * - Keyboard on a field: ArrowUp/ArrowDown adjust by 1 (minutes by `step`);
 *   typing digits sets the value; PageUp/PageDown step larger for minutes.
 * - Emits `input` while editing and a vetoable `beforeChange` then `change`.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';
import { type TimeValue, pad2, snapMinutes } from './date-utils.js';

export interface TimePickerConfig extends WidgetConfig {
  /** Current time (null = empty, treated as 00:00 for editing). */
  value?: TimeValue | null | undefined;
  /** Display 12-hour with AM/PM (default) or 24-hour. */
  hour12?: boolean | undefined;
  /** Minute increment for stepping/snapping. Default 1. */
  step?: number | undefined;
  /** Disabled state. */
  disabled?: boolean;
  /** Value-change convenience handler. */
  onChange?: ((value: TimeValue) => void) | undefined;
}

export interface TimePickerEvents extends WidgetEvents {
  /** Fired on every edit before commit. */
  input: { value: TimeValue; picker: TimePicker };
  /** Vetoable: return `false` to reject a new value. */
  beforeChange: { value: TimeValue; picker: TimePicker };
  /** Fired after the committed value changes. */
  change: { value: TimeValue; picker: TimePicker };
}

const norm = (t: TimeValue | null | undefined): TimeValue => ({
  hours: t ? ((t.hours % 24) + 24) % 24 : 0,
  minutes: t ? ((t.minutes % 60) + 60) % 60 : 0,
});

export class TimePicker extends Widget<TimePickerConfig, TimePickerEvents> {
  private declare hourField: HTMLInputElement;
  private declare minuteField: HTMLInputElement;
  private declare periodBtn: HTMLButtonElement;

  protected override defaults(): Partial<TimePickerConfig> {
    return { value: null, hour12: true, step: 1 };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-timepicker', attrs: { role: 'group', 'aria-label': 'Time' } });

    this.hourField = this.makeField('Hours');
    this.minuteField = this.makeField('Minutes');
    this.hourField.addEventListener('keydown', (e) => this.onFieldKeydown(e, 'hours'));
    this.minuteField.addEventListener('keydown', (e) => this.onFieldKeydown(e, 'minutes'));
    this.hourField.addEventListener('change', () => this.onFieldChange('hours'));
    this.minuteField.addEventListener('change', () => this.onFieldChange('minutes'));

    const sep = createEl('span', { className: 'jects-timepicker__sep', text: ':', attrs: { 'aria-hidden': 'true' } });

    this.periodBtn = createEl('button', {
      className: 'jects-timepicker__period',
      attrs: { type: 'button', 'aria-pressed': 'false' },
      text: 'AM',
    });
    this.periodBtn.addEventListener('click', () => this.togglePeriod());

    root.append(this.hourField, sep, this.minuteField, this.periodBtn);
    return root;
  }

  private makeField(label: string): HTMLInputElement {
    return createEl('input', {
      className: 'jects-timepicker__field',
      attrs: {
        type: 'text',
        inputmode: 'numeric',
        role: 'spinbutton',
        'aria-label': label,
        maxlength: '2',
        autocomplete: 'off',
      },
    });
  }

  protected override render(): void {
    const { hour12 = true, disabled = false } = this.config;
    const t = norm(this.config.value);

    this.el.className = ['jects-timepicker', disabled ? 'jects-timepicker--disabled' : '', this.config.cls ?? '']
      .filter(Boolean)
      .join(' ');

    const displayHour = hour12 ? this.to12(t.hours).hour : t.hours;
    this.setField(this.hourField, displayHour, hour12 ? 1 : 0, hour12 ? 12 : 23);
    this.setField(this.minuteField, t.minutes, 0, 59);

    this.hourField.disabled = disabled;
    this.minuteField.disabled = disabled;

    this.periodBtn.hidden = !hour12;
    this.periodBtn.disabled = disabled;
    const isPm = t.hours >= 12;
    this.periodBtn.textContent = isPm ? 'PM' : 'AM';
    this.periodBtn.setAttribute('aria-pressed', String(isPm));
  }

  private setField(field: HTMLInputElement, value: number, min: number, max: number): void {
    if (document.activeElement !== field) field.value = pad2(value);
    field.setAttribute('aria-valuemin', String(min));
    field.setAttribute('aria-valuemax', String(max));
    field.setAttribute('aria-valuenow', String(value));
    field.setAttribute('aria-valuetext', pad2(value));
  }

  private to12(hours24: number): { hour: number; pm: boolean } {
    const pm = hours24 >= 12;
    let h = hours24 % 12;
    if (h === 0) h = 12;
    return { hour: h, pm };
  }

  private from12(hour12: number, pm: boolean): number {
    let h = hour12 % 12;
    if (pm) h += 12;
    return h;
  }

  private onFieldKeydown(e: KeyboardEvent, which: 'hours' | 'minutes'): void {
    const step = which === 'minutes' ? (this.config.step ?? 1) : 1;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.bump(which, step);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.bump(which, -step);
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      this.bump(which, which === 'minutes' ? 15 : 1);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      this.bump(which, which === 'minutes' ? -15 : -1);
    }
  }

  /** Adjust hours or minutes by delta, wrapping within range. */
  private bump(which: 'hours' | 'minutes', delta: number): void {
    const t = norm(this.config.value);
    if (which === 'hours') {
      t.hours = (((t.hours + delta) % 24) + 24) % 24;
    } else {
      t.minutes = (((t.minutes + delta) % 60) + 60) % 60;
    }
    this.commit(t);
    const field = which === 'hours' ? this.hourField : this.minuteField;
    field.focus();
  }

  private onFieldChange(which: 'hours' | 'minutes'): void {
    const t = norm(this.config.value);
    const raw = (which === 'hours' ? this.hourField : this.minuteField).value;
    const n = Number(raw.replace(/\D/g, ''));
    if (Number.isNaN(n)) {
      this.render();
      return;
    }
    if (which === 'hours') {
      if (this.config.hour12 ?? true) {
        const pm = t.hours >= 12;
        const h12 = Math.min(12, Math.max(1, n || 12));
        t.hours = this.from12(h12, pm);
      } else {
        t.hours = Math.min(23, Math.max(0, n));
      }
    } else {
      t.minutes = snapMinutes(Math.min(59, Math.max(0, n)), this.config.step ?? 1);
    }
    this.commit(t);
  }

  private togglePeriod(): void {
    const t = norm(this.config.value);
    t.hours = (t.hours + 12) % 24;
    this.commit(t);
  }

  /** Commit a new time, firing input + vetoable beforeChange + change. */
  private commit(value: TimeValue): void {
    const next = norm(value);
    this.emit('input', { value: next, picker: this });
    const current = norm(this.config.value);
    if (current.hours === next.hours && current.minutes === next.minutes && this.config.value) {
      this.render();
      return;
    }
    if (this.emit('beforeChange', { value: next, picker: this }) === false) {
      this.render();
      return;
    }
    this.config = { ...this.config, value: next };
    this.render();
    this.config.onChange?.(next);
    this.emit('change', { value: next, picker: this });
  }

  /** Current value (normalised; null becomes 00:00). */
  getValue(): TimeValue {
    return norm(this.config.value);
  }

  override update(patch: Partial<TimePickerConfig>): this {
    return super.update(patch);
  }
}

register(
  'timepicker',
  TimePicker as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => TimePicker,
);
