/**
 * Select — a single-value dropdown of options with placeholder, disabled and
 * clearable support. Uses a local anchored Popup (no cross-cluster imports).
 *
 * a11y: button trigger with role="combobox", aria-expanded, aria-haspopup;
 * the listbox is role="listbox" with role="option" rows and aria-activedescendant.
 * Keyboard: Enter/Space/Arrow opens; Up/Down move the active option; Enter/Space
 * select; Escape closes; Home/End jump; typeahead by first letter.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';
import { renderIcon } from '@jects/icons';
import { Popup } from './popup.js';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectConfig extends WidgetConfig {
  /** Options to choose from. */
  options?: SelectOption[];
  /** Selected value. */
  value?: string;
  /** Placeholder shown when nothing is selected. */
  placeholder?: string;
  /** Disabled state. */
  disabled?: boolean;
  /** Show a clear (×) button when a value is selected. */
  clearable?: boolean;
  /** Accessible label for the trigger. */
  ariaLabel?: string;
  /** Convenience handler (also via `.on('change', ...)`). */
  onChange?: (value: string | undefined) => void;
}

export interface SelectEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel selecting a value. */
  beforeChange: { value: string | undefined; select: Select };
  change: { value: string | undefined; select: Select };
  open: { select: Select };
  close: { select: Select };
  focus: { select: Select };
  blur: { select: Select };
}

export class Select extends Widget<SelectConfig, SelectEvents> {
  // NOTE: these refs are populated lazily (NOT as class-field initializers),
  // because `super()` runs buildEl()/render() before field initializers, and
  // initialized fields would clobber any assignment made during buildEl().
  private _listbox?: HTMLElement;
  private _popup?: Popup;
  private activeIndex = -1;
  private typeahead = '';
  private typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

  private get listboxId(): string {
    return `${this.id}-listbox`;
  }

  private get trigger(): HTMLButtonElement {
    return this.el.querySelector('.jects-select__trigger') as HTMLButtonElement;
  }

  /** Lazily build the listbox panel + popup on first open. */
  private get popup(): Popup {
    if (!this._popup) {
      const listbox = createEl('div', {
        className: 'jects-select__listbox',
        attrs: { role: 'listbox' },
      });
      this._listbox = listbox;
      listbox.addEventListener('click', (e) => this.handleOptionClick(e));
      listbox.addEventListener('keydown', (e) => this.handleTriggerKeydown(e));
      this._popup = new Popup({
        anchor: this.trigger,
        panel: listbox,
        onRequestClose: () => this.close(),
      });
    }
    return this._popup;
  }

  private get listbox(): HTMLElement {
    void this.popup; // ensure built
    return this._listbox!;
  }

  protected override defaults(): Partial<SelectConfig> {
    return { options: [], placeholder: 'Select…', clearable: false };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-select' });
    const trigger = createEl('button', {
      className: 'jects-select__trigger',
      attrs: { type: 'button', role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' },
    });
    root.append(trigger);

    trigger.addEventListener('click', () => this.toggle());
    trigger.addEventListener('keydown', (e) => this.handleTriggerKeydown(e));
    trigger.addEventListener('focus', () => this.emit('focus', { select: this }));
    trigger.addEventListener('blur', () => this.emit('blur', { select: this }));
    // Single delegated clear handler (the clear span is rebuilt each render, so
    // we must NOT attach per-render listeners). Catch pointerdown before the
    // trigger's click/toggle fires.
    trigger.addEventListener('pointerdown', (ev) => {
      const clearEl = (ev.target as Element | null)?.closest('[data-clear]');
      if (!clearEl) return;
      ev.stopPropagation();
      ev.preventDefault();
      this.clear();
    });
    return root;
  }

  private options(): SelectOption[] {
    return this.config.options ?? [];
  }

  get value(): string | undefined {
    return this.config.value;
  }

  get isOpen(): boolean {
    return this.popup.isOpen;
  }

  toggle(): void {
    if (this.popup.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (this.config.disabled || this.popup.isOpen) return;
    const opts = this.options();
    // Land the active option on the selected option only when it is enabled;
    // otherwise fall through to the first enabled option so the initial
    // aria-activedescendant never points at a disabled row.
    const selectedIdx = opts.findIndex((o) => o.value === this.config.value && !o.disabled);
    this.activeIndex = selectedIdx >= 0 ? selectedIdx : opts.findIndex((o) => !o.disabled);
    this.renderListbox();
    this.popup.open();
    this.trigger.setAttribute('aria-expanded', 'true');
    this.el.classList.add('jects-select--open');
    this.updateActiveDescendant();
    this.emit('open', { select: this });
  }

  close(): void {
    if (!this.popup.isOpen) return;
    this.popup.close();
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.removeAttribute('aria-activedescendant');
    this.el.classList.remove('jects-select--open');
    this.emit('close', { select: this });
    this.trigger.focus();
  }

  /** Select a value (fires events, respects veto). Pass undefined to clear. */
  selectValue(value: string | undefined): this {
    if (value === this.config.value) {
      this.close();
      return this;
    }
    if (value !== undefined) {
      const opt = this.options().find((o) => o.value === value);
      if (!opt || opt.disabled) return this;
    }
    if (this.emit('beforeChange', { value, select: this }) === false) return this;
    const next = { ...this.config };
    if (value === undefined) delete next.value;
    else next.value = value;
    this.config = next;
    this.render();
    this.config.onChange?.(value);
    this.emit('change', { value, select: this });
    this.close();
    return this;
  }

  clear(): this {
    return this.selectValue(undefined);
  }

  private handleOptionClick(e: MouseEvent): void {
    const row = (e.target as Element | null)?.closest('.jects-select__option') as HTMLElement | null;
    if (!row || row.getAttribute('aria-disabled') === 'true') return;
    this.selectValue(row.dataset.value);
  }

  private handleTriggerKeydown(e: KeyboardEvent): void {
    const open = this.popup.isOpen;
    const opts = this.options();

    if (!open) {
      // Keyboard-reachable clear: when closed, clearable and a value is set,
      // Delete/Backspace clears the selection (the visual clear affordance is
      // pointer-only / aria-hidden).
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        this.config.clearable &&
        this.config.value !== undefined &&
        !this.config.disabled
      ) {
        e.preventDefault();
        this.clear();
        return;
      }
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        this.open();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.moveActive(-1);
        break;
      case 'Home':
        e.preventDefault();
        this.activeIndex = opts.findIndex((o) => !o.disabled);
        this.updateActiveDescendant();
        break;
      case 'End':
        e.preventDefault();
        for (let i = opts.length - 1; i >= 0; i--) {
          if (!opts[i]!.disabled) {
            this.activeIndex = i;
            break;
          }
        }
        this.updateActiveDescendant();
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (this.activeIndex >= 0) this.selectValue(opts[this.activeIndex]!.value);
        break;
      case 'Tab':
        this.close();
        break;
      default:
        if (e.key.length === 1) this.handleTypeahead(e.key);
    }
  }

  private moveActive(dir: 1 | -1): void {
    const opts = this.options();
    if (opts.length === 0) return;
    let i = this.activeIndex;
    for (let step = 0; step < opts.length; step++) {
      i = (i + dir + opts.length) % opts.length;
      if (!opts[i]!.disabled) {
        this.activeIndex = i;
        break;
      }
    }
    this.updateActiveDescendant();
  }

  private handleTypeahead(ch: string): void {
    this.typeahead += ch.toLowerCase();
    if (this.typeaheadTimer) clearTimeout(this.typeaheadTimer);
    this.typeaheadTimer = setTimeout(() => (this.typeahead = ''), 600);
    const opts = this.options();
    const idx = opts.findIndex(
      (o) => !o.disabled && o.label.toLowerCase().startsWith(this.typeahead),
    );
    if (idx >= 0) {
      this.activeIndex = idx;
      this.updateActiveDescendant();
    }
  }

  private updateActiveDescendant(): void {
    const rows = this.listbox.querySelectorAll<HTMLElement>('.jects-select__option');
    rows.forEach((row, i) => {
      const active = i === this.activeIndex;
      row.classList.toggle('jects-select__option--active', active);
      row.setAttribute('aria-selected', String(this.options()[i]?.value === this.config.value));
    });
    const activeRow = rows[this.activeIndex];
    if (activeRow) {
      this.trigger.setAttribute('aria-activedescendant', activeRow.id);
      activeRow.scrollIntoView?.({ block: 'nearest' });
    } else {
      this.trigger.removeAttribute('aria-activedescendant');
    }
  }

  private renderListbox(): void {
    const opts = this.options();
    const value = this.config.value;
    this.listbox.id = this.listboxId;
    this.trigger.setAttribute('aria-controls', this.listboxId);
    this.listbox.innerHTML = opts
      .map((o, i) => {
        const selected = o.value === value;
        const disabled = !!o.disabled;
        return [
          `<div class="jects-select__option${selected ? ' jects-select__option--selected' : ''}${disabled ? ' jects-select__option--disabled' : ''}"`,
          ` id="${this.listboxId}-opt-${i}" role="option" aria-selected="${selected}"`,
          disabled ? ' aria-disabled="true"' : '',
          ` data-value="${escapeAttr(o.value)}">`,
          `<span class="jects-select__option-label">${escapeHtml(o.label)}</span>`,
          selected ? `<span class="jects-select__option-check" aria-hidden="true">${renderIcon('check', { size: 16 })}</span>` : '',
          `</div>`,
        ].join('');
      })
      .join('');
  }

  protected override render(): void {
    const {
      value,
      placeholder = 'Select…',
      disabled = false,
      clearable = false,
      ariaLabel,
      options = [],
    } = this.config;

    const el = this.el;
    el.className = [
      'jects-select',
      disabled ? 'jects-select--disabled' : '',
      this._popup?.isOpen ? 'jects-select--open' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    const selectedOpt = options.find((o) => o.value === value);
    const hasValue = selectedOpt !== undefined;

    const trigger = this.trigger;
    trigger.disabled = disabled;
    // Always guarantee an accessible name: the visible value provides one when
    // present, but an empty placeholder + icon-only state would leave the
    // combobox unnamed, so fall back to a label.
    trigger.setAttribute('aria-label', ariaLabel ?? 'Select');

    const showClear = clearable && hasValue && !disabled;
    trigger.innerHTML = [
      `<span class="jects-select__value${hasValue ? '' : ' jects-select__value--placeholder'}">`,
      escapeHtml(hasValue ? selectedOpt!.label : placeholder),
      `</span>`,
      showClear
        ? `<span class="jects-select__clear" aria-hidden="true" data-clear="1">${renderIcon('x', { size: 14 })}</span>`
        : '',
      `<span class="jects-select__chevron" aria-hidden="true">${renderIcon('chevron-down', { size: 16 })}</span>`,
    ].join('');

    if (this._popup?.isOpen) this.renderListbox();
  }

  override destroy(): void {
    if (this.typeaheadTimer) clearTimeout(this.typeaheadTimer);
    this._popup?.destroy();
    super.destroy();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

register(
  'select',
  Select as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Select,
);
