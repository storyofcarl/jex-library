/**
 * Switch — an on/off toggle, semantically a checkbox styled as a sliding track.
 *
 * Mirrors the Button reference pattern. Vetoable `beforeChange` then `change`.
 * a11y: role="switch" via a native checkbox input; aria-checked reflects state;
 * Space/Enter toggle natively through the input.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';

export interface SwitchConfig extends WidgetConfig {
  /** Visible label text. */
  label?: string;
  /** On/off state. Default `false`. */
  checked?: boolean;
  /** Disabled state. */
  disabled?: boolean;
  /** Form field name. */
  name?: string;
  /** Convenience handler (also via `.on('change', ...)`). */
  onChange?: (checked: boolean) => void;
}

export interface SwitchEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel the toggle. */
  beforeChange: { checked: boolean; switch: Switch };
  change: { checked: boolean; switch: Switch };
  focus: { switch: Switch };
  blur: { switch: Switch };
}

export class Switch extends Widget<SwitchConfig, SwitchEvents> {
  private get input(): HTMLInputElement {
    return this.el.querySelector('.jects-switch__input') as HTMLInputElement;
  }

  protected override defaults(): Partial<SwitchConfig> {
    return { checked: false };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('label', { className: 'jects-switch' });
    const input = createEl('input', {
      className: 'jects-switch__input',
      attrs: { type: 'checkbox', role: 'switch' },
    });
    const track = createEl('span', { className: 'jects-switch__track', attrs: { 'aria-hidden': 'true' } });
    const thumb = createEl('span', { className: 'jects-switch__thumb' });
    track.append(thumb);
    const label = createEl('span', { className: 'jects-switch__label' });
    root.append(input, track, label);

    input.addEventListener('change', () => this.handleChange());
    input.addEventListener('focus', () => this.emit('focus', { switch: this }));
    input.addEventListener('blur', () => this.emit('blur', { switch: this }));
    return root;
  }

  private handleChange(): void {
    // A disabled switch must never change aria-checked or emit change, even if
    // a programmatic toggle() or a synthetic event flips the input.
    if (this.config.disabled) {
      this.input.checked = this.config.checked ?? false;
      return;
    }
    const next = this.input.checked;
    if (this.emit('beforeChange', { checked: next, switch: this }) === false) {
      this.input.checked = !next;
      return;
    }
    this.config = { ...this.config, checked: next };
    this.render();
    this.config.onChange?.(next);
    this.emit('change', { checked: next, switch: this });
  }

  /** Programmatically toggle (fires events). No-op when disabled. */
  toggle(): this {
    if (this.config.disabled) return this;
    this.input.checked = !this.input.checked;
    this.handleChange();
    return this;
  }

  get checked(): boolean {
    return this.config.checked ?? false;
  }

  protected override render(): void {
    const { label = '', checked = false, disabled = false, name } = this.config;

    const el = this.el;
    el.className = [
      'jects-switch',
      checked ? 'jects-switch--checked' : '',
      disabled ? 'jects-switch--disabled' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    const input = this.input;
    input.checked = checked;
    input.disabled = disabled;
    input.setAttribute('aria-checked', String(checked));
    // Guarantee an accessible name even when there is no visible label.
    if (label === '') input.setAttribute('aria-label', 'Switch');
    else input.removeAttribute('aria-label');
    if (name) input.name = name;
    else input.removeAttribute('name');

    const labelEl = el.querySelector('.jects-switch__label') as HTMLElement;
    labelEl.textContent = label;
    labelEl.hidden = label === '';
  }
}

register(
  'switch',
  Switch as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Switch,
);
