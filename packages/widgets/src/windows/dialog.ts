/**
 * Dialog — a modal `Window` preset with a header / body / footer layout and a
 * row of action buttons (REUSING the Wave-1 `Button`). Opening a dialog returns
 * a `Promise` that resolves with the key of the action the user chose (or
 * `null` if it was dismissed via Escape / backdrop / close button).
 *
 * Built on top of `Window`, so it inherits dragging, focus-trap, Escape, and the
 * Mask backdrop. By default it is non-resizable and non-maximizable (a dialog is
 * a fixed, centered surface), but those can be re-enabled via config.
 *
 * NOTE: `super()` runs `buildEl()` before subclass field initializers; the
 * footer buttons are created lazily in `render()` (post-construction safe).
 */

import { register } from '@jects/core';
import { Button } from '../button/button.js';
import { Window, type WindowConfig, type WindowEvents, type WindowCloseReason } from './window.js';

export interface DialogAction {
  /** Stable key resolved by the open() promise and emitted on `action`. */
  key: string;
  /** Visible button label. */
  text: string;
  /** Button variant (Wave-1 Button). Default `secondary`. */
  variant?: 'primary' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';
  /** When true, this action's button is auto-focused on open. */
  autoFocus?: boolean;
  /** When true, closes the dialog after firing (default `true`). */
  closeOnAction?: boolean;
}

export interface DialogConfig extends Omit<WindowConfig, 'minimizable'> {
  /** Footer action buttons (left→right). */
  actions?: DialogAction[];
  /** Variant styling hook for the dialog surface. Default `default`. */
  tone?: 'default' | 'destructive';
}

export interface DialogEvents extends WindowEvents {
  /** Fired when an action button is pressed. */
  action: { dialog: Dialog; key: string };
}

export class Dialog extends Window {
  /**
   * Live footer buttons, rebuilt on each render().
   *
   * NOTE: `super()` (Window's constructor) runs `render()` BEFORE this subclass
   * field initializer would run, so `render()` must not assume this is defined.
   * `teardownButtons()` lazily initializes it; never re-assign it to a fresh
   * array elsewhere (that would also be clobbered — mutate in place instead).
   */
  private buttons?: Button[];
  /** Resolver for the open() promise (set by open(), cleared on settle). */
  private resolveOpen?: (key: string | null) => void;
  /** Guards against double-settling the open() promise. Undefined ≡ false. */
  private settled?: boolean;

  protected override defaults(): Partial<DialogConfig> {
    return {
      // Dialog presets: modal, centered-ish, fixed surface.
      modal: true,
      resizable: false,
      maximizable: false,
      draggable: true,
      closable: true,
      width: 440,
      height: 220,
      tone: 'default',
      actions: [],
    } as Partial<DialogConfig>;
  }

  protected override render(): void {
    super.render();
    const el = this.el;
    const cfg = this.config as DialogConfig;

    el.classList.add('jects-dialog');
    if (cfg.tone === 'destructive') el.classList.add('jects-dialog--destructive');
    else el.classList.remove('jects-dialog--destructive');

    // Rebuild the footer button row. Tear down previous Button instances first
    // so we never leak listeners across re-renders.
    this.teardownButtons();

    const body = el.querySelector<HTMLElement>('.jects-window__body');
    if (!body) return;

    // Wrap the rendered body content in a dialog body + footer structure if not
    // already wrapped. We append a footer after the body element.
    let footer = el.querySelector<HTMLElement>('.jects-dialog__footer');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'jects-dialog__footer';
      body.insertAdjacentElement('afterend', footer);
    } else {
      // jects-safe-html: empty clear; action buttons built below as Button widgets
      footer.innerHTML = '';
    }

    const actions = cfg.actions ?? [];
    for (const action of actions) {
      const slot = document.createElement('div');
      slot.className = 'jects-dialog__action';
      footer.appendChild(slot);
      const btn = new Button(slot, {
        text: action.text,
        variant: action.variant ?? 'secondary',
        onClick: () => this.handleAction(action),
      });
      (this.buttons ??= []).push(btn);
      if (action.autoFocus) {
        // Defer focus until the panel is mounted/visible.
        queueMicrotask(() => btn.el.focus());
      }
    }
    footer.hidden = actions.length === 0;
  }

  private handleAction(action: DialogAction): void {
    this.emit('action', { dialog: this, key: action.key });
    if (action.closeOnAction !== false) {
      this.settle(action.key);
      this.close('api');
    }
  }

  /**
   * Open the dialog and return a Promise that resolves with the chosen action
   * key, or `null` if the dialog was dismissed. Resolves at most once.
   */
  open(): Promise<string | null> {
    this.settled = false;
    return new Promise<string | null>((resolve) => {
      this.resolveOpen = resolve;
    });
  }

  /** Resolve the pending open() promise (idempotent). */
  private settle(key: string | null): void {
    if (this.settled) return;
    this.settled = true;
    const resolve = this.resolveOpen;
    delete this.resolveOpen;
    resolve?.(key);
  }

  /** Closing via a dismiss path resolves the promise with `null`. */
  override close(reason: WindowCloseReason = 'api'): this {
    // Only a non-action close resolves with null; action closes pre-settle above.
    if (reason !== 'api') this.settle(null);
    return super.close(reason) as this;
  }

  private teardownButtons(): void {
    if (!this.buttons) return;
    for (const b of this.buttons.splice(0)) b.destroy();
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    // If destroyed without an explicit action, the promise resolves null.
    this.settle(null);
    this.teardownButtons();
    super.destroy();
  }
}

register(
  'dialog',
  Dialog as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Dialog,
);
