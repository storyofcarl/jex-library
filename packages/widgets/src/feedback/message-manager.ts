/**
 * Feedback cluster — MessageManager.
 *
 * MessageManager mounts a fixed region and renders stackable TOAST notifications
 * (variant info/success/warning/error, title/message, auto-dismiss timeout, manual
 * close, configurable corner position). It follows the Jects reference patterns:
 *
 * - extends `Widget<Config, Events>`
 * - `defaults()` supplies component defaults
 * - `buildEl()` builds the single root region once and wires DOM listeners with a
 *   bound method (NOT a class-field arrow — `super()` runs `buildEl()` first)
 * - `render()` syncs the region container class to current config (idempotent)
 * - emits vetoable `beforeShow` / `beforeDismiss` then `show` / `dismiss`
 * - CSS lives in `message-manager.css`, references only `--jects-*` tokens
 *
 * This module ALSO exports the imperative dialog helpers `alert`/`confirm`/`prompt`
 * which return Promises and render a self-contained modal dialog (backdrop, focus
 * trap, Esc/Enter handling). The dialog overlay is built locally so the feedback
 * cluster has no cross-cluster imports.
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  createEl,
  register,
  getFocusable,
  trapFocus,
  type Unbind,
  setHtml,
  trustedHtml,
} from '@jects/core';
import { renderIcon, type IconName } from '@jects/icons';

// ---------------------------------------------------------------------------
// Toast / MessageManager types
// ---------------------------------------------------------------------------

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';
export type ToastPosition =
  | 'top-left'
  | 'top-right'
  | 'top-center'
  | 'bottom-left'
  | 'bottom-right'
  | 'bottom-center';

export interface ToastOptions {
  /** Bold heading line. Optional. */
  title?: string;
  /** Body text of the toast. */
  message?: string;
  /** Semantic variant (drives color + icon). Default `info`. */
  variant?: ToastVariant;
  /** Auto-dismiss after N ms. `0` or negative disables auto-dismiss. */
  timeout?: number;
  /** Show the close (×) button. Default `true`. */
  closable?: boolean;
}

/** A live toast handle returned by `MessageManager.show()`. */
export interface ToastHandle {
  readonly id: string;
  readonly el: HTMLElement;
  /** Programmatically dismiss this toast. */
  dismiss(): void;
}

export interface MessageManagerConfig extends WidgetConfig {
  /** Corner the toast stack docks to. Default `top-right`. */
  position?: ToastPosition;
  /** Default auto-dismiss timeout (ms) applied to toasts without their own. Default `5000`. */
  defaultTimeout?: number;
  /** Maximum simultaneously visible toasts; oldest is dismissed past this. Default `5`. */
  max?: number;
}

export interface MessageManagerEvents extends WidgetEvents {
  /** Vetoable: return `false` to suppress a toast. */
  beforeShow: { options: ToastOptions; manager: MessageManager };
  /** A toast was shown. (Named to avoid colliding with the base `show` event.) */
  toastShow: { id: string; options: ToastOptions; manager: MessageManager };
  /** Vetoable: return `false` to keep a toast open. */
  beforeDismiss: { id: string; manager: MessageManager };
  /** A toast was dismissed. */
  toastDismiss: { id: string; manager: MessageManager };
}

const VARIANT_ICON: Record<ToastVariant, IconName> = {
  info: 'info',
  success: 'check-circle',
  warning: 'alert-triangle',
  error: 'alert-triangle',
};

let toastSeq = 0;

interface ActiveToast {
  id: string;
  el: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
  /** Remaining auto-dismiss ms (0/neg disables). Restarted after a pause. */
  timeout: number;
  /** Removes the per-toast hover/focus listeners. */
  cleanupEl?: () => void;
}

export class MessageManager extends Widget<MessageManagerConfig, MessageManagerEvents> {
  private toasts = new Map<string, ActiveToast>();

  protected override defaults(): Partial<MessageManagerConfig> {
    return { position: 'top-right', defaultTimeout: 5000, max: 5 };
  }

  protected buildEl(): HTMLElement {
    // A11y: the container is NOT a live region. Each toast carries its own
    // role=status/alert (+ implicit politeness), so we must not nest live
    // regions here — nested live regions produce undefined SR behavior.
    const region = createEl('div', {
      className: 'jects-toaster',
      attrs: {
        role: 'region',
        'aria-label': 'Notifications',
      },
    });
    // The Widget base `disposers` field is initialized before super() invokes
    // buildEl(), so `track()` is safe here and the listener is auto-removed on
    // destroy(). We must NOT reference a subclass class-field arrow here (those
    // initialize AFTER super() runs), so we build a local bound handler and
    // register both the add and the paired removal under the disposer contract.
    const onClick = (e: Event): void => this.handleClick(e);
    region.addEventListener('click', onClick);
    this.track(() => region.removeEventListener('click', onClick));
    return region;
  }

  private handleClick(event: Event): void {
    const target = event.target as Element | null;
    const closeBtn = target?.closest<HTMLElement>('[data-jects-toast-close]');
    if (!closeBtn) return;
    const item = closeBtn.closest<HTMLElement>('.jects-toast');
    if (item?.dataset.toastId) this.dismiss(item.dataset.toastId);
  }

  protected override render(): void {
    const { position = 'top-right' } = this.config;
    this.el.className = ['jects-toaster', `jects-toaster--${position}`, this.config.cls ?? '']
      .filter(Boolean)
      .join(' ');
  }

  /**
   * Show a toast. Returns a handle (or `null` if a `beforeShow` handler vetoed).
   * Named `push` (not `show`) so it does not clash with `Widget.show()` visibility.
   */
  push(options: ToastOptions): ToastHandle | null {
    if (this.isDestroyed) return null;
    if (this.emit('beforeShow', { options, manager: this }) === false) return null;

    const {
      title,
      message,
      variant = 'info',
      timeout = this.config.defaultTimeout ?? 5000,
      closable = true,
    } = options;

    const id = `jects-toast-${++toastSeq}`;
    const assertive = variant === 'error' || variant === 'warning';
    const el = createEl('div', {
      className: ['jects-toast', `jects-toast--${variant}`].join(' '),
      attrs: {
        // A11y: each toast is its OWN announcement layer (role=status → polite,
        // role=alert → assertive). The container is deliberately NOT a live
        // region, so we do not add aria-live here (that would nest live
        // regions). `tabindex=-1` lets us move focus here when an adjacent
        // focused toast is auto-dismissed, so keyboard focus is never lost.
        role: assertive ? 'alert' : 'status',
        tabindex: '-1',
      },
      dataset: { toastId: id },
    });

    setHtml(el, trustedHtml(
      `<span class="jects-toast__icon" aria-hidden="true">${renderIcon(VARIANT_ICON[variant], { size: 18 })}</span>` +
      `<div class="jects-toast__body">` +
      (title ? `<p class="jects-toast__title">${escapeHtml(title)}</p>` : '') +
      (message ? `<p class="jects-toast__message">${escapeHtml(message)}</p>` : '') +
      `</div>` +
      (closable
        ? `<button type="button" class="jects-toast__close" data-jects-toast-close aria-label="Dismiss notification">${renderIcon('x', { size: 16 })}</button>`
        : '')));

    this.el.appendChild(el);

    const active: ActiveToast = { id, el, timer: null, timeout };
    this.toasts.set(id, active);

    // A11y: pause auto-dismiss while the user is hovering or has focus inside
    // the toast (so they have time to read/reach the close button), and resume
    // when they leave. Listeners are removed in forceDismiss().
    const onEnter = (): void => this.pauseTimer(id);
    const onLeave = (): void => this.resumeTimer(id);
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    el.addEventListener('focusin', onEnter);
    el.addEventListener('focusout', onLeave);
    active.cleanupEl = () => {
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
      el.removeEventListener('focusin', onEnter);
      el.removeEventListener('focusout', onLeave);
    };

    if (timeout > 0) {
      active.timer = setTimeout(() => this.dismiss(id), timeout);
    }

    // Emit `toastShow` BEFORE cap enforcement so external observers always see
    // a consistent map (the new toast is present and announced) before any
    // overflow dismissal fires.
    this.emit('toastShow', { id, options, manager: this });

    // Enforce max: force-dismiss the oldest toasts beyond the cap. We iterate a
    // SNAPSHOT of ids and bound the work by the overflow count, and we use the
    // NON-vetoable forceDismiss() so a `beforeDismiss` veto cannot stall the
    // drain into an infinite loop / browser hang.
    const max = this.config.max ?? 5;
    const overflow = this.toasts.size - max;
    if (overflow > 0) {
      let removed = 0;
      for (const k of [...this.toasts.keys()]) {
        if (removed >= overflow) break;
        if (k === id) continue;
        this.forceDismiss(k);
        removed++;
      }
    }

    return {
      id,
      el,
      dismiss: () => this.dismiss(id),
    };
  }

  /** Pause a toast's auto-dismiss timer (remaining time is preserved as full). */
  private pauseTimer(id: string): void {
    const active = this.toasts.get(id);
    if (active?.timer) {
      clearTimeout(active.timer);
      active.timer = null;
    }
  }

  /** Resume a paused auto-dismiss timer. */
  private resumeTimer(id: string): void {
    const active = this.toasts.get(id);
    if (active && active.timer === null && active.timeout > 0 && !this.isDestroyed) {
      active.timer = setTimeout(() => this.dismiss(id), active.timeout);
    }
  }

  /** Convenience: `info(message, title?)`. */
  info(message: string, title?: string): ToastHandle | null {
    return this.push({ message, variant: 'info', ...(title !== undefined ? { title } : {}) });
  }
  success(message: string, title?: string): ToastHandle | null {
    return this.push({ message, variant: 'success', ...(title !== undefined ? { title } : {}) });
  }
  warning(message: string, title?: string): ToastHandle | null {
    return this.push({ message, variant: 'warning', ...(title !== undefined ? { title } : {}) });
  }
  error(message: string, title?: string): ToastHandle | null {
    return this.push({ message, variant: 'error', ...(title !== undefined ? { title } : {}) });
  }

  /** Dismiss a toast by id. Vetoable via `beforeDismiss`. */
  dismiss(id: string): void {
    const active = this.toasts.get(id);
    if (!active) return;
    if (this.emit('beforeDismiss', { id, manager: this }) === false) return;
    this.removeToast(active);
    this.emit('toastDismiss', { id, manager: this });
  }

  /**
   * Internal, NON-vetoable removal used for cap enforcement and teardown so a
   * `beforeDismiss` veto can never stall the overflow drain. Emits
   * `toastDismiss` for observer consistency but does not consult `beforeDismiss`.
   */
  private forceDismiss(id: string): void {
    const active = this.toasts.get(id);
    if (!active) return;
    this.removeToast(active);
    this.emit('toastDismiss', { id, manager: this });
  }

  /**
   * Shared removal: clears the timer, detaches per-toast listeners, drops the
   * map entry, removes the node, and — if focus was inside this toast — moves
   * focus to the next/previous toast (or lets it fall back to the body) so a
   * keyboard user never loses focus when a focused toast disappears.
   */
  private removeToast(active: ActiveToast): void {
    const hadFocus = active.el.contains(document.activeElement);
    const nextFocusTarget = hadFocus ? this.focusNeighborOf(active.id) : null;
    if (active.timer) {
      clearTimeout(active.timer);
      active.timer = null;
    }
    active.cleanupEl?.();
    this.toasts.delete(active.id);
    active.el.remove();
    if (hadFocus) nextFocusTarget?.focus();
  }

  /** Pick a sibling toast to receive focus when `id` is being removed. */
  private focusNeighborOf(id: string): HTMLElement | null {
    const ids = [...this.toasts.keys()];
    const idx = ids.indexOf(id);
    if (idx === -1) return null;
    const neighborId = ids[idx + 1] ?? ids[idx - 1];
    return neighborId ? (this.toasts.get(neighborId)?.el ?? null) : null;
  }

  /** Dismiss every visible toast. */
  clear(): void {
    for (const id of [...this.toasts.keys()]) this.dismiss(id);
  }

  /** Number of currently visible toasts. */
  get count(): number {
    return this.toasts.size;
  }

  override destroy(): void {
    for (const active of this.toasts.values()) {
      if (active.timer) clearTimeout(active.timer);
      active.cleanupEl?.();
    }
    this.toasts.clear();
    super.destroy();
  }
}

// ---------------------------------------------------------------------------
// Imperative dialog helpers: alert / confirm / prompt
// ---------------------------------------------------------------------------

export type DialogVariant = 'info' | 'success' | 'warning' | 'error';

export interface DialogOptions {
  /** Heading shown in the dialog. */
  title?: string;
  /** Body message. */
  message?: string;
  /** Semantic variant (drives icon/accent). Default `info`. */
  variant?: DialogVariant;
  /** Confirm-button label. Default `OK` (alert) / `OK` (confirm/prompt). */
  okText?: string;
  /** Cancel-button label (confirm/prompt). Default `Cancel`. */
  cancelText?: string;
}

export interface PromptOptions extends DialogOptions {
  /** Initial value of the input. */
  defaultValue?: string;
  /** Placeholder for the input. */
  placeholder?: string;
}

type DialogKind = 'alert' | 'confirm' | 'prompt';

/**
 * A dialog Promise augmented with a programmatic `cancel()` so callers can
 * dismiss the modal even if its promise would otherwise never settle (SPA
 * unmount, navigation, dropped promise). Cancelling settles the promise with
 * the same result as a user cancel and runs full cleanup (focus trap + overlay
 * listeners + node removal), so nothing leaks.
 */
export interface DialogHandle<R> extends Promise<R> {
  /** Programmatically dismiss the dialog as if the user cancelled. */
  cancel(): void;
}

/**
 * Build and mount a modal dialog. Returns a {@link DialogHandle} resolving to
 * the result and exposing `.cancel()`. Self-contained: backdrop + panel + focus
 * trap + Esc/Enter, no external overlay.
 */
function openDialog<R>(
  kind: DialogKind,
  opts: DialogOptions & PromptOptions,
  resultFor: (action: 'ok' | 'cancel', input: string) => R,
): DialogHandle<R> {
  let cancelFn: () => void = () => {};
  const promise = new Promise<R>((resolve) => {
    const { title, message, variant = 'info', okText, cancelText, defaultValue, placeholder } = opts;
    const labelId = `jects-dialog-title-${++toastSeq}`;
    const descId = `jects-dialog-desc-${++toastSeq}`;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const overlay = createEl('div', { className: 'jects-dialog-overlay' });
    // A11y: a dialog/alertdialog MUST have an accessible name. Prefer the
    // visible title (aria-labelledby); else the message (aria-labelledby on the
    // message); else a sensible role-derived aria-label so the panel is never
    // unnamed (e.g. a prompt with only a placeholder).
    const fallbackName =
      kind === 'confirm' ? 'Confirm' : kind === 'prompt' ? 'Prompt' : 'Alert';
    const nameById = title ? labelId : message ? descId : null;
    const panel = createEl('div', {
      className: ['jects-dialog', `jects-dialog--${variant}`].join(' '),
      attrs: {
        role: kind === 'confirm' || kind === 'prompt' ? 'alertdialog' : 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': nameById,
        'aria-label': nameById ? null : fallbackName,
        'aria-describedby': message && title ? descId : null,
      },
    });

    const showCancel = kind === 'confirm' || kind === 'prompt';
    const showInput = kind === 'prompt';

    setHtml(panel, trustedHtml(
      `<span class="jects-dialog__icon" aria-hidden="true">${renderIcon(VARIANT_ICON[variant], { size: 22 })}</span>` +
      `<div class="jects-dialog__content">` +
      (title ? `<h2 class="jects-dialog__title" id="${labelId}">${escapeHtml(title)}</h2>` : '') +
      (message ? `<p class="jects-dialog__message" id="${descId}">${escapeHtml(message)}</p>` : '') +
      (showInput
        ? `<input class="jects-dialog__input" type="text" data-jects-dialog-input ` +
          // Name the input: prefer the title, else the message, else a
          // placeholder/role-derived aria-label so it is never an unnamed field.
          (title
            ? `aria-labelledby="${labelId}" ` + (message ? `aria-describedby="${descId}" ` : '')
            : message
              ? `aria-labelledby="${descId}" `
              : `aria-label="${escapeAttr(placeholder || 'Input')}" `) +
          `value="${escapeAttr(defaultValue ?? '')}" placeholder="${escapeAttr(placeholder ?? '')}" />`
        : '') +
      `</div>` +
      `<div class="jects-dialog__actions">` +
      (showCancel
        ? `<button type="button" class="jects-dialog__btn jects-dialog__btn--cancel" data-jects-dialog-cancel>${escapeHtml(cancelText ?? 'Cancel')}</button>`
        : '') +
      `<button type="button" class="jects-dialog__btn jects-dialog__btn--ok" data-jects-dialog-ok>${escapeHtml(okText ?? 'OK')}</button>` +
      `</div>`));

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const input = panel.querySelector<HTMLInputElement>('[data-jects-dialog-input]');
    let releaseTrap: Unbind | null = null;
    let settled = false;
    let cleanedUp = false;

    // Idempotency guard: a double settle()+cleanup() (e.g. user settle then an
    // external .cancel()) must never double-call releaseTrap()/overlay.remove().
    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      releaseTrap?.();
      releaseTrap = null;
      overlay.removeEventListener('keydown', onKeydown, true);
      overlay.removeEventListener('mousedown', onOverlayMouseDown);
      overlay.remove();
      previouslyFocused?.focus?.();
    };

    const settle = (action: 'ok' | 'cancel'): void => {
      if (settled) return;
      settled = true;
      const value = resultFor(action, input?.value ?? '');
      cleanup();
      resolve(value);
    };

    // Expose programmatic cancellation so a dropped/never-settled promise can
    // still be torn down (cleanup runs on this path too).
    cancelFn = () => settle('cancel');

    function onKeydown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        // Esc cancels (alert resolves regardless of action).
        settle('cancel');
      } else if (e.key === 'Enter') {
        // Enter confirms unless focus is on the cancel button.
        const active = document.activeElement as HTMLElement | null;
        if (active?.hasAttribute('data-jects-dialog-cancel')) return;
        e.preventDefault();
        settle('ok');
      }
    }

    function onOverlayMouseDown(e: MouseEvent): void {
      // Backdrop click cancels (does not apply to alert action distinction).
      if (e.target === overlay) settle('cancel');
    }

    panel.addEventListener('click', (e) => {
      const t = e.target as Element | null;
      if (t?.closest('[data-jects-dialog-ok]')) settle('ok');
      else if (t?.closest('[data-jects-dialog-cancel]')) settle('cancel');
    });

    overlay.addEventListener('keydown', onKeydown, true);
    overlay.addEventListener('mousedown', onOverlayMouseDown);

    // Focus trap + initial focus.
    releaseTrap = trapFocus(panel);
    if (showInput && input) {
      input.focus();
      input.select();
    } else {
      const focusables = getFocusable(panel);
      // Prefer the OK button for initial focus.
      const ok = panel.querySelector<HTMLElement>('[data-jects-dialog-ok]');
      (ok ?? focusables[0])?.focus();
    }
  });

  // Augment the promise with a programmatic cancel handle (chainable: then/catch
  // return native promises, which is fine — the handle is for the live dialog).
  const handle = promise as DialogHandle<R>;
  handle.cancel = () => cancelFn();
  return handle;
}

/** Imperative alert(): resolves to `void` when dismissed. Returns a cancellable handle. */
export function alert(opts: DialogOptions | string = {}): DialogHandle<void> {
  const o = typeof opts === 'string' ? { message: opts } : opts;
  return openDialog<void>('alert', o, () => undefined);
}

/** Imperative confirm(): resolves to `true` (OK) or `false` (Cancel/Esc/backdrop). */
export function confirm(opts: DialogOptions | string = {}): DialogHandle<boolean> {
  const o = typeof opts === 'string' ? { message: opts } : opts;
  return openDialog<boolean>('confirm', o, (action) => action === 'ok');
}

/** Imperative prompt(): resolves to the input string (OK) or `null` (Cancel/Esc/backdrop). */
export function prompt(opts: PromptOptions | string = {}): DialogHandle<string | null> {
  const o = typeof opts === 'string' ? { message: opts } : opts;
  return openDialog<string | null>('prompt', o, (action, value) =>
    action === 'ok' ? value : null,
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Register for declarative composition: create({ type: 'message-manager' }).
register(
  'message-manager',
  MessageManager as unknown as new (
    host: HTMLElement | string,
    config?: Record<string, unknown>,
  ) => MessageManager,
);
