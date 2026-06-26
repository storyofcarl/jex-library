/**
 * ContextMenu — a Menu shown at the pointer on a `contextmenu` event.
 *
 * Composes the `Menu` widget for item rendering / keyboard / ARIA, and a thin
 * floating container that is positioned at the pointer location and clamped to
 * the viewport (Popup-style). Closes on Escape, click-outside, and on select.
 *
 * NOTE: `super()` runs `buildEl()` before subclass field initializers, so DOM
 * listeners are wired with bound methods inside `buildEl()`; mutable state uses
 * `declare` so it survives the first render.
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  createEl,
  register,
  trapFocus,
  type Unbind,
} from '@jects/core';
import { Menu, type MenuItem } from './menu.js';

export interface ContextMenuConfig extends WidgetConfig {
  /** Item tree forwarded to the inner Menu. */
  items?: MenuItem[];
  /** Element whose `contextmenu` event opens this menu. */
  target?: HTMLElement;
  /** Close after a (non-submenu) item is selected. Default `true`. */
  closeOnSelect?: boolean;
  /** Close on Escape. Default `true`. */
  closeOnEsc?: boolean;
  /** Close on pointer-down outside. Default `true`. */
  closeOnClickOutside?: boolean;
  /** Accessible name. Default `'Context menu'`. */
  label?: string;
}

export interface ContextMenuEvents extends WidgetEvents {
  beforeOpen: { menu: ContextMenu; x: number; y: number };
  open: { menu: ContextMenu; x: number; y: number };
  close: { menu: ContextMenu; reason: ContextMenuCloseReason };
  select: { id: string; item: MenuItem; menu: ContextMenu };
}

export type ContextMenuCloseReason = 'select' | 'escape' | 'click-outside' | 'api';

export class ContextMenu extends Widget<ContextMenuConfig, ContextMenuEvents> {
  private declare inner: Menu | null;
  // `declare` (no field initializer) so values set during super()'s render()
  // — e.g. the target `contextmenu` listener bound when `target` is supplied in
  // the constructor — are not clobbered to `undefined` after super() returns.
  private declare onTargetContext?: (e: MouseEvent) => void;
  private declare onDocPointerDown?: (e: Event) => void;
  private declare onDocKeydown?: (e: KeyboardEvent) => void;
  private declare boundTarget?: HTMLElement;
  private declare releaseTrap?: Unbind;
  private declare returnFocusTo?: HTMLElement | null;

  protected override defaults(): Partial<ContextMenuConfig> {
    return {
      items: [],
      closeOnSelect: true,
      closeOnEsc: true,
      closeOnClickOutside: true,
      label: 'Context menu',
    };
  }

  protected buildEl(): HTMLElement {
    const el = createEl('div', { className: 'jects-context-menu' });
    el.hidden = true;
    return el;
  }

  protected override render(): void {
    if (this.inner === undefined) this.inner = null;
    this.el.className = ['jects-context-menu', this.config.cls ?? ''].filter(Boolean).join(' ');
    this.bindTarget();
  }

  private bindTarget(): void {
    // Re-bind on each render so a swapped `target` config takes effect.
    if (this.onTargetContext && this.boundTarget) {
      this.boundTarget.removeEventListener('contextmenu', this.onTargetContext);
      delete this.onTargetContext;
      delete this.boundTarget;
    }
    const target = this.config.target;
    if (!target) return;
    this.onTargetContext = (e: MouseEvent): void => {
      e.preventDefault();
      this.openAt(e.clientX, e.clientY);
    };
    target.addEventListener('contextmenu', this.onTargetContext);
    this.boundTarget = target;
  }

  private get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Open the menu at viewport coordinates `(x, y)`. */
  openAt(x: number, y: number): this {
    if (this.isDestroyed) return this;
    if (this.emit('beforeOpen', { menu: this, x, y }) === false) return this;
    // Remember the invoking element so focus can be returned on close.
    this.returnFocusTo = document.activeElement as HTMLElement | null;
    this.el.hidden = false;
    if (!this.inner) {
      this.inner = new Menu(this.el, {
        items: this.config.items ?? [],
        variant: 'menu',
        ...(this.config.label !== undefined ? { label: this.config.label } : {}),
      });
      this.inner.on('select', ({ id, item }) => {
        this.emit('select', { id, item, menu: this });
        if (this.config.closeOnSelect) this.close('select');
      });
    } else {
      this.inner.update({ items: this.config.items ?? [] });
    }

    this.position(x, y);
    this.bindGlobal();
    this.inner.focusFirst();
    // Trap Tab focus inside the popup so keyboard users cannot tab to the page
    // content behind it (WCAG 2.4.3 / 2.1.2).
    this.releaseTrap = trapFocus(this.el);
    this.emit('open', { menu: this, x, y });
    return this;
  }

  private position(x: number, y: number): void {
    this.el.style.position = 'fixed';
    this.el.style.left = '0px';
    this.el.style.top = '0px';
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const left = Math.max(0, Math.min(x, vw - w));
    const top = Math.max(0, Math.min(y, vh - h));
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }

  /** Close the menu. */
  close(reason: ContextMenuCloseReason = 'api'): this {
    if (!this.isOpen) return this;
    this.el.hidden = true;
    this.unbindGlobal();
    if (this.releaseTrap) {
      this.releaseTrap();
      delete this.releaseTrap;
    }
    // Return focus to the element that was focused when the menu opened.
    const restore = this.returnFocusTo;
    delete this.returnFocusTo;
    if (restore && document.contains(restore) && typeof restore.focus === 'function') {
      restore.focus();
    }
    this.emit('close', { menu: this, reason });
    return this;
  }

  get opened(): boolean {
    return this.isOpen;
  }

  /** Access the inner Menu (created lazily on first open). */
  getMenu(): Menu | null {
    return this.inner ?? null;
  }

  private bindGlobal(): void {
    if (this.config.closeOnClickOutside) {
      this.onDocPointerDown = (e: Event): void => {
        const t = e.target as Node | null;
        if (t && this.el.contains(t)) return;
        this.close('click-outside');
      };
      document.addEventListener('pointerdown', this.onDocPointerDown, true);
    }
    if (this.config.closeOnEsc) {
      this.onDocKeydown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          this.close('escape');
        }
      };
      document.addEventListener('keydown', this.onDocKeydown, true);
    }
  }

  private unbindGlobal(): void {
    if (this.onDocPointerDown) {
      document.removeEventListener('pointerdown', this.onDocPointerDown, true);
      delete this.onDocPointerDown;
    }
    if (this.onDocKeydown) {
      document.removeEventListener('keydown', this.onDocKeydown, true);
      delete this.onDocKeydown;
    }
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    this.unbindGlobal();
    if (this.releaseTrap) {
      this.releaseTrap();
      delete this.releaseTrap;
    }
    if (this.onTargetContext && this.boundTarget) {
      this.boundTarget.removeEventListener('contextmenu', this.onTargetContext);
      delete this.onTargetContext;
      delete this.boundTarget;
    }
    this.inner?.destroy();
    this.inner = null;
    super.destroy();
  }
}

register(
  'context-menu',
  ContextMenu as unknown as new (
    host: HTMLElement | string,
    config?: Record<string, unknown>,
  ) => ContextMenu,
);
