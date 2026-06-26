/**
 * Menu — an accessible menu / menubar of nested items.
 *
 * Mirrors the Button reference: extends `Widget<Config, Events>`, supplies
 * `defaults()`, builds its root once in `buildEl()`, syncs DOM in `render()`,
 * registers with the factory, and emits a vetoable `beforeSelect` then `select`.
 *
 * Items are described declaratively as a nested config tree (TreeStore-like):
 * actions, separators, and submenus, with optional icons and checkable state.
 * Full ARIA `menu`/`menuitem` roles, roving tabindex, and keyboard support
 * (ArrowUp/Down to move, ArrowRight/Enter to open a submenu, ArrowLeft/Escape
 * to close it, Home/End, type-ahead).
 *
 * NOTE: `super()` runs `buildEl()` before subclass field initializers, so DOM
 * listeners are wired with bound methods inside `buildEl()`, never class-field
 * arrows; mutable per-instance state uses `declare` (no field initializer) so
 * the value set during the first render is not clobbered after super().
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  createEl,
  register,
} from '@jects/core';
import { renderIcon, type IconName } from '@jects/icons';

export interface MenuItem {
  /** Stable id (used in events / lookups). Auto-derived when omitted. */
  id?: string;
  /** Visible label. */
  text?: string;
  /** Leading icon name. */
  icon?: IconName;
  /** Optional shortcut hint shown trailing (e.g. `Ctrl+S`). */
  shortcut?: string;
  /** Disabled — not focusable, not selectable. */
  disabled?: boolean;
  /** Renders a non-interactive separator (ignores other fields). */
  separator?: boolean;
  /** Checkable item: renders a check indicator reflecting `checked`. */
  checkable?: boolean;
  /** Initial checked state for a checkable item. */
  checked?: boolean;
  /** Child items — turns this into a submenu. */
  children?: MenuItem[];
  /** Arbitrary user payload, echoed on `select`. */
  data?: unknown;
}

export interface MenuConfig extends WidgetConfig {
  /** Item tree. */
  items?: MenuItem[];
  /** `menu` (default, vertical popup) or `menubar` (horizontal top bar). */
  variant?: 'menu' | 'menubar';
  /** Accessible name (`aria-label`). Default `'Menu'`. */
  label?: string;
}

export interface MenuEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel selection. */
  beforeSelect: { id: string; item: MenuItem; menu: Menu };
  select: { id: string; item: MenuItem; menu: Menu };
  /** A checkable item toggled. */
  check: { id: string; item: MenuItem; checked: boolean; menu: Menu };
  /** A submenu opened or closed. */
  submenu: { id: string; item: MenuItem; open: boolean; menu: Menu };
  /** Escape pressed at the outermost level (request to close the menu). */
  dismiss: { menu: Menu };
}

interface FlatItem {
  id: string;
  item: MenuItem;
  path: number[];
}

export class Menu extends Widget<MenuConfig, MenuEvents> {
  // `declare` so no initializer clobbers state set during the first render().
  private declare activeId: string | null;
  private declare openSubmenus: Set<string>;
  private declare checkedState: Map<string, boolean>;
  private declare typeahead: string;
  private declare typeaheadAt: number;

  protected override defaults(): Partial<MenuConfig> {
    return { items: [], variant: 'menu', label: 'Menu' };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-menu' });
    root.addEventListener('click', (e) => this.handleClick(e as MouseEvent));
    root.addEventListener('keydown', (e) => this.handleKeydown(e as KeyboardEvent));
    root.addEventListener('pointerover', (e) => this.handlePointerOver(e as PointerEvent));
    return root;
  }

  // ---- rendering ----------------------------------------------------------

  protected override render(): void {
    if (this.activeId === undefined) this.initState();
    const variant = this.config.variant ?? 'menu';
    const items = this.config.items ?? [];

    this.el.className = [
      'jects-menu',
      `jects-menu--${variant}`,
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');
    this.el.setAttribute('role', variant === 'menubar' ? 'menubar' : 'menu');
    this.el.setAttribute('aria-orientation', variant === 'menubar' ? 'horizontal' : 'vertical');
    this.el.setAttribute('aria-label', this.config.label ?? 'Menu');

    // Only currently-visible (ancestors all open) focusable items can hold the
    // roving tab stop, so exactly one rendered item carries tabindex=0.
    const focusables = this.flatten(items).filter(
      (f) => this.isFocusable(f.item) && this.isVisible(f),
    );
    if (this.activeId === null || !focusables.some((f) => f.id === this.activeId)) {
      this.activeId = focusables[0]?.id ?? null;
    }

    // jects-safe-html: renderItem escapes item.text/shortcut via escapeHtml and ids/submenu label via escapeAttr; icons via renderIcon
    this.el.innerHTML = items.map((item, i) => this.renderItem(item, [i], 0)).join('');
  }

  private renderItem(item: MenuItem, path: number[], depth: number): string {
    if (item.separator) {
      return `<div class="jects-menu__separator" role="separator"></div>`;
    }
    const id = this.idForPath(item, path);
    const hasChildren = !!item.children && item.children.length > 0;
    const disabled = !!item.disabled;
    const isActive = this.activeId === id;
    const checkable = !!item.checkable;
    const checked = checkable ? this.isChecked(id, item) : false;
    const isOpen = hasChildren && this.openSubmenus.has(id);

    const role = checkable ? 'menuitemcheckbox' : 'menuitem';
    const parts: string[] = [];

    if (checkable) {
      parts.push(
        `<span class="jects-menu__check" aria-hidden="true">${checked ? renderIcon('check', { size: 14 }) : ''}</span>`,
      );
    } else if (item.icon) {
      parts.push(
        `<span class="jects-menu__icon" aria-hidden="true">${renderIcon(item.icon, { size: 16 })}</span>`,
      );
    }
    parts.push(`<span class="jects-menu__label">${escapeHtml(item.text ?? '')}</span>`);
    if (item.shortcut) {
      parts.push(`<span class="jects-menu__shortcut" aria-hidden="true">${escapeHtml(item.shortcut)}</span>`);
    }
    if (hasChildren) {
      parts.push(
        `<span class="jects-menu__arrow" aria-hidden="true">${renderIcon('chevron-right', { size: 14 })}</span>`,
      );
    }

    const attrs = [
      `class="jects-menu__item${isActive ? ' jects-menu__item--active' : ''}${disabled ? ' jects-menu__item--disabled' : ''}${hasChildren ? ' jects-menu__item--has-submenu' : ''}"`,
      `role="${role}"`,
      `data-id="${escapeAttr(id)}"`,
      `tabindex="${isActive ? 0 : -1}"`,
      disabled ? 'aria-disabled="true"' : '',
      checkable ? `aria-checked="${checked}"` : '',
      hasChildren ? `aria-haspopup="true" aria-expanded="${isOpen}"` : '',
    ]
      .filter(Boolean)
      .join(' ');

    let submenu = '';
    if (hasChildren) {
      submenu = [
        `<div class="jects-menu__submenu${isOpen ? ' jects-menu__submenu--open' : ''}" role="menu" aria-label="${escapeAttr(item.text ?? 'Submenu')}"${isOpen ? '' : ' hidden'}>`,
        item.children!.map((c, i) => this.renderItem(c, [...path, i], depth + 1)).join(''),
        `</div>`,
      ].join('');
    }

    return [
      `<div class="jects-menu__node" data-node="${escapeAttr(id)}">`,
      `<div ${attrs}>`,
      ...parts,
      `</div>`,
      submenu,
      `</div>`,
    ].join('');
  }

  // ---- state --------------------------------------------------------------

  private initState(): void {
    this.activeId = null;
    this.openSubmenus = new Set<string>();
    this.checkedState = new Map<string, boolean>();
    this.typeahead = '';
    this.typeaheadAt = 0;
  }

  private idForPath(item: MenuItem, path: number[]): string {
    return item.id ?? `it-${path.join('-')}`;
  }

  private isFocusable(item: MenuItem): boolean {
    return !item.separator && !item.disabled;
  }

  /** True when every ancestor submenu of `f` is currently open (so it renders). */
  private isVisible(f: FlatItem): boolean {
    const all = this.flatten(this.config.items ?? []);
    for (let depth = 1; depth < f.path.length; depth++) {
      const ancestorPath = f.path.slice(0, depth);
      const ancestor = all.find((x) => x.path.join('-') === ancestorPath.join('-'));
      if (!ancestor || !this.openSubmenus.has(ancestor.id)) return false;
    }
    return true;
  }

  private isChecked(id: string, item: MenuItem): boolean {
    return this.checkedState.has(id) ? this.checkedState.get(id)! : !!item.checked;
  }

  /** Depth-first flat list of items (with stable id + path). */
  private flatten(items: MenuItem[], path: number[] = []): FlatItem[] {
    const out: FlatItem[] = [];
    items.forEach((item, i) => {
      const p = [...path, i];
      const id = this.idForPath(item, p);
      out.push({ id, item, path: p });
      if (item.children) out.push(...this.flatten(item.children, p));
    });
    return out;
  }

  private find(id: string): FlatItem | undefined {
    return this.flatten(this.config.items ?? []).find((f) => f.id === id);
  }

  /** Visible, focusable items at the current open level around `id`. */
  private siblingsOf(id: string): FlatItem[] {
    const target = this.find(id);
    if (!target) return [];
    const parentPath = target.path.slice(0, -1);
    return this.flatten(this.config.items ?? [])
      .filter(
        (f) =>
          f.path.length === target.path.length &&
          f.path.slice(0, -1).join('-') === parentPath.join('-') &&
          this.isFocusable(f.item),
      );
  }

  // ---- interaction --------------------------------------------------------

  private handleClick(event: MouseEvent): void {
    const el = (event.target as HTMLElement).closest<HTMLElement>('.jects-menu__item');
    if (!el) return;
    const id = el.dataset['id'];
    if (!id) return;
    const found = this.find(id);
    if (!found || found.item.disabled) return;
    this.activate(found);
  }

  private handlePointerOver(event: PointerEvent): void {
    const el = (event.target as HTMLElement).closest<HTMLElement>('.jects-menu__item');
    if (!el) return;
    const id = el.dataset['id'];
    if (!id) return;
    const found = this.find(id);
    if (found && this.isFocusable(found.item)) this.setActive(id, false);
  }

  private activate(found: FlatItem): void {
    const { item, id } = found;
    if (item.children && item.children.length) {
      this.toggleSubmenu(id);
      return;
    }
    if (item.checkable) {
      const next = !this.isChecked(id, item);
      this.checkedState.set(id, next);
      this.render();
      this.emit('check', { id, item, checked: next, menu: this });
    }
    if (this.emit('beforeSelect', { id, item, menu: this }) === false) return;
    this.emit('select', { id, item, menu: this });
  }

  private toggleSubmenu(id: string): void {
    const found = this.find(id);
    if (!found) return;
    const open = !this.openSubmenus.has(id);
    if (open) this.openSubmenus.add(id);
    else this.closeSubmenuTree(id);
    this.setActive(id, true);
    this.emit('submenu', { id, item: found.item, open, menu: this });
  }

  private closeSubmenuTree(id: string): void {
    const prefix = id;
    // Close this submenu and any of its descendants.
    for (const open of [...this.openSubmenus]) {
      const f = this.find(open);
      if (open === id || (f && this.find(prefix) && this.isDescendant(prefix, open))) {
        this.openSubmenus.delete(open);
      }
    }
  }

  private isDescendant(ancestorId: string, candidateId: string): boolean {
    const a = this.find(ancestorId);
    const c = this.find(candidateId);
    if (!a || !c) return false;
    return c.path.length > a.path.length && c.path.slice(0, a.path.length).join('-') === a.path.join('-');
  }

  private setActive(id: string, focus: boolean): void {
    this.activeId = id;
    this.render();
    if (focus) {
      const node = this.el.querySelector<HTMLElement>(
        `.jects-menu__item[data-id="${cssEscape(id)}"]`,
      );
      node?.focus();
    }
  }

  private handleKeydown(event: KeyboardEvent): void {
    const horizontal = (this.config.variant ?? 'menu') === 'menubar';
    const active = this.activeId;
    if (!active) return;
    const found = this.find(active);
    if (!found) return;
    const siblings = this.siblingsOf(active);
    const idx = siblings.findIndex((f) => f.id === active);

    const nextKey = horizontal ? 'ArrowRight' : 'ArrowDown';
    const prevKey = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const openKey = horizontal ? 'ArrowDown' : 'ArrowRight';
    const closeKey = horizontal ? 'ArrowUp' : 'ArrowLeft';

    switch (event.key) {
      case nextKey:
        event.preventDefault();
        this.move(siblings, idx, 1);
        break;
      case prevKey:
        event.preventDefault();
        this.move(siblings, idx, -1);
        break;
      case openKey:
        if (found.item.children && found.item.children.length) {
          event.preventDefault();
          this.openAndEnter(active);
        }
        break;
      case closeKey:
        if (found.path.length > 1) {
          event.preventDefault();
          this.exitSubmenu(found);
        }
        break;
      case 'Home':
        event.preventDefault();
        if (siblings[0]) this.setActive(siblings[0].id, true);
        break;
      case 'End':
        event.preventDefault();
        if (siblings.length) this.setActive(siblings[siblings.length - 1]!.id, true);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.activateActive();
        break;
      case 'Escape':
        event.preventDefault();
        this.handleEscape(found);
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          this.typeAhead(event.key, siblings);
        }
        break;
    }
  }

  /**
   * Escape behavior: collapse the deepest open submenu and move focus to its
   * parent. When nothing is open at the outermost level, emit a dedicated
   * `dismiss` event so hosts (ContextMenu, Toolbar overflow, …) can close.
   */
  private handleEscape(found: FlatItem): void {
    // Focus is inside an open submenu: collapse it, return focus to the parent.
    if (found.path.length > 1) {
      this.exitSubmenu(found);
      return;
    }
    // Focus is on a top-level item that has its own submenu open: collapse it.
    if (this.openSubmenus.has(found.id)) {
      this.closeSubmenuTree(found.id);
      this.emit('submenu', { id: found.id, item: found.item, open: false, menu: this });
      this.setActive(found.id, true);
      return;
    }
    // Outermost level with nothing open: request dismissal.
    this.emit('dismiss', { menu: this });
  }

  private move(siblings: FlatItem[], idx: number, dir: 1 | -1): void {
    if (!siblings.length) return;
    const start = idx < 0 ? 0 : idx;
    const next = (start + dir + siblings.length) % siblings.length;
    this.setActive(siblings[next]!.id, true);
  }

  private openAndEnter(id: string): void {
    this.openSubmenus.add(id);
    const child = this.flatten(this.config.items ?? []).find(
      (f) => this.isDescendant(id, f.id) && f.path.length === (this.find(id)?.path.length ?? 0) + 1 && this.isFocusable(f.item),
    );
    const found = this.find(id);
    if (found) this.emit('submenu', { id, item: found.item, open: true, menu: this });
    if (child) this.setActive(child.id, true);
    else this.render();
  }

  private exitSubmenu(found: FlatItem): void {
    const parentPath = found.path.slice(0, -1);
    const parent = this.flatten(this.config.items ?? []).find(
      (f) => f.path.join('-') === parentPath.join('-'),
    );
    if (parent) {
      this.closeSubmenuTree(parent.id);
      this.emit('submenu', { id: parent.id, item: parent.item, open: false, menu: this });
      this.setActive(parent.id, true);
    }
  }

  private activateActive(): void {
    if (!this.activeId) return;
    const found = this.find(this.activeId);
    if (found && this.isFocusable(found.item)) this.activate(found);
  }

  private typeAhead(ch: string, siblings: FlatItem[]): void {
    const now = Date.now();
    if (now - this.typeaheadAt > 600) this.typeahead = '';
    this.typeaheadAt = now;
    this.typeahead += ch.toLowerCase();
    const match = siblings.find((f) => (f.item.text ?? '').toLowerCase().startsWith(this.typeahead));
    if (match) this.setActive(match.id, true);
  }

  // ---- public API ---------------------------------------------------------

  /** Programmatically open a submenu by item id. */
  openSubmenuById(id: string): this {
    if (!this.openSubmenus.has(id)) this.toggleSubmenu(id);
    return this;
  }

  /** Close all open submenus. */
  closeAll(): this {
    this.openSubmenus.clear();
    this.render();
    return this;
  }

  /** Current checked state for a checkable item. */
  isItemChecked(id: string): boolean {
    const found = this.find(id);
    return found ? this.isChecked(id, found.item) : false;
  }

  /** Move keyboard focus to the first focusable item. */
  focusFirst(): this {
    const first = this.flatten(this.config.items ?? []).find((f) => this.isFocusable(f.item));
    if (first) this.setActive(first.id, true);
    return this;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

register(
  'menu',
  Menu as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Menu,
);
