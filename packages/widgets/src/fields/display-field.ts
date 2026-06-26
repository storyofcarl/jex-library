/**
 * DisplayField — a read-only labeled value (e.g. for detail / summary views).
 * Non-interactive: renders a label and its value as static text.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';
import type { FieldSize } from './text-field.js';

export interface DisplayFieldConfig extends WidgetConfig {
  /** Field label. */
  label?: string;
  /** Displayed value. */
  value?: string;
  /** Fallback text shown when value is empty. Default `—`. */
  empty?: string;
  /** Size. Default `md`. */
  size?: FieldSize;
  /** Layout: stacked (label above) or inline (label beside). Default `stacked`. */
  layout?: 'stacked' | 'inline';
}

export type DisplayFieldEvents = WidgetEvents;

export class DisplayField extends Widget<DisplayFieldConfig, DisplayFieldEvents> {
  protected get labelEl(): HTMLElement {
    return this.el.querySelector('.jects-display__label') as HTMLElement;
  }
  protected get valueEl(): HTMLElement {
    return this.el.querySelector('.jects-display__value') as HTMLElement;
  }

  protected override defaults(): Partial<DisplayFieldConfig> {
    return { size: 'md', layout: 'stacked', empty: '—' };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-display' });
    root.append(
      createEl('span', { className: 'jects-display__label' }),
      createEl('span', { className: 'jects-display__value' }),
    );
    return root;
  }

  /** Current displayed value. */
  getValue(): string {
    return this.config.value ?? '';
  }

  protected override render(): void {
    const { label = '', value, empty = '—', size = 'md', layout = 'stacked' } = this.config;

    this.el.className = [
      'jects-display',
      `jects-display--${size}`,
      `jects-display--${layout}`,
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    this.labelEl.textContent = label;
    this.labelEl.hidden = !label;

    const hasValue = value != null && value !== '';
    this.valueEl.textContent = hasValue ? value! : empty;
    this.valueEl.classList.toggle('jects-display__value--empty', !hasValue);
  }
}

register(
  'displayfield',
  DisplayField as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => DisplayField,
);
