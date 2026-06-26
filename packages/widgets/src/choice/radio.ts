/**
 * Radio — a single radio button. Usually composed by RadioGroup, but standalone
 * capable. Vetoable `beforeChange` then `change`.
 *
 * a11y: native `<input type="radio">` carries role/checked semantics.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';

export interface RadioConfig extends WidgetConfig {
  /** Visible label text. */
  label?: string;
  /** Form value this radio represents. */
  value?: string;
  /** Selected state. Default `false`. */
  checked?: boolean;
  /** Disabled state. */
  disabled?: boolean;
  /** Form group name (radios sharing a name are mutually exclusive). */
  name?: string;
  /** Convenience handler (also via `.on('change', ...)`). */
  onChange?: (value: string | undefined) => void;
}

export interface RadioEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel the selection. */
  beforeChange: { value: string | undefined; radio: Radio };
  change: { value: string | undefined; radio: Radio };
  focus: { radio: Radio };
  blur: { radio: Radio };
}

export class Radio extends Widget<RadioConfig, RadioEvents> {
  private get input(): HTMLInputElement {
    return this.el.querySelector('.jects-radio__input') as HTMLInputElement;
  }

  protected override defaults(): Partial<RadioConfig> {
    return { checked: false };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('label', { className: 'jects-radio' });
    const input = createEl('input', {
      className: 'jects-radio__input',
      attrs: { type: 'radio' },
    });
    const dot = createEl('span', { className: 'jects-radio__dot', attrs: { 'aria-hidden': 'true' } });
    const label = createEl('span', { className: 'jects-radio__label' });
    root.append(input, dot, label);

    input.addEventListener('change', () => this.handleChange());
    input.addEventListener('focus', () => this.emit('focus', { radio: this }));
    input.addEventListener('blur', () => this.emit('blur', { radio: this }));
    return root;
  }

  private handleChange(): void {
    if (!this.input.checked) return;
    const value = this.config.value;
    if (this.emit('beforeChange', { value, radio: this }) === false) {
      this.input.checked = false;
      return;
    }
    this.config = { ...this.config, checked: true };
    this.render();
    this.config.onChange?.(value);
    this.emit('change', { value, radio: this });
  }

  get checked(): boolean {
    return this.config.checked ?? false;
  }

  /** Set selected state without firing events (used by RadioGroup). */
  setChecked(on: boolean): this {
    this.config = { ...this.config, checked: on };
    this.render();
    return this;
  }

  protected override render(): void {
    const { label = '', value, checked = false, disabled = false, name } = this.config;

    const el = this.el;
    el.className = [
      'jects-radio',
      checked ? 'jects-radio--checked' : '',
      disabled ? 'jects-radio--disabled' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    const input = this.input;
    input.checked = checked;
    input.disabled = disabled;
    if (value !== undefined) input.value = value;
    if (name) input.name = name;
    else input.removeAttribute('name');

    const labelEl = el.querySelector('.jects-radio__label') as HTMLElement;
    labelEl.textContent = label;
    labelEl.hidden = label === '';
  }
}

register(
  'radio',
  Radio as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Radio,
);
