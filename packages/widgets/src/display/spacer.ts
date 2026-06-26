/**
 * Spacer — a presentational layout gap. Renders an empty box that consumes
 * space along an axis (or flex-grows to push siblings apart).
 *
 * Mirrors the Button reference pattern. Purely decorative, so it carries
 * `aria-hidden="true"` and `role="none"`.
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';

export type SpacerAxis = 'vertical' | 'horizontal';
/** A token scale step (maps to `--jects-space-<n>`) or an explicit CSS length. */
export type SpacerSize = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | string;

export interface SpacerConfig extends WidgetConfig {
  /** Axis the spacer occupies. Default `vertical`. */
  axis?: SpacerAxis;
  /**
   * Size: a numeric token step (0–12 → `--jects-space-<n>`) or a CSS length
   * string (e.g. `"2rem"`). Default `4`. Ignored when `grow` is set.
   */
  size?: SpacerSize;
  /** Flex-grow to fill available space instead of a fixed size. Default `false`. */
  grow?: boolean;
}

export type SpacerEvents = WidgetEvents;

export class Spacer extends Widget<SpacerConfig, SpacerEvents> {
  protected override defaults(): Partial<SpacerConfig> {
    return { axis: 'vertical', size: 4, grow: false };
  }

  protected buildEl(): HTMLElement {
    return createEl('div', {
      className: 'jects-spacer',
      attrs: { 'aria-hidden': 'true', role: 'none' },
    });
  }

  private resolveSize(size: SpacerSize): string {
    if (typeof size === 'number') return `var(--jects-space-${size})`;
    return size; // explicit CSS length
  }

  protected override render(): void {
    const { axis = 'vertical', size = 4, grow = false } = this.config;

    this.el.className = [
      'jects-spacer',
      `jects-spacer--${axis}`,
      grow ? 'jects-spacer--grow' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    // Reset both dims, then drive the active axis.
    this.el.style.removeProperty('width');
    this.el.style.removeProperty('height');
    this.el.style.removeProperty('flex');

    if (grow) {
      this.el.style.flex = '1 1 0%';
      return;
    }

    const len = this.resolveSize(size);
    if (axis === 'vertical') {
      this.el.style.height = len;
      this.el.style.width = '100%';
    } else {
      this.el.style.width = len;
      this.el.style.height = '100%';
    }
  }
}

register(
  'spacer',
  Spacer as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Spacer,
);
