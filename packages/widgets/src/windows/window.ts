/**
 * Window — a floating, draggable, resizable panel.
 *
 * Features:
 * - Drag by the header to move; eight resize handles to resize.
 * - Minimise / maximise / restore (toggle), with min/max size clamping.
 * - Optional modal mode: REUSES the Wave-1 overlays `Mask` as a backdrop,
 *   traps Tab focus inside the panel, and closes on Escape.
 * - Z-order management: focusing/pointing a window brings it to the front via a
 *   shared monotonic counter sourced from `--jects-z-modal`.
 * - Events: vetoable `beforeClose`/`beforeResize`/`beforeMove`; plain `close`,
 *   `resize`, `move`, `maximize`, `restore`, `minimize`, `focus`.
 *
 * Self-contained except for `@jects/core` and the sibling Wave-1 `Mask`.
 *
 * NOTE: `super()` runs `buildEl()` before subclass field initializers, so DOM
 * listeners are wired with bound methods inside `buildEl()`, never class-field
 * arrows. State that must survive the initial render is DERIVED from the DOM or
 * assigned only by methods invoked after construction.
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  createEl,
  register,
} from '@jects/core';
import { Mask } from '../overlays/mask.js';

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Shared monotonic z-counter so the most-recently-focused window sits on top. */
let zCounter = 0;

/**
 * Base z-index that `toFront` stacks above. `toFront` writes an INLINE z-index,
 * which overrides the `.jects-window { z-index: var(--jects-z-modal) }` rule —
 * so without a base the first window would land at z-index 1, *below* the modal
 * Mask backdrop (`--jects-z-overlay`, 1030), and the backdrop would swallow all
 * clicks on the panel. We seed the counter from the `--jects-z-modal` token
 * (read once, lazily) so every window — modal or not — sits at/above the modal
 * layer, then increments per focus to preserve relative stacking.
 */
let zBase = 0;
function resolveZBase(): number {
  if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue('--jects-z-modal')
      .trim();
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1040; // fallback matches the default token value
}

export interface WindowConfig extends WidgetConfig {
  /** Title shown in the header. */
  title?: string;
  /** Plain text body content (used when `html` is not given). */
  text?: string;
  /** Trusted HTML for the body. */
  html?: string;
  /** Initial left position in px. Default `40`. */
  x?: number;
  /** Initial top position in px. Default `40`. */
  y?: number;
  /** Initial width in px. Default `420`. */
  width?: number;
  /** Initial height in px. Default `300`. */
  height?: number;
  /** Minimum width in px. Default `200`. */
  minWidth?: number;
  /** Minimum height in px. Default `120`. */
  minHeight?: number;
  /** Maximum width in px (optional clamp). */
  maxWidth?: number;
  /** Maximum height in px (optional clamp). */
  maxHeight?: number;
  /** Allow dragging by the header. Default `true`. */
  draggable?: boolean;
  /** Allow edge/corner resizing. Default `true`. */
  resizable?: boolean;
  /** Show the close button and allow Escape to close. Default `true`. */
  closable?: boolean;
  /** Show the maximize/restore button. Default `true`. */
  maximizable?: boolean;
  /** Show the minimize button. Default `false`. */
  minimizable?: boolean;
  /** Modal: render a Mask backdrop, trap focus, close on Escape. Default `false`. */
  modal?: boolean;
  /** Start maximized. Default `false`. */
  maximized?: boolean;
  /** Accessible name. Falls back to `title`. */
  label?: string;
}

export type WindowCloseReason = 'api' | 'close-button' | 'escape' | 'backdrop';

export interface WindowEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel closing. */
  beforeClose: { window: Window; reason: WindowCloseReason };
  close: { window: Window; reason: WindowCloseReason };
  /** Vetoable: return `false` to cancel a drag-move commit. */
  beforeMove: { window: Window; x: number; y: number };
  move: { window: Window; x: number; y: number };
  /** Vetoable: return `false` to cancel a resize commit. */
  beforeResize: { window: Window; width: number; height: number };
  resize: { window: Window; width: number; height: number };
  maximize: { window: Window };
  restore: { window: Window };
  minimize: { window: Window };
  focus: { window: Window };
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  edge: ResizeEdge | undefined;
}

const EDGES: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

export class Window extends Widget<WindowConfig, WindowEvents> {
  /** The modal backdrop (Wave-1 Mask), created lazily when modal. */
  private mask?: Mask;
  /** Active drag/resize gesture, if any. Assigned only by pointer handlers. */
  private drag: DragState | undefined;
  /** Geometry saved before maximize, restored on restore(). */
  private restoreRect?: { x: number; y: number; width: number; height: number };
  /** Bound document-level gesture handlers (assigned while dragging). */
  private onDocMove?: (e: PointerEvent) => void;
  private onDocUp?: (e: PointerEvent) => void;
  /** Bound document Escape handler (assigned while modal+closable). */
  private onDocKeydown?: (e: KeyboardEvent) => void;
  /** Tab focus-trap handler (assigned while modal). */
  private onPanelKeydown?: (e: KeyboardEvent) => void;
  /** Element focused before a modal window opened, restored on close. */
  private restoreFocusTo?: HTMLElement | null;
  /** Background elements inerted while modal; reverted on disableModal(). */
  private inerted?: Array<{ el: HTMLElement; inert: boolean; ariaHidden: string | null }>;

  constructor(host: HTMLElement | string, config?: WindowConfig) {
    super(host, config);
    // After field initializers have run: bring to front, wire modal behaviour.
    this.toFront();
    if (this.config.modal) this.enableModal();
  }

  protected override defaults(): Partial<WindowConfig> {
    return {
      x: 40,
      y: 40,
      width: 420,
      height: 300,
      minWidth: 200,
      minHeight: 120,
      draggable: true,
      resizable: true,
      closable: true,
      maximizable: true,
      minimizable: false,
      modal: false,
      maximized: false,
    };
  }

  protected buildEl(): HTMLElement {
    const el = createEl('div', {
      className: 'jects-window',
      attrs: { role: 'dialog', tabindex: '-1' },
    });
    // Bring to front on any pointer interaction.
    el.addEventListener('pointerdown', () => this.toFront());
    // Header drag, control buttons, and resize handles use delegated targets we
    // detect by data-attribute on pointerdown.
    el.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
    el.addEventListener('click', (e) => this.handleControlClick(e));
    return el;
  }

  /**
   * Merge a config patch and re-render, keeping modal *behaviour* in lockstep
   * with modal *appearance*. `render()` (re)paints the `jects-window--modal`
   * class and `aria-modal` from `config.modal`, but the Mask backdrop, focus
   * trap, Escape handler and background-inerting are imperative side effects
   * installed by enableModal()/disableModal(). Detect a modal transition here so
   * toggling `modal` via update() does not leave state and behaviour diverged
   * (a painted-but-inert modal, or a stale trap + dangling backdrop).
   */
  override update(patch: Partial<WindowConfig>): this {
    if (this.isDestroyed) return this;
    const wasModal = this.config.modal === true;
    super.update(patch);
    const isModal = this.config.modal === true;
    if (isModal && !wasModal) this.enableModal();
    else if (!isModal && wasModal) this.disableModal();
    return this;
  }

  // ---- rendering ----------------------------------------------------------

  protected override render(): void {
    const {
      title,
      text,
      html,
      draggable = true,
      resizable = true,
      closable = true,
      maximizable = true,
      minimizable = false,
      modal = false,
      maximized = false,
      label,
    } = this.config;

    const el = this.el;
    el.className = [
      'jects-window',
      maximized ? 'jects-window--maximized' : '',
      modal ? 'jects-window--modal' : '',
      draggable ? '' : 'jects-window--no-drag',
      resizable ? '' : 'jects-window--no-resize',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    el.setAttribute('role', 'dialog');
    if (modal) el.setAttribute('aria-modal', 'true');
    else el.removeAttribute('aria-modal');

    // Accessible name (axe rule aria-dialog-name). A role="dialog" MUST have an
    // accessible name. Precedence: explicit `label`, else `title` (via
    // aria-labelledby on the title element), else a synthesized fallback so a
    // window created with neither title nor label is still named. In dev we warn
    // that title or label is the documented, intended way to name a Window.
    const name = label ?? title;
    if (label !== undefined) {
      // Explicit label wins; expose it directly and drop any stale labelledby.
      el.setAttribute('aria-label', label);
      el.removeAttribute('aria-labelledby');
    } else if (title !== undefined) {
      // Named by the title element (aria-labelledby set below); no aria-label.
      el.removeAttribute('aria-label');
    } else {
      // Neither provided: synthesize a default name and warn (dev only).
      el.setAttribute('aria-label', 'Dialog');
      el.removeAttribute('aria-labelledby');
      warnMissingName(this.id);
    }
    void name;

    this.applyGeometry();

    const headerControls: string[] = [];
    if (minimizable) {
      headerControls.push(
        `<button type="button" class="jects-window__control jects-window__minimize" data-window-action="minimize" aria-label="Minimize">−</button>`,
      );
    }
    if (maximizable) {
      headerControls.push(
        `<button type="button" class="jects-window__control jects-window__maximize" data-window-action="maximize" aria-label="${maximized ? 'Restore' : 'Maximize'}" aria-pressed="${maximized}">${maximized ? '⧉' : '□'}</button>`,
      );
    }
    if (closable) {
      headerControls.push(
        `<button type="button" class="jects-window__control jects-window__close" data-window-action="close" aria-label="Close">✕</button>`,
      );
    }

    const titleId = `${this.id}-title`;
    const bodyHtml = html !== undefined ? html : text !== undefined ? escapeHtml(text) : '';

    const handles = resizable
      ? EDGES.map(
          (edge) =>
            `<span class="jects-window__resize jects-window__resize--${edge}" data-window-resize="${edge}" aria-hidden="true"></span>`,
        ).join('')
      : '';

    // jects-safe-html: title and text escaped via escapeHtml (bodyHtml above), ids internal; html config is trusted authored body by contract
    el.innerHTML = [
      `<header class="jects-window__header" data-window-drag${draggable && !maximized ? '' : ' data-disabled="true"'}>`,
      `<span class="jects-window__title" id="${titleId}">${title ? escapeHtml(title) : ''}</span>`,
      `<span class="jects-window__controls">${headerControls.join('')}</span>`,
      `</header>`,
      `<div class="jects-window__body">${bodyHtml}</div>`,
      handles,
    ].join('');

    if (title !== undefined) el.setAttribute('aria-labelledby', titleId);
  }

  /** Push the current geometry into inline styles. */
  private applyGeometry(): void {
    const el = this.el;
    if (this.config.maximized) {
      el.style.left = '';
      el.style.top = '';
      el.style.width = '';
      el.style.height = '';
      return;
    }
    const { x = 40, y = 40, width = 420, height = 300 } = this.config;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
  }

  // ---- z-order ------------------------------------------------------------

  /** Bring this window to the front of the z-stack. */
  toFront(): this {
    this.el.style.zIndex = String(this.nextZ());
    return this;
  }

  private nextZ(): number {
    if (zBase === 0) zBase = resolveZBase();
    return zBase + ++zCounter;
  }

  // ---- pointer (drag + resize) -------------------------------------------

  private handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const resizeEl = target.closest<HTMLElement>('[data-window-resize]');
    if (resizeEl && this.config.resizable && !this.config.maximized) {
      const edge = resizeEl.getAttribute('data-window-resize') as ResizeEdge;
      this.beginGesture(event, edge);
      return;
    }

    const dragEl = target.closest<HTMLElement>('[data-window-drag]');
    if (
      dragEl &&
      !dragEl.hasAttribute('data-disabled') &&
      this.config.draggable &&
      !this.config.maximized &&
      // Don't start a drag from a header control button.
      !target.closest('[data-window-action]')
    ) {
      this.beginGesture(event);
    }
  }

  private beginGesture(event: PointerEvent, edge?: ResizeEdge): void {
    event.preventDefault();
    const { x = 40, y = 40, width = 420, height = 300 } = this.config;
    this.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origX: x,
      origY: y,
      origW: width,
      origH: height,
      edge,
    };
    this.onDocMove = (e: PointerEvent): void => this.handleGestureMove(e);
    this.onDocUp = (e: PointerEvent): void => this.endGesture(e);
    document.addEventListener('pointermove', this.onDocMove);
    document.addEventListener('pointerup', this.onDocUp);
    document.addEventListener('pointercancel', this.onDocUp);
    this.el.classList.add(edge ? 'jects-window--resizing' : 'jects-window--dragging');
  }

  private handleGestureMove(event: PointerEvent): void {
    const d = this.drag;
    if (!d || event.pointerId !== d.pointerId) return;
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;

    if (!d.edge) {
      // Drag: move only.
      this.el.style.left = `${d.origX + dx}px`;
      this.el.style.top = `${d.origY + dy}px`;
      return;
    }

    // Resize: compute new rect from the active edge, clamped to min/max.
    const minW = this.config.minWidth ?? 200;
    const minH = this.config.minHeight ?? 120;
    const maxW = this.config.maxWidth ?? Infinity;
    const maxH = this.config.maxHeight ?? Infinity;

    let x = d.origX;
    let y = d.origY;
    let w = d.origW;
    let h = d.origH;

    if (d.edge.includes('e')) w = clamp(d.origW + dx, minW, maxW);
    if (d.edge.includes('s')) h = clamp(d.origH + dy, minH, maxH);
    if (d.edge.includes('w')) {
      w = clamp(d.origW - dx, minW, maxW);
      x = d.origX + (d.origW - w);
    }
    if (d.edge.includes('n')) {
      h = clamp(d.origH - dy, minH, maxH);
      y = d.origY + (d.origH - h);
    }

    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.el.style.width = `${w}px`;
    this.el.style.height = `${h}px`;
  }

  private endGesture(event: PointerEvent): void {
    const d = this.drag;
    if (!d || event.pointerId !== d.pointerId) return;
    this.detachGesture();

    const el = this.el;
    // NaN-aware fallback: a legitimate gesture can land at left:0/top:0, so we
    // must NOT treat 0 as "missing" (a `|| d.origX` would snap back to start).
    const newX = num(el.style.left, d.origX);
    const newY = num(el.style.top, d.origY);
    const newW = num(el.style.width, d.origW);
    const newH = num(el.style.height, d.origH);
    const edge = d.edge;
    this.drag = undefined;

    if (edge) {
      // Resize commit — vetoable. On veto, revert to the original rect.
      if (this.emit('beforeResize', { window: this, width: newW, height: newH }) === false) {
        this.update({ x: d.origX, y: d.origY, width: d.origW, height: d.origH });
        return;
      }
      this.config = { ...this.config, x: newX, y: newY, width: newW, height: newH };
      this.emit('resize', { window: this, width: newW, height: newH });
      this.emit('move', { window: this, x: newX, y: newY });
    } else {
      // Move commit — vetoable. On veto, revert.
      if (this.emit('beforeMove', { window: this, x: newX, y: newY }) === false) {
        this.update({ x: d.origX, y: d.origY });
        return;
      }
      this.config = { ...this.config, x: newX, y: newY };
      this.emit('move', { window: this, x: newX, y: newY });
    }
  }

  private detachGesture(): void {
    if (this.onDocMove) {
      document.removeEventListener('pointermove', this.onDocMove);
      delete this.onDocMove;
    }
    if (this.onDocUp) {
      document.removeEventListener('pointerup', this.onDocUp);
      document.removeEventListener('pointercancel', this.onDocUp);
      delete this.onDocUp;
    }
    this.el.classList.remove('jects-window--dragging', 'jects-window--resizing');
  }

  // ---- control buttons ----------------------------------------------------

  private handleControlClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const btn = target?.closest<HTMLElement>('[data-window-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-window-action');
    if (action === 'close') this.close('close-button');
    else if (action === 'maximize') this.toggleMaximize();
    else if (action === 'minimize') this.minimize();
  }

  // ---- public API ---------------------------------------------------------

  /** Move the window to an absolute position (px). Fires `move`. */
  moveTo(x: number, y: number): this {
    if (this.emit('beforeMove', { window: this, x, y }) === false) return this;
    this.update({ x, y, maximized: false });
    this.emit('move', { window: this, x, y });
    return this;
  }

  /** Resize the window (px), clamped to min/max. Fires `resize`. */
  resizeTo(width: number, height: number): this {
    const w = clamp(width, this.config.minWidth ?? 200, this.config.maxWidth ?? Infinity);
    const h = clamp(height, this.config.minHeight ?? 120, this.config.maxHeight ?? Infinity);
    if (this.emit('beforeResize', { window: this, width: w, height: h }) === false) return this;
    this.update({ width: w, height: h, maximized: false });
    this.emit('resize', { window: this, width: w, height: h });
    return this;
  }

  /** Is the window currently maximized? */
  get maximized(): boolean {
    return this.config.maximized === true;
  }

  /** Maximize to fill the host. Saves the current rect for restore(). */
  maximize(): this {
    if (this.config.maximized) return this;
    const { x = 40, y = 40, width = 420, height = 300 } = this.config;
    this.restoreRect = { x, y, width, height };
    this.update({ maximized: true });
    this.emit('maximize', { window: this });
    return this;
  }

  /** Restore from maximized to the saved rect. */
  restore(): this {
    if (!this.config.maximized) return this;
    const rect = this.restoreRect;
    this.update({ maximized: false, ...(rect ?? {}) });
    delete this.restoreRect;
    this.emit('restore', { window: this });
    return this;
  }

  /** Toggle maximize/restore. */
  toggleMaximize(): this {
    return this.config.maximized ? this.restore() : this.maximize();
  }

  /** Minimize (hide) the window. Fires `minimize`. */
  minimize(): this {
    this.emit('minimize', { window: this });
    this.hide();
    return this;
  }

  /** Close the window (vetoable). Detaches modal backdrop and destroys. */
  close(reason: WindowCloseReason = 'api'): this {
    if (this.isDestroyed) return this;
    if (this.emit('beforeClose', { window: this, reason }) === false) return this;
    this.emit('close', { window: this, reason });
    this.destroy();
    return this;
  }

  /** Focus the window panel and bring it to front. Fires `focus`. */
  focus(): this {
    this.toFront();
    const first = this.focusables()[0];
    if (first) first.focus();
    else this.el.focus();
    this.emit('focus', { window: this });
    return this;
  }

  // ---- modal --------------------------------------------------------------

  private enableModal(): void {
    // Backdrop: REUSE the Wave-1 overlays Mask (no spinner; dismissible click).
    this.restoreFocusTo = document.activeElement as HTMLElement | null;
    const mask = new Mask(this.host, {
      spinner: false,
      dismissible: true,
      cls: 'jects-window__backdrop',
    });
    // Place the panel above the backdrop, then bring window to front.
    this.host.appendChild(this.el);
    this.toFront();
    // Pin this mask directly beneath its own panel so the backdrop covers the
    // page (and any lower windows) but never intercepts clicks on this panel's
    // own content — even with stacked modals.
    mask.el.style.zIndex = String(Number(this.el.style.zIndex) - 1);
    mask.on('dismiss', () => {
      if (this.config.closable) this.close('backdrop');
    });
    this.mask = mask;

    // Focus trap.
    this.onPanelKeydown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const items = this.focusables();
      if (items.length === 0) {
        e.preventDefault();
        this.el.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      const outside = active === this.el || !this.el.contains(active);
      if (e.shiftKey) {
        if (active === first || outside) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || outside) {
        // Forward Tab from the last focusable — OR from anywhere outside the
        // panel (e.g. after a programmatic focus / click on background) — must
        // be pulled back to the first focusable so focus cannot escape forward.
        e.preventDefault();
        first.focus();
      }
    };
    this.el.addEventListener('keydown', this.onPanelKeydown, true);

    // Escape closes a modal window when closable.
    this.onDocKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && this.config.closable) {
        e.stopPropagation();
        this.close('escape');
      }
    };
    document.addEventListener('keydown', this.onDocKeydown, true);

    // Inert the background: mark every top-level element that is NOT an ancestor
    // of the panel (and not the panel or its Mask backdrop) as inert + aria-hidden
    // so neither Tab focus nor assistive tech can reach content behind the modal.
    this.inertBackground();

    // Move initial focus into the panel.
    this.focusPanel();
  }

  /** Apply inert + aria-hidden to background content while modal. */
  private inertBackground(): void {
    const panel = this.el;
    const maskEl = this.mask?.el;
    const keep = (node: HTMLElement): boolean =>
      node === panel ||
      node === maskEl ||
      node.contains(panel) ||
      (maskEl != null && node.contains(maskEl));
    const saved: Array<{ el: HTMLElement; inert: boolean; ariaHidden: string | null }> = [];
    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (keep(child)) continue;
      saved.push({
        el: child,
        inert: child.inert,
        ariaHidden: child.getAttribute('aria-hidden'),
      });
      child.inert = true;
      child.setAttribute('aria-hidden', 'true');
    }
    this.inerted = saved;
  }

  /** Revert any background inert/aria-hidden applied by inertBackground(). */
  private restoreBackground(): void {
    if (!this.inerted) return;
    for (const { el, inert, ariaHidden } of this.inerted) {
      el.inert = inert;
      if (ariaHidden === null) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', ariaHidden);
    }
    delete this.inerted;
  }

  private disableModal(): void {
    // Revert background inerting first so AT/Tab reach restored content.
    this.restoreBackground();
    if (this.onPanelKeydown) {
      this.el.removeEventListener('keydown', this.onPanelKeydown, true);
      delete this.onPanelKeydown;
    }
    if (this.onDocKeydown) {
      document.removeEventListener('keydown', this.onDocKeydown, true);
      delete this.onDocKeydown;
    }
    if (this.mask) {
      this.mask.destroy();
      delete this.mask;
    }
    // Restore focus to where it was before the modal opened.
    const target = this.restoreFocusTo;
    delete this.restoreFocusTo;
    if (target && typeof target.focus === 'function' && target.isConnected) {
      target.focus();
    }
  }

  // ---- focus helpers ------------------------------------------------------

  protected focusables(): HTMLElement[] {
    const sel = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    return Array.from(this.el.querySelectorAll<HTMLElement>(sel)).filter(
      (n) => !n.hasAttribute('disabled') && n.tabIndex !== -1,
    );
  }

  private focusPanel(): void {
    const first = this.focusables()[0];
    if (first) first.focus();
    else this.el.focus();
  }

  // ---- teardown -----------------------------------------------------------

  override destroy(): void {
    if (this.isDestroyed) return;
    this.detachGesture();
    this.disableModal();
    super.destroy();
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(v, max));
}

/** Parse a CSS px value, falling back to `f` only when the value is non-numeric.
 * Unlike `parseFloat(v) || f`, a legitimate `0` is preserved. */
function num(v: string, f: number): number {
  const n = parseFloat(v);
  return Number.isNaN(n) ? f : n;
}

/** Dev-only one-shot warning when a Window has neither `title` nor `label`. */
const warnedNames = new Set<string>();
function warnMissingName(id: string): void {
  if (warnedNames.has(id)) return;
  warnedNames.add(id);
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  if (env && env.NODE_ENV === 'production') return;
  console.warn(
    `[jects] Window ${id} was created without a \`title\` or \`label\`; ` +
      `falling back to aria-label="Dialog". Provide \`title\` or \`label\` for an accessible name.`,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

register(
  'window',
  Window as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Window,
);
