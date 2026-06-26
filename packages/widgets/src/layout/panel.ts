/**
 * Panel — a titled, bordered region with an optional header (title + tools),
 * a collapsible body, and an optional footer.
 *
 * Follows the Button reference pattern: extends `Widget<Config, Events>`,
 * supplies `defaults()`, builds the root once in `buildEl()` (wiring the
 * collapse toggle via a bound method), syncs DOM in `render()`, emits vetoable
 * `beforeCollapse`/`beforeExpand` then `collapse`/`expand`, and registers with
 * the factory.
 *
 * Body content may be a built `Widget`, a raw `HTMLElement`, or a trusted HTML
 * string. A built widget passed as body is owned and destroyed with the panel.
 *
 * a11y: the collapse toggle is a real `<button>` with `aria-expanded` and
 * `aria-controls` pointing at the body region.
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  createEl,
  register,
  escape as escapeHtml,
  sanitizeHtml,
} from '@jects/core';

/**
 * Panel body content: a widget, an element, or an HTML string. A string is
 * treated as authored HTML and sanitized through the shared `@jects/core`
 * sanitizer before insertion (unless the Panel is configured `trusted: true`).
 */
export type PanelBody = Widget | HTMLElement | string;

export interface PanelConfig extends WidgetConfig {
  /** Header title text (plain text, always escaped). When omitted the header is hidden (unless tools/collapsible). */
  title?: string;
  /** HTML for header tools (right-aligned actions). Sanitized unless `trusted: true`. */
  tools?: string;
  /** Body content: a widget, an element, or an HTML string (sanitized unless `trusted: true`). */
  body?: PanelBody;
  /** HTML for an optional footer. Sanitized unless `trusted: true`. */
  footer?: string;
  /** Whether the body can collapse. Default `false`. */
  collapsible?: boolean;
  /** Initial collapsed state (collapsible only). Default `false`. */
  collapsed?: boolean;
  /** Remove the surrounding border/background chrome. Default `false`. */
  flat?: boolean;
  /** Opt out of HTML sanitization for `tools`, `footer`, and string `body`. Default `false`. */
  trusted?: boolean;
}

export interface PanelEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel collapsing. */
  beforeCollapse: { panel: Panel };
  /** Vetoable: return `false` to cancel expanding. */
  beforeExpand: { panel: Panel };
  collapse: { panel: Panel };
  expand: { panel: Panel };
}

export class Panel extends Widget<PanelConfig, PanelEvents> {
  /**
   * A body widget owned by this panel (destroyed with it), if any.
   * NOTE: declared with `declare` (type-only, emits NO field) — under
   * `useDefineForClassFields`, even an uninitialised field declaration would
   * run `this.bodyWidget = undefined` AFTER `super()` (which already ran
   * render()), wiping the reference captured on first render. Initialised to
   * `null` in `buildEl()` (runs during super, before any field reset).
   */
  declare private bodyWidget: Widget | null;

  /**
   * Live collapsed state. Mirrors the Layout/Sidebar model: collapse state is
   * held in a private field (seeded from `config.collapsed` on first render) and
   * exposed via the {@link collapsed} getter, so it is never written back into
   * `config` and `getConfig().collapsed` stays stable over the widget's life.
   * `declare` (no initializer) so the value seeded during super()'s render() is
   * not clobbered by a field reset after super() returns.
   */
  declare private collapsedState: boolean;

  /** Is the panel body currently collapsed? */
  get collapsed(): boolean {
    return this.collapsedState ?? false;
  }

  private get bodyId(): string {
    return `${this.id}-body`;
  }

  private get headerEl(): HTMLElement {
    return this.el.querySelector('.jects-panel__header')!;
  }
  private get bodyEl(): HTMLElement {
    return this.el.querySelector('.jects-panel__body')!;
  }
  private get footerEl(): HTMLElement {
    return this.el.querySelector('.jects-panel__footer')!;
  }

  protected override defaults(): Partial<PanelConfig> {
    return { collapsible: false, collapsed: false, flat: false };
  }

  protected buildEl(): HTMLElement {
    this.bodyWidget = null;
    this.collapsedState = !!this.config.collapsed;
    const root = createEl('div', { className: 'jects-panel' });
    const header = createEl('div', { className: 'jects-panel__header' });
    const body = createEl('div', {
      className: 'jects-panel__body',
      attrs: { role: 'region' },
    });
    body.id = this.bodyId;
    const footer = createEl('div', { className: 'jects-panel__footer' });
    root.append(header, body, footer);

    // Delegated click for the collapse toggle (bound method — super() runs
    // buildEl() before subclass field initializers).
    root.addEventListener('click', (e) => this.handleClick(e));
    return root;
  }

  private handleClick(e: Event): void {
    const target = e.target as Element | null;
    if (target?.closest('.jects-panel__toggle')) {
      e.preventDefault();
      this.toggle();
    }
  }

  /** Toggle collapsed state. */
  toggle(): void {
    if (this.collapsed) this.expand();
    else this.collapse();
  }

  /** Collapse the body (vetoable). No-op when not collapsible or already collapsed. */
  collapse(): void {
    if (!this.config.collapsible || this.collapsed) return;
    if (this.emit('beforeCollapse', { panel: this }) === false) return;
    this.collapsedState = true;
    this.render();
    this.emit('collapse', { panel: this });
  }

  /** Expand the body (vetoable). No-op when not collapsible or already expanded. */
  expand(): void {
    if (!this.config.collapsible || !this.collapsed) return;
    if (this.emit('beforeExpand', { panel: this }) === false) return;
    this.collapsedState = false;
    this.render();
    this.emit('expand', { panel: this });
  }

  private disposeBodyWidget(): void {
    if (this.bodyWidget && !this.bodyWidget.isDestroyed) this.bodyWidget.destroy();
    this.bodyWidget = null;
  }

  private renderBody(body: PanelBody | undefined): void {
    const host = this.bodyEl;
    this.disposeBodyWidget();
    host.replaceChildren();
    if (body === undefined) return;
    if (body instanceof Widget) {
      this.bodyWidget = body;
      host.appendChild(body.el);
    } else if (body instanceof HTMLElement) {
      host.appendChild(body);
    } else {
      // A string is authored HTML → sanitized by default; only the explicit
      // `trusted` opt-out injects it raw.
      host.innerHTML = this.config.trusted ? body : sanitizeHtml(body);
    }
  }

  protected override render(): void {
    const {
      title,
      tools,
      body,
      footer,
      collapsible = false,
      flat = false,
    } = this.config;
    const collapsed = this.collapsed;

    const el = this.el;
    el.className = [
      'jects-panel',
      flat ? 'jects-panel--flat' : '',
      collapsible ? 'jects-panel--collapsible' : '',
      collapsed ? 'jects-panel--collapsed' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    // ---- header ----
    const header = this.headerEl;
    const hasHeader = !!title || !!tools || collapsible;
    header.hidden = !hasHeader;
    if (hasHeader) {
      const toggle = collapsible
        ? `<button type="button" class="jects-panel__toggle" aria-expanded="${String(!collapsed)}" aria-controls="${this.bodyId}">` +
          `<span class="jects-panel__chevron" aria-hidden="true"></span>` +
          `<span class="jects-panel__title">${escapeHtml(title ?? '')}</span>` +
          `</button>`
        : `<span class="jects-panel__title">${escapeHtml(title ?? '')}</span>`;
      const safeTools = tools
        ? this.config.trusted
          ? tools
          : sanitizeHtml(tools)
        : '';
      const toolsHtml = safeTools ? `<div class="jects-panel__tools">${safeTools}</div>` : '';
      // jects-safe-html: title escaped via escapeHtml in toggle; tools sanitizeHtml'd unless trusted opt-out
      header.innerHTML = toggle + toolsHtml;
    } else {
      // jects-safe-html: empty clear
      header.innerHTML = '';
    }

    // ---- body ----
    this.renderBody(body);
    const bodyEl = this.bodyEl;
    bodyEl.hidden = collapsed;
    bodyEl.setAttribute('aria-hidden', String(collapsed));

    // ---- footer ----
    const footerEl = this.footerEl;
    if (footer) {
      footerEl.hidden = false;
      // Authored HTML → sanitized by default; `trusted` opt-out injects raw.
      footerEl.innerHTML = this.config.trusted ? footer : sanitizeHtml(footer);
    } else {
      footerEl.hidden = true;
      // jects-safe-html: empty clear
      footerEl.innerHTML = '';
    }
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    this.disposeBodyWidget();
    super.destroy();
  }
}

register(
  'panel',
  Panel as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Panel,
);
