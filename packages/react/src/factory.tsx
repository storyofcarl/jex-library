import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ForwardRefExoticComponent,
  type PropsWithoutRef,
  type RefAttributes,
} from 'react';

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
 * `onSelectionChange`, `click` becomes `onClick`, etc.
 */
export type JectsEventHandlers<Events> = {
  [K in keyof Events as `on${Capitalize<string & K>}`]?: (payload: Events[K]) => void;
};

/**
 * Props for a generated component: the engine config (minus any key that would
 * collide with an `on<Event>` handler — the handler typing wins), plus typed event
 * handlers, plus React's `className`/`style` applied to the host wrapper element.
 */
export type JectsComponentProps<Config, Events> = Omit<
  Partial<Config>,
  keyof JectsEventHandlers<Events>
> &
  JectsEventHandlers<Events> & {
    className?: string;
    style?: CSSProperties;
  };

export interface CreateComponentOptions<Config> {
  /**
   * Config keys that the engine cannot apply via `update()`. A change to any of
   * these forces a full destroy + recreate instead of an in-place update.
   * Everything else is diffed and pushed through `inst.update(patch)`.
   */
  nonUpdatableKeys?: (keyof Config)[];
  /** React devtools display name. Defaults to the constructor name. */
  displayName?: string;
}

interface SplitProps {
  config: Record<string, unknown>;
  handlers: Record<string, (payload: unknown) => void>;
  className: string | undefined;
  style: CSSProperties | undefined;
}

const EVENT_PROP = /^on[A-Z]/;

/** `onSelectionChange` -> `selectionChange`. */
function eventNameFromProp(key: string): string {
  return key.charAt(2).toLowerCase() + key.slice(3);
}

/** Partition incoming React props into engine config, event handlers, and host styling. */
function splitProps(props: Record<string, unknown>): SplitProps {
  const config: Record<string, unknown> = {};
  const handlers: Record<string, (payload: unknown) => void> = {};
  let className: string | undefined;
  let style: CSSProperties | undefined;

  for (const key in props) {
    const value = props[key];
    if (key === 'className') {
      className = value as string | undefined;
    } else if (key === 'style') {
      style = value as CSSProperties | undefined;
    } else if (EVENT_PROP.test(key) && typeof value === 'function') {
      handlers[eventNameFromProp(key)] = value as (payload: unknown) => void;
    } else {
      config[key] = value;
    }
  }

  return { config, handlers, className, style };
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
 * Build a typed React component from a `@jects/*` engine constructor.
 *
 * The returned `forwardRef` component:
 * - mounts `new Ctor(host, config)` into a wrapper `<div>` in a layout effect;
 * - on prop changes shallow-diffs config and calls `inst.update(patch)` — it does
 *   NOT remount on every render; a remount happens only when a `nonUpdatableKeys`
 *   key changes;
 * - bridges `on<Event>` props to `inst.on(event, ...)`, keeping handlers current via
 *   a ref so changing a handler never remounts or rebinds;
 * - exposes the live engine instance through the forwarded ref (imperative API);
 * - calls `inst.destroy()` on unmount and is SSR-safe (no DOM access during render).
 */
export function createComponent<Inst extends object, Config, Events>(
  Ctor: WidgetCtor<Inst, Config>,
  opts: CreateComponentOptions<Config> = {},
): ForwardRefExoticComponent<
  PropsWithoutRef<JectsComponentProps<Config, Events>> & RefAttributes<Inst>
> {
  const nonUpdatable = new Set<string>((opts.nonUpdatableKeys ?? []).map((k) => String(k)));

  const Component = forwardRef<Inst, JectsComponentProps<Config, Events>>(
    function JectsReactComponent(props, ref) {
      const { config, handlers, className, style } = splitProps(
        props as Record<string, unknown>,
      );

      const hostRef = useRef<HTMLDivElement | null>(null);
      const instanceRef = useRef<Inst | null>(null);

      // Latest config/handlers, readable from inside long-lived effect closures.
      const configRef = useRef(config);
      configRef.current = config;
      const handlersRef = useRef(handlers);
      handlersRef.current = handlers;

      const prevConfigRef = useRef<Record<string, unknown> | null>(null);
      const boundRef = useRef<Map<string, () => void>>(new Map());

      // Bumping this destroys and recreates the engine (used for non-updatable changes).
      const [remountToken, setRemountToken] = useState(0);

      // --- mount / unmount ---------------------------------------------------
      useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        // Capture the bound-handlers map locally so the cleanup uses the same
        // (stable, never-reassigned) Map instance even if a ref read would lint
        // as "may have changed" (react-hooks/exhaustive-deps).
        const bound = boundRef.current;
        const inst = new Ctor(host, configRef.current as Config);
        instanceRef.current = inst;
        prevConfigRef.current = { ...configRef.current };

        return () => {
          for (const unbind of bound.values()) unbind();
          bound.clear();
          (inst as unknown as WidgetRuntime).destroy();
          instanceRef.current = null;
          prevConfigRef.current = null;
        };
        // Mounts/unmounts the engine only on remount (token bump).
      }, [remountToken]);

      // --- config -> update() (or remount on a non-updatable change) ---------
      // Intentionally runs on EVERY commit (no dep array) to reconcile the latest
      // props against the live engine via configRef. setRemountToken is guarded by
      // the diff/change check below, so it cannot loop — a constraint the rule
      // can't model, hence the scoped disable.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      useLayoutEffect(() => {
        const inst = instanceRef.current as unknown as WidgetRuntime | null;
        const prev = prevConfigRef.current;
        if (!inst || !prev) return;

        const next = configRef.current;
        const patch = diffConfig(prev, next);
        const changed = Object.keys(patch);
        if (changed.length === 0) return;

        if (changed.some((k) => nonUpdatable.has(k))) {
          setRemountToken((t) => t + 1);
          return;
        }

        inst.update(patch);
        prevConfigRef.current = { ...next };
      });

      // --- event bridging: reconcile bound handlers when the key set changes -
      const handlerKeys = Object.keys(handlers).sort().join(',');
      useLayoutEffect(() => {
        const inst = instanceRef.current as unknown as WidgetRuntime | null;
        if (!inst) return;

        const wanted = new Set(Object.keys(handlersRef.current));
        // Drop handlers that are no longer present.
        for (const [evt, unbind] of boundRef.current) {
          if (!wanted.has(evt)) {
            unbind();
            boundRef.current.delete(evt);
          }
        }
        // Bind newly added handlers; the wrapper always reads the current handler.
        for (const evt of wanted) {
          if (boundRef.current.has(evt)) continue;
          const off = inst.on(evt, (payload) => {
            handlersRef.current[evt]?.(payload);
          });
          boundRef.current.set(
            evt,
            typeof off === 'function' ? off : () => inst.off(evt),
          );
        }
        // Intentional: reconcile bound handlers only when the key set or
        // remount token changes. (react-hooks/exhaustive-deps is not enabled.)
      }, [handlerKeys, remountToken]);

      // --- expose the live engine instance via the forwarded ref -------------
      // No dep array: refresh the handle every commit so it always resolves the
      // current instance (incl. after a remount) without an "unnecessary dep".
      useImperativeHandle(ref, () => instanceRef.current as Inst);

      return <div ref={hostRef} className={className} style={style} />;
    },
  );

  Component.displayName = opts.displayName ?? `Jects(${Ctor.name})`;
  return Component;
}
