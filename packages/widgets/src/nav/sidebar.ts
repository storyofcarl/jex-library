/**
 * Sidebar — a vertical, collapsible navigation rail.
 *
 * Supports nested item groups (expand/collapse), an active item, and a
 * mini / expanded mode toggle. Uses ARIA `navigation` + a `tree`-style item
 * list with roving tabindex and full keyboard support (ArrowUp/Down to move,
 * ArrowRight/Left to expand/collapse groups, Enter/Space to activate, Home/End).
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
  setHtml,
  trustedHtml,
} from '@jects/core';
import { renderIcon, type IconName } from '@jects/icons';

export interface SidebarItem {
  /** Stable id, echoed on events. */
  id: string;
  /** Visible label. */
  text: string;
  /** Leading icon. */
  icon?: IconName;
  /** Optional trailing badge text. */
  badge?: string;
  /** Disabled. */
  disabled?: boolean;
  /** Child items — turns this into an expandable group. */
  children?: SidebarItem[];
  /** Arbitrary user payload. */
  data?: unknown;
}

export interface SidebarConfig extends WidgetConfig {
  /** Item tree. */
  items?: SidebarItem[];
  /** Active item id. */
  active?: string;
  /** Start collapsed into mini mode (icons only). Default `false`. */
  collapsed?: boolean;
  /** Ids of groups expanded initially. */
  expanded?: string[];
  /** Header label / brand text. */
  title?: string;
  /** Accessible name (`aria-label`). Default `'Sidebar'`. */
  label?: string;
}

export interface SidebarEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel activation. */
  beforeSelect: { id: string; item: SidebarItem; sidebar: Sidebar };
  select: { id: string; item: SidebarItem; sidebar: Sidebar };
  toggle: { id: string; item: SidebarItem; expanded: boolean; sidebar: Sidebar };
  collapse: { collapsed: boolean; sidebar: Sidebar };
}

interface FlatNode {
  id: string;
  item: SidebarItem;
  depth: number;
  isGroup: boolean;
}

export class Sidebar extends Widget<SidebarConfig, SidebarEvents> {
  private declare activeId: string | null;
  private declare expandedSet: Set<string>;
  private declare focusId: string | null;
  private declare collapsedState: boolean;

  protected override defaults(): Partial<SidebarConfig> {
    return { items: [], collapsed: false, label: 'Sidebar' };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('nav', { className: 'jects-sidebar' });
    root.addEventListener('click', (e) => this.handleClick(e as MouseEvent));
    root.addEventListener('keydown', (e) => this.handleKeydown(e as KeyboardEvent));
    return root;
  }

  protected override render(): void {
    if (this.activeId === undefined) this.initState();
    const collapsed = this.collapsedState;
    const items = this.config.items ?? [];

    this.el.className = [
      'jects-sidebar',
      collapsed ? 'jects-sidebar--collapsed' : 'jects-sidebar--expanded',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');
    this.el.setAttribute('aria-label', this.config.label ?? 'Sidebar');

    const focusables = this.visibleNodes();
    if (this.focusId === null || !focusables.some((f) => f.id === this.focusId)) {
      this.focusId = focusables[0]?.id ?? null;
    }

    const header = this.config.title
      ? `<div class="jects-sidebar__header"><span class="jects-sidebar__title">${escapeHtml(this.config.title)}</span></div>`
      : '';

    // Toggle lives outside the roving tree, so it is a normal tab stop
    // (tabindex 0) — the only keyboard path to collapse/expand the sidebar.
    const toggle = `<button type="button" class="jects-sidebar__toggle" tabindex="0" aria-label="${collapsed ? 'Expand sidebar' : 'Collapse sidebar'}" aria-pressed="${collapsed}" data-toggle="collapse">${renderIcon(collapsed ? 'chevron-right' : 'chevron-left', { size: 16 })}</button>`;

    const list = `<ul class="jects-sidebar__list" role="tree">${items
      .map((item) => this.renderItem(item, 1))
      .join('')}</ul>`;

    setHtml(this.el, trustedHtml(`${header}${list}<div class="jects-sidebar__footer">${toggle}</div>`));
  }

  private renderItem(item: SidebarItem, depth: number): string {
    const isGroup = !!item.children && item.children.length > 0;
    const expanded = isGroup && this.expandedSet.has(item.id);
    const isActive = this.activeId === item.id;
    const isFocus = this.focusId === item.id;
    const disabled = !!item.disabled;
    const collapsed = this.collapsedState;

    const icon = item.icon
      ? `<span class="jects-sidebar__icon" aria-hidden="true">${renderIcon(item.icon, { size: 18 })}</span>`
      : `<span class="jects-sidebar__icon jects-sidebar__icon--empty" aria-hidden="true"></span>`;
    const label = `<span class="jects-sidebar__label">${escapeHtml(item.text)}</span>`;
    const badge = item.badge
      ? `<span class="jects-sidebar__badge">${escapeHtml(item.badge)}</span>`
      : '';
    const caret = isGroup
      ? `<span class="jects-sidebar__caret" aria-hidden="true">${renderIcon(expanded ? 'chevron-down' : 'chevron-right', { size: 14 })}</span>`
      : '';

    const attrs = [
      `class="jects-sidebar__item${isActive ? ' jects-sidebar__item--active' : ''}${disabled ? ' jects-sidebar__item--disabled' : ''}${isGroup ? ' jects-sidebar__item--group' : ''}"`,
      `role="treeitem"`,
      `data-id="${escapeAttr(item.id)}"`,
      `aria-level="${depth}"`,
      `tabindex="${isFocus ? 0 : -1}"`,
      isActive ? 'aria-current="page"' : '',
      disabled ? 'aria-disabled="true"' : '',
      isGroup ? `aria-expanded="${expanded}"` : '',
      // In mini mode the visible label is omitted, so name the treeitem for AT.
      collapsed
        ? `aria-label="${escapeAttr(item.badge ? `${item.text} (${item.badge})` : item.text)}"`
        : '',
      `title="${escapeAttr(item.text)}"`,
      `style="padding-inline-start: calc(${depth} * var(--jects-space-2));"`,
    ]
      .filter(Boolean)
      .join(' ');

    const inner = `<div ${attrs}>${icon}${collapsed ? '' : label}${collapsed ? '' : badge}${collapsed ? '' : caret}</div>`;

    let sub = '';
    if (isGroup && expanded && !collapsed) {
      // `role="none"` on the <ul> removes its implicit list role so the tree's
      // treeitem children remain valid; the treeitem carries aria-expanded and
      // owns the group via DOM nesting.
      sub = `<ul class="jects-sidebar__sublist" role="group">${item.children!
        .map((c) => this.renderItem(c, depth + 1))
        .join('')}</ul>`;
    }
    // `role="none"` strips the <li>'s implicit listitem role so the treeitem
    // div is a direct (logical) child of role="tree" / role="group" (axe:
    // aria-required-children / aria-required-parent / listitem).
    return `<li class="jects-sidebar__node" role="none">${inner}${sub}</li>`;
  }

  // ---- state --------------------------------------------------------------

  private initState(): void {
    this.activeId = this.config.active ?? null;
    this.expandedSet = new Set(this.config.expanded ?? []);
    this.collapsedState = !!this.config.collapsed;
    this.focusId = null;
  }

  /** Flattened currently-visible nodes (respecting collapse / expansion). */
  private visibleNodes(): FlatNode[] {
    const out: FlatNode[] = [];
    const walk = (items: SidebarItem[], depth: number): void => {
      for (const item of items) {
        if (item.disabled) continue;
        const isGroup = !!item.children && item.children.length > 0;
        out.push({ id: item.id, item, depth, isGroup });
        if (isGroup && this.expandedSet.has(item.id) && !this.collapsedState) {
          walk(item.children!, depth + 1);
        }
      }
    };
    walk(this.config.items ?? [], 1);
    return out;
  }

  private findItem(id: string): SidebarItem | undefined {
    const find = (items: SidebarItem[]): SidebarItem | undefined => {
      for (const item of items) {
        if (item.id === id) return item;
        if (item.children) {
          const r = find(item.children);
          if (r) return r;
        }
      }
      return undefined;
    };
    return find(this.config.items ?? []);
  }

  // ---- interaction --------------------------------------------------------

  private handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('[data-toggle="collapse"]')) {
      this.setCollapsed(!this.collapsedState);
      return;
    }
    const el = target.closest<HTMLElement>('.jects-sidebar__item');
    if (!el) return;
    const id = el.dataset['id'];
    if (!id) return;
    const item = this.findItem(id);
    if (!item || item.disabled) return;
    this.focusId = id;
    if (item.children && item.children.length) this.toggleGroup(id);
    else this.selectItem(id);
  }

  private handleKeydown(event: KeyboardEvent): void {
    const nodes = this.visibleNodes();
    if (!nodes.length) return;
    let idx = this.focusId ? nodes.findIndex((n) => n.id === this.focusId) : 0;
    if (idx < 0) idx = 0;
    const current = nodes[idx]!;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.setFocus(nodes[Math.min(idx + 1, nodes.length - 1)]!.id);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.setFocus(nodes[Math.max(idx - 1, 0)]!.id);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (current.isGroup && !this.expandedSet.has(current.id)) this.toggleGroup(current.id);
        else if (idx + 1 < nodes.length) this.setFocus(nodes[idx + 1]!.id);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (current.isGroup && this.expandedSet.has(current.id)) this.toggleGroup(current.id);
        else {
          const parent = nodes.slice(0, idx).reverse().find((n) => n.depth < current.depth);
          if (parent) this.setFocus(parent.id);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (current.isGroup) this.toggleGroup(current.id);
        else this.selectItem(current.id);
        break;
      case 'Home':
        event.preventDefault();
        this.setFocus(nodes[0]!.id);
        break;
      case 'End':
        event.preventDefault();
        this.setFocus(nodes[nodes.length - 1]!.id);
        break;
      default:
        break;
    }
  }

  private setFocus(id: string): void {
    this.focusId = id;
    this.render();
    this.el
      .querySelector<HTMLElement>(`.jects-sidebar__item[data-id="${cssEscape(id)}"]`)
      ?.focus();
  }

  private toggleGroup(id: string): void {
    const item = this.findItem(id);
    if (!item) return;
    const expanded = !this.expandedSet.has(id);
    if (expanded) this.expandedSet.add(id);
    else this.expandedSet.delete(id);
    this.focusId = id;
    this.render();
    this.emit('toggle', { id, item, expanded, sidebar: this });
  }

  private selectItem(id: string): void {
    const item = this.findItem(id);
    if (!item) return;
    if (this.emit('beforeSelect', { id, item, sidebar: this }) === false) return;
    this.activeId = id;
    this.render();
    this.emit('select', { id, item, sidebar: this });
  }

  // ---- public API ---------------------------------------------------------

  /** Toggle / set mini (collapsed) mode. */
  setCollapsed(collapsed: boolean): this {
    if (this.collapsedState === collapsed) return this;
    this.collapsedState = collapsed;
    this.render();
    this.emit('collapse', { collapsed, sidebar: this });
    return this;
  }

  /** Is the sidebar in mini mode? */
  get collapsed(): boolean {
    return this.collapsedState;
  }

  /** Programmatically set the active item. */
  setActive(id: string): this {
    this.activeId = id;
    this.render();
    return this;
  }

  /** Currently active item id (or null). */
  getActive(): string | null {
    return this.activeId ?? null;
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
  'sidebar',
  Sidebar as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Sidebar,
);
