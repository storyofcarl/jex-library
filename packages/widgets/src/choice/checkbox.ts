/**
 * Checkbox — a tri-state (checked / unchecked / indeterminate) control.
 *
 * Mirrors the Button reference pattern: extends Widget, typed Config/Events,
 * defaults()/buildEl()/render(), vetoable `beforeChange` then `change`,
 * registers with the factory. Token-pure CSS lives in checkbox.css.
 *
 * a11y: native `<input type="checkbox">` carries role/checked semantics;
 * indeterminate is reflected on the DOM property and aria-checked="mixed".
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register, setHtml, trustedHtml } from '@jects/core';
import { renderIcon } from '@jects/icons';

export interface CheckboxConfig extends WidgetConfig {
  /** Visible label text. */
  label?: string;
  /** Checked state. Default `false`. */
  checked?: boolean;
  /** Indeterminate (mixed) state — visually a dash; overrides the check glyph. */
  indeterminate?: boolean;
  /** Disabled state. */
  disabled?: boolean;
  /** Form value submitted when checked. Default `'on'`. */
  value?: string;
  /** Form field name. */
  name?: string;
  /** Convenience handler (also via `.on('change', ...)`). */
  onChange?: (checked: boolean) => void;
}

export interface CheckboxEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel the toggle. */
  beforeChange: { checked: boolean; checkbox: Checkbox };
  change: { checked: boolean; checkbox: Checkbox };
  focus: { checkbox: Checkbox };
  blur: { checkbox: Checkbox };
}

export class Checkbox extends Widget<CheckboxConfig, CheckboxEvents> {
  private get input(): HTMLInputElement {
    return this.el.querySelector('.jects-checkbox__input') as HTMLInputElement;
  }

  protected override defaults(): Partial<CheckboxConfig> {
    return { checked: false, indeterminate: false, value: 'on' };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('label', { className: 'jects-checkbox' });
    const input = createEl('input', {
      className: 'jects-checkbox__input',
      attrs: { type: 'checkbox' },
    });
    const box = createEl('span', { className: 'jects-checkbox__box', attrs: { 'aria-hidden': 'true' } });
    const label = createEl('span', { className: 'jects-checkbox__label' });
    root.append(input, box, label);

    input.addEventListener('change', () => this.handleChange());
    input.addEventListener('focus', () => this.emit('focus', { checkbox: this }));
    input.addEventListener('blur', () => this.emit('blur', { checkbox: this }));
    return root;
  }

  private handleChange(): void {
    const next = this.input.checked;
    if (this.emit('beforeChange', { checked: next, checkbox: this }) === false) {
      // revert the native toggle
      this.input.checked = !next;
      return;
    }
    this.config = { ...this.config, checked: next, indeterminate: false };
    this.render();
    this.config.onChange?.(next);
    this.emit('change', { checked: next, checkbox: this });
  }

  /** Programmatically toggle the checked state (fires events). */
  toggle(): this {
    this.input.checked = !this.input.checked;
    this.handleChange();
    return this;
  }

  /** Current checked state. */
  get checked(): boolean {
    return this.config.checked ?? false;
  }

  protected override render(): void {
    const {
      label = '',
      checked = false,
      indeterminate = false,
      disabled = false,
      value = 'on',
      name,
    } = this.config;

    const el = this.el;
    el.className = [
      'jects-checkbox',
      checked ? 'jects-checkbox--checked' : '',
      indeterminate ? 'jects-checkbox--indeterminate' : '',
      disabled ? 'jects-checkbox--disabled' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    const input = this.input;
    input.checked = checked;
    input.indeterminate = indeterminate;
    input.disabled = disabled;
    input.value = value;
    if (name) input.name = name;
    else input.removeAttribute('name');
    input.setAttribute('aria-checked', indeterminate ? 'mixed' : String(checked));
    // Guarantee an accessible name even when there is no visible label.
    if (label === '') input.setAttribute('aria-label', 'Checkbox');
    else input.removeAttribute('aria-label');

    const box = el.querySelector('.jects-checkbox__box')!;
    setHtml(box, trustedHtml(indeterminate
      ? renderIcon('minus', { size: 14 })
      : checked
        ? renderIcon('check', { size: 14 })
        : ''));

    const labelEl = el.querySelector('.jects-checkbox__label') as HTMLElement;
    labelEl.textContent = label;
    labelEl.hidden = label === '';
  }
}

register(
  'checkbox',
  Checkbox as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Checkbox,
);
