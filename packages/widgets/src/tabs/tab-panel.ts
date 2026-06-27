/**
 * TabPanel — a Tabbar wired to a set of content panels (the full Tabs widget).
 *
 * Composes a {@link Tabbar} (the tab strip) above a panel region. Each panel is
 * role="tabpanel", labelled by its tab (aria-labelledby) and referenced from the
 * tab via aria-controls. Only the active panel is shown; the rest are hidden.
 *
 * Lazy rendering: with `lazy: true` (default) a panel's content is only
 * materialised the first time it becomes active, and (with `keepAlive: false`)
 * inactive panels can be torn down again. Content is supplied per-tab as a
 * string, a Node, or a factory `(host) => void` invoked with the panel element.
 *
 * CSS lives in tab-panel.css (token-only, @layer jects.components).
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  createEl,
  register,
  setHtml,
  safeHtml,
  trustedHtml,
} from '@jects/core';
import { Tabbar, type TabItem, type TabbarConfig, panelElementId } from './tabbar.js';

export type TabPanelContent = string | Node | ((host: HTMLElement) => void);

export interface TabPanelItem extends TabItem {
  /**
   * Panel content: an HTML string, a Node, or a factory called with the panel
   * host. A string is treated as authored HTML and sanitized through the shared
   * `@jects/core` allow-list sanitizer before insertion (unless the TabPanel is
   * configured `trusted: true`). For full control, pass a Node or a factory.
   */
  content?: TabPanelContent;
}

export interface TabPanelConfig extends WidgetConfig {
  /** Tabs and their panel content. */
  items?: TabPanelItem[];
  /** Active tab id. Defaults to the first enabled tab. */
  active?: string;
  /** Make all tabs closable (per-item `closable` overrides this). */
  closable?: boolean;
  /** Accessible label for the tablist. */
  ariaLabel?: string;
  /** Only render a panel's content once it first becomes active. Default `true`. */
  lazy?: boolean;
  /** Keep rendered panels in the DOM (hidden) once built. Default `true`. */
  keepAlive?: boolean;
  /** Opt out of HTML sanitization for string panel `content`. Default `false`. */
  trusted?: boolean;
  /** Convenience handler (also via `.on('change', ...)`). */
  onChange?: (id: string) => void;
}

export interface TabPanelEvents extends WidgetEvents {
  beforeChange: { id: string; tabPanel: TabPanel };
  change: { id: string; previous: string | undefined; tabPanel: TabPanel };
  beforeClose: { id: string; tabPanel: TabPanel };
  close: { id: string; tabPanel: TabPanel };
}

export class TabPanel extends Widget<TabPanelConfig, TabPanelEvents> {
  // NOTE: these are intentionally NOT class-field initializers. `super()` runs
  // buildEl()/render() (which assign them) BEFORE subclass field initializers,
  // so declaring `= undefined`/`= new Set()` here would clobber those
  // assignments. Declared via `declare` (type-only, no runtime initializer).
  private declare _tabbar?: Tabbar;
  private declare _panels?: HTMLElement;
  /** Ids of panels whose content has already been materialised. */
  private declare _rendered?: Set<string>;

  private get rendered(): Set<string> {
    return (this._rendered ??= new Set<string>());
  }

  protected override defaults(): Partial<TabPanelConfig> {
    return { items: [], closable: false, lazy: true, keepAlive: true };
  }

  protected buildEl(): HTMLElement {
    return createEl('div', { className: 'jects-tabpanel' });
  }

  private items(): TabPanelItem[] {
    return this.config.items ?? [];
  }

  /** The active tab id (delegated to the inner Tabbar once built). */
  get active(): string | undefined {
    return this._tabbar?.active;
  }

  /** The inner Tabbar instance. */
  get tabbar(): Tabbar | undefined {
    return this._tabbar;
  }

  /** Programmatically activate a tab. */
  activate(id: string): this {
    this._tabbar?.activate(id);
    return this;
  }

  /** Close a tab + its panel. */
  close(id: string): this {
    this._tabbar?.close(id);
    return this;
  }

  protected override render(): void {
    const el = this.el;
    el.className = ['jects-tabpanel', this.config.cls ?? ''].filter(Boolean).join(' ');

    // Build the strip + panel region once; subsequent renders sync them.
    if (!this._tabbar) {
      const strip = createEl('div', { className: 'jects-tabpanel__strip' });
      const panels = createEl('div', { className: 'jects-tabpanel__panels' });
      el.append(strip, panels);
      this._panels = panels;
      this._tabbar = new Tabbar(strip, this.tabbarConfig());
      this._tabbar.on('change', ({ id, previous }) => {
        this.config = { ...this.config, active: id };
        this.syncPanels();
        this.config.onChange?.(id);
        this.emit('change', { id, previous, tabPanel: this });
      });
      this._tabbar.on('beforeChange', ({ id }) =>
        this.emit('beforeChange', { id, tabPanel: this }),
      );
      this._tabbar.on('beforeClose', ({ id }) =>
        this.emit('beforeClose', { id, tabPanel: this }),
      );
      this._tabbar.on('close', ({ id }) => {
        this.removePanel(id);
        this.config = { ...this.config, items: this._tabbar!.getConfig().items as TabPanelItem[] };
        this.syncPanels();
        this.emit('close', { id, tabPanel: this });
      });
    } else {
      // Patch the inner Tabbar with current config (items/active/etc.).
      this._tabbar.update(this.tabbarConfig());
    }

    this.syncPanels();
  }

  /** Build a Tabbar config from the current config, omitting undefined optionals. */
  private tabbarConfig(): TabbarConfig {
    // Panels always exist (as shells) when driven by TabPanel, so it is safe and
    // correct for the tabs to reference them via aria-controls.
    const cfg: TabbarConfig = { items: this.items(), controlsPanels: true };
    if (this.config.active !== undefined) cfg.active = this.config.active;
    if (this.config.closable !== undefined) cfg.closable = this.config.closable;
    if (this.config.ariaLabel !== undefined) cfg.ariaLabel = this.config.ariaLabel;
    return cfg;
  }

  /** Create/update/show/hide panel elements to match items + active tab. */
  private syncPanels(): void {
    const panels = this._panels!;
    const items = this.items();
    const active = this.active;
    const lazy = this.config.lazy ?? true;
    const keepAlive = this.config.keepAlive ?? true;
    const tabbar = this._tabbar!;

    // Remove panels whose tab no longer exists.
    const validIds = new Set(items.map((t) => t.id));
    panels.querySelectorAll<HTMLElement>('.jects-tabpanel__panel').forEach((p) => {
      const id = p.dataset.id;
      if (!id || !validIds.has(id)) {
        if (id) this.rendered.delete(id);
        p.remove();
      }
    });

    for (const item of items) {
      const isActive = item.id === active;
      // Always keep a real panel element (a shell) in the DOM for every tab, so
      // each tab's `aria-controls` resolves to an existing id even under lazy
      // mode. Only the panel *content* is materialised lazily.
      let panel = panels.querySelector<HTMLElement>(
        `.jects-tabpanel__panel[data-id="${cssAttr(item.id)}"]`,
      );
      if (!panel) {
        panel = this.buildPanelShell(item, tabbar);
        panels.append(panel);
      }

      // Materialise content when eager, when active, or once already built.
      const shouldFill = !lazy || isActive || this.rendered.has(item.id);
      if (shouldFill && !this.rendered.has(item.id)) {
        this.fillPanel(panel, item.content);
        this.rendered.add(item.id);
      }

      // Tear down inactive panel *content* (not the shell) when keepAlive is off,
      // so aria-controls stays valid while the heavy content is released.
      if (!isActive && !keepAlive && lazy && this.rendered.has(item.id)) {
        this.rendered.delete(item.id);
        panel.replaceChildren();
      }

      panel.hidden = !isActive;
      panel.setAttribute('aria-hidden', String(!isActive));
      panel.tabIndex = isActive ? 0 : -1;
    }
  }

  /**
   * Create an empty panel shell (role=tabpanel, labelled by its tab). Content is
   * filled separately so it can be deferred under lazy mode.
   */
  private buildPanelShell(item: TabPanelItem, tabbar: Tabbar): HTMLElement {
    const panel = createEl('div', {
      className: 'jects-tabpanel__panel',
      attrs: {
        role: 'tabpanel',
        id: panelElementId(tabbar.id, item.id),
        'aria-labelledby': tabbar.tabElementId(item.id),
      },
    });
    panel.dataset.id = item.id;
    return panel;
  }

  private fillPanel(panel: HTMLElement, content: TabPanelContent | undefined): void {
    if (content == null) return;
    if (typeof content === 'function') {
      content(panel);
    } else if (typeof content === 'string') {
      // A string is authored HTML → sanitized by default; only the explicit
      // `trusted` opt-out injects it raw.
      setHtml(panel, this.config.trusted ? trustedHtml(content) : safeHtml(content));
    } else {
      panel.append(content);
    }
  }

  private removePanel(id: string): void {
    this.rendered.delete(id);
    this._panels
      ?.querySelector(`.jects-tabpanel__panel[data-id="${cssAttr(id)}"]`)
      ?.remove();
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    this._tabbar?.destroy();
    super.destroy();
  }
}

function cssAttr(s: string): string {
  return s.replace(/(["\\])/g, '\\$1');
}

register(
  'tabpanel',
  TabPanel as unknown as new (
    host: HTMLElement | string,
    config?: Record<string, unknown>,
  ) => TabPanel,
);
