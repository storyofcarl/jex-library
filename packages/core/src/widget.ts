/**
 * Widget — the abstract base every Jects component extends.
 *
 * Lifecycle:
 *   constructor(host, config) → buildEl() → render() → [update(patch) → render()]* → destroy()
 *
 * - Owns a single root `el`, appended into `host`.
 * - Mixes in a typed EventEmitter (`on`/`off`/`once`/`emit` with veto convention).
 * - Tracks reactive effects and delegated DOM listeners; `destroy()` disposes all.
 *
 * Subclasses MUST implement `buildEl()` (create & return the root element) and
 * SHOULD implement `render()` (sync DOM to current config). Override `update()`
 * only for custom patch handling.
 */

import { EventEmitter, type EventMap, type Handler, type HandlerOptions } from './events.js';
import { resolveHost, on as delegate, type Unbind } from './dom.js';
import { effect as createEffect } from './signals.js';

export interface WidgetConfig {
  /** Extra class names added to the root element. */
  cls?: string;
  /** Inline styles applied to the root element. */
  style?: Partial<CSSStyleDeclaration>;
  /** Initial hidden state. */
  hidden?: boolean;
  /** Initial disabled state. */
  disabled?: boolean;
}

export interface WidgetEvents extends EventMap {
  beforeDestroy: { widget: Widget };
  destroy: { widget: Widget };
  render: { widget: Widget };
  show: { widget: Widget };
  hide: { widget: Widget };
}

let widgetSeq = 0;

export abstract class Widget<
  Config extends WidgetConfig = WidgetConfig,
  Events extends EventMap = WidgetEvents,
> {
  /** Unique per-instance id, e.g. `jects-7`. */
  readonly id: string;
  /** The single root element this widget owns. */
  readonly el: HTMLElement;
  /** The host element this widget was mounted into. */
  protected readonly host: HTMLElement;

  protected config: Config;
  private readonly emitter = new EventEmitter<Events>();
  private readonly disposers: Unbind[] = [];
  private _destroyed = false;

  constructor(host: HTMLElement | string, config?: Config) {
    this.id = `jects-${++widgetSeq}`;
    this.host = resolveHost(host);
    this.config = { ...this.defaults(), ...(config ?? {}) } as Config;
    this.el = this.buildEl();
    this.el.id ||= this.id;
    this.applyBaseConfig();
    this.host.appendChild(this.el);
    this.render();
    this.emit('render' as keyof Events, { widget: this } as Events[keyof Events]);
  }

  /** Default config merged under user config. Override to supply component defaults. */
  protected defaults(): Partial<Config> {
    return {};
  }

  /** Build and return the root element. Called once in the constructor. */
  protected abstract buildEl(): HTMLElement;

  /** Sync the DOM to the current `config`. Called after build and after each update. */
  protected render(): void {}

  /** Apply base WidgetConfig (cls/style/hidden/disabled) to the root. */
  protected applyBaseConfig(): void {
    const { cls, style, hidden, disabled } = this.config;
    if (cls) this.el.className = `${this.el.className} ${cls}`.trim();
    if (style) Object.assign(this.el.style, style);
    if (hidden) this.el.hidden = true;
    if (disabled) this.el.setAttribute('aria-disabled', 'true');
  }

  /** Merge `patch` into config and re-render. Returns `this` for chaining. */
  update(patch: Partial<Config>): this {
    if (this._destroyed) return this;
    this.config = { ...this.config, ...patch };
    this.render();
    return this;
  }

  /** Read the current (frozen-ish) config. */
  getConfig(): Readonly<Config> {
    return this.config;
  }

  // ---- visibility ---------------------------------------------------------

  show(): this {
    this.el.hidden = false;
    this.emit('show' as keyof Events, { widget: this } as Events[keyof Events]);
    return this;
  }

  hide(): this {
    this.el.hidden = true;
    this.emit('hide' as keyof Events, { widget: this } as Events[keyof Events]);
    return this;
  }

  get isDestroyed(): boolean {
    return this._destroyed;
  }

  // ---- events (delegated to the internal emitter) -------------------------

  on<K extends keyof Events>(event: K, fn: Handler<Events[K]>, options?: HandlerOptions): () => void {
    return this.emitter.on(event, fn, options);
  }

  once<K extends keyof Events>(event: K, fn: Handler<Events[K]>, options?: HandlerOptions): () => void {
    return this.emitter.once(event, fn, options);
  }

  off<K extends keyof Events>(event: K, fn?: Handler<Events[K]>, id?: string): void {
    this.emitter.off(event, fn, id);
  }

  /** Emit an event. Returns `false` if a `beforeX`-style handler vetoed. */
  emit<K extends keyof Events>(event: K, payload: Events[K]): boolean {
    return this.emitter.emit(event, payload);
  }

  // ---- protected helpers for subclasses -----------------------------------

  /** Register a reactive effect that is auto-disposed on `destroy()`. */
  protected effect(fn: () => void): void {
    this.disposers.push(createEffect(fn));
  }

  /** Register a delegated DOM listener on the root, auto-removed on `destroy()`. */
  protected on2<E extends keyof HTMLElementEventMap>(
    selector: string,
    evt: E,
    fn: (event: HTMLElementEventMap[E], matched: HTMLElement) => void,
  ): void {
    this.disposers.push(delegate(this.el, selector, evt, fn));
  }

  /** Register an arbitrary disposer to run on `destroy()`. */
  protected track(disposer: Unbind): void {
    this.disposers.push(disposer);
  }

  /** Bind a plain (non-delegated) listener on the root, auto-removed on destroy. */
  protected listen<E extends keyof HTMLElementEventMap>(
    evt: E,
    fn: (event: HTMLElementEventMap[E]) => void,
  ): void {
    this.el.addEventListener(evt, fn as EventListener);
    this.disposers.push(() => this.el.removeEventListener(evt, fn as EventListener));
  }

  // ---- teardown -----------------------------------------------------------

  /** Tear down: vetoable via `beforeDestroy`. Removes el, disposes effects & listeners. */
  destroy(): void {
    if (this._destroyed) return;
    const ok = this.emit('beforeDestroy' as keyof Events, { widget: this } as Events[keyof Events]);
    if (ok === false) return;
    this._destroyed = true;
    for (const d of this.disposers.splice(0)) {
      try {
        d();
      } catch {
        /* ignore disposer errors during teardown */
      }
    }
    this.el.remove();
    this.emit('destroy' as keyof Events, { widget: this } as Events[keyof Events]);
    this.emitter.clear();
  }
}
