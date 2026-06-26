/**
 * NumberField — a numeric input with min/max/step, spinner buttons, keyboard
 * Up/Down stepping, and optional fixed-decimal formatting.
 *
 * Self-contained: extends the local `TextField` (same folder) and layers numeric
 * behavior on top. Listeners are wired in `buildEl()` with bound methods. Like
 * TextField it caches NO element references as class fields (field-init order).
 */

import { type WidgetEvents, createEl, register } from '@jects/core';
import { TextField, type TextFieldConfig } from './text-field.js';

export interface NumberFieldConfig extends Omit<TextFieldConfig, 'inputType'> {
  /** Numeric value (as string). */
  value?: string;
  /** Minimum allowed value. */
  min?: number;
  /** Maximum allowed value. */
  max?: number;
  /** Step increment for spinners / keyboard. Default 1. */
  step?: number;
  /** Show up/down spinner buttons. Default true. */
  spinners?: boolean;
  /** Fixed number of decimal places to format committed values to. */
  precision?: number;
}

export interface NumberFieldEvents extends WidgetEvents {
  input: { value: string; numericValue: number | null; event: Event; field: NumberField };
  change: { value: string; numericValue: number | null; event: Event; field: NumberField };
  focus: { event: FocusEvent; field: NumberField };
  blur: { event: FocusEvent; field: NumberField };
  clear: { field: NumberField };
}

export class NumberField extends TextField {
  protected get stepUpBtn(): HTMLButtonElement | null {
    return this.el.querySelector('.jects-field__step--up');
  }
  protected get stepDownBtn(): HTMLButtonElement | null {
    return this.el.querySelector('.jects-field__step--down');
  }
  protected get spinnersEl(): HTMLElement | null {
    return this.el.querySelector('.jects-field__spinners');
  }

  protected override defaults(): Partial<TextFieldConfig> {
    return { size: 'md', inputType: 'text', value: '', step: 1, spinners: true } as Partial<TextFieldConfig>;
  }

  protected get numConfig(): NumberFieldConfig {
    return this.config as unknown as NumberFieldConfig;
  }

  protected override buildEl(): HTMLElement {
    const root = super.buildEl();
    root.addEventListener('keydown', (e) => this.handleKeydown(e as KeyboardEvent));
    return root;
  }

  protected handleKeydown(event: KeyboardEvent): void {
    if (this.config.disabled || this.config.readOnly) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.step(1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.step(-1);
    }
  }

  protected override handleClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    const up = this.stepUpBtn;
    const down = this.stepDownBtn;
    if (target && up && (target === up || up.contains(target))) {
      this.step(1);
      return;
    }
    if (target && down && (target === down || down.contains(target))) {
      this.step(-1);
      return;
    }
    super.handleClick(event);
  }

  /** Parse the current text into a number, or null if blank/NaN. */
  getNumericValue(): number | null {
    const raw = this.input?.value ?? '';
    if (raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  }

  protected clamp(n: number): number {
    const { min, max } = this.numConfig;
    if (typeof min === 'number' && n < min) n = min;
    if (typeof max === 'number' && n > max) n = max;
    return n;
  }

  protected format(n: number): string {
    const { precision } = this.numConfig;
    return typeof precision === 'number' ? n.toFixed(precision) : String(n);
  }

  /** Step the value by `dir * step`, clamping to min/max. */
  step(dir: number): this {
    const { step = 1 } = this.numConfig;
    const current = this.getNumericValue() ?? 0;
    const next = this.clamp(current + dir * step);
    const text = this.format(next);
    this.input.value = text;
    this.config.value = text;
    this.syncAriaValue();
    this.syncClearVisibility();
    this.emit('input', { value: text, numericValue: next, event: new Event('input'), field: this } as never);
    this.emit('change', { value: text, numericValue: next, event: new Event('change'), field: this } as never);
    return this;
  }

  protected override handleInput(event: Event): void {
    if (!this.isInput(event.target)) return;
    this.config.value = this.input.value;
    this.syncClearVisibility();
    // Keep the spinbutton aria state in sync on every keystroke so a screen
    // reader never announces a value that disagrees with the typed text.
    this.syncAriaValue();
    this.emit('input', {
      value: this.input.value,
      numericValue: this.getNumericValue(),
      event,
      field: this,
    } as never);
  }

  /** Mirror render()'s aria-valuenow/aria-valuetext logic for live updates. */
  protected syncAriaValue(): void {
    const input = this.input;
    if (!input) return;
    const n = this.getNumericValue();
    if (n !== null) {
      input.setAttribute('aria-valuenow', String(n));
      input.setAttribute('aria-valuetext', this.format(n));
    } else {
      input.removeAttribute('aria-valuenow');
      input.removeAttribute('aria-valuetext');
    }
  }

  protected override handleChange(event: Event): void {
    if (!this.isInput(event.target)) return;
    const n = this.getNumericValue();
    if (n !== null) {
      const clamped = this.clamp(n);
      const text = this.format(clamped);
      this.input.value = text;
      this.config.value = text;
    } else {
      this.config.value = this.input.value;
    }
    this.emit('change', {
      value: this.input.value,
      numericValue: this.getNumericValue(),
      event,
      field: this,
    } as never);
  }

  protected override render(): void {
    super.render();
    const control = this.el.querySelector('.jects-field__control') as HTMLElement | null;
    if (!control) return;
    const input = this.input;

    input.setAttribute('role', 'spinbutton');
    input.setAttribute('inputmode', 'decimal');
    const { min, max, spinners = true } = this.numConfig;
    if (typeof min === 'number') input.setAttribute('aria-valuemin', String(min));
    else input.removeAttribute('aria-valuemin');
    if (typeof max === 'number') input.setAttribute('aria-valuemax', String(max));
    else input.removeAttribute('aria-valuemax');
    this.syncAriaValue();

    // Spinners are built once and toggled in place. TextField.render() no longer
    // wipes the control on every render, so we must NOT recreate them each time
    // (that would duplicate the buttons) — only add/remove as enablement changes.
    const wantSpinners = spinners && !this.config.disabled && !this.config.readOnly;
    let spin = this.spinnersEl;
    if (wantSpinners) {
      if (!spin) {
        spin = createEl('div', { className: 'jects-field__spinners' });
        const up = createEl('button', {
          className: 'jects-field__step jects-field__step--up',
          text: '+',
          attrs: { type: 'button', 'aria-label': 'Increment', tabindex: '-1' },
        });
        const down = createEl('button', {
          className: 'jects-field__step jects-field__step--down',
          text: '−',
          attrs: { type: 'button', 'aria-label': 'Decrement', tabindex: '-1' },
        });
        spin.append(up, down);
      }
      // Keep spinners as the last child of the control.
      control.append(spin);
    } else if (spin) {
      spin.remove();
    }
  }
}

register(
  'numberfield',
  NumberField as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => NumberField,
);
