/**
 * RadioGroup — a mutually-exclusive set of radio options with full keyboard
 * support per the ARIA radiogroup pattern (Arrow keys move + select, roving
 * tabindex, Home/End). Built self-contained (does not import the Radio widget)
 * so it owns its DOM and keyboard model directly.
 *
 * a11y: role="radiogroup" on root; role="radio" + aria-checked on each option;
 * exactly one option is tabbable at a time.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface RadioGroupConfig extends WidgetConfig {
  /** Options to render. */
  options?: RadioOption[];
  /** Currently selected value. */
  value?: string;
  /** Accessible group label. */
  ariaLabel?: string;
  /** Form field name (applied to a hidden mirror for forms). */
  name?: string;
  /** Layout direction. Default `vertical`. */
  orientation?: 'vertical' | 'horizontal';
  /** Disable the whole group. */
  disabled?: boolean;
  /** Convenience handler (also via `.on('change', ...)`). */
  onChange?: (value: string) => void;
}

export interface RadioGroupEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel selecting a value. */
  beforeChange: { value: string; group: RadioGroup };
  change: { value: string; group: RadioGroup };
  focus: { group: RadioGroup };
  blur: { group: RadioGroup };
}

export class RadioGroup extends Widget<RadioGroupConfig, RadioGroupEvents> {
  // Set while we are programmatically re-rendering + refocusing during arrow-key
  // navigation. The innerHTML rebuild momentarily blows away the focused radio,
  // firing a focusout with a null relatedTarget; we suppress the spurious 'blur'.
  private navigating_ = false;

  protected override defaults(): Partial<RadioGroupConfig> {
    return { options: [], orientation: 'vertical' };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-radio-group', attrs: { role: 'radiogroup' } });
    root.addEventListener('click', (e) => this.handlePointer(e));
    root.addEventListener('keydown', (e) => this.handleKeydown(e));
    root.addEventListener('focusin', () => this.emit('focus', { group: this }));
    root.addEventListener('focusout', (e) => {
      if (this.navigating_) return;
      if (!root.contains(e.relatedTarget as Node)) this.emit('blur', { group: this });
    });
    return root;
  }

  private options(): RadioOption[] {
    return this.config.options ?? [];
  }

  private enabledValues(): string[] {
    const groupDisabled = this.config.disabled ?? false;
    return this.options().filter((o) => !groupDisabled && !o.disabled).map((o) => o.value);
  }

  private handlePointer(e: MouseEvent): void {
    const target = (e.target as Element | null)?.closest('.jects-radio-group__option') as HTMLElement | null;
    if (!target) return;
    const value = target.dataset.value;
    if (value !== undefined) this.select(value);
  }

  private handleKeydown(e: KeyboardEvent): void {
    const values = this.enabledValues();
    if (values.length === 0) return;
    const current = this.config.value;
    const idx = current !== undefined ? values.indexOf(current) : -1;
    let nextIdx: number | null = null;

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        nextIdx = idx < 0 ? 0 : (idx + 1) % values.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        nextIdx = idx < 0 ? values.length - 1 : (idx - 1 + values.length) % values.length;
        break;
      case 'Home':
        nextIdx = 0;
        break;
      case 'End':
        nextIdx = values.length - 1;
        break;
      case ' ':
      case 'Enter': {
        const focused = (document.activeElement as HTMLElement | null)?.dataset?.value;
        if (focused !== undefined) {
          e.preventDefault();
          this.select(focused);
        }
        return;
      }
      default:
        return;
    }

    if (nextIdx !== null) {
      e.preventDefault();
      const value = values[nextIdx]!;
      // select() re-renders (innerHTML rebuild) which transiently removes the
      // focused radio; guard the focusout->blur emit across the rebuild+refocus.
      this.navigating_ = true;
      try {
        this.select(value);
        this.focusOption(value);
      } finally {
        this.navigating_ = false;
      }
    }
  }

  private focusOption(value: string): void {
    const rows = this.el.querySelectorAll<HTMLElement>('.jects-radio-group__option');
    for (const row of Array.from(rows)) {
      if (row.dataset.value === value) {
        row.focus();
        return;
      }
    }
  }

  /** Select a value (fires events, respecting the veto). */
  select(value: string): this {
    if (value === this.config.value) return this;
    if (this.config.disabled) return this;
    const opt = this.options().find((o) => o.value === value);
    if (!opt || opt.disabled) return this;
    if (this.emit('beforeChange', { value, group: this }) === false) return this;
    this.config = { ...this.config, value };
    this.render();
    this.config.onChange?.(value);
    this.emit('change', { value, group: this });
    return this;
  }

  get value(): string | undefined {
    return this.config.value;
  }

  protected override render(): void {
    const {
      options = [],
      value,
      ariaLabel,
      orientation = 'vertical',
      disabled = false,
    } = this.config;

    const el = this.el;
    el.className = [
      'jects-radio-group',
      `jects-radio-group--${orientation}`,
      disabled ? 'jects-radio-group--disabled' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
    else el.removeAttribute('aria-label');
    el.setAttribute('aria-orientation', orientation);

    // Determine the single tabbable option (selected, else first enabled).
    const firstEnabled = options.find((o) => !disabled && !o.disabled)?.value;
    const tabbable = value ?? firstEnabled;

    el.innerHTML = options
      .map((o) => {
        const checked = o.value === value;
        const optDisabled = disabled || !!o.disabled;
        const tabindex = !optDisabled && o.value === tabbable ? '0' : '-1';
        return [
          `<div class="jects-radio-group__option${checked ? ' jects-radio-group__option--checked' : ''}${optDisabled ? ' jects-radio-group__option--disabled' : ''}"`,
          ` role="radio" aria-checked="${checked}" tabindex="${tabindex}"`,
          optDisabled ? ' aria-disabled="true"' : '',
          ` data-value="${escapeAttr(o.value)}">`,
          `<span class="jects-radio-group__dot" aria-hidden="true"></span>`,
          `<span class="jects-radio-group__label">${escapeHtml(o.label)}</span>`,
          `</div>`,
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
  'radiogroup',
  RadioGroup as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => RadioGroup,
);
