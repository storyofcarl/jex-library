/**
 * ProgressBar — determinate or indeterminate progress indicator.
 *
 * Mirrors the Button reference pattern. Uses `role="progressbar"` with
 * aria-valuemin/valuemax/valuenow (omitted while indeterminate, per ARIA).
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';

export type ProgressVariant = 'primary' | 'success' | 'warning' | 'destructive';
export type ProgressSize = 'sm' | 'md' | 'lg';

export interface ProgressBarConfig extends WidgetConfig {
  /** Current value. Default `0`. */
  value?: number;
  /** Maximum value. Default `100`. */
  max?: number;
  /** Indeterminate (animated) state — ignores `value`. Default `false`. */
  indeterminate?: boolean;
  /** Color variant. Default `primary`. */
  variant?: ProgressVariant;
  /** Bar thickness. Default `md`. */
  size?: ProgressSize;
  /** Show a percentage label. Default `false`. */
  showLabel?: boolean;
  /** Accessible label. */
  label?: string;
}

export interface ProgressBarEvents extends WidgetEvents {
  /** Fired whenever the value changes. */
  change: { value: number; max: number; progress: ProgressBar };
  /** Fired when value reaches max. */
  complete: { progress: ProgressBar };
}

export class ProgressBar extends Widget<ProgressBarConfig, ProgressBarEvents> {
  // Element refs via getters (see Slider note): never cache as class fields.
  private get fillEl(): HTMLElement {
    return this.el.querySelector('.jects-progress__fill')!;
  }
  private get labelEl(): HTMLElement {
    return this.el.querySelector('.jects-progress__label')!;
  }

  protected override defaults(): Partial<ProgressBarConfig> {
    return { value: 0, max: 100, variant: 'primary', size: 'md', indeterminate: false };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-progress', attrs: { role: 'progressbar' } });
    const track = createEl('div', { className: 'jects-progress__track' });
    const fill = createEl('div', { className: 'jects-progress__fill' });
    const label = createEl('span', { className: 'jects-progress__label' });
    track.append(fill);
    root.append(track, label);
    return root;
  }

  /** Update the value and re-render (convenience over `update({ value })`). */
  setValue(value: number): this {
    this.update({ value });
    return this;
  }

  override update(patch: Partial<ProgressBarConfig>): this {
    const prevValue = this.config.value ?? 0;
    super.update(patch);
    const value = this.config.value ?? 0;
    const max = this.config.max ?? 100;
    if (!this.config.indeterminate && value !== prevValue) {
      this.emit('change', { value, max, progress: this });
      if (value >= max) this.emit('complete', { progress: this });
    }
    return this;
  }

  protected override render(): void {
    const max = this.config.max ?? 100;
    const indeterminate = this.config.indeterminate ?? false;
    const rawValue = this.config.value ?? 0;
    const value = Math.min(max, Math.max(0, rawValue));
    const variant = this.config.variant ?? 'primary';
    const size = this.config.size ?? 'md';
    const pct = max === 0 ? 0 : (value / max) * 100;

    this.el.className = [
      'jects-progress',
      `jects-progress--${variant}`,
      `jects-progress--${size}`,
      indeterminate ? 'jects-progress--indeterminate' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    this.fillEl.style.width = indeterminate ? '' : `${pct}%`;

    if (indeterminate) {
      this.el.removeAttribute('aria-valuenow');
      this.el.removeAttribute('aria-valuemin');
      this.el.removeAttribute('aria-valuemax');
    } else {
      this.el.setAttribute('aria-valuemin', '0');
      this.el.setAttribute('aria-valuemax', String(max));
      this.el.setAttribute('aria-valuenow', String(value));
    }
    this.el.setAttribute('aria-label', this.config.label ?? 'Progress');

    const showLabel = this.config.showLabel ?? false;
    this.labelEl.hidden = !showLabel || indeterminate;
    if (showLabel && !indeterminate) {
      this.labelEl.textContent = `${Math.round(pct)}%`;
    }
  }
}

register(
  'progressbar',
  ProgressBar as unknown as new (
    host: HTMLElement | string,
    config?: Record<string, unknown>,
  ) => ProgressBar,
);
