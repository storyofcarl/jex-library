/**
 * RangeSlider — a dual-thumb slider selecting a [low, high] range.
 *
 * Mirrors the Button reference pattern. Each thumb carries `role="slider"`
 * with its own aria-valuenow plus aria-valuemin/valuemax reflecting the
 * effective bounds (a thumb cannot cross its sibling). Full keyboard support.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';

export interface RangeSliderConfig extends WidgetConfig {
  /** Minimum value. Default `0`. */
  min?: number;
  /** Maximum value. Default `100`. */
  max?: number;
  /** Step increment. Default `1`. */
  step?: number;
  /** Lower thumb value. Default `min`. */
  low?: number;
  /** Upper thumb value. Default `max`. */
  high?: number;
  /** Disabled state. */
  disabled?: boolean;
  /** Change handler convenience (also available via `.on('change', ...)`). */
  onChange?: (range: { low: number; high: number }) => void;
}

export interface RangeSliderEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel the range change. */
  beforeChange: { low: number; high: number; range: RangeSlider };
  change: { low: number; high: number; range: RangeSlider };
  input: { low: number; high: number; range: RangeSlider };
}

type Which = 'low' | 'high';

export class RangeSlider extends Widget<RangeSliderConfig, RangeSliderEvents> {
  private dragging: Which | null = null;

  // Element refs via getters (see Slider note): never cache as class fields.
  private get trackEl(): HTMLElement {
    return this.el.querySelector('.jects-range__track')!;
  }
  private get fillEl(): HTMLElement {
    return this.el.querySelector('.jects-range__fill')!;
  }
  private get lowEl(): HTMLElement {
    return this.el.querySelector('.jects-range__thumb--low')!;
  }
  private get highEl(): HTMLElement {
    return this.el.querySelector('.jects-range__thumb--high')!;
  }

  protected override defaults(): Partial<RangeSliderConfig> {
    return { min: 0, max: 100, step: 1 };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-range' });
    const track = createEl('div', { className: 'jects-range__track' });
    const fill = createEl('div', { className: 'jects-range__fill' });
    const low = createEl('div', {
      className: 'jects-range__thumb jects-range__thumb--low',
      attrs: { role: 'slider', tabindex: '0', 'aria-label': 'Lower bound' },
    });
    const high = createEl('div', {
      className: 'jects-range__thumb jects-range__thumb--high',
      attrs: { role: 'slider', tabindex: '0', 'aria-label': 'Upper bound' },
    });
    track.append(fill, low, high);
    root.append(track);

    low.addEventListener('keydown', (e) => this.handleKeydown(e, 'low'));
    high.addEventListener('keydown', (e) => this.handleKeydown(e, 'high'));
    low.addEventListener('pointerdown', (e) => this.handlePointerDown(e, 'low'));
    high.addEventListener('pointerdown', (e) => this.handlePointerDown(e, 'high'));

    // Register the global drag listeners ONCE (gated on `this.dragging`) so a
    // press/release cycle never accumulates per-drag disposers. A single
    // disposer tears them down at destroy().
    const onMove = (ev: PointerEvent): void => {
      if (this.dragging) this.setThumb(this.dragging, this.valueFromPointer(ev.clientX), false);
    };
    const onUp = (ev: PointerEvent): void => {
      if (!this.dragging) return;
      this.setThumb(this.dragging, this.valueFromPointer(ev.clientX), true);
      this.dragging = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.track(() => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    });
    return root;
  }

  private get min(): number {
    return this.config.min ?? 0;
  }
  private get max(): number {
    return this.config.max ?? 100;
  }
  private get step(): number {
    return this.config.step ?? 1;
  }

  private clamp(v: number): number {
    const { min, max, step } = this;
    const stepped = Math.round((v - min) / step) * step + min;
    return Math.min(max, Math.max(min, stepped));
  }

  private currentLow(): number {
    return this.config.low ?? this.min;
  }
  private currentHigh(): number {
    return this.config.high ?? this.max;
  }

  /** Set one thumb's value (clamped, never crossing its sibling), emitting events. */
  setThumb(which: Which, value: number, commit = true): void {
    let low = this.currentLow();
    let high = this.currentHigh();
    if (which === 'low') low = Math.min(this.clamp(value), high);
    else high = Math.max(this.clamp(value), low);

    if (low === this.currentLow() && high === this.currentHigh() && commit) return;
    if (this.emit('beforeChange', { low, high, range: this }) === false) return;
    this.config.low = low;
    this.config.high = high;
    this.render();
    this.emit('input', { low, high, range: this });
    if (commit) {
      this.config.onChange?.({ low, high });
      this.emit('change', { low, high, range: this });
    }
  }

  private handleKeydown(e: KeyboardEvent, which: Which): void {
    if (this.config.disabled) return;
    const { min, max, step } = this;
    const big = Math.max(step, (max - min) / 10);
    const current = which === 'low' ? this.currentLow() : this.currentHigh();
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = current + step;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = current - step;
        break;
      case 'PageUp':
        next = current + big;
        break;
      case 'PageDown':
        next = current - big;
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    this.setThumb(which, next);
  }

  private valueFromPointer(clientX: number): number {
    const rect = this.trackEl.getBoundingClientRect();
    const ratio = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
    return this.min + ratio * (this.max - this.min);
  }

  private handlePointerDown(e: PointerEvent, which: Which): void {
    if (this.config.disabled) return;
    e.stopPropagation();
    this.dragging = which;
    (which === 'low' ? this.lowEl : this.highEl).focus();
    // Global pointermove/pointerup are registered once in buildEl() and gated
    // on `this.dragging`; nothing to (un)bind per press.
  }

  protected override render(): void {
    const { min, max } = this;
    const low = this.clamp(this.currentLow());
    const high = Math.max(low, this.clamp(this.currentHigh()));
    this.config.low = low;
    this.config.high = high;
    const disabled = this.config.disabled ?? false;
    const span = max === min ? 1 : max - min;
    const lowPct = ((low - min) / span) * 100;
    const highPct = ((high - min) / span) * 100;

    this.el.className = ['jects-range', disabled ? 'jects-range--disabled' : '', this.config.cls ?? '']
      .filter(Boolean)
      .join(' ');

    this.fillEl.style.left = `${lowPct}%`;
    this.fillEl.style.width = `${highPct - lowPct}%`;
    this.lowEl.style.left = `${lowPct}%`;
    this.highEl.style.left = `${highPct}%`;

    this.lowEl.setAttribute('aria-valuemin', String(min));
    this.lowEl.setAttribute('aria-valuemax', String(high));
    this.lowEl.setAttribute('aria-valuenow', String(low));
    this.highEl.setAttribute('aria-valuemin', String(low));
    this.highEl.setAttribute('aria-valuemax', String(max));
    this.highEl.setAttribute('aria-valuenow', String(high));

    for (const t of [this.lowEl, this.highEl]) {
      t.setAttribute('aria-disabled', String(disabled));
      t.tabIndex = disabled ? -1 : 0;
    }
  }
}

register(
  'rangeslider',
  RangeSlider as unknown as new (
    host: HTMLElement | string,
    config?: Record<string, unknown>,
  ) => RangeSlider,
);
