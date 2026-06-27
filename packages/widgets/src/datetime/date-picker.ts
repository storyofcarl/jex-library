/**
 * DatePicker — a text input paired with its own popover MiniCalendar.
 *
 * - The input is `role="combobox"` with `aria-haspopup="dialog"` and
 *   `aria-expanded` reflecting the popover state.
 * - Typing a valid `YYYY-MM-DD` date updates the value; clicking a calendar day
 *   fills the input and closes the popover.
 * - Keyboard: ArrowDown / Enter opens the calendar; Escape closes it.
 * - Emits `input` while typing and a vetoable `beforeChange` then `change` when a
 *   committed value changes.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register, staticHtml } from '@jects/core';
import { MiniCalendar } from './mini-calendar.js';
import { Popover } from './popover.js';
import {
  type WeekStart,
  startOfDay,
  isSameDay,
  isDisabledDay,
  parseISODate,
  formatISODate,
} from './date-utils.js';

export interface DatePickerConfig extends WidgetConfig {
  /** Current value (null = empty). */
  value?: Date | null | undefined;
  /** Placeholder for the empty input. */
  placeholder?: string | undefined;
  /** Earliest selectable day. */
  min?: Date | null | undefined;
  /** Latest selectable day. */
  max?: Date | null | undefined;
  /** Week start passed to the calendar. */
  weekStart?: WeekStart | undefined;
  /** Disabled state. */
  disabled?: boolean;
  /** Value-change convenience handler. */
  onChange?: ((value: Date | null) => void) | undefined;
}

export interface DatePickerEvents extends WidgetEvents {
  /** Fired on every keystroke with the raw input text. */
  input: { text: string; picker: DatePicker };
  /** Vetoable: return `false` to reject a committed value. */
  beforeChange: { value: Date | null; picker: DatePicker };
  /** Fired after a committed value changes. */
  change: { value: Date | null; picker: DatePicker };
  /** Fired when the popover opens. */
  open: { picker: DatePicker };
  /** Fired when the popover closes. */
  close: { picker: DatePicker };
}

export class DatePicker extends Widget<DatePickerConfig, DatePickerEvents> {
  private declare input: HTMLInputElement;
  private declare trigger: HTMLButtonElement;
  private declare popover: Popover;
  private calendar: MiniCalendar | null = null;

  protected override defaults(): Partial<DatePickerConfig> {
    return { value: null, placeholder: 'YYYY-MM-DD', weekStart: 0, min: null, max: null };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-datepicker' });

    const panelId = `${this.id}-popover`;
    this.input = createEl('input', {
      className: 'jects-datepicker__input',
      attrs: {
        type: 'text',
        role: 'combobox',
        'aria-haspopup': 'dialog',
        'aria-expanded': 'false',
        'aria-controls': panelId,
        'aria-label': 'Date',
        autocomplete: 'off',
      },
    });
    this.input.addEventListener('input', () => this.handleInput());
    this.input.addEventListener('keydown', (e) => this.handleKeydown(e));
    this.input.addEventListener('blur', () => this.commitFromInput());

    this.trigger = createEl('button', {
      className: 'jects-datepicker__trigger',
      attrs: { type: 'button', 'aria-label': 'Open calendar', tabindex: '-1' },
      html: staticHtml`&#128197;`,
    });
    this.trigger.addEventListener('click', () => this.toggle());

    this.popover = new Popover({ anchor: root, onClose: () => this.close() });
    // Link the combobox to its dialog and give the dialog an accessible name.
    this.popover.panel.id = panelId;
    this.popover.panel.setAttribute('aria-label', 'Choose date');

    root.append(this.input, this.trigger, this.popover.panel);
    return root;
  }

  protected override render(): void {
    const { value = null, placeholder = '', disabled = false } = this.config;
    this.el.className = ['jects-datepicker', disabled ? 'jects-datepicker--disabled' : '', this.config.cls ?? '']
      .filter(Boolean)
      .join(' ');
    this.input.placeholder = placeholder;
    this.input.disabled = disabled;
    this.trigger.disabled = disabled;
    // Only overwrite the field if it isn't the source of an in-progress edit.
    if (document.activeElement !== this.input) {
      this.input.value = value ? formatISODate(value) : '';
    }
  }

  private handleInput(): void {
    this.emit('input', { text: this.input.value, picker: this });
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || (e.key === 'Enter' && !this.popover.isOpen)) {
      e.preventDefault();
      if (e.key === 'Enter') this.commitFromInput();
      this.open();
    } else if (e.key === 'Escape' && this.popover.isOpen) {
      e.preventDefault();
      this.close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.commitFromInput();
    }
  }

  /** Parse the input text and commit a value (or null when empty/invalid). */
  private commitFromInput(): void {
    const text = this.input.value.trim();
    if (text === '') {
      this.commit(null);
      return;
    }
    const parsed = parseISODate(text);
    if (!parsed || isDisabledDay(parsed, this.config.min, this.config.max)) {
      // Revert to the last good value.
      this.render();
      return;
    }
    this.commit(startOfDay(parsed));
  }

  /** Commit a new value, firing the vetoable beforeChange then change. */
  private commit(value: Date | null): void {
    const current = this.config.value ?? null;
    if (isSameDay(current, value) || (current === null && value === null)) {
      this.render();
      return;
    }
    if (this.emit('beforeChange', { value, picker: this }) === false) {
      this.render();
      return;
    }
    this.config = { ...this.config, value };
    this.render();
    this.calendar?.update({ value, viewDate: value ?? undefined });
    this.config.onChange?.(value);
    this.emit('change', { value, picker: this });
  }

  /** Open the popover, building the calendar lazily. */
  open(): void {
    if (this.config.disabled || this.popover.isOpen) return;
    if (!this.calendar) {
      this.calendar = new MiniCalendar(this.popover.panel, {
        value: this.config.value ?? null,
        min: this.config.min,
        max: this.config.max,
        weekStart: this.config.weekStart,
      });
      this.calendar.on('change', ({ value }) => {
        this.commit(value);
        this.close();
        this.input.focus();
      });
      this.track(() => this.calendar?.destroy());
    } else {
      this.calendar.update({ value: this.config.value ?? null, viewDate: this.config.value ?? undefined });
    }
    this.popover.show();
    this.input.setAttribute('aria-expanded', 'true');
    this.emit('open', { picker: this });
  }

  /** Close the popover, returning focus to the input if it was inside. */
  close(): void {
    if (!this.popover.isOpen) return;
    // Capture before hiding: hide() removes the panel's listeners but the
    // focused element may still be a calendar cell inside the (now hidden) panel.
    const focusWasInside =
      document.activeElement === this.input ||
      this.popover.panel.contains(document.activeElement);
    this.popover.hide();
    this.input.setAttribute('aria-expanded', 'false');
    // Don't strand keyboard focus on a now-hidden element.
    if (focusWasInside && document.activeElement !== this.input) this.input.focus();
    this.emit('close', { picker: this });
  }

  /** Toggle the popover open/closed. */
  toggle(): void {
    if (this.popover.isOpen) this.close();
    else this.open();
  }

  /** Current committed value (or null). */
  getValue(): Date | null {
    return this.config.value ?? null;
  }

  override destroy(): void {
    this.popover.destroy();
    super.destroy();
  }
}

register(
  'datepicker',
  DatePicker as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => DatePicker,
);
