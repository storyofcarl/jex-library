/**
 * Splitter — a draggable divider that proportions two panes.
 *
 * Builds two pane regions with a draggable separator between them. The split
 * `ratio` (0–1, fraction allotted to the first/primary pane) is clamped to
 * `[min, max]`, drag-adjustable, keyboard-operable, and optionally persisted to
 * `localStorage` under `persist`.
 *
 * Follows the Button reference pattern: extends `Widget<Config, Events>`,
 * supplies `defaults()`, builds the root once in `buildEl()` (wiring pointer +
 * keyboard handlers via bound methods, registering global drag listeners ONCE
 * gated on `this.dragging`), syncs DOM in `render()`, emits vetoable
 * `beforeResize` then `resize`, and registers with the factory.
 *
 * a11y: the separator carries `role="separator"`, `aria-orientation`,
 * `aria-valuemin/max/now` and Arrow/Home/End keyboard support.
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

export type SplitterOrientation = 'horizontal' | 'vertical';
/**
 * Pane content: a widget, an element, or an HTML string. A string is treated as
 * authored HTML and sanitized through the shared `@jects/core` sanitizer before
 * insertion (unless the Splitter is configured `trusted: true`).
 */
export type SplitterPane = Widget | HTMLElement | string;

export interface SplitterConfig extends WidgetConfig {
  /**
   * Split orientation. `horizontal` = two side-by-side panes split by a
   * vertical handle; `vertical` = stacked panes split by a horizontal handle.
   * Default `horizontal`.
   */
  orientation?: SplitterOrientation;
  /** Fraction (0–1) of space given to the first pane. Default `0.5`. */
  ratio?: number;
  /** Minimum ratio. Default `0.1`. */
  min?: number;
  /** Maximum ratio. Default `0.9`. */
  max?: number;
  /** Keyboard/programmatic step (in ratio units). Default `0.05`. */
  step?: number;
  /** First (primary) pane content. */
  first?: SplitterPane;
  /** Second pane content. */
  second?: SplitterPane;
  /** Disable resizing. */
  disabled?: boolean;
  /** localStorage key to persist the ratio under. */
  persist?: string;
  /** Opt out of HTML sanitization for string pane content. Default `false`. */
  trusted?: boolean;
  /** Convenience handler (also via `.on('resize', ...)`). */
  onResize?: (ratio: number) => void;
}

export interface SplitterEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel the resize. */
  beforeResize: { ratio: number; prev: number; splitter: Splitter };
  resize: { ratio: number; splitter: Splitter };
}

export class Splitter extends Widget<SplitterConfig, SplitterEvents> {
  private dragging = false;
  // NOTE: pane widget refs use `declare` (type-only, emits NO field) — under
  // `useDefineForClassFields`, even an uninitialised field declaration runs
  // `this.x = undefined` AFTER `super()` (which already ran render()), wiping
  // references captured on first render. Initialised in `buildEl()` (runs
  // during super, before any field reset).
  declare private firstWidget: Widget | null;
  declare private secondWidget: Widget | null;

  // Scope to DIRECT children (`:scope >`): a splitter pane may itself contain a
  // nested splitter (e.g. when composed by `Layout`), and an unscoped
  // `querySelector` would match the nested splitter's pane/handle first — so the
  // outer splitter would size the wrong handle and never set its own separator
  // aria. Direct-child selectors always resolve this splitter's own parts.
  private get firstEl(): HTMLElement {
    return this.el.querySelector(':scope > .jects-splitter__pane--first')!;
  }
  private get secondEl(): HTMLElement {
    return this.el.querySelector(':scope > .jects-splitter__pane--second')!;
  }
  private get handleEl(): HTMLElement {
    return this.el.querySelector(':scope > .jects-splitter__handle')!;
  }

  protected override defaults(): Partial<SplitterConfig> {
    return { orientation: 'horizontal', ratio: 0.5, min: 0.1, max: 0.9, step: 0.05 };
  }

  protected buildEl(): HTMLElement {
    this.firstWidget = null;
    this.secondWidget = null;
    // Adopt a persisted ratio (if any) before the first render. `this.config`
    // is already populated when buildEl() runs.
    const persisted = this.loadPersisted();
    if (persisted !== undefined) this.config.ratio = persisted;

    const root = createEl('div', { className: 'jects-splitter' });
    const first = createEl('div', {
      className: 'jects-splitter__pane jects-splitter__pane--first',
    });
    const handle = createEl('div', {
      className: 'jects-splitter__handle',
      attrs: { role: 'separator', tabindex: '0' },
    });
    const second = createEl('div', {
      className: 'jects-splitter__pane jects-splitter__pane--second',
    });
    root.append(first, handle, second);

    // Bound methods (NOT class-field arrows): super() runs buildEl() before
    // subclass field initializers.
    handle.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
    handle.addEventListener('keydown', (e) => this.handleKeydown(e));
    handle.addEventListener('dblclick', () => this.reset());

    // Register global drag listeners ONCE, gated on `this.dragging`, so a
    // press/release cycle never accumulates disposers. A single disposer tears
    // them down at destroy().
    const onMove = (ev: PointerEvent): void => {
      if (this.dragging) this.setRatio(this.ratioFromPointer(ev), false);
    };
    const onUp = (ev: PointerEvent): void => {
      if (!this.dragging) return;
      this.dragging = false;
      this.handleEl.classList.remove('jects-splitter__handle--dragging');
      this.setRatio(this.ratioFromPointer(ev), true);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.track(() => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    });

    return root;
  }

  private get min(): number {
    return this.config.min ?? 0.1;
  }
  private get max(): number {
    return this.config.max ?? 0.9;
  }
  private get step(): number {
    return this.config.step ?? 0.05;
  }

  private clamp(r: number): number {
    return Math.min(this.max, Math.max(this.min, r));
  }

  /** Read the persisted ratio, if any and valid. */
  private loadPersisted(): number | undefined {
    const key = this.config.persist;
    if (!key) return undefined;
    try {
      const raw = globalThis.localStorage?.getItem(key);
      if (raw == null) return undefined;
      const n = Number.parseFloat(raw);
      return Number.isFinite(n) ? n : undefined;
    } catch {
      return undefined;
    }
  }

  private savePersisted(ratio: number): void {
    const key = this.config.persist;
    if (!key) return;
    try {
      globalThis.localStorage?.setItem(key, String(ratio));
    } catch {
      /* storage unavailable / quota — ignore */
    }
  }

  /** Current split ratio (fraction given to the first pane). */
  get ratio(): number {
    return this.clamp(this.config.ratio ?? 0.5);
  }

  /** Set the split ratio (clamped), emitting events. `commit` controls `resize`. */
  setRatio(ratio: number, commit = true): void {
    if (this.config.disabled) return;
    const prev = this.clamp(this.config.ratio ?? 0.5);
    const next = this.clamp(ratio);
    if (next === prev && commit) return;
    if (this.emit('beforeResize', { ratio: next, prev, splitter: this }) === false) return;
    this.config.ratio = next;
    this.applyRatio();
    if (commit) {
      this.savePersisted(next);
      this.config.onResize?.(next);
      this.emit('resize', { ratio: next, splitter: this });
    }
  }

  /** Reset to the midpoint of the allowed range. */
  reset(): void {
    this.setRatio((this.min + this.max) / 2, true);
  }

  private ratioFromPointer(e: PointerEvent): number {
    const rect = this.el.getBoundingClientRect();
    if (this.config.orientation === 'vertical') {
      return rect.height === 0 ? this.ratio : (e.clientY - rect.top) / rect.height;
    }
    return rect.width === 0 ? this.ratio : (e.clientX - rect.left) / rect.width;
  }

  private handlePointerDown(e: PointerEvent): void {
    if (this.config.disabled) return;
    e.preventDefault();
    this.dragging = true;
    this.handleEl.classList.add('jects-splitter__handle--dragging');
    this.handleEl.focus();
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (this.config.disabled) return;
    const horizontal = this.config.orientation !== 'vertical';
    const dec = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const inc = horizontal ? 'ArrowRight' : 'ArrowDown';
    let next: number | null = null;
    switch (e.key) {
      case dec:
        next = this.ratio - this.step;
        break;
      case inc:
        next = this.ratio + this.step;
        break;
      case 'Home':
        next = this.min;
        break;
      case 'End':
        next = this.max;
        break;
      default:
        return;
    }
    e.preventDefault();
    this.setRatio(next, true);
  }

  /** Apply current ratio to pane sizing + separator aria, without rebuilding panes. */
  private applyRatio(): void {
    const ratio = this.ratio;
    const pct = Math.round(ratio * 10000) / 100;
    this.el.style.setProperty('--_splitter-ratio', String(pct));
    const now = Math.round(ratio * 100);
    this.handleEl.setAttribute('aria-valuenow', String(now));
  }

  private disposePaneWidgets(): void {
    if (this.firstWidget && !this.firstWidget.isDestroyed) this.firstWidget.destroy();
    if (this.secondWidget && !this.secondWidget.isDestroyed) this.secondWidget.destroy();
    this.firstWidget = null;
    this.secondWidget = null;
  }

  private mountPane(host: HTMLElement, pane: SplitterPane | undefined): Widget | null {
    host.replaceChildren();
    if (pane === undefined) return null;
    if (pane instanceof Widget) {
      host.appendChild(pane.el);
      return pane;
    }
    if (pane instanceof HTMLElement) {
      host.appendChild(pane);
      return null;
    }
    // A string is authored HTML → sanitized by default; only the explicit
    // `trusted` opt-out injects it raw.
    setHtml(host, this.config.trusted ? trustedHtml(pane) : safeHtml(pane));
    return null;
  }

  protected override render(): void {
    const { orientation = 'horizontal', disabled = false, first, second } = this.config;

    const el = this.el;
    el.className = [
      'jects-splitter',
      `jects-splitter--${orientation}`,
      disabled ? 'jects-splitter--disabled' : '',
      this.config.cls ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    // (Re)build panes.
    this.disposePaneWidgets();
    this.firstWidget = this.mountPane(this.firstEl, first);
    this.secondWidget = this.mountPane(this.secondEl, second);

    // Separator aria.
    const handle = this.handleEl;
    handle.setAttribute(
      'aria-orientation',
      orientation === 'vertical' ? 'horizontal' : 'vertical',
    );
    handle.setAttribute('aria-valuemin', String(Math.round(this.min * 100)));
    handle.setAttribute('aria-valuemax', String(Math.round(this.max * 100)));
    handle.setAttribute('aria-label', 'Resize panes');
    handle.tabIndex = disabled ? -1 : 0;
    handle.setAttribute('aria-disabled', String(disabled));

    this.applyRatio();
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    this.disposePaneWidgets();
    super.destroy();
  }
}

register(
  'splitter',
  Splitter as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Splitter,
);
