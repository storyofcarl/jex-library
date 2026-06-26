/**
 * Ribbon — a tabbed command surface (Office-style): a row of tabs, each
 * revealing a panel of labelled command groups built from Wave-1 `Button`s.
 *
 * Tabs use ARIA `tablist`/`tab`/`tabpanel` with roving tabindex and keyboard
 * support (ArrowLeft/Right, Home/End to switch tabs, automatic activation).
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
import type { IconName } from '@jects/icons';

export interface RibbonCommand {
  /** Stable id, echoed on `command`. */
  id: string;
  /** Label (omit for icon-only). */
  text?: string;
  /** Icon. */
  icon?: IconName;
  /** Disabled. */
  disabled?: boolean;
  /** Accessible name when icon-only. */
  label?: string;
}

export interface RibbonGroup {
  /** Group caption shown under the commands. */
  title: string;
  /** Commands within this group. */
  commands: RibbonCommand[];
}

export interface RibbonTab {
  /** Stable id. */
  id: string;
  /** Tab label. */
  text: string;
  /** Command groups revealed by this tab. */
  groups: RibbonGroup[];
}

export interface RibbonConfig extends WidgetConfig {
  // NOTE: Ribbon deliberately has NO widget-level `disabled`. Like Toolbar it is
  // a container of independently-operable commands, not a single control, so the
  // shared `disabled` vocabulary is applied per command (`RibbonCommand.disabled`)
  // rather than to the ribbon as a whole.
  /** Tabs. */
  tabs?: RibbonTab[];
  /** Initially active tab id (defaults to the first tab). */
  active?: string;
  /** Accessible name (`aria-label`) for the tablist. Default `'Ribbon'`. */
  label?: string;
}

export interface RibbonEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel a tab change. */
  beforeChange: { id: string; tab: RibbonTab; ribbon: Ribbon };
  change: { id: string; tab: RibbonTab; ribbon: Ribbon };
  /** A command button was activated. */
  command: { id: string; command: RibbonCommand; tabId: string; ribbon: Ribbon };
}

export class Ribbon extends Widget<RibbonConfig, RibbonEvents> {
  private declare activeId: string | null;
  private declare buttons: Button[];

  protected override defaults(): Partial<RibbonConfig> {
    return { tabs: [], label: 'Ribbon' };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-ribbon' });
    root.addEventListener('click', (e) => this.handleClick(e as MouseEvent));
    root.addEventListener('keydown', (e) => this.handleKeydown(e as KeyboardEvent));
    return root;
  }

  protected override render(): void {
    if (this.activeId === undefined) this.initState();
    this.teardownButtons();
    const tabs = this.config.tabs ?? [];
    if (this.activeId === null || !tabs.some((t) => t.id === this.activeId)) {
      this.activeId = tabs[0]?.id ?? null;
    }

    this.el.className = ['jects-ribbon', this.config.cls ?? ''].filter(Boolean).join(' ');
    this.el.innerHTML = '';

    // Tablist
    const tablist = createEl('div', { className: 'jects-ribbon__tablist' });
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', this.config.label ?? 'Ribbon');
    tabs.forEach((tab) => {
      const isActive = tab.id === this.activeId;
      const t = createEl('button', { className: 'jects-ribbon__tab' });
      t.type = 'button';
      t.setAttribute('role', 'tab');
      t.dataset['tab'] = tab.id;
      t.id = `${this.id}-tab-${tab.id}`;
      t.setAttribute('aria-selected', String(isActive));
      t.setAttribute('aria-controls', `${this.id}-panel-${tab.id}`);
      t.tabIndex = isActive ? 0 : -1;
      if (isActive) t.classList.add('jects-ribbon__tab--active');
      t.textContent = tab.text;
      tablist.appendChild(t);
    });
    this.el.appendChild(tablist);

    // Active panel
    const activeTab = tabs.find((t) => t.id === this.activeId);
    if (activeTab) {
      const panel = createEl('div', { className: 'jects-ribbon__panel' });
      panel.setAttribute('role', 'tabpanel');
      panel.id = `${this.id}-panel-${activeTab.id}`;
      panel.setAttribute('aria-labelledby', `${this.id}-tab-${activeTab.id}`);
      panel.tabIndex = 0;
      activeTab.groups.forEach((group) => {
        const g = createEl('div', { className: 'jects-ribbon__group' });
        g.setAttribute('role', 'group');
        g.setAttribute('aria-label', group.title);
        const cmds = createEl('div', { className: 'jects-ribbon__commands' });
        group.commands.forEach((cmd) => {
          const slot = createEl('div', { className: 'jects-ribbon__command' });
          cmds.appendChild(slot);
          const btn = new Button(slot, {
            ...(cmd.text !== undefined ? { text: cmd.text } : {}),
            ...(cmd.icon !== undefined ? { icon: cmd.icon } : {}),
            variant: 'ghost',
            size: 'sm',
            ...(cmd.disabled !== undefined ? { disabled: cmd.disabled } : {}),
          });
          if (!cmd.text && cmd.label) btn.el.setAttribute('aria-label', cmd.label);
          btn.on('click', () =>
            this.emit('command', {
              id: cmd.id,
              command: cmd,
              tabId: activeTab.id,
              ribbon: this,
            }),
          );
          this.buttons.push(btn);
        });
        const caption = createEl('div', { className: 'jects-ribbon__group-title' });
        caption.textContent = group.title;
        g.appendChild(cmds);
        g.appendChild(caption);
        panel.appendChild(g);
      });
      this.el.appendChild(panel);
    }
  }

  private initState(): void {
    this.activeId = this.config.active ?? null;
    this.buttons = [];
  }

  // ---- interaction --------------------------------------------------------

  private handleClick(event: MouseEvent): void {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('.jects-ribbon__tab');
    if (!tab) return;
    const id = tab.dataset['tab'];
    if (id) this.selectTab(id);
  }

  private handleKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (!target.classList.contains('jects-ribbon__tab')) return;
    const tabs = this.config.tabs ?? [];
    if (!tabs.length) return;
    let idx = tabs.findIndex((t) => t.id === this.activeId);
    if (idx < 0) idx = 0;

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        this.selectTab(tabs[(idx + 1) % tabs.length]!.id, true);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.selectTab(tabs[(idx - 1 + tabs.length) % tabs.length]!.id, true);
        break;
      case 'Home':
        event.preventDefault();
        this.selectTab(tabs[0]!.id, true);
        break;
      case 'End':
        event.preventDefault();
        this.selectTab(tabs[tabs.length - 1]!.id, true);
        break;
      default:
        break;
    }
  }

  // ---- public API ---------------------------------------------------------

  /** Activate a tab by id. */
  selectTab(id: string, focus = false): this {
    if (id === this.activeId) return this;
    const tab = (this.config.tabs ?? []).find((t) => t.id === id);
    if (!tab) return this;
    if (this.emit('beforeChange', { id, tab, ribbon: this }) === false) return this;
    this.activeId = id;
    this.render();
    if (focus) {
      this.el.querySelector<HTMLElement>(`.jects-ribbon__tab[data-tab="${cssEscape(id)}"]`)?.focus();
    }
    this.emit('change', { id, tab, ribbon: this });
    return this;
  }

  /** Currently active tab id (or null). */
  getActive(): string | null {
    return this.activeId ?? null;
  }

  private teardownButtons(): void {
    if (this.buttons) {
      this.buttons.forEach((b) => b.destroy());
      this.buttons = [];
    }
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    this.teardownButtons();
    super.destroy();
  }
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

register(
  'ribbon',
  Ribbon as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Ribbon,
);
