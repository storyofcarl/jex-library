/**
 * CheckboxGroup — a set of independent checkboxes producing an array value.
 * Self-contained (owns its DOM, does not import the Checkbox widget).
 *
 * a11y: role="group"; each option is a native `<input type="checkbox">` inside
 * a label, so screen readers and keyboard (Space) work natively.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';
import { renderIcon } from '@jects/icons';

export interface CheckboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface CheckboxGroupConfig extends WidgetConfig {
  /** Options to render. */
  options?: CheckboxOption[];
  /** Currently checked values. */
  value?: string[];
  /** Accessible group label. */
  ariaLabel?: string;
  /** Layout direction. Default `vertical`. */
  orientation?: 'vertical' | 'horizontal';
  /** Disable the whole group. */
  disabled?: boolean;
  /** Convenience handler (also via `.on('change', ...)`). */
  onChange?: (value: string[]) => void;
}

export interface CheckboxGroupEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel the change. */
  beforeChange: { value: string[]; group: CheckboxGroup };
  change: { value: string[]; group: CheckboxGroup };
}

export class CheckboxGroup extends Widget<CheckboxGroupConfig, CheckboxGroupEvents> {
  protected override defaults(): Partial<CheckboxGroupConfig> {
    return { options: [], value: [], orientation: 'vertical' };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-checkbox-group', attrs: { role: 'group' } });
    root.addEventListener('change', (e) => this.handleChange(e));
    return root;
  }

  private handleChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (!input.matches('input[type="checkbox"]')) return;
    const value = input.value;
    const current = new Set(this.config.value ?? []);
    if (input.checked) current.add(value);
    else current.delete(value);
    const next = this.options()
      .map((o) => o.value)
      .filter((v) => current.has(v));

    if (this.emit('beforeChange', { value: next, group: this }) === false) {
      input.checked = !input.checked; // revert
      return;
    }
    this.config = { ...this.config, value: next };
    this.render();
    this.config.onChange?.(next);
    this.emit('change', { value: next, group: this });
  }

  private options(): CheckboxOption[] {
    return this.config.options ?? [];
  }

  get value(): string[] {
    return [...(this.config.value ?? [])];
  }

  protected override render(): void {
    const {
      options = [],
      value = [],
      ariaLabel,
      orientation = 'vertical',
      disabled = false,
    } = this.config;
    const selected = new Set(value);

    const el = this.el;
    el.className = [
      'jects-checkbox-group',
      `jects-checkbox-group--${orientation}`,
      disabled ? 'jects-checkbox-group--disabled' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
    else el.removeAttribute('aria-label');

    el.innerHTML = options
      .map((o) => {
        const checked = selected.has(o.value);
        const optDisabled = disabled || !!o.disabled;
        return [
          `<label class="jects-checkbox-group__option${checked ? ' jects-checkbox-group__option--checked' : ''}${optDisabled ? ' jects-checkbox-group__option--disabled' : ''}">`,
          `<input class="jects-checkbox-group__input" type="checkbox" value="${escapeAttr(o.value)}"${checked ? ' checked' : ''}${optDisabled ? ' disabled' : ''}>`,
          `<span class="jects-checkbox-group__box" aria-hidden="true">${checked ? renderIcon('check', { size: 14 }) : ''}</span>`,
          `<span class="jects-checkbox-group__label">${escapeHtml(o.label)}</span>`,
          `</label>`,
        ].join('');
      })
      .join('');
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

register(
  'checkboxgroup',
  CheckboxGroup as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => CheckboxGroup,
);
