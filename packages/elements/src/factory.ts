/**
 * Generic custom-element factory over the uniform `@jects/core` `Widget` contract.
 *
 * Every `@jects/*` component shares the same runtime shape — `new Ctor(host, config)`
 * with `.on/.off/.update(partial)/.getConfig()/.destroy()/.el` — so a single factory
 * can turn any of them into a light-DOM Web Component. The produced element:
 * - constructs `new Ctor(this, config)` in `connectedCallback`, rendering the engine
 *   directly INTO the custom element (LIGHT DOM, no shadow root — consistent with the
 *   rest of the suite);
 * - reads config from a `config` property and/or observed attributes;
 * - re-dispatches engine events as DOM `CustomEvent`s, bound lazily the first time a
 *   listener is added for that type (mirrors the on-demand bridging in `@jects/react`);
 * - diffs config changes and calls `inst.update(patch)` in place, remounting only when
 *   a `nonUpdatableKeys` key changes;
 * - calls `inst.destroy()` in `disconnectedCallback`.
 */

/**
 * Constructor shape every `@jects/*` component shares: `new Ctor(host, config)`.
 * The host is the DOM element the engine mounts itself into.
 */
export interface WidgetCtor<Inst, Config> {
  new (host: HTMLElement | string, config?: Config): Inst;
}

/**
 * Minimal runtime view of the `@jects/core` `Widget` contract the factory drives.
 * Per-component instance types are far richer; this is only what the bridge calls.
 */
interface WidgetRuntime {
  readonly el: HTMLElement;
  readonly isDestroyed: boolean;
  on(event: string, fn: (payload: unknown) => void): (() => void) | void;
  off(event: string, fn?: (payload: unknown) => void): void;
  update(patch: Record<string, unknown>): unknown;
  destroy(): void;
}

/**
 * Typed custom-element instance produced by {@link createComponent}. Carries the
 * engine config via the `config` property and exposes typed `addEventListener`
 * overloads keyed off the component's `Events` map (each delivered as a
 * `CustomEvent<Events[K]>` whose `detail` is the engine payload).
 */
export interface JectsElement<Inst extends object, Config, Events> extends HTMLElement {
  /** Engine config. Setting it diffs against the live config and applies an update. */
  config: Partial<Config>;
  /** The live engine instance (null before connect / after disconnect). */
  readonly instance: Inst | null;

  addEventListener<K extends keyof Events & string>(
    type: K,
    listener: (this: JectsElement<Inst, Config, Events>, ev: CustomEvent<Events[K]>) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;

  removeEventListener<K extends keyof Events & string>(
    type: K,
    listener: (this: JectsElement<Inst, Config, Events>, ev: CustomEvent<Events[K]>) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

/** Constructor type for a generated custom element (assignable to `CustomElementConstructor`). */
export interface JectsElementConstructor<Inst extends object, Config, Events> {
  new (): JectsElement<Inst, Config, Events>;
  readonly observedAttributes: string[];
}

export interface CreateComponentOptions<Config> {
  /**
   * Config keys the engine cannot apply via `update()`. A change to any of these
   * forces a full destroy + recreate instead of an in-place update. Everything else
   * is diffed and pushed through `inst.update(patch)`.
   */
  nonUpdatableKeys?: (keyof Config)[];
  /**
   * Plain string attributes (besides the reserved `config` attribute) that should be
   * merged into config. Their values are passed through verbatim as strings.
   */
  observedAttributes?: string[];
}

/** Parse a JSON config attribute, tolerating malformed input. */
function safeParse(json: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json);
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Shallow-diff two config objects. Returns the changed keys (removed keys -> `undefined`). */
function diffConfig(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key in next) {
    if (!Object.is(prev[key], next[key])) patch[key] = next[key];
  }
  for (const key in prev) {
    if (!(key in next)) patch[key] = undefined;
  }
  return patch;
}

/**
 * Build a typed light-DOM custom element class from a `@jects/*` engine constructor.
 * Register it with {@link import('./index.js').register} or `customElements.define(tag, El)`.
 */
export function createComponent<Inst extends object, Config, Events>(
  Ctor: WidgetCtor<Inst, Config>,
  opts: CreateComponentOptions<Config> = {},
): JectsElementConstructor<Inst, Config, Events> {
  const nonUpdatable = new Set<string>((opts.nonUpdatableKeys ?? []).map((k) => String(k)));
  const observed = ['config', ...(opts.observedAttributes ?? []).map((a) => String(a))];

  class JectsCustomElement extends HTMLElement {
    static get observedAttributes(): string[] {
      return observed;
    }

    #instance: Inst | null = null;
    #config: Record<string, unknown> = {};
    /** Event types a consumer has subscribed to (kept across remounts). */
    #wanted = new Set<string>();
    /** Active engine subscriptions, keyed by event type. */
    #bound = new Map<string, () => void>();

    get instance(): Inst | null {
      return this.#instance;
    }

    get config(): Partial<Config> {
      return this.#config as Partial<Config>;
    }

    set config(value: Partial<Config> | null | undefined) {
      this.#applyConfig({ ...(value ?? {}) } as Record<string, unknown>);
    }

    connectedCallback(): void {
      if (this.#instance) return;
      this.#config = { ...this.#config, ...this.#readAttributes() };
      this.#instance = new Ctor(this, this.#config as Config);
      for (const type of this.#wanted) this.#bind(type);
    }

    disconnectedCallback(): void {
      this.#teardown();
    }

    attributeChangedCallback(name: string, _oldValue: string | null, value: string | null): void {
      // Initial attribute values are folded in by connectedCallback; only react to
      // live changes once the engine exists.
      if (!this.#instance) return;
      if (name === 'config') {
        this.#applyConfig(value ? safeParse(value) : {});
      } else {
        this.#applyConfig({ ...this.#config, [name]: value });
      }
    }

    // Lazily bridge engine events: the first listener for a type binds `inst.on`.
    override addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void {
      super.addEventListener(type, listener as EventListenerOrEventListenerObject, options);
      if (!this.#wanted.has(type)) {
        this.#wanted.add(type);
        this.#bind(type);
      }
    }

    #readAttributes(): Record<string, unknown> {
      const out: Record<string, unknown> = {};
      const cfgAttr = this.getAttribute('config');
      if (cfgAttr) Object.assign(out, safeParse(cfgAttr));
      for (const name of observed) {
        if (name === 'config') continue;
        const v = this.getAttribute(name);
        if (v !== null) out[name] = v;
      }
      return out;
    }

    #applyConfig(next: Record<string, unknown>): void {
      const inst = this.#instance as unknown as WidgetRuntime | null;
      if (!inst) {
        this.#config = next;
        return;
      }
      const patch = diffConfig(this.#config, next);
      this.#config = next;
      const changed = Object.keys(patch);
      if (changed.length === 0) return;
      if (changed.some((k) => nonUpdatable.has(k))) {
        this.#remount();
        return;
      }
      inst.update(patch);
    }

    #remount(): void {
      this.#teardown();
      this.#instance = new Ctor(this, this.#config as Config);
      for (const type of this.#wanted) this.#bind(type);
    }

    #bind(type: string): void {
      if (this.#bound.has(type)) return;
      const inst = this.#instance as unknown as WidgetRuntime | null;
      if (!inst) return;
      const off = inst.on(type, (payload: unknown) => {
        this.dispatchEvent(new CustomEvent(type, { detail: payload, bubbles: true, composed: true }));
      });
      this.#bound.set(type, typeof off === 'function' ? off : () => inst.off(type));
    }

    #teardown(): void {
      for (const off of this.#bound.values()) off();
      this.#bound.clear();
      const inst = this.#instance as unknown as WidgetRuntime | null;
      if (inst && !inst.isDestroyed) inst.destroy();
      this.#instance = null;
    }
  }

  return JectsCustomElement as unknown as JectsElementConstructor<Inst, Config, Events>;
}
