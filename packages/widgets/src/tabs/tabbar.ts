/**
 * Tabbar — a horizontal tab strip implementing the WAI-ARIA Tabs pattern.
 *
 * - role="tablist" on the root; each tab is role="tab" with aria-selected and
 *   roving tabindex (only the active tab is tabbable).
 * - Keyboard: ArrowLeft/Right (and Home/End) move the active tab following the
 *   automatic-activation pattern; Delete removes a closable tab.
 * - Overflow: when tabs exceed the available width the strip scrolls
 *   horizontally and the active tab is scrolled into view.
 * - Closable tabs render an inline close affordance; closing is vetoable.
 *
 * CSS lives in tabbar.css (token-only, @layer jects.components).
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register, setHtml, trustedHtml } from '@jects/core';
import { renderIcon } from '@jects/icons';

export interface TabItem {
  /** Stable identifier (also used to key panels in TabPanel). */
  id: string;
  /** Visible label. */
  label: string;
  /** Disabled tabs are skipped by keyboard navigation and not selectable. */
  disabled?: boolean;
  /** Show an inline close button on this tab. */
  closable?: boolean;
}

export interface TabbarConfig extends WidgetConfig {
  /** The tabs to display. */
  items?: TabItem[];
  /** Active tab id. Defaults to the first enabled tab. */
  active?: string;
  /** Make all tabs closable (per-item `closable` overrides this). */
  closable?: boolean;
  /** Accessible label for the tablist. */
  ariaLabel?: string;
  /**
   * Emit `aria-controls` on each tab pointing at its panel (`{id}-panel-{tabId}`).
   * Only enable this when a matching tabpanel element actually exists in the DOM
   * (e.g. when driven by {@link TabPanel}); otherwise the IDREF dangles and axe
   * flags it. Default `false` (standalone Tabbar with no panels). */
  controlsPanels?: boolean;
  /** Convenience handler (also via `.on('change', ...)`). */
  onChange?: (id: string) => void;
}

export interface TabbarEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel activating a tab. */
  beforeChange: { id: string; tabbar: Tabbar };
  /** Fired after the active tab changes. */
  change: { id: string; previous: string | undefined; tabbar: Tabbar };
  /** Vetoable: return `false` to cancel closing a tab. */
  beforeClose: { id: string; tabbar: Tabbar };
  /** Fired after a tab is closed/removed. */
  close: { id: string; tabbar: Tabbar };
}

export class Tabbar extends Widget<TabbarConfig, TabbarEvents> {
  protected override defaults(): Partial<TabbarConfig> {
    return { items: [], closable: false };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', {
      className: 'jects-tabbar',
      attrs: { role: 'tablist' },
    });
    // Bound-method listeners (NOT class-field arrows): super() runs buildEl()
    // before subclass field initializers.
    root.addEventListener('click', (e) => this.handleClick(e));
    root.addEventListener('keydown', (e) => this.handleKeydown(e));
    return root;
  }

  private items(): TabItem[] {
    return this.config.items ?? [];
  }

  /** The id used for a tab's element (so panels can reference it). */
  tabElementId(id: string): string {
    return `${this.id}-tab-${id}`;
  }

  /** The currently active tab id (resolved against items). */
  get active(): string | undefined {
    const items = this.items();
    const wanted = this.config.active;
    if (wanted !== undefined && items.some((t) => t.id === wanted && !t.disabled)) return wanted;
    return items.find((t) => !t.disabled)?.id;
  }

  /** Programmatically activate a tab (fires events, respects veto). */
  activate(id: string): this {
    const item = this.items().find((t) => t.id === id);
    if (!item || item.disabled) return this;
    const previous = this.active;
    if (id === previous) return this;
    if (this.emit('beforeChange', { id, tabbar: this }) === false) return this;
    this.config = { ...this.config, active: id };
    this.render();
    this.config.onChange?.(id);
    this.emit('change', { id, previous, tabbar: this });
    return this;
  }

  /** Close (remove) a tab by id (fires events, respects veto). */
  close(id: string): this {
    const items = this.items();
    const idx = items.findIndex((t) => t.id === id);
    if (idx < 0) return this;
    if (this.emit('beforeClose', { id, tabbar: this }) === false) return this;

    const wasActive = this.active === id;
    const next = items.filter((t) => t.id !== id);
    let active = this.config.active;
    if (wasActive) {
      // Move activation to the nearest enabled neighbour.
      const after = next.slice(idx).find((t) => !t.disabled);
      const before = next
        .slice(0, idx)
        .reverse()
        .find((t) => !t.disabled);
      active = (after ?? before)?.id;
    }
    const cfg = { ...this.config, items: next };
    if (active === undefined) delete cfg.active;
    else cfg.active = active;
    this.config = cfg;
    this.render();
    this.emit('close', { id, tabbar: this });
    return this;
  }

  private handleClick(e: MouseEvent): void {
    const target = e.target as Element | null;
    if (!target) return;
    const closeBtn = target.closest('.jects-tabbar__close') as HTMLElement | null;
    if (closeBtn) {
      e.stopPropagation();
      const id = closeBtn.dataset.id;
      if (id) this.close(id);
      return;
    }
    const tab = target.closest('.jects-tabbar__tab') as HTMLElement | null;
    if (!tab || tab.getAttribute('aria-disabled') === 'true') return;
    const id = tab.dataset.id;
    if (id) this.activate(id);
  }

  private handleKeydown(e: KeyboardEvent): void {
    const items = this.items();
    if (items.length === 0) return;
    const current = this.active;
    const currentIdx = items.findIndex((t) => t.id === current);

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        this.moveActive(currentIdx, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        this.moveActive(currentIdx, -1);
        break;
      case 'Home':
        e.preventDefault();
        this.activateFirstEnabled();
        break;
      case 'End':
        e.preventDefault();
        this.activateLastEnabled();
        break;
      case 'Delete': {
        const item = items[currentIdx];
        if (item && (item.closable ?? this.config.closable)) {
          e.preventDefault();
          this.close(item.id);
        }
        break;
      }
      default:
        break;
    }
  }

  private moveActive(fromIdx: number, dir: 1 | -1): void {
    const items = this.items();
    if (items.length === 0) return;
    let i = fromIdx < 0 ? (dir === 1 ? -1 : 0) : fromIdx;
    for (let step = 0; step < items.length; step++) {
      i = (i + dir + items.length) % items.length;
      if (!items[i]!.disabled) {
        this.activate(items[i]!.id);
        this.focusActiveTab();
        return;
      }
    }
  }

  private activateFirstEnabled(): void {
    const first = this.items().find((t) => !t.disabled);
    if (first) {
      this.activate(first.id);
      this.focusActiveTab();
    }
  }

  private activateLastEnabled(): void {
    const items = this.items();
    for (let i = items.length - 1; i >= 0; i--) {
      if (!items[i]!.disabled) {
        this.activate(items[i]!.id);
        this.focusActiveTab();
        return;
      }
    }
  }

  private focusActiveTab(): void {
    const active = this.active;
    if (active === undefined) return;
    const el = this.el.querySelector<HTMLElement>(`#${cssId(this.tabElementId(active))}`);
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  protected override render(): void {
    const { ariaLabel, controlsPanels = false } = this.config;
    const items = this.items();
    const active = this.active;

    const el = this.el;
    el.className = ['jects-tabbar', this.config.cls ?? ''].filter(Boolean).join(' ');
    if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
    else el.removeAttribute('aria-label');

    setHtml(el, trustedHtml(items
      .map((t) => {
        const selected = t.id === active;
        const disabled = !!t.disabled;
        const closable = t.closable ?? this.config.closable ?? false;
        const tabId = this.tabElementId(t.id);
        // The tab is a <button role="tab">. The close affordance is rendered as a
        // DECORATIVE, aria-hidden span (NOT role=button, NOT focusable): nesting
        // an interactive control inside the tab button is invalid (axe
        // nested-interactive) and would pollute the tab's accessible name.
        // Closing is exposed to assistive tech via the Delete key, advertised
        // with aria-keyshortcuts on the tab; the span is a pointer convenience.
        return [
          `<button class="jects-tabbar__tab${selected ? ' jects-tabbar__tab--active' : ''}${disabled ? ' jects-tabbar__tab--disabled' : ''}${closable ? ' jects-tabbar__tab--closable' : ''}"`,
          ` id="${escapeAttr(tabId)}" role="tab" type="button"`,
          ` data-id="${escapeAttr(t.id)}"`,
          ` aria-selected="${selected}"`,
          // Only reference a panel when one is guaranteed to exist (TabPanel),
          // otherwise the IDREF dangles (axe aria-valid-attr-value).
          controlsPanels
            ? ` aria-controls="${escapeAttr(panelElementId(this.id, t.id))}"`
            : '',
          ` tabindex="${selected && !disabled ? '0' : '-1'}"`,
          closable ? ' aria-keyshortcuts="Delete"' : '',
          disabled ? ' aria-disabled="true"' : '',
          '>',
          `<span class="jects-tabbar__label">${escapeHtml(t.label)}</span>`,
          closable
            ? `<span class="jects-tabbar__close" data-id="${escapeAttr(t.id)}" aria-hidden="true">${renderIcon('x', { size: 14 })}</span>`
            : '',
          '</button>',
        ].join('');
      })
      .join('')));
  }
}

/** Shared panel id helper so Tabbar tabs can point `aria-controls` at panels. */
export function panelElementId(widgetId: string, tabId: string): string {
  return `${widgetId}-panel-${tabId}`;
}

function cssId(id: string): string {
  // Escape an id for use in a querySelector `#...` selector.
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(id);
  return id.replace(/([^\w-])/g, '\\$1');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

register(
  'tabbar',
  Tabbar as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Tabbar,
);
