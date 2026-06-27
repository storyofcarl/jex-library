/**
 * ComboBox — an editable autocomplete control with optional multiselect chips.
 * Owns its OWN internal anchored dropdown (local Popup; no cross-cluster imports).
 *
 * Single mode: a text input filters options; choosing one fills the input and
 * emits change. Multi mode: chosen options render as removable chips before the
 * input; the input keeps filtering the remaining options.
 *
 * a11y: input role="combobox" with aria-expanded / aria-controls /
 * aria-autocomplete="list"; the popup is role="listbox" with role="option" rows
 * and aria-activedescendant. Keyboard: type to filter; Down/Up move active;
 * Enter selects; Escape closes; Backspace on empty input removes the last chip.
 * `input` fires on each keystroke, `change` on (de)selection.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register, setHtml, trustedHtml, staticHtml } from '@jects/core';
import { renderIcon } from '@jects/icons';
import { Popup } from './popup.js';

export interface ComboBoxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ComboBoxConfig extends WidgetConfig {
  /** Options to choose from. */
  options?: ComboBoxOption[];
  /** Allow multiple selections (renders chips). Default `false`. */
  multiple?: boolean;
  /** Selected value (single mode). */
  value?: string;
  /** Selected values (multi mode). */
  values?: string[];
  /** Placeholder for the text input. */
  placeholder?: string;
  /** Disabled state. */
  disabled?: boolean;
  /** Accessible label for the input. */
  ariaLabel?: string;
  /** Custom filter; defaults to case-insensitive label "includes". */
  filter?: (option: ComboBoxOption, query: string) => boolean;
  /** Convenience handler (also via `.on('change', ...)`). */
  onChange?: (value: string | string[] | undefined) => void;
}

export interface ComboBoxEvents extends WidgetEvents {
  /** Fired on each keystroke in the text input. */
  input: { query: string; combobox: ComboBox };
  /** Vetoable: return `false` to cancel a selection change. */
  beforeChange: { value: string | string[] | undefined; combobox: ComboBox };
  change: { value: string | string[] | undefined; combobox: ComboBox };
  open: { combobox: ComboBox };
  close: { combobox: ComboBox };
  focus: { combobox: ComboBox };
  blur: { combobox: ComboBox };
}

export class ComboBox extends Widget<ComboBoxConfig, ComboBoxEvents> {
  // Lazy refs: see the Select note — class-field initializers run after super()
  // and would clobber assignments made in buildEl().
  private _listbox?: HTMLElement;
  private _popup?: Popup;
  private query = '';
  private activeIndex = -1;
  private filtered: ComboBoxOption[] = [];

  private get listboxId(): string {
    return `${this.id}-listbox`;
  }

  private get control(): HTMLElement {
    return this.el.querySelector('.jects-combobox__control') as HTMLElement;
  }
  private get input(): HTMLInputElement {
    return this.el.querySelector('.jects-combobox__input') as HTMLInputElement;
  }

  /** Lazily build the listbox panel + popup on first open. */
  private get popup(): Popup {
    if (!this._popup) {
      const listbox = createEl('div', {
        className: 'jects-combobox__listbox',
        attrs: { role: 'listbox' },
      });
      this._listbox = listbox;
      listbox.addEventListener('click', (e) => this.handleOptionClick(e));
      listbox.addEventListener('pointerdown', (e) => e.preventDefault()); // keep input focus
      this._popup = new Popup({ anchor: this.control, panel: listbox, onRequestClose: () => this.close() });
    }
    return this._popup;
  }

  private get listbox(): HTMLElement {
    void this.popup;
    return this._listbox!;
  }

  protected override defaults(): Partial<ComboBoxConfig> {
    return { options: [], multiple: false, values: [], placeholder: '' };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-combobox' });
    const control = createEl('div', { className: 'jects-combobox__control' });
    const input = createEl('input', {
      className: 'jects-combobox__input',
      attrs: {
        type: 'text',
        role: 'combobox',
        autocomplete: 'off',
        'aria-autocomplete': 'list',
        'aria-expanded': 'false',
      },
    });
    control.append(input);
    root.append(control);

    input.addEventListener('input', () => this.handleInput());
    input.addEventListener('keydown', (e) => this.handleKeydown(e));
    input.addEventListener('focus', () => {
      this.emit('focus', { combobox: this });
      this.open();
    });
    input.addEventListener('blur', (e) => {
      this.emit('blur', { combobox: this });
      // Close the popup when focus leaves the combobox entirely (e.g. Tab out),
      // unless focus moved into the panel. Otherwise a stranded open dropdown
      // keeps document-level listeners attached and aria-expanded stuck true.
      const next = (e as FocusEvent).relatedTarget as Node | null;
      if (next && this._popup?.panel.contains(next)) return;
      this.close();
    });
    control.addEventListener('click', (e) => this.handleControlClick(e));
    return root;
  }

  private options(): ComboBoxOption[] {
    return this.config.options ?? [];
  }

  private selectedValues(): string[] {
    if (this.config.multiple) return this.config.values ?? [];
    return this.config.value !== undefined ? [this.config.value] : [];
  }

  get isOpen(): boolean {
    return this.popup.isOpen;
  }

  get value(): string | undefined {
    return this.config.value;
  }
  get values(): string[] {
    return [...(this.config.values ?? [])];
  }

  open(): void {
    if (this.config.disabled || this.popup.isOpen) return;
    this.computeFiltered();
    this.activeIndex = this.filtered.findIndex((o) => !o.disabled);
    this.renderListbox();
    this.popup.open();
    this.input.setAttribute('aria-expanded', 'true');
    this.el.classList.add('jects-combobox--open');
    this.emit('open', { combobox: this });
  }

  close(): void {
    if (!this.popup.isOpen) return;
    this.popup.close();
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.el.classList.remove('jects-combobox--open');
    this.emit('close', { combobox: this });
  }

  private computeFiltered(): void {
    const q = this.query.trim().toLowerCase();
    const filter =
      this.config.filter ?? ((o: ComboBoxOption, query: string) => o.label.toLowerCase().includes(query));
    const selected = new Set(this.selectedValues());
    this.filtered = this.options().filter((o) => {
      if (this.config.multiple && selected.has(o.value)) return false; // hide already-chosen in multi
      return q === '' ? true : filter(o, q);
    });
  }

  /** Keep activeIndex in range after `filtered` is recomputed. */
  private clampActive(): void {
    if (this.activeIndex >= this.filtered.length || this.activeIndex < 0) {
      this.activeIndex = this.filtered.findIndex((o) => !o.disabled);
    } else if (this.filtered[this.activeIndex]?.disabled) {
      this.activeIndex = this.filtered.findIndex((o) => !o.disabled);
    }
  }

  private handleInput(): void {
    this.query = this.input.value;
    this.emit('input', { query: this.query, combobox: this });
    if (!this.popup.isOpen) this.open();
    else {
      this.computeFiltered();
      this.activeIndex = this.filtered.findIndex((o) => !o.disabled);
      this.renderListbox();
    }
  }

  private handleControlClick(e: MouseEvent): void {
    const chip = (e.target as Element | null)?.closest('[data-remove]') as HTMLElement | null;
    if (chip) {
      e.stopPropagation();
      this.deselect(chip.dataset.remove!);
      return;
    }
    if (this.config.disabled) return;
    this.input.focus();
  }

  private handleOptionClick(e: MouseEvent): void {
    const row = (e.target as Element | null)?.closest('.jects-combobox__option') as HTMLElement | null;
    if (!row || row.getAttribute('aria-disabled') === 'true') return;
    this.choose(row.dataset.value!);
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (!this.popup.isOpen && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      this.open();
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
      case 'Enter':
        if (this.popup.isOpen && this.activeIndex >= 0) {
          e.preventDefault();
          // Guard against a stale activeIndex pointing past the current
          // filtered set (e.g. options mutated via update() while open).
          const opt = this.filtered[this.activeIndex];
          if (opt) this.choose(opt.value);
        }
        break;
      case 'Escape':
        if (this.popup.isOpen) {
          e.preventDefault();
          this.close();
        }
        break;
      case 'Backspace':
        if (this.config.multiple && this.input.value === '') {
          const vals = this.config.values ?? [];
          if (vals.length > 0) this.deselect(vals[vals.length - 1]!);
        }
        break;
      default:
        break;
    }
  }

  private moveActive(dir: 1 | -1): void {
    const n = this.filtered.length;
    if (n === 0) return;
    let i = this.activeIndex;
    for (let step = 0; step < n; step++) {
      i = (i + dir + n) % n;
      if (!this.filtered[i]!.disabled) {
        this.activeIndex = i;
        break;
      }
    }
    this.updateActiveDescendant();
  }

  /** Choose an option's value (single = set; multi = add). */
  choose(value: string): this {
    const opt = this.options().find((o) => o.value === value);
    if (!opt || opt.disabled) return this;

    if (this.config.multiple) {
      const set = new Set(this.config.values ?? []);
      if (set.has(value)) return this;
      set.add(value);
      const next = this.options().map((o) => o.value).filter((v) => set.has(v));
      if (this.emit('beforeChange', { value: next, combobox: this }) === false) return this;
      this.config = { ...this.config, values: next };
      this.query = '';
      this.input.value = '';
      this.render();
      this.config.onChange?.(next);
      this.emit('change', { value: next, combobox: this });
      this.computeFiltered();
      this.activeIndex = this.filtered.findIndex((o) => !o.disabled);
      this.renderListbox();
      this.input.focus();
    } else {
      if (this.emit('beforeChange', { value, combobox: this }) === false) return this;
      this.config = { ...this.config, value };
      this.query = '';
      this.input.value = opt.label;
      this.render();
      this.config.onChange?.(value);
      this.emit('change', { value, combobox: this });
      this.close();
    }
    return this;
  }

  /** Remove a value (multi mode) or clear (single mode). */
  deselect(value: string): this {
    if (this.config.multiple) {
      const next = (this.config.values ?? []).filter((v) => v !== value);
      if (this.emit('beforeChange', { value: next, combobox: this }) === false) return this;
      this.config = { ...this.config, values: next };
      this.render();
      this.config.onChange?.(next);
      this.emit('change', { value: next, combobox: this });
      if (this.popup.isOpen) {
        this.computeFiltered();
        this.clampActive();
        this.renderListbox();
      }
    } else if (this.config.value === value) {
      if (this.emit('beforeChange', { value: undefined, combobox: this }) === false) return this;
      const next = { ...this.config };
      delete next.value;
      this.config = next;
      this.query = '';
      this.render();
      this.config.onChange?.(undefined);
      this.emit('change', { value: undefined, combobox: this });
    }
    return this;
  }

  private updateActiveDescendant(): void {
    const rows = this.listbox.querySelectorAll<HTMLElement>('.jects-combobox__option');
    rows.forEach((row, i) => row.classList.toggle('jects-combobox__option--active', i === this.activeIndex));
    const activeRow = rows[this.activeIndex];
    if (activeRow) {
      this.input.setAttribute('aria-activedescendant', activeRow.id);
      activeRow.scrollIntoView?.({ block: 'nearest' });
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
  }

  private renderListbox(): void {
    this.listbox.id = this.listboxId;
    this.input.setAttribute('aria-controls', this.listboxId);
    if (this.filtered.length === 0) {
      setHtml(this.listbox, staticHtml`<div class="jects-combobox__empty">No matches</div>`);
      this.input.removeAttribute('aria-activedescendant');
      return;
    }
    setHtml(this.listbox, trustedHtml(this.filtered
      .map((o, i) => {
        const disabled = !!o.disabled;
        const active = i === this.activeIndex;
        return [
          `<div class="jects-combobox__option${active ? ' jects-combobox__option--active' : ''}${disabled ? ' jects-combobox__option--disabled' : ''}"`,
          ` id="${this.listboxId}-opt-${i}" role="option" aria-selected="false"`,
          disabled ? ' aria-disabled="true"' : '',
          ` data-value="${escapeAttr(o.value)}">`,
          `<span class="jects-combobox__option-label">${escapeHtml(o.label)}</span>`,
          `</div>`,
        ].join('');
      })
      .join('')));
    this.updateActiveDescendant();
  }

  protected override render(): void {
    const {
      multiple = false,
      placeholder = '',
      disabled = false,
      ariaLabel,
      value,
      options = [],
    } = this.config;

    const el = this.el;
    el.className = [
      'jects-combobox',
      multiple ? 'jects-combobox--multiple' : 'jects-combobox--single',
      disabled ? 'jects-combobox--disabled' : '',
      this._popup?.isOpen ? 'jects-combobox--open' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    const input = this.input;
    input.disabled = disabled;
    input.placeholder = placeholder;
    // Always guarantee an accessible name for the combobox input.
    input.setAttribute('aria-label', ariaLabel || placeholder || 'Combobox');

    // chips (multi mode) live before the input inside the control
    this.control.querySelectorAll('.jects-combobox__chip').forEach((c) => c.remove());
    if (multiple) {
      const selected = this.config.values ?? [];
      const chips = selected
        .map((v) => options.find((o) => o.value === v))
        .filter((o): o is ComboBoxOption => !!o);
      for (const o of chips.reverse()) {
        const chip = createEl('span', {
          className: 'jects-combobox__chip',
          html: trustedHtml(`<span class="jects-combobox__chip-label">${escapeHtml(o.label)}</span><button type="button" class="jects-combobox__chip-remove" data-remove="${escapeAttr(o.value)}" aria-label="Remove ${escapeAttr(o.label)}">${renderIcon('x', { size: 12 })}</button>`),
        });
        this.control.insertBefore(chip, this.control.firstChild);
      }
    } else if (value !== undefined) {
      const opt = options.find((o) => o.value === value);
      if (opt && this.query === '') input.value = opt.label;
    }

    if (this._popup?.isOpen) {
      this.computeFiltered();
      this.clampActive();
      this.renderListbox();
    }
  }

  override destroy(): void {
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
  'combobox',
  ComboBox as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => ComboBox,
);
