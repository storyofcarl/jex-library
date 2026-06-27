/**
 * TagsField — a minimal chips/tags input producing a `string[]` value.
 *
 * Mirrors the reference Button pattern: extends `Widget<Config, Events>`,
 * `defaults()` supplies component defaults, `buildEl()` builds the root once and
 * wires DOM listeners with bound methods (NOT class-field arrows, because
 * `super()` runs `buildEl()` before subclass field initializers), and `render()`
 * idempotently syncs the DOM to config.
 *
 * Interaction: type then Enter (or comma) to add a tag; Backspace on an empty
 * input removes the last tag; each chip has a remove (×) button. Duplicate and
 * blank tags are ignored. Emits a vetoable `beforeChange` then `change` whenever
 * the tag set changes — wired into the Form like every other control.
 *
 * a11y: role="group" on the root; the text input carries an accessible name
 * (visible `<label for>` when supplied, else `aria-label`).
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register, staticHtml } from '@jects/core';

let tagsSeq = 0;

export interface TagsFieldConfig extends WidgetConfig {
  /** Current tags. */
  value?: string[];
  /** Placeholder shown in the entry input. */
  placeholder?: string;
  /** Visible label rendered above the control. */
  label?: string;
  /** Accessible name applied to the input when no visible `label` is supplied. */
  ariaLabel?: string;
  /** Disabled state. */
  disabled?: boolean;
  /** Read-only state (chips visible, no add/remove). */
  readOnly?: boolean;
  /** Native name (mirrored onto the entry input). */
  name?: string;
  /** Invalid state styling + aria-invalid. */
  invalid?: boolean;
  /** Change handler convenience (also available via `.on('change', ...)`). */
  onChange?: (value: string[]) => void;
}

export interface TagsFieldEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel the change. */
  beforeChange: { value: string[]; field: TagsField };
  change: { value: string[]; field: TagsField };
}

export class TagsField extends Widget<TagsFieldConfig, TagsFieldEvents> {
  /** Stable id for the input, stored on the root so it survives field-init order. */
  protected get inputId(): string {
    let id = this.el.dataset.inputId;
    if (!id) {
      id = `jects-tags-${++tagsSeq}`;
      this.el.dataset.inputId = id;
    }
    return id;
  }

  // Element refs via getters (see Slider note): never cache as class fields.
  private get input(): HTMLInputElement {
    return this.el.querySelector('.jects-tags__input') as HTMLInputElement;
  }

  protected override defaults(): Partial<TagsFieldConfig> {
    return { value: [] };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-tags', attrs: { role: 'group' } });
    // Bound listeners (super() runs buildEl() before field initializers).
    root.addEventListener('keydown', (e) => this.handleKeydown(e));
    root.addEventListener('click', (e) => this.handleClick(e));
    return root;
  }

  private get interactive(): boolean {
    return !this.config.disabled && !this.config.readOnly;
  }

  private tags(): string[] {
    return this.config.value ?? [];
  }

  /** Commit a new tag set, emitting events (no-op when unchanged). */
  private commit(next: string[]): void {
    const prev = this.tags();
    if (prev.length === next.length && prev.every((t, i) => t === next[i])) return;
    if (this.emit('beforeChange', { value: next, field: this }) === false) return;
    this.config = { ...this.config, value: next };
    this.render();
    this.config.onChange?.(next);
    this.emit('change', { value: next, field: this });
  }

  /** Add a tag (trimmed; blanks + duplicates ignored). */
  addTag(raw: string): void {
    if (!this.interactive) return;
    const tag = raw.trim();
    if (!tag || this.tags().includes(tag)) return;
    this.commit([...this.tags(), tag]);
  }

  /** Remove a tag by value. */
  removeTag(tag: string): void {
    if (!this.interactive) return;
    this.commit(this.tags().filter((t) => t !== tag));
  }

  /** Current tags (a copy). */
  getValue(): string[] {
    return [...this.tags()];
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.target !== this.input || !this.interactive) return;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      this.addTag(this.input.value);
      this.input.value = '';
    } else if (e.key === 'Backspace' && this.input.value === '' && this.tags().length) {
      e.preventDefault();
      this.removeTag(this.tags()[this.tags().length - 1]!);
    }
  }

  private handleClick(e: MouseEvent): void {
    const remove = (e.target as Element).closest('.jects-tags__remove') as HTMLElement | null;
    if (remove && this.interactive) {
      e.preventDefault();
      this.removeTag(remove.dataset.tag ?? '');
    }
  }

  protected override render(): void {
    const {
      value = [],
      placeholder,
      label,
      ariaLabel,
      disabled = false,
      readOnly = false,
      invalid = false,
      name,
    } = this.config;

    this.el.className = [
      'jects-tags',
      disabled ? 'jects-tags--disabled' : '',
      readOnly ? 'jects-tags--readonly' : '',
      invalid ? 'jects-tags--invalid' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    // Build structure once (label / chips container / input), then sync in place.
    let labelEl = this.el.querySelector('.jects-tags__label') as HTMLLabelElement | null;
    let chips = this.el.querySelector('.jects-tags__chips') as HTMLElement | null;
    let input = this.el.querySelector('.jects-tags__input') as HTMLInputElement | null;
    if (!chips) {
      chips = createEl('div', { className: 'jects-tags__chips' });
      input = createEl('input', {
        className: 'jects-tags__input',
        attrs: { id: this.inputId, type: 'text' },
      });
      chips.append(input);
      this.el.append(chips);
    }
    input = input ?? (this.el.querySelector('.jects-tags__input') as HTMLInputElement);

    if (label) {
      if (!labelEl) {
        labelEl = createEl('label', { className: 'jects-tags__label', attrs: { for: this.inputId } });
        this.el.insertBefore(labelEl, chips);
      }
      labelEl.textContent = label;
    } else if (labelEl) {
      labelEl.remove();
    }

    // Re-render chips (everything before the persistent input).
    for (const chip of [...chips.querySelectorAll('.jects-tags__chip')]) chip.remove();
    for (const tag of value) {
      const chip = createEl('span', { className: 'jects-tags__chip' });
      const text = createEl('span', { className: 'jects-tags__text' });
      text.textContent = tag;
      chip.append(text);
      if (this.interactive) {
        const remove = createEl('button', {
          className: 'jects-tags__remove',
          html: staticHtml`&times;`,
          attrs: { type: 'button', 'aria-label': `Remove ${tag}`, tabindex: '-1', 'data-tag': tag },
        });
        chip.append(remove);
      }
      chips.insertBefore(chip, input);
    }

    input.disabled = disabled || readOnly;
    input.setAttribute('aria-invalid', String(invalid));
    if (placeholder != null) input.placeholder = placeholder;
    else input.removeAttribute('placeholder');
    if (name != null) input.name = name;
    if (label) input.removeAttribute('aria-label');
    else if (ariaLabel) input.setAttribute('aria-label', ariaLabel);
    else input.removeAttribute('aria-label');
  }
}

register(
  'tagsfield',
  TagsField as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => TagsField,
);
