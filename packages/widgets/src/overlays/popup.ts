/**
 * Popup — an anchored floating panel.
 *
 * Anchored to a trigger element (or a fixed point), positioned on one of four
 * sides (top/bottom/left/right) with a cross-axis alignment, an offset, and
 * automatic flip when it would collide with the viewport edge. Opens / closes
 * imperatively, on click-outside, and on Escape. Houses arbitrary content.
 *
 * Self-contained: depends only on `@jects/core`.
 *
 * NOTE: `super()` runs `buildEl()` before subclass field initializers, so DOM
 * listeners are wired with bound methods inside `buildEl()`, never class-field
 * arrows.
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  createEl,
  register,
  sanitizeHtml,
} from '@jects/core';

export type PopupPlacement = 'top' | 'bottom' | 'left' | 'right';
export type PopupAlign = 'start' | 'center' | 'end';

export interface PopupConfig extends WidgetConfig {
  /** Element the popup is anchored to. Required for collision/positioning. */
  anchor?: HTMLElement;
  /** Side of the anchor to place the panel on. Default `bottom`. */
  placement?: PopupPlacement;
  /** Cross-axis alignment along the chosen side. Default `center`. */
  align?: PopupAlign;
  /** Gap (px) between anchor and panel. Default `8`. */
  offset?: number;
  /** Flip to the opposite side on viewport collision. Default `true`. */
  flip?: boolean;
  /** Close when a pointer-down lands outside panel + anchor. Default `true`. */
  closeOnClickOutside?: boolean;
  /** Close when Escape is pressed. Default `true`. */
  closeOnEsc?: boolean;
  /** Plain text content (used when `html` is not given). */
  text?: string;
  /**
   * HTML content for the panel body (used when `text` is not given). Sanitized
   * through the shared `@jects/core` allow-list sanitizer before insertion. Set
   * `trusted: true` only when the markup is author-controlled and must bypass
   * sanitization.
   */
  html?: string;
  /** Opt out of HTML sanitization for `html`. Default `false`. */
  trusted?: boolean;
  /** Start opened. Default `false`. */
  open?: boolean;
  /** ARIA role for the panel. Default `dialog`. */
  role?: string;
  /** Accessible name for the panel (sets `aria-label`). Required when role is dialog/alertdialog and no `labelledby` is given. */
  label?: string;
  /** Id of an element that labels the panel (sets `aria-labelledby`). Alternative to `label`. */
  labelledby?: string;
  /** Trap Tab focus inside the panel and treat it as modal. Default `true` when role is dialog/alertdialog. */
  modal?: boolean;
}

export interface PopupEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel opening. */
  beforeOpen: { popup: Popup };
  open: { popup: Popup };
  /** Vetoable: return `false` to cancel closing. */
  beforeClose: { popup: Popup; reason: PopupCloseReason };
  close: { popup: Popup; reason: PopupCloseReason };
}

export type PopupCloseReason = 'api' | 'click-outside' | 'escape';

export class Popup extends Widget<PopupConfig, PopupEvents> {
  // NOTE: with `useDefineForClassFields`, subclass field initializers run AFTER
  // super() (which runs buildEl()+render()) and would clobber any state set during
  // the initial render. So `isOpen` is DERIVED from the DOM (the `--open` class),
  // never stored in a field. Handler refs below are only assigned by open(), which
  // is invoked AFTER construction (deferred in the constructor), so they survive.
  private onDocPointerDown?: (e: Event) => void;
  private onDocKeydown?: (e: KeyboardEvent) => void;
  private onPanelKeydown?: (e: KeyboardEvent) => void;
  /** Element focused at open() time, restored on close(). */
  private restoreFocusTo?: HTMLElement | null;
  /** The side actually applied by the last reposition() (may differ from config after a flip). */
  private resolvedSide?: PopupPlacement;

  constructor(host: HTMLElement | string, config?: PopupConfig) {
    super(host, config);
    // Apply the initial `open` config AFTER field initializers have run.
    if (this.config.open) this.open();
  }

  private get isOpen(): boolean {
    return this.el.classList.contains('jects-popup--open');
  }

  /** Does the resolved role behave like a modal dialog (needs name + focus trap)? */
  private get isDialogRole(): boolean {
    const role = this.config.role ?? 'dialog';
    return role === 'dialog' || role === 'alertdialog';
  }

  /** Should Tab focus be trapped and the panel treated as modal? */
  private get isModal(): boolean {
    return this.config.modal ?? this.isDialogRole;
  }

  protected override defaults(): Partial<PopupConfig> {
    return {
      placement: 'bottom',
      align: 'center',
      offset: 8,
      flip: true,
      closeOnClickOutside: true,
      closeOnEsc: true,
      open: false,
      role: 'dialog',
    };
  }

  protected buildEl(): HTMLElement {
    return createEl('div', {
      className: 'jects-popup',
      attrs: { role: this.config.role ?? 'dialog' },
    });
  }

  protected override render(): void {
    const { html, text, role = 'dialog', placement = 'bottom', label, labelledby } = this.config;
    const el = this.el;
    const wasOpen = this.isOpen;
    // While open, honor the side that reposition() actually resolved (may be a
    // flipped side) instead of reverting to the original config.placement.
    const side: PopupPlacement = wasOpen ? this.resolvedSide ?? placement : placement;
    el.className = [
      'jects-popup',
      `jects-popup--${side}`,
      wasOpen ? 'jects-popup--open' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');
    el.setAttribute('role', role);
    el.setAttribute('data-placement', side);

    // Accessible name for dialog/alertdialog roles. Prefer aria-labelledby.
    if (labelledby) {
      el.setAttribute('aria-labelledby', labelledby);
      el.removeAttribute('aria-label');
    } else if (label !== undefined) {
      el.setAttribute('aria-label', label);
      el.removeAttribute('aria-labelledby');
    }

    // Modal dialogs trap focus; advertise that to assistive tech.
    if (this.isModal) el.setAttribute('aria-modal', 'true');
    else el.removeAttribute('aria-modal');
    // The panel itself must be focusable so we can move focus into it on open.
    if (this.isDialogRole && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');

    if (html !== undefined) el.innerHTML = this.config.trusted ? html : sanitizeHtml(html);
    else if (text !== undefined) el.textContent = text;

    // Keep hidden state in sync with derived open-state. The constructor applies
    // the initial `open` config after field initializers, so we only hide here.
    if (!this.isOpen) {
      el.hidden = true;
    } else {
      // Re-run positioning after any config change (content/placement/etc.) so the
      // panel does not desync from its flipped side or sit at stale coordinates.
      this.reposition();
    }
  }

  /** Is the popup currently open? */
  get opened(): boolean {
    return this.isOpen;
  }

  /** Open the popup, positioning it against its anchor. */
  open(): this {
    if (this.isOpen || this.isDestroyed) return this;
    if (this.emit('beforeOpen', { popup: this }) === false) return this;
    // Record where focus was so we can restore it on close.
    this.restoreFocusTo = document.activeElement as HTMLElement | null;
    this.el.hidden = false;
    this.el.classList.add('jects-popup--open');
    this.reposition();
    this.bindGlobal();
    this.bindFocusTrap();
    this.focusPanel();
    this.emit('open', { popup: this });
    return this;
  }

  /** Close the popup. `reason` is forwarded on the events. */
  close(reason: PopupCloseReason = 'api'): this {
    if (!this.isOpen) return this;
    if (this.emit('beforeClose', { popup: this, reason }) === false) return this;
    this.el.classList.remove('jects-popup--open');
    this.el.hidden = true;
    this.unbindGlobal();
    this.unbindFocusTrap();
    this.restoreFocus();
    delete this.resolvedSide;
    this.emit('close', { popup: this, reason });
    return this;
  }

  /** Toggle open/closed. */
  toggle(): this {
    return this.isOpen ? this.close('api') : this.open();
  }

  /** Recompute and apply the panel position against its anchor. */
  reposition(): this {
    const anchor = this.config.anchor;
    if (!anchor || !this.isOpen) return this;
    const {
      placement = 'bottom',
      align = 'center',
      offset = 8,
      flip = true,
    } = this.config;

    const a = anchor.getBoundingClientRect();
    const pw = this.el.offsetWidth;
    const ph = this.el.offsetHeight;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    let side: PopupPlacement = placement;
    if (flip) {
      if (placement === 'bottom' && a.bottom + offset + ph > vh && a.top - offset - ph >= 0)
        side = 'top';
      else if (placement === 'top' && a.top - offset - ph < 0 && a.bottom + offset + ph <= vh)
        side = 'bottom';
      else if (placement === 'right' && a.right + offset + pw > vw && a.left - offset - pw >= 0)
        side = 'left';
      else if (placement === 'left' && a.left - offset - pw < 0 && a.right + offset + pw <= vw)
        side = 'right';
    }

    let top = 0;
    let left = 0;
    if (side === 'top' || side === 'bottom') {
      top = side === 'bottom' ? a.bottom + offset : a.top - offset - ph;
      if (align === 'start') left = a.left;
      else if (align === 'end') left = a.right - pw;
      else left = a.left + (a.width - pw) / 2;
    } else {
      left = side === 'right' ? a.right + offset : a.left - offset - pw;
      if (align === 'start') top = a.top;
      else if (align === 'end') top = a.bottom - ph;
      else top = a.top + (a.height - ph) / 2;
    }

    // Clamp into the viewport.
    left = Math.max(0, Math.min(left, vw - pw));
    top = Math.max(0, Math.min(top, vh - ph));

    this.el.style.position = 'fixed';
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
    // Remember the side we actually resolved so render() (run on every update())
    // re-applies it instead of reverting to the un-flipped config.placement.
    this.resolvedSide = side;
    this.el.setAttribute('data-placement', side);
    this.el.className = this.el.className
      .replace(/jects-popup--(top|bottom|left|right)/, `jects-popup--${side}`);
    return this;
  }

  // ---- focus management ---------------------------------------------------

  /** Collect tabbable descendants of the panel, in DOM order. */
  private focusables(): HTMLElement[] {
    const sel = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    return Array.from(this.el.querySelectorAll<HTMLElement>(sel)).filter(
      (n) => !n.hasAttribute('disabled') && n.tabIndex !== -1 && n.offsetParent !== null,
    );
  }

  /** Move focus into the panel: first focusable child, else the panel itself. */
  private focusPanel(): void {
    const first = this.focusables()[0];
    if (first) first.focus();
    else this.el.focus();
  }

  /** Restore focus to wherever it was when we opened. */
  private restoreFocus(): void {
    const target = this.restoreFocusTo;
    delete this.restoreFocusTo;
    if (target && typeof target.focus === 'function' && target.isConnected) {
      target.focus();
    } else {
      this.config.anchor?.focus();
    }
  }

  /** Trap Tab / Shift+Tab inside the panel while it is modal. */
  private bindFocusTrap(): void {
    if (!this.isModal) return;
    this.onPanelKeydown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const items = this.focusables();
      if (items.length === 0) {
        // Nothing tabbable inside; keep focus on the panel.
        e.preventDefault();
        this.el.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || active === this.el || !this.el.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    this.el.addEventListener('keydown', this.onPanelKeydown, true);
  }

  private unbindFocusTrap(): void {
    if (this.onPanelKeydown) {
      this.el.removeEventListener('keydown', this.onPanelKeydown, true);
      delete this.onPanelKeydown;
    }
  }

  private bindGlobal(): void {
    if (this.config.closeOnClickOutside) {
      this.onDocPointerDown = (e: Event): void => {
        const t = e.target as Node | null;
        if (!t) return;
        if (this.el.contains(t)) return;
        if (this.config.anchor?.contains(t)) return;
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
    this.unbindGlobal();
    this.unbindFocusTrap();
    delete this.restoreFocusTo;
    super.destroy();
  }
}

register(
  'popup',
  Popup as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Popup,
);
