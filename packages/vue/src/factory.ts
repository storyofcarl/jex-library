import {
  defineComponent,
  h,
  markRaw,
  onMounted,
  onUnmounted,
  shallowRef,
  useAttrs,
  watch,
  type DefineComponent,
} from 'vue';

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
  on(event: string, fn: (payload: unknown) => void): (() => void) | void;
  off(event: string, fn?: (payload: unknown) => void): void;
  update(patch: Record<string, unknown>): unknown;
  destroy(): void;
}

/**
 * `on<Event>` props derived from a component's Events map. `selectionChange` becomes
 * `onSelectionChange`, `click` becomes `onClick`, etc. Mirrors Vue's own listener
 * naming, so `<JectsGrid @selection-change="…">` binds the `selectionChange` event.
 */
export type JectsEventHandlers<Events> = {
  [K in keyof Events as `on${Capitalize<string & K>}`]?: (payload: Events[K]) => void;
};

/**
 * Props for a generated component: the engine config (minus any key that would
 * collide with an `on<Event>` handler — the handler typing wins), plus typed event
 * handlers, plus Vue's `class`/`style` applied to the host wrapper element.
 */
export type JectsComponentProps<Config, Events> = Omit<
  Partial<Config>,
  keyof JectsEventHandlers<Events>
> &
  JectsEventHandlers<Events> & {
    class?: unknown;
    style?: unknown;
  };

/**
 * The concrete Vue component type a per-component export resolves to. Typed so that
 * consumers get config props, `on<Event>` handlers, and `expose()`d imperative access.
 */
export type JectsVueComponent<Inst, Config, Events> = DefineComponent<
  JectsComponentProps<Config, Events>
> & {
  /** Imperative escape hatch type: the live engine instance, available after mount. */
  new (): { instance: Inst | null };
};

export interface CreateComponentOptions<Config> {
  /**
   * Config keys that the engine cannot apply via `update()`. A change to any of
   * these forces a full destroy + recreate instead of an in-place update.
   * Everything else is diffed and pushed through `inst.update(patch)`.
   */
  nonUpdatableKeys?: (keyof Config)[];
  /** Component display name. Defaults to a name derived from the constructor. */
  displayName?: string;
}

interface SplitProps {
  config: Record<string, unknown>;
  handlers: Record<string, (payload: unknown) => void>;
}

const EVENT_PROP = /^on[A-Z]/;

/** `onSelectionChange` -> `selectionChange`. */
function eventNameFromProp(key: string): string {
  return key.charAt(2).toLowerCase() + key.slice(3);
}

/**
 * Partition incoming attrs into engine config and event handlers.
 * `class`/`style` (applied to the host) and Vue's internal vnode hooks are dropped.
 */
function splitProps(attrs: Record<string, unknown>): SplitProps {
  const config: Record<string, unknown> = {};
  const handlers: Record<string, (payload: unknown) => void> = {};

  for (const key in attrs) {
    const value = attrs[key];
    if (key === 'class' || key === 'style' || key === 'ref' || key === 'key') continue;
    // Skip Vue's internal lifecycle vnode hooks (onVnodeMounted, onVnodeUpdated, …).
    if (key.startsWith('onVnode') || key.includes(':')) continue;
    if (EVENT_PROP.test(key) && typeof value === 'function') {
      handlers[eventNameFromProp(key)] = value as (payload: unknown) => void;
    } else {
      config[key] = value;
    }
  }

  return { config, handlers };
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
 * Build a typed Vue 3 component from a `@jects/*` engine constructor.
 *
 * The returned `defineComponent`:
 * - mounts `new Ctor(host, config)` into a wrapper `<div>` in `onMounted`, wrapping the
 *   instance in `markRaw` so Vue never makes the engine reactive;
 * - `watch`es the incoming attrs and shallow-diffs config, calling `inst.update(patch)` —
 *   it does NOT remount on every change; a remount happens only when a `nonUpdatableKeys`
 *   key changes;
 * - bridges `on<Event>` props to `inst.on(event, …)`, reading the latest handler through a
 *   live reference so swapping a handler never remounts or rebinds;
 * - exposes the live engine instance through `expose({ instance })` (imperative API);
 * - calls `inst.destroy()` in `onUnmounted`.
 */
export function createComponent<Inst extends object, Config, Events>(
  Ctor: WidgetCtor<Inst, Config>,
  opts: CreateComponentOptions<Config> = {},
): JectsVueComponent<Inst, Config, Events> {
  const nonUpdatable = new Set<string>((opts.nonUpdatableKeys ?? []).map((k) => String(k)));

  const Component = defineComponent({
    name: opts.displayName ?? `Jects${Ctor.name}`,
    // Engine config is consumed manually from attrs; never reflected onto the host DOM.
    inheritAttrs: false,
    setup(_props, { expose }) {
      const attrs = useAttrs();

      const hostRef = shallowRef<HTMLDivElement | null>(null);
      // The engine instance is markRaw-wrapped: large/data-heavy and never reactive.
      const instance = shallowRef<Inst | null>(null);

      let inst: Inst | null = null;
      let prevConfig: Record<string, unknown> = {};
      let currentHandlers: Record<string, (payload: unknown) => void> = {};
      const bound = new Map<string, () => void>();

      function runtime(): WidgetRuntime {
        return inst as unknown as WidgetRuntime;
      }

      /** Reconcile bound engine listeners against the current `on<Event>` handlers. */
      function reconcileHandlers(handlers: Record<string, (payload: unknown) => void>): void {
        currentHandlers = handlers;
        if (!inst) return;
        const rt = runtime();
        const wanted = new Set(Object.keys(handlers));
        // Drop handlers that are no longer present.
        for (const [evt, unbind] of bound) {
          if (!wanted.has(evt)) {
            unbind();
            bound.delete(evt);
          }
        }
        // Bind newly added handlers; the wrapper always reads the current handler.
        for (const evt of wanted) {
          if (bound.has(evt)) continue;
          const off = rt.on(evt, (payload) => {
            currentHandlers[evt]?.(payload);
          });
          bound.set(evt, typeof off === 'function' ? off : () => rt.off(evt));
        }
      }

      function create(): void {
        const host = hostRef.value;
        if (!host) return;
        const { config, handlers } = splitProps({ ...attrs });
        inst = markRaw(new Ctor(host, config as Config));
        instance.value = inst;
        prevConfig = { ...config };
        reconcileHandlers(handlers);
      }

      function teardown(): void {
        for (const unbind of bound.values()) unbind();
        bound.clear();
        if (inst) {
          runtime().destroy();
          inst = null;
          instance.value = null;
        }
      }

      /** Apply attr changes: shallow-diff -> `update(patch)`, or remount on a non-updatable change. */
      function sync(): void {
        if (!inst) return;
        const { config, handlers } = splitProps({ ...attrs });

        const patch = diffConfig(prevConfig, config);
        const changed = Object.keys(patch);
        if (changed.length > 0) {
          if (changed.some((k) => nonUpdatable.has(k))) {
            teardown();
            create();
            return;
          }
          runtime().update(patch);
          prevConfig = { ...config };
        }

        reconcileHandlers(handlers);
      }

      onMounted(create);
      onUnmounted(teardown);

      // Track every top-level attr; fires whenever any prop/handler reference changes.
      watch(
        () => {
          const snapshot: Record<string, unknown> = {};
          for (const key in attrs) snapshot[key] = attrs[key];
          return snapshot;
        },
        sync,
      );

      expose({ instance });

      return () =>
        h('div', {
          ref: hostRef,
          class: attrs.class,
          style: attrs.style,
        });
    },
  });

  return Component as unknown as JectsVueComponent<Inst, Config, Events>;
}
