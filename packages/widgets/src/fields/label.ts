/**
 * Label — an accessible `<label>` with an optional required marker, associable
 * to a form control via `htmlFor`.
 */

import { Widget, type WidgetConfig, type WidgetEvents, register } from '@jects/core';
import type { FieldSize } from './text-field.js';

export interface LabelConfig extends WidgetConfig {
  /** Label text. */
  text?: string;
  /** Associated control id (`for` attribute). */
  htmlFor?: string;
  /** Show a required marker (`*`). */
  required?: boolean;
  /** Size. Default `md`. */
  size?: FieldSize;
}

export type LabelEvents = WidgetEvents;

export class Label extends Widget<LabelConfig, LabelEvents> {
  protected override defaults(): Partial<LabelConfig> {
    return { size: 'md' };
  }

  protected buildEl(): HTMLElement {
    return document.createElement('label');
  }

  protected override render(): void {
    const { text = '', htmlFor, required = false, size = 'md' } = this.config;
    const el = this.el as HTMLLabelElement;

    el.className = ['jects-label', `jects-label--${size}`, this.config.cls ?? '']
      .filter(Boolean)
      .join(' ');

    if (htmlFor) el.htmlFor = htmlFor;
    else el.removeAttribute('for');

    el.innerHTML = `${escapeHtml(text)}${required ? '<span class="jects-label__required" aria-hidden="true">*</span>' : ''}`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

register(
  'label',
  Label as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Label,
);
