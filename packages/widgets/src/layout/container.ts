/**
 * Container — a flex/grid layout wrapper.
 *
 * Follows the Button reference pattern: extends `Widget<Config, Events>`,
 * supplies `defaults()`, builds the root once in `buildEl()`, syncs DOM in
 * `render()`, and registers itself with the factory.
 *
 * Children may be provided declaratively via `items` (factory `{ type, ... }`
 * configs or already-built `Widget` instances or raw `HTMLElement`/HTML strings).
 * Child widgets created by the container are owned by it and destroyed on
 * `destroy()`.
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  createEl,
  register,
  create,
  type TypedConfig,
} from '@jects/core';

export type ContainerLayout = 'flex' | 'grid';
export type FlexDirection = 'row' | 'column';
export type AlignValue = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type JustifyValue = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';

/** A child item: a factory config, a built widget, or raw DOM/HTML. */
export type ContainerItem = TypedConfig | Widget | HTMLElement | string;

export interface ContainerConfig extends WidgetConfig {
  /** Layout mode. Default `flex`. */
  layout?: ContainerLayout;
  /** Flex direction (flex layout only). Default `row`. */
  direction?: FlexDirection;
  /** Allow wrapping (flex layout only). Default `false`. */
  wrap?: boolean;
  /** Number of columns (grid layout only). */
  columns?: number;
  /** Gap between items — a `--jects-space-*` step (0–12) or any CSS length. */
  gap?: number | string;
  /** Cross-axis alignment (align-items). Default `stretch`. */
  align?: AlignValue;
  /** Main-axis distribution (justify-content). Default `start`. */
  justify?: JustifyValue;
  /** Child items. */
  items?: ContainerItem[];
  /** ARIA role for the container (e.g. `toolbar`, `group`). */
  role?: string;
  /** Accessible label. */
  ariaLabel?: string;
}

export interface ContainerEvents extends WidgetEvents {
  /** Emitted after items are (re)built. */
  itemsChange: { items: Widget[]; container: Container };
}

const ALIGN_MAP: Record<AlignValue, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
};

const JUSTIFY_MAP: Record<JustifyValue, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
};

export class Container extends Widget<ContainerConfig, ContainerEvents> {
  /**
   * Child widgets created/owned by this container (destroyed with it).
   * NOTE: declared with `declare` (type-only, emits NO field) — under
   * `useDefineForClassFields`, even an uninitialised field declaration runs
   * `this.items = undefined` AFTER `super()` (which already ran render()),
   * wiping items captured on first render. The backing array is created in
   * `buildEl()` (runs during super, before any field reset) and read via
   * `itemList`.
   */
  declare private items: Widget[];

  private get itemList(): Widget[] {
    return (this.items ??= []);
  }

  protected override defaults(): Partial<ContainerConfig> {
    return { layout: 'flex', direction: 'row', wrap: false, align: 'stretch', justify: 'start' };
  }

  protected buildEl(): HTMLElement {
    this.items = [];
    return createEl('div', { className: 'jects-container' });
  }

  /** Built child widgets (excludes raw HTML/element children). */
  getItems(): Widget[] {
    return [...this.itemList];
  }

  /** Append a single item (config/widget/element/html) and return its widget if one was created. */
  add(item: ContainerItem): Widget | undefined {
    // Persist the item into config.items so it survives the next render()
    // (render() disposes itemList and rebuilds solely from config.items). For
    // a built Widget we store the widget itself; render()'s mount() re-appends
    // its existing .el without recreating it. For factory configs we store the
    // original config so it is rebuilt rather than left dangling.
    (this.config.items ??= []).push(item);
    const w = this.mount(item);
    if (w) {
      this.itemList.push(w);
    }
    this.emit('itemsChange', { items: this.getItems(), container: this });
    return w;
  }

  private disposeItems(): void {
    for (const w of this.itemList.splice(0)) {
      if (!w.isDestroyed) w.destroy();
    }
  }

  /** Mount one item into the root; returns the created/built Widget when applicable. */
  private mount(item: ContainerItem): Widget | undefined {
    if (item instanceof Widget) {
      this.el.appendChild(item.el);
      return item;
    }
    if (item instanceof HTMLElement) {
      this.el.appendChild(item);
      return undefined;
    }
    if (typeof item === 'string') {
      const wrap = createEl('div', { className: 'jects-container__html', html: item });
      this.el.appendChild(wrap);
      return undefined;
    }
    // TypedConfig: build via factory mounted into the container.
    return create(item, this.el);
  }

  private cssGap(): string | undefined {
    const { gap } = this.config;
    if (gap === undefined) return undefined;
    if (typeof gap === 'number') return `var(--jects-space-${gap})`;
    return gap;
  }

  protected override render(): void {
    const {
      layout = 'flex',
      direction = 'row',
      wrap = false,
      columns,
      align = 'stretch',
      justify = 'start',
      role,
      ariaLabel,
      items = [],
    } = this.config;

    const el = this.el;
    el.className = [
      'jects-container',
      `jects-container--${layout}`,
      layout === 'flex' ? `jects-container--${direction}` : '',
      layout === 'flex' && wrap ? 'jects-container--wrap' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    // (Re)build items: dispose previously-owned widgets, clear, remount.
    this.disposeItems();
    el.replaceChildren();
    for (const item of items) {
      const w = this.mount(item);
      if (w) this.itemList.push(w);
    }

    // Layout via inline CSS custom properties consumed by the stylesheet.
    el.style.setProperty('--_container-align', ALIGN_MAP[align]);
    el.style.setProperty('--_container-justify', JUSTIFY_MAP[justify]);
    const gap = this.cssGap();
    if (gap) el.style.setProperty('--_container-gap', gap);
    else el.style.removeProperty('--_container-gap');
    if (layout === 'grid') {
      el.style.setProperty('--_container-columns', String(columns ?? 1));
    } else {
      el.style.removeProperty('--_container-columns');
    }

    if (role) el.setAttribute('role', role);
    else el.removeAttribute('role');
    if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
    else el.removeAttribute('aria-label');

    this.emit('itemsChange', { items: this.getItems(), container: this });
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    this.disposeItems();
    super.destroy();
  }
}

register(
  'container',
  Container as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Container,
);
