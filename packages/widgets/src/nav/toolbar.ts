/**
 * Toolbar — a horizontal (or vertical) bar of buttons, groups, and separators
 * with an optional overflow menu.
 *
 * Reuses the Wave-1 `Button` primitive for each action, the `Menu` widget for
 * the overflow popup, and exposes ARIA `toolbar` role with roving-tabindex
 * keyboard navigation (ArrowLeft/Right or Up/Down, Home/End).
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
} from '@jects/core';
import { Button } from '../button/button.js';
import { Menu, type MenuItem } from './menu.js';
import type { IconName } from '@jects/icons';

export interface ToolbarItem {
  /** Stable id, echoed on `action`. Optional for separators. */
  id?: string;
  /** Visible label (omit for icon-only). */
  text?: string;
  /** Leading icon. */
  icon?: IconName;
  /** Button variant. Default `ghost`. */
  variant?: 'primary' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';
  /** Disabled. */
  disabled?: boolean;
  /** Renders a separator (ignores other fields). */
  separator?: boolean;
  /** Accessible name when icon-only. */
  label?: string;
  /** Arbitrary user payload. */
  data?: unknown;
}

export interface ToolbarConfig extends WidgetConfig {
  // NOTE: Toolbar deliberately has NO widget-level `disabled`. A toolbar is a
  // container of independently-operable commands, not a single control, so the
  // shared `disabled` vocabulary is applied per item (`ToolbarItem.disabled`)
  // rather than to the bar as a whole. Disable each command individually.
  /** Action items. */
  items?: ToolbarItem[];
  /** Layout orientation. Default `horizontal`. */
  orientation?: 'horizontal' | 'vertical';
  /** Button size for all items. Default `sm`. */
  size?: 'sm' | 'md' | 'lg';
  /** Collapse items beyond this count into an overflow menu (`0` = off). Default `0`. */
  overflowAfter?: number;
  /** Accessible name (`aria-label`). Default `'Toolbar'`. */
  label?: string;
}

export interface ToolbarEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel. */
  beforeAction: { id: string; item: ToolbarItem; toolbar: Toolbar };
  action: { id: string; item: ToolbarItem; toolbar: Toolbar };
}

export class Toolbar extends Widget<ToolbarConfig, ToolbarEvents> {
  private declare buttons: Map<string, Button>;
  private declare overflowMenu: Menu | null;
  private declare activeIdx: number;
  private declare overflowDismiss?: () => void;

  protected override defaults(): Partial<ToolbarConfig> {
    return {
      items: [],
      orientation: 'horizontal',
      size: 'sm',
      overflowAfter: 0,
      label: 'Toolbar',
    };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-toolbar' });
    root.setAttribute('role', 'toolbar');
    root.addEventListener('keydown', (e) => this.handleKeydown(e as KeyboardEvent));
    return root;
  }

  protected override render(): void {
    if (this.buttons === undefined) {
      this.buttons = new Map();
      this.overflowMenu = null;
      this.activeIdx = 0;
    }
    // Tear down previous render's child widgets to avoid leaks on re-render.
    this.teardownChildren();

    const orientation = this.config.orientation ?? 'horizontal';
    const size = this.config.size ?? 'sm';
    const items = this.config.items ?? [];
    const overflowAfter = this.config.overflowAfter ?? 0;

    this.el.className = [
      'jects-toolbar',
      `jects-toolbar--${orientation}`,
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');
    this.el.setAttribute('aria-orientation', orientation);
    this.el.setAttribute('aria-label', this.config.label ?? 'Toolbar');
    // jects-safe-html: empty clear; items built below as DOM nodes / Button widgets
    this.el.innerHTML = '';

    const visible = overflowAfter > 0 ? items.slice(0, overflowAfter) : items;
    const overflow = overflowAfter > 0 ? items.slice(overflowAfter) : [];

    visible.forEach((item) => {
      if (item.separator) {
        const sep = createEl('div', { className: 'jects-toolbar__separator' });
        sep.setAttribute('role', 'separator');
        sep.setAttribute('aria-orientation', orientation === 'horizontal' ? 'vertical' : 'horizontal');
        this.el.appendChild(sep);
        return;
      }
      const slot = createEl('div', { className: 'jects-toolbar__item' });
      this.el.appendChild(slot);
      const btn = new Button(slot, {
        ...(item.text !== undefined ? { text: item.text } : {}),
        ...(item.icon !== undefined ? { icon: item.icon } : {}),
        variant: item.variant ?? 'ghost',
        size,
        ...(item.disabled !== undefined ? { disabled: item.disabled } : {}),
      });
      const itemId = item.id ?? '';
      btn.el.dataset['id'] = itemId;
      if (!item.text && item.label) btn.el.setAttribute('aria-label', item.label);
      btn.on('click', () => this.fire(item));
      this.buttons.set(itemId, btn);
    });

    if (overflow.length) {
      const slot = createEl('div', { className: 'jects-toolbar__overflow' });
      this.el.appendChild(slot);
      const trigger = new Button(slot, { icon: 'more-horizontal', variant: 'ghost', size });
      trigger.el.setAttribute('aria-label', 'More');
      trigger.el.setAttribute('aria-haspopup', 'true');
      // Expose the collapsed state before any interaction.
      trigger.el.setAttribute('aria-expanded', 'false');
      this.buttons.set('__overflow', trigger);

      const menuHost = createEl('div', { className: 'jects-toolbar__overflow-menu' });
      menuHost.hidden = true;
      slot.appendChild(menuHost);
      const menu = new Menu(menuHost, {
        items: overflow.map<MenuItem>((it) => ({
          id: it.id ?? '',
          ...(it.text !== undefined ? { text: it.text } : { text: it.label ?? it.id ?? '' }),
          ...(it.icon !== undefined ? { icon: it.icon } : {}),
          ...(it.disabled !== undefined ? { disabled: it.disabled } : {}),
        })),
        label: 'More actions',
      });

      const closeOverflow = (returnFocus: boolean): void => {
        if (menuHost.hidden) return;
        menuHost.hidden = true;
        trigger.el.setAttribute('aria-expanded', 'false');
        if (this.overflowDismiss) {
          this.overflowDismiss();
          delete this.overflowDismiss;
        }
        if (returnFocus) trigger.el.focus();
      };

      const openOverflow = (): void => {
        menuHost.hidden = false;
        trigger.el.setAttribute('aria-expanded', 'true');
        menu.focusFirst();
        // Escape + outside-click dismissal so keyboard users are never stranded.
        const onDocPointerDown = (e: Event): void => {
          const t = e.target as Node | null;
          if (t && slot.contains(t)) return;
          closeOverflow(false);
        };
        const onDocKeydown = (e: KeyboardEvent): void => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            closeOverflow(true);
          }
        };
        document.addEventListener('pointerdown', onDocPointerDown, true);
        document.addEventListener('keydown', onDocKeydown, true);
        this.overflowDismiss = (): void => {
          document.removeEventListener('pointerdown', onDocPointerDown, true);
          document.removeEventListener('keydown', onDocKeydown, true);
        };
      };

      menu.on('select', ({ id }) => {
        const it = overflow.find((o) => o.id === id);
        if (it) this.fire(it);
        closeOverflow(true);
      });
      trigger.on('click', () => {
        if (menuHost.hidden) openOverflow();
        else closeOverflow(true);
      });
      this.overflowMenu = menu;
    }

    this.applyRovingTabindex();
  }

  private fire(item: ToolbarItem): void {
    if (item.disabled || item.separator) return;
    const id = item.id ?? '';
    if (this.emit('beforeAction', { id, item, toolbar: this }) === false) return;
    this.emit('action', { id, item, toolbar: this });
  }

  // ---- roving tabindex ----------------------------------------------------

  private focusables(): HTMLElement[] {
    return Array.from(this.el.querySelectorAll<HTMLElement>('.jects-btn'));
  }

  private applyRovingTabindex(): void {
    const items = this.focusables();
    if (this.activeIdx >= items.length) this.activeIdx = 0;
    items.forEach((el, i) => {
      el.tabIndex = i === this.activeIdx ? 0 : -1;
    });
  }

  private handleKeydown(event: KeyboardEvent): void {
    const horizontal = (this.config.orientation ?? 'horizontal') === 'horizontal';
    const next = horizontal ? 'ArrowRight' : 'ArrowDown';
    const prev = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const items = this.focusables();
    if (!items.length) return;
    const current = items.findIndex((el) => el === document.activeElement);
    let idx = current < 0 ? this.activeIdx : current;

    switch (event.key) {
      case next:
        event.preventDefault();
        idx = (idx + 1) % items.length;
        break;
      case prev:
        event.preventDefault();
        idx = (idx - 1 + items.length) % items.length;
        break;
      case 'Home':
        event.preventDefault();
        idx = 0;
        break;
      case 'End':
        event.preventDefault();
        idx = items.length - 1;
        break;
      default:
        return;
    }
    this.activeIdx = idx;
    this.applyRovingTabindex();
    items[idx]!.focus();
  }

  private teardownChildren(): void {
    if (this.overflowDismiss) {
      this.overflowDismiss();
      delete this.overflowDismiss;
    }
    if (this.buttons) {
      this.buttons.forEach((b) => b.destroy());
      this.buttons.clear();
    }
    if (this.overflowMenu) {
      this.overflowMenu.destroy();
      this.overflowMenu = null;
    }
  }

  /** Access a rendered button by item id. */
  getButton(id: string): Button | undefined {
    return this.buttons?.get(id);
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    this.teardownChildren();
    super.destroy();
  }
}

register(
  'toolbar',
  Toolbar as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Toolbar,
);
