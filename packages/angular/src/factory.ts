import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  effect,
  inject,
  input,
  output,
  untracked,
  type OnDestroy,
  type InputSignal,
  type OutputEmitterRef,
  type Type,
} from '@angular/core';

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
 * A single forwarded engine event: a discriminated union keyed by event name, so a
 * `(jectsEvent)` consumer can narrow on `type` and get a fully typed `payload`.
 *
 * `Grid` with `GridEvents` produces `{ type: 'selectionChange'; payload: … } | …`.
 */
export type JectsEventOf<Events> = {
  [K in keyof Events]: { type: K; payload: Events[K] };
}[keyof Events];

/**
 * The public surface of every generated Angular wrapper. Useful for typing a
 * `@ViewChild(JectsGrid)` reference without depending on the anonymous class shape.
 */
export interface JectsWidgetComponent<Inst, Config, Events> {
  /** Engine config. Diffed on change and pushed through `inst.update(patch)`. */
  readonly config: InputSignal<Partial<Config>>;
  /** Engine event names to forward to `(jectsEvent)`. Reconciled on change. */
  readonly events: InputSignal<(keyof Events & string)[]>;
  /** Emits `{ type, payload }` for each forwarded engine event. */
  readonly jectsEvent: OutputEmitterRef<JectsEventOf<Events>>;
  /** The live engine instance (or `null` before init / after destroy). */
  readonly instance: Inst | null;
}

export interface CreateComponentOptions<Config> {
  /**
   * Config keys that the engine cannot apply via `update()`. A change to any of
   * these forces a full destroy + recreate instead of an in-place update.
   * Everything else is diffed and pushed through `inst.update(patch)`.
   */
  nonUpdatableKeys?: (keyof Config)[];
  /**
   * The standalone component's element selector, e.g. `jects-grid`.
   * Defaults to `jects-<ctorname>` lowercased.
   */
  selector?: string;
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
 * Build a typed Angular standalone component from a `@jects/*` engine constructor.
 *
 * The returned component:
 * - constructs `new Ctor(host, config)` into its own host element **outside the
 *   Angular zone** (`NgZone.runOutsideAngular`) so engine internals never trigger
 *   change detection;
 * - reacts to `[config]` signal-input changes with an `effect()` that shallow-diffs
 *   and calls `inst.update(patch)` — it does NOT recreate on every change; a recreate
 *   happens only when a `nonUpdatableKeys` key changes;
 * - forwards the engine events named in `[events]` to the single typed `(jectsEvent)`
 *   output, re-entering the zone (`NgZone.run`) only to emit, and reconciling the
 *   bound set when `[events]` changes;
 * - exposes the live engine via the `instance` getter (imperative API);
 * - calls `inst.destroy()` in `ngOnDestroy`.
 */
export function createComponent<Inst extends object, Config, Events>(
  Ctor: WidgetCtor<Inst, Config>,
  opts: CreateComponentOptions<Config> = {},
): Type<JectsWidgetComponent<Inst, Config, Events>> {
  const nonUpdatable = new Set<string>((opts.nonUpdatableKeys ?? []).map((k) => String(k)));
  const selector = opts.selector ?? `jects-${Ctor.name.toLowerCase()}`;

  @Component({
    selector,
    standalone: true,
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
  })
  class JectsAngularComponent
    implements OnDestroy, JectsWidgetComponent<Inst, Config, Events>
  {
    private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;
    private readonly zone = inject(NgZone);

    readonly config = input<Partial<Config>>({});
    readonly events = input<(keyof Events & string)[]>([]);
    readonly jectsEvent = output<JectsEventOf<Events>>();

    private _instance: Inst | null = null;
    private prevConfig: Record<string, unknown> = {};
    private readonly bound = new Map<string, () => void>();

    constructor() {
      // Config effect: runs during change detection, so `config()` reflects the
      // committed `[config]` binding (a `componentRef.setInput` value is only
      // applied during CD, not synchronously). First run constructs the engine;
      // later runs diff and `update()` it.
      effect(() => {
        const next = this.config() as Record<string, unknown>;
        if (!this._instance) {
          this.create(next);
        } else {
          this.applyConfig(next);
        }
      });

      // Event reconciliation: tracks `events()`; no-op until the engine exists.
      effect(() => {
        const names = this.events();
        if (!this._instance) return;
        this.reconcileEvents(names);
      });
    }

    /** The live engine instance (or `null` before init / after destroy). */
    get instance(): Inst | null {
      return this._instance;
    }

    /** Construct the engine into the host element, outside the Angular zone. */
    private create(cfg: Record<string, unknown>): void {
      this.zone.runOutsideAngular(() => {
        const inst = new Ctor(this.host.nativeElement, cfg as Config);
        this._instance = inst;
        this.prevConfig = { ...cfg };
        // Read `events()` untracked so this (config) effect doesn't depend on it.
        untracked(() => this.reconcileEvents(this.events()));
      });
    }

    ngOnDestroy(): void {
      this.teardownEvents();
      const inst = this._instance as unknown as WidgetRuntime | null;
      inst?.destroy();
      this._instance = null;
    }

    /** Shallow-diff config and apply via `update()`, or recreate on a non-updatable change. */
    private applyConfig(next: Record<string, unknown>): void {
      const inst = this._instance as unknown as WidgetRuntime | null;
      if (!inst) return;

      const patch = diffConfig(this.prevConfig, next);
      const changed = Object.keys(patch);
      if (changed.length === 0) return;

      if (changed.some((k) => nonUpdatable.has(k))) {
        this.recreate(next);
        return;
      }

      this.zone.runOutsideAngular(() => inst.update(patch));
      this.prevConfig = { ...next };
    }

    /** Destroy and rebuild the engine (used for `nonUpdatableKeys` changes). */
    private recreate(next: Record<string, unknown>): void {
      this.zone.runOutsideAngular(() => {
        this.teardownEvents();
        (this._instance as unknown as WidgetRuntime | null)?.destroy();
        const inst = new Ctor(this.host.nativeElement, next as Config);
        this._instance = inst;
        this.prevConfig = { ...next };
        untracked(() => this.reconcileEvents(this.events()));
      });
    }

    /** Bind newly requested events; drop ones no longer in the list. */
    private reconcileEvents(names: readonly string[]): void {
      const inst = this._instance as unknown as WidgetRuntime | null;
      if (!inst) return;
      const wanted = new Set(names);

      for (const [evt, unbind] of this.bound) {
        if (!wanted.has(evt)) {
          unbind();
          this.bound.delete(evt);
        }
      }

      for (const evt of wanted) {
        if (this.bound.has(evt)) continue;
        const off = inst.on(evt, (payload) => {
          // Engine fired outside the zone; re-enter only to emit to Angular.
          this.zone.run(() => {
            this.jectsEvent.emit({ type: evt, payload } as JectsEventOf<Events>);
          });
        });
        this.bound.set(evt, typeof off === 'function' ? off : () => inst.off(evt));
      }
    }

    private teardownEvents(): void {
      for (const unbind of this.bound.values()) unbind();
      this.bound.clear();
    }
  }

  return JectsAngularComponent;
}
