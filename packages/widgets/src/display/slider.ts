/**
 * Slider — a single-thumb range input.
 *
 * Mirrors the Button reference pattern: extends `Widget<Config, Events>`,
 * supplies `defaults()`, builds the root once in `buildEl()`, syncs DOM in
 * `render()`, emits a vetoable `beforeChange` then `change`, and registers
 * itself with the factory.
 *
 * Accessibility: the thumb carries `role="slider"` with
 * `aria-valuemin/valuemax/valuenow` and full keyboard support
 * (Arrow keys, PageUp/Down, Home/End).
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';

export interface SliderConfig extends WidgetConfig {
  /** Minimum value. Default `0`. */
  min?: number;
  /** Maximum value. Default `100`. */
  max?: number;
  /** Step increment. Default `1`. */
  step?: number;
  /** Current value. Default `min`. */
  value?: number;
  /** Disabled state. */
  disabled?: boolean;
  /** Accessible label applied to the thumb. */
  label?: string;
  /** Change handler convenience (also available via `.on('change', ...)`). */
  onChange?: (value: number) => void;
}

export interface SliderEvents extends WidgetEvents {
  /** Vetoable: return `false` from a handler to cancel the value change. */
  beforeChange: { value: number; prev: number; slider: Slider };
  change: { value: number; slider: Slider };
  /** Fired on every intermediate drag/keyboard movement. */
  input: { value: number; slider: Slider };
}

export class Slider extends Widget<SliderConfig, SliderEvents> {
  private dragging = false;

  // NOTE: element references are resolved via getters that query `this.el`,
  // NOT stored as class fields — `super()` runs buildEl()/render() before
  // subclass field initializers, which would otherwise reset cached fields.
  private get trackEl(): HTMLElement {
    return this.el.querySelector('.jects-slider__track')!;
  }
  private get fillEl(): HTMLElement {
    return this.el.querySelector('.jects-slider__fill')!;
  }
  private get thumbEl(): HTMLElement {
    return this.el.querySelector('.jects-slider__thumb')!;
  }

  protected override defaults(): Partial<SliderConfig> {
    return { min: 0, max: 100, step: 1, value: 0 };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-slider' });
    const track = createEl('div', { className: 'jects-slider__track' });
    const fill = createEl('div', { className: 'jects-slider__fill' });
    const thumb = createEl('div', {
      className: 'jects-slider__thumb',
      attrs: { role: 'slider', tabindex: '0' },
    });
    track.append(fill, thumb);
    root.append(track);

    // Bind methods (NOT class-field arrows): super() runs buildEl() before
    // subclass field initializers.
    thumb.addEventListener('keydown', (e) => this.handleKeydown(e));
    root.addEventListener('pointerdown', (e) => this.handlePointerDown(e));

    // Register the global drag listeners ONCE (gated on `this.dragging`) so a
    // press/release cycle never accumulates per-drag disposers. A single
    // disposer tears them down at destroy().
    const onMove = (ev: PointerEvent): void => {
      if (this.dragging) this.setValue(this.valueFromPointer(ev.clientX), false);
    };
    const onUp = (ev: PointerEvent): void => {
      if (!this.dragging) return;
      this.dragging = false;
      this.setValue(this.valueFromPointer(ev.clientX), true);
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

  /** Programmatically set the value (clamped + stepped), emitting events. */
  setValue(value: number, commit = true): void {
    const prev = this.config.value ?? this.min;
    const next = this.clamp(value);
    if (next === prev && commit) return;
    if (this.emit('beforeChange', { value: next, prev, slider: this }) === false) return;
    this.config.value = next;
    this.render();
    this.emit('input', { value: next, slider: this });
    if (commit) {
      this.config.onChange?.(next);
      this.emit('change', { value: next, slider: this });
    }
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (this.config.disabled) return;
    const { min, max, step } = this;
    const big = Math.max(step, (max - min) / 10);
    const current = this.config.value ?? min;
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
    this.setValue(next);
  }

  private valueFromPointer(clientX: number): number {
    const rect = this.trackEl.getBoundingClientRect();
    const ratio = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
    return this.min + ratio * (this.max - this.min);
  }

  private handlePointerDown(e: PointerEvent): void {
    if (this.config.disabled) return;
    this.dragging = true;
    this.thumbEl.focus();
    this.setValue(this.valueFromPointer(e.clientX), false);
    // Global pointermove/pointerup are registered once in buildEl() and gated
    // on `this.dragging`; nothing to (un)bind per press.
  }

  protected override render(): void {
    const { min, max } = this;
    const value = this.clamp(this.config.value ?? min);
    this.config.value = value;
    const disabled = this.config.disabled ?? false;
    const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;

    this.el.className = ['jects-slider', disabled ? 'jects-slider--disabled' : '', this.config.cls ?? '']
      .filter(Boolean)
      .join(' ');

    this.fillEl.style.width = `${pct}%`;
    this.thumbEl.style.left = `${pct}%`;

    this.thumbEl.setAttribute('aria-valuemin', String(min));
    this.thumbEl.setAttribute('aria-valuemax', String(max));
    this.thumbEl.setAttribute('aria-valuenow', String(value));
    // Always provide an accessible name (WCAG 4.1.2 / axe aria-input-field-name):
    // fall back to a meaningful default when no label is supplied.
    this.thumbEl.setAttribute('aria-label', this.config.label ?? 'Slider');
    this.thumbEl.setAttribute('aria-disabled', String(disabled));
    this.thumbEl.tabIndex = disabled ? -1 : 0;
  }
}

register(
  'slider',
  Slider as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Slider,
);
