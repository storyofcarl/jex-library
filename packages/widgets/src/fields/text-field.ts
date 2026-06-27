/**
 * TextField — a labeled single-line text input.
 *
 * Mirrors the reference Button pattern: extends `Widget<Config, Events>`,
 * `defaults()` supplies component defaults, `buildEl()` builds the root once and
 * wires DOM listeners with bound methods (NOT class-field arrows, because
 * `super()` runs `buildEl()` before subclass field initializers), and `render()`
 * idempotently syncs the DOM to config.
 *
 * IMPORTANT: with `useDefineForClassFields`, a class field declaration emits an
 * assignment that runs AFTER `super()` — wiping anything `render()` set during
 * construction. So this component caches NO element references as class fields;
 * it resolves child nodes lazily via getters that query `this.el`.
 *
 * Features: value / placeholder / label / disabled / readOnly / clearable /
 * prefix + suffix / size (sm|md|lg) / invalid + error message.
 * Events: input / change / focus / blur / clear.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register, setHtml, trustedHtml, staticHtml } from '@jects/core';

export type FieldSize = 'sm' | 'md' | 'lg';

export interface TextFieldConfig extends WidgetConfig {
  /** Current value. */
  value?: string;
  /** Placeholder text shown when empty. */
  placeholder?: string;
  /** Visible label rendered above the control. */
  label?: string;
  /**
   * Accessible name applied as `aria-label` when no visible `label` is supplied.
   * (A placeholder is NOT an accessible name; supply this so screen readers
   * announce the field.)
   */
  ariaLabel?: string;
  /** Native input type (text-like). Default `text`. */
  inputType?: 'text' | 'email' | 'password' | 'tel' | 'url' | 'search';
  /** Disabled state. */
  disabled?: boolean;
  /** Read-only state. */
  readOnly?: boolean;
  /** Required marker on the label + native `required`. */
  required?: boolean;
  /** Show a clear (x) button when there is a value. */
  clearable?: boolean;
  /** Static prefix content (e.g. `$`). */
  prefix?: string;
  /** Static suffix content (e.g. `.00`). */
  suffix?: string;
  /** Size. Default `md`. */
  size?: FieldSize;
  /** Invalid state styling + aria-invalid. */
  invalid?: boolean;
  /** Error message rendered below the control (implies invalid). */
  error?: string;
  /** Native name attribute. */
  name?: string;
}

export interface TextFieldEvents extends WidgetEvents {
  input: { value: string; event: Event; field: TextField };
  change: { value: string; event: Event; field: TextField };
  focus: { event: FocusEvent; field: TextField };
  blur: { event: FocusEvent; field: TextField };
  clear: { field: TextField };
}

let fieldSeq = 0;

export class TextField extends Widget<TextFieldConfig, TextFieldEvents> {
  /** Stable id for the input, stored on the root so it survives field-init order. */
  protected get inputId(): string {
    let id = this.el.dataset.inputId;
    if (!id) {
      id = `jects-field-${++fieldSeq}`;
      this.el.dataset.inputId = id;
    }
    return id;
  }

  /** The owned input (created lazily in render). */
  protected get input(): HTMLInputElement {
    return this.el.querySelector('.jects-field__input') as HTMLInputElement;
  }

  protected get clearBtn(): HTMLButtonElement | null {
    return this.el.querySelector('.jects-field__clear');
  }

  protected get prefixEl(): HTMLElement | null {
    return this.el.querySelector('.jects-field__prefix');
  }

  protected get suffixEl(): HTMLElement | null {
    return this.el.querySelector('.jects-field__suffix');
  }

  protected override defaults(): Partial<TextFieldConfig> {
    return { size: 'md', inputType: 'text', value: '' };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-field' });
    root.addEventListener('input', (e) => this.handleInput(e));
    root.addEventListener('change', (e) => this.handleChange(e));
    root.addEventListener('focusin', (e) => this.handleFocus(e as FocusEvent));
    root.addEventListener('focusout', (e) => this.handleBlur(e as FocusEvent));
    root.addEventListener('click', (e) => this.handleClick(e));
    return root;
  }

  /** Internal: the input that actually fired the event (ignores other controls). */
  protected isInput(target: EventTarget | null): boolean {
    return target === this.input;
  }

  protected handleInput(event: Event): void {
    if (!this.isInput(event.target)) return;
    this.config.value = this.input.value;
    this.syncClearVisibility();
    this.emit('input', { value: this.input.value, event, field: this });
  }

  protected handleChange(event: Event): void {
    if (!this.isInput(event.target)) return;
    this.config.value = this.input.value;
    this.emit('change', { value: this.input.value, event, field: this });
  }

  protected handleFocus(event: FocusEvent): void {
    this.el.classList.add('jects-field--focused');
    this.emit('focus', { event, field: this });
  }

  protected handleBlur(event: FocusEvent): void {
    this.el.classList.remove('jects-field--focused');
    this.emit('blur', { event, field: this });
  }

  protected handleClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    const clearBtn = this.clearBtn;
    if (target && clearBtn && (target === clearBtn || clearBtn.contains(target))) {
      this.clear();
    }
  }

  /** Programmatically clear the value, emit `clear` then `input`/`change`. */
  clear(): this {
    if (this.config.disabled || this.config.readOnly) return this;
    this.input.value = '';
    this.config.value = '';
    this.syncClearVisibility();
    this.emit('clear', { field: this });
    this.emit('input', { value: '', event: new Event('input'), field: this });
    this.emit('change', { value: '', event: new Event('change'), field: this });
    this.input.focus();
    return this;
  }

  /** Current value. */
  getValue(): string {
    return this.input?.value ?? this.config.value ?? '';
  }

  /** Move focus to the input. */
  focus(): this {
    this.input?.focus();
    return this;
  }

  protected syncClearVisibility(): void {
    const clearBtn = this.clearBtn;
    if (!clearBtn) return;
    const show =
      !!this.config.clearable &&
      (this.input.value?.length ?? 0) > 0 &&
      !this.config.disabled &&
      !this.config.readOnly;
    clearBtn.hidden = !show;
  }

  protected override render(): void {
    const {
      value = '',
      placeholder,
      label,
      ariaLabel,
      inputType = 'text',
      disabled = false,
      readOnly = false,
      required = false,
      clearable = false,
      prefix,
      suffix,
      size = 'md',
      invalid = false,
      error,
      name,
    } = this.config;

    const hasError = invalid || !!error;

    this.el.className = [
      'jects-field',
      `jects-field--${size}`,
      disabled ? 'jects-field--disabled' : '',
      readOnly ? 'jects-field--readonly' : '',
      hasError ? 'jects-field--invalid' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    // Build structure once.
    let control = this.el.querySelector('.jects-field__control') as HTMLElement | null;
    let input = this.el.querySelector('.jects-field__input') as HTMLInputElement | null;
    if (!control) {
      control = createEl('div', { className: 'jects-field__control' });
      input = createEl('input', { className: 'jects-field__input', attrs: { id: this.inputId } });
      control.append(input);
      this.el.append(control);
    }
    input = input ?? (this.el.querySelector('.jects-field__input') as HTMLInputElement);

    // Label
    let labelEl = this.el.querySelector('.jects-field__label') as HTMLLabelElement | null;
    if (label) {
      if (!labelEl) {
        labelEl = createEl('label', { className: 'jects-field__label', attrs: { for: this.inputId } });
        this.el.insertBefore(labelEl, control);
      }
      setHtml(labelEl, trustedHtml(`${escapeHtml(label)}${required ? '<span class="jects-field__required" aria-hidden="true">*</span>' : ''}`));
    } else if (labelEl) {
      labelEl.remove();
    }

    // Control children: prefix / input / suffix / clear.
    // The input node is created once (above) and NEVER detached on re-render, so
    // an update() fired mid-edit (e.g. from an input handler setting an error)
    // cannot drop focus or the caret. Affixes and the clear button are created
    // lazily and only toggled/updated in place around the persistent input.
    let prefixEl = this.prefixEl;
    if (prefix) {
      if (!prefixEl) {
        prefixEl = createEl('span', {
          className: 'jects-field__affix jects-field__prefix',
          attrs: { 'aria-hidden': 'true' },
        });
        control.insertBefore(prefixEl, input);
      }
      prefixEl.textContent = prefix;
    } else if (prefixEl) {
      prefixEl.remove();
    }

    let suffixEl = this.suffixEl;
    if (suffix) {
      if (!suffixEl) {
        suffixEl = createEl('span', {
          className: 'jects-field__affix jects-field__suffix',
          attrs: { 'aria-hidden': 'true' },
        });
        // After the input (and any trailing clear button is re-positioned below).
        input.after(suffixEl);
      }
      suffixEl.textContent = suffix;
    } else if (suffixEl) {
      suffixEl.remove();
    }

    let clearBtn = this.clearBtn;
    if (clearable) {
      if (!clearBtn) {
        clearBtn = createEl('button', {
          className: 'jects-field__clear',
          html: staticHtml`&times;`,
          attrs: { type: 'button', 'aria-label': 'Clear', tabindex: '-1' },
        });
      }
      // Keep the clear button as the last child of the control.
      control.append(clearBtn);
    } else if (clearBtn) {
      clearBtn.remove();
    }

    // Input attributes
    input.type = inputType;
    input.value = value;
    input.disabled = disabled;
    input.readOnly = readOnly;
    input.required = required;
    if (placeholder != null) input.placeholder = placeholder;
    else input.removeAttribute('placeholder');
    if (name != null) input.name = name;
    input.setAttribute('aria-invalid', String(hasError));

    // Accessible name: a visible <label for> already names the input. When there
    // is no visible label, fall back to an explicit aria-label (placeholder is
    // NOT an accessible name). In dev, warn loudly if neither is present.
    if (label) {
      input.removeAttribute('aria-label');
    } else if (ariaLabel) {
      input.setAttribute('aria-label', ariaLabel);
    } else {
      input.removeAttribute('aria-label');
      if (isDev()) {
        console.warn(
          'Jects TextField: no `label` or `ariaLabel` supplied — the input has no accessible name. ' +
            'Provide a `label` or `ariaLabel` (placeholder is not an accessible name).',
        );
      }
    }

    // Error message
    const errorId = `${this.inputId}-error`;
    let errorEl = this.el.querySelector('.jects-field__error') as HTMLElement | null;
    if (error) {
      if (!errorEl) {
        errorEl = createEl('div', { className: 'jects-field__error', attrs: { id: errorId, role: 'alert' } });
        this.el.append(errorEl);
      }
      errorEl.textContent = error;
      input.setAttribute('aria-describedby', errorId);
    } else if (errorEl) {
      errorEl.remove();
      input.removeAttribute('aria-describedby');
    }

    this.syncClearVisibility();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Dev-mode detection that is safe in any bundler/browser context. */
function isDev(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

register(
  'textfield',
  TextField as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => TextField,
);
