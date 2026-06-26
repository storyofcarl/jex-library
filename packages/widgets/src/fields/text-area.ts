/**
 * TextArea — a labeled multi-line text input with optional autoGrow, a fixed row
 * count, and a maxLength character counter.
 *
 * Mirrors the Button pattern: typed Config/Events, `defaults()`, `buildEl()`
 * (listeners wired with bound methods), idempotent `render()`, factory registration.
 * Caches NO element refs as class fields (field-init order under
 * `useDefineForClassFields`); resolves children lazily via getters.
 * Events: input / change / focus / blur.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';
import type { FieldSize } from './text-field.js';

export interface TextAreaConfig extends WidgetConfig {
  /** Current value. */
  value?: string;
  /** Placeholder text. */
  placeholder?: string;
  /** Visible label. */
  label?: string;
  /** Disabled state. */
  disabled?: boolean;
  /** Read-only state. */
  readOnly?: boolean;
  /** Required marker + native required. */
  required?: boolean;
  /** Visible rows (initial height). Default 3. */
  rows?: number;
  /** Auto-grow height to fit content. */
  autoGrow?: boolean;
  /** Maximum character length (shows a counter). */
  maxLength?: number;
  /** Size. Default `md`. */
  size?: FieldSize;
  /** Invalid state. */
  invalid?: boolean;
  /** Error message (implies invalid). */
  error?: string;
  /** Native name. */
  name?: string;
}

export interface TextAreaEvents extends WidgetEvents {
  input: { value: string; event: Event; field: TextArea };
  change: { value: string; event: Event; field: TextArea };
  focus: { event: FocusEvent; field: TextArea };
  blur: { event: FocusEvent; field: TextArea };
}

let areaSeq = 0;

export class TextArea extends Widget<TextAreaConfig, TextAreaEvents> {
  protected get inputId(): string {
    let id = this.el.dataset.inputId;
    if (!id) {
      id = `jects-textarea-${++areaSeq}`;
      this.el.dataset.inputId = id;
    }
    return id;
  }

  protected get textarea(): HTMLTextAreaElement {
    return this.el.querySelector('.jects-textarea__input') as HTMLTextAreaElement;
  }
  protected get counterEl(): HTMLElement | null {
    return this.el.querySelector('.jects-textarea__counter');
  }

  protected override defaults(): Partial<TextAreaConfig> {
    return { size: 'md', rows: 3, value: '' };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-textarea' });
    root.addEventListener('input', (e) => this.handleInput(e));
    root.addEventListener('change', (e) => this.handleChange(e));
    root.addEventListener('focusin', (e) => this.handleFocus(e as FocusEvent));
    root.addEventListener('focusout', (e) => this.handleBlur(e as FocusEvent));
    return root;
  }

  protected handleInput(event: Event): void {
    if (event.target !== this.textarea) return;
    this.config.value = this.textarea.value;
    this.updateCounter();
    if (this.config.autoGrow) this.grow();
    this.emit('input', { value: this.textarea.value, event, field: this });
  }

  protected handleChange(event: Event): void {
    if (event.target !== this.textarea) return;
    this.config.value = this.textarea.value;
    this.emit('change', { value: this.textarea.value, event, field: this });
  }

  protected handleFocus(event: FocusEvent): void {
    this.el.classList.add('jects-textarea--focused');
    this.emit('focus', { event, field: this });
  }

  protected handleBlur(event: FocusEvent): void {
    this.el.classList.remove('jects-textarea--focused');
    this.emit('blur', { event, field: this });
  }

  protected grow(): void {
    const ta = this.textarea;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }

  protected updateCounter(): void {
    const counter = this.counterEl;
    if (!counter) return;
    const { maxLength } = this.config;
    const len = this.textarea.value.length;
    counter.textContent = typeof maxLength === 'number' ? `${len} / ${maxLength}` : String(len);
  }

  getValue(): string {
    return this.textarea?.value ?? this.config.value ?? '';
  }

  focus(): this {
    this.textarea?.focus();
    return this;
  }

  protected override render(): void {
    const {
      value = '',
      placeholder,
      label,
      disabled = false,
      readOnly = false,
      required = false,
      rows = 3,
      autoGrow = false,
      maxLength,
      size = 'md',
      invalid = false,
      error,
      name,
    } = this.config;

    const hasError = invalid || !!error;

    this.el.className = [
      'jects-textarea',
      `jects-textarea--${size}`,
      disabled ? 'jects-textarea--disabled' : '',
      readOnly ? 'jects-textarea--readonly' : '',
      autoGrow ? 'jects-textarea--autogrow' : '',
      hasError ? 'jects-textarea--invalid' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    let textarea = this.el.querySelector('.jects-textarea__input') as HTMLTextAreaElement | null;
    if (!textarea) {
      textarea = createEl('textarea', { className: 'jects-textarea__input', attrs: { id: this.inputId } });
      this.el.append(textarea);
    }

    // Label (before textarea)
    let labelEl = this.el.querySelector('.jects-textarea__label') as HTMLLabelElement | null;
    if (label) {
      if (!labelEl) {
        labelEl = createEl('label', { className: 'jects-textarea__label', attrs: { for: this.inputId } });
        this.el.insertBefore(labelEl, textarea);
      }
      labelEl.innerHTML = `${escapeHtml(label)}${required ? '<span class="jects-textarea__required" aria-hidden="true">*</span>' : ''}`;
    } else if (labelEl) {
      labelEl.remove();
    }

    textarea.value = value;
    textarea.placeholder = placeholder ?? '';
    textarea.disabled = disabled;
    textarea.readOnly = readOnly;
    textarea.required = required;
    textarea.rows = rows;
    if (name != null) textarea.name = name;
    if (typeof maxLength === 'number') textarea.maxLength = maxLength;
    else textarea.removeAttribute('maxlength');
    textarea.setAttribute('aria-invalid', String(hasError));

    // Counter (after textarea)
    let counter = this.el.querySelector('.jects-textarea__counter') as HTMLElement | null;
    if (typeof maxLength === 'number') {
      if (!counter) {
        counter = createEl('div', { className: 'jects-textarea__counter', attrs: { 'aria-hidden': 'true' } });
      }
      this.el.append(counter);
      const len = textarea.value.length;
      counter.textContent = `${len} / ${maxLength}`;
    } else if (counter) {
      counter.remove();
    }

    // Error
    const errorId = `${this.inputId}-error`;
    let errorEl = this.el.querySelector('.jects-textarea__error') as HTMLElement | null;
    if (error) {
      if (!errorEl) {
        errorEl = createEl('div', { className: 'jects-textarea__error', attrs: { id: errorId, role: 'alert' } });
      }
      this.el.append(errorEl);
      errorEl.textContent = error;
      textarea.setAttribute('aria-describedby', errorId);
    } else if (errorEl) {
      errorEl.remove();
      textarea.removeAttribute('aria-describedby');
    }

    if (autoGrow) this.grow();
    else textarea.style.height = '';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

register(
  'textarea',
  TextArea as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => TextArea,
);
