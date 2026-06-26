/**
 * Rating — a star rating control supporting half-steps and keyboard input.
 *
 * Mirrors the Button reference pattern. Uses `role="slider"` on the root
 * (with aria-valuemin/valuemax/valuenow + aria-valuetext) which is the
 * recommended pattern for an adjustable rating widget. Arrow keys adjust,
 * Home/End jump to bounds.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';

export interface RatingConfig extends WidgetConfig {
  /** Number of stars. Default `5`. */
  max?: number;
  /** Current value (0..max). Default `0`. */
  value?: number;
  /** Allow half-star granularity. Default `false`. */
  allowHalf?: boolean;
  /** Read-only display (no input). Default `false`. */
  readOnly?: boolean;
  /** Disabled state. */
  disabled?: boolean;
  /** Accessible label. */
  label?: string;
  /** Change handler convenience (also available via `.on('change', ...)`). */
  onChange?: (value: number) => void;
}

export interface RatingEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel the value change. */
  beforeChange: { value: number; prev: number; rating: Rating };
  change: { value: number; rating: Rating };
}

export class Rating extends Widget<RatingConfig, RatingEvents> {
  // Element ref via getter (see Slider note): never cache as a class field.
  private get starsEl(): HTMLElement {
    return this.el.querySelector('.jects-rating__stars')!;
  }

  protected override defaults(): Partial<RatingConfig> {
    return { max: 5, value: 0, allowHalf: false, readOnly: false };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', {
      className: 'jects-rating',
      attrs: { role: 'slider', tabindex: '0' },
    });
    const stars = createEl('div', {
      className: 'jects-rating__stars',
      attrs: { 'aria-hidden': 'true' },
    });
    root.append(stars);

    root.addEventListener('keydown', (e) => this.handleKeydown(e));
    root.addEventListener('click', (e) => this.handleClick(e));
    return root;
  }

  private get max(): number {
    return this.config.max ?? 5;
  }
  private get step(): number {
    return this.config.allowHalf ? 0.5 : 1;
  }

  private clamp(v: number): number {
    const step = this.step;
    const stepped = Math.round(v / step) * step;
    return Math.min(this.max, Math.max(0, stepped));
  }

  private get interactive(): boolean {
    return !this.config.readOnly && !this.config.disabled;
  }

  /** Set the rating value (clamped to step + bounds), emitting events. */
  setValue(value: number): void {
    if (!this.interactive) return;
    const prev = this.config.value ?? 0;
    const next = this.clamp(value);
    if (next === prev) return;
    if (this.emit('beforeChange', { value: next, prev, rating: this }) === false) return;
    this.config.value = next;
    this.render();
    this.config.onChange?.(next);
    this.emit('change', { value: next, rating: this });
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (!this.interactive) return;
    const current = this.config.value ?? 0;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = current + this.step;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = current - this.step;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = this.max;
        break;
      default:
        return;
    }
    e.preventDefault();
    this.setValue(next);
  }

  private handleClick(e: MouseEvent): void {
    if (!this.interactive) return;
    const target = (e.target as Element).closest('.jects-rating__star') as HTMLElement | null;
    if (!target) return;
    const index = Number(target.dataset.index); // 1-based star index
    if (this.config.allowHalf) {
      const rect = target.getBoundingClientRect();
      const isLeftHalf = e.clientX - rect.left < rect.width / 2;
      this.setValue(isLeftHalf ? index - 0.5 : index);
    } else {
      this.setValue(index);
    }
  }

  protected override render(): void {
    const max = this.max;
    const value = this.clamp(this.config.value ?? 0);
    this.config.value = value;
    const disabled = this.config.disabled ?? false;
    const readOnly = this.config.readOnly ?? false;

    this.el.className = [
      'jects-rating',
      readOnly ? 'jects-rating--readonly' : '',
      disabled ? 'jects-rating--disabled' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    const parts: string[] = [];
    for (let i = 1; i <= max; i++) {
      let state = 'empty';
      if (value >= i) state = 'full';
      else if (value >= i - 0.5) state = 'half';
      parts.push(
        `<span class="jects-rating__star jects-rating__star--${state}" data-index="${i}">` +
          `<span class="jects-rating__glyph jects-rating__glyph--bg">★</span>` +
          `<span class="jects-rating__glyph jects-rating__glyph--fg">★</span>` +
          `</span>`,
      );
    }
    this.starsEl.innerHTML = parts.join('');

    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', String(max));
    this.el.setAttribute('aria-valuenow', String(value));
    this.el.setAttribute('aria-valuetext', `${value} of ${max} stars`);
    this.el.setAttribute('aria-label', this.config.label ?? 'Rating');
    this.el.setAttribute('aria-readonly', String(readOnly));
    this.el.setAttribute('aria-disabled', String(disabled));
    this.el.tabIndex = this.interactive ? 0 : -1;
  }
}

register(
  'rating',
  Rating as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Rating,
);
