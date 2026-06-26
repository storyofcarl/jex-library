/**
 * Scheduler PRO — auto-reschedule wiring (Scheduler Pro's flagship behaviour).
 *
 * The pure constraint solver in `scheduling-engine.ts` (`schedule()`) is *data →
 * data*: feed it events + dependencies + a working calendar, get back the
 * adjusted spans. On its own nothing calls it from the live view. This module is
 * the missing seam: it wires `schedule()` to a running `Scheduler` so that
 * moving/resizing an event — or creating/removing a dependency — cascades to all
 * dependent events, exactly like Bryntum Scheduler Pro / DHTMLX auto-scheduling.
 *
 * Design (concurrency-safe, additive):
 *   - It is a standalone **plugin** installed onto a `Scheduler` instance via
 *     `installAutoReschedule(scheduler, config)` (or `new AutoReschedulePlugin`),
 *     so it never edits the main `Scheduler` class. It uses only the scheduler's
 *     PUBLIC surface (`getEventStore()`, `getConfig()`, `on()`, `emit()`).
 *   - On `eventChange` / `dependencyCreate` / `eventDelete` it re-runs the engine
 *     over the whole event+dependency+calendar set, diffs the result, and writes
 *     the changed spans back into the event store.
 *   - **Veto:** before applying the cascade it emits a vetoable
 *     `beforeAutoReschedule` event; any handler returning `false` cancels the
 *     write-back (the trigger change stands, dependents are left untouched).
 *   - **Animation:** rescheduled bars get a brief `--rescheduled` class so the
 *     repaint visibly flashes/eases the cascade (token-pure CSS, honours
 *     `prefers-reduced-motion`).
 *   - **Re-entrancy guard:** the engine's own write-backs would re-fire
 *     `eventChange`; a guard flag suppresses recursion so one user gesture yields
 *     exactly one cascade pass.
 *
 * The plugin is itself disposable: `destroy()` removes every listener it added
 * and clears any pending animation timer. It is also auto-disposed when the host
 * scheduler is destroyed (it tracks `destroy`).
 */

import { EventEmitter, type RecordId, type EventMap } from '@jects/core';
import type { WorkingTimeCalendar } from '@jects/timeline-core';
import type {
  EventModel,
  DependencyModel,
  SchedulerConfig,
} from '../contract.js';
import { schedule, type ScheduledSpan, type ScheduleDirection } from './scheduling-engine.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Minimal structural view of the host Scheduler.

   We deliberately depend on a STRUCTURAL interface rather than importing the
   concrete `Scheduler` class, so this plugin (a) has no circular import with the
   view module and (b) is trivially testable in jsdom with a fake host. Any
   object exposing this surface can be auto-rescheduled.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The slice of `@jects/core` Store the plugin needs (read + write spans). */
export interface AutoRescheduleEventStore {
  forEach(fn: (record: EventModel) => void): void;
  getById(id: RecordId): EventModel | undefined;
  update(id: RecordId, changes: Partial<EventModel>): EventModel | undefined;
}

/** The slice of the host `Scheduler` the plugin needs. */
export interface AutoRescheduleHost {
  getEventStore(): AutoRescheduleEventStore;
  getConfig(): Readonly<SchedulerConfig>;
  on<E extends string>(event: E, fn: (payload: never) => unknown): () => void;
  emit<E extends string>(event: E, payload: unknown): boolean;
  readonly el?: HTMLElement;
  readonly isDestroyed?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Config + events
   ═══════════════════════════════════════════════════════════════════════════ */

/** Auto-reschedule plugin configuration. */
export interface AutoRescheduleConfig {
  /**
   * Master switch. When `false` the plugin installs its listeners but performs
   * no cascade (so it can be toggled live). Default `true`.
   */
  enabled?: boolean;
  /** Scheduling direction passed to the engine. Default `'forward'`. */
  direction?: ScheduleDirection;
  /**
   * Working-time calendar. When omitted the host scheduler's `calendar` config
   * is used (falling back to the engine default Mon–Fri 9–17).
   */
  calendar?: WorkingTimeCalendar;
  /**
   * Override the dependency set. When omitted the host scheduler's
   * `dependencies` config is read live on every cascade.
   */
  dependencies?: DependencyModel[];
  /**
   * Duration (ms) the `--rescheduled` animation class stays on a moved bar.
   * `0` disables the animation flag entirely. Default `600`.
   */
  animationMs?: number;
}

/** The result of one cascade pass (also the `autoReschedule` event payload). */
export interface AutoRescheduleResult {
  /** The event whose change triggered the cascade (if any). */
  trigger?: EventModel;
  /** The spans the engine changed and the plugin wrote back. */
  changes: ScheduledSpan[];
}

/** Typed event map for the plugin's own emitter. */
export interface AutoRescheduleEvents extends EventMap {
  /** Vetoable: the cascade is about to be written back. Return `false` to cancel. */
  beforeAutoReschedule: { trigger?: EventModel; changes: ScheduledSpan[] };
  /** The cascade was applied (spans written back to the store). */
  autoReschedule: AutoRescheduleResult;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Pure core — usable headless (jsdom) without a real Scheduler.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Normalize `SchedulerConfig.dependencies` (a plain array OR a reactive
 * `Store<DependencyModel>`) into a plain array. Avoids importing the concrete
 * Store class — any value exposing `toArray()` is treated as a store.
 */
export function toDependencyArray(
  src: ReadonlyArray<DependencyModel> | { toArray(): DependencyModel[] } | undefined,
): DependencyModel[] {
  if (!src) return [];
  if (Array.isArray(src)) return src as DependencyModel[];
  if (typeof (src as { toArray?: unknown }).toArray === 'function') {
    return (src as { toArray(): DependencyModel[] }).toArray();
  }
  return [];
}

/** Snapshot the live event records from a store into a plain array. */
export function snapshotEvents(store: AutoRescheduleEventStore): EventModel[] {
  const out: EventModel[] = [];
  store.forEach((e) => out.push(e));
  return out;
}

/**
 * Compute the cascade for a given event/dependency/calendar set. Pure: returns
 * the spans the engine would change. This is the headless heart of the feature
 * (the plugin merely wires it to store write-backs + veto + animation).
 */
export function computeCascade(input: {
  events: ReadonlyArray<EventModel>;
  dependencies: ReadonlyArray<DependencyModel>;
  calendar?: WorkingTimeCalendar;
  direction?: ScheduleDirection;
}): ScheduledSpan[] {
  if (input.dependencies.length === 0) return [];
  return schedule({
    events: input.events,
    dependencies: input.dependencies,
    ...(input.calendar ? { calendar: input.calendar } : {}),
    ...(input.direction ? { direction: input.direction } : {}),
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   The plugin
   ═══════════════════════════════════════════════════════════════════════════ */

export class AutoReschedulePlugin {
  private readonly host: AutoRescheduleHost;
  private cfg: Required<Omit<AutoRescheduleConfig, 'calendar' | 'dependencies'>> &
    Pick<AutoRescheduleConfig, 'calendar' | 'dependencies'>;
  private readonly emitter = new EventEmitter<AutoRescheduleEvents>();
  private readonly disposers: Array<() => void> = [];
  /** Re-entrancy guard: true while the plugin is writing its own cascade. */
  private applying = false;
  private destroyed = false;
  /** Pending animation-clear timers, so destroy() can cancel them. */
  private readonly animTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Ids currently in their "rescheduled" flash window (survives repaints). */
  private readonly flashing = new Set<string>();
  /** Observer that re-applies the flash class after the scheduler repaints bars. */
  private flashObserver: MutationObserver | null = null;

  constructor(host: AutoRescheduleHost, config: AutoRescheduleConfig = {}) {
    this.host = host;
    this.cfg = {
      enabled: config.enabled ?? true,
      direction: config.direction ?? 'forward',
      animationMs: config.animationMs ?? 600,
      ...(config.calendar ? { calendar: config.calendar } : {}),
      ...(config.dependencies ? { dependencies: config.dependencies } : {}),
    };
    this.install();
  }

  /* ── public API ─────────────────────────────────────────────────────────── */

  /** Subscribe to a plugin event (`beforeAutoReschedule` veto / `autoReschedule`). */
  on<K extends keyof AutoRescheduleEvents>(
    event: K,
    fn: (payload: AutoRescheduleEvents[K]) => unknown,
  ): () => void {
    return this.emitter.on(event, fn);
  }

  /** Enable/disable the cascade at runtime without re-installing listeners. */
  setEnabled(enabled: boolean): this {
    this.cfg.enabled = enabled;
    return this;
  }

  /** Whether the cascade is currently active. */
  get enabled(): boolean {
    return this.cfg.enabled;
  }

  /**
   * Run a cascade pass NOW (e.g. after programmatically mutating dependencies).
   * Returns the spans written back. A no-op while disabled / destroyed.
   */
  reschedule(trigger?: EventModel): ScheduledSpan[] {
    return this.runCascade(trigger);
  }

  /** Remove all listeners + timers this plugin installed. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const t of this.animTimers) clearTimeout(t);
    this.animTimers.clear();
    this.flashing.clear();
    this.flashObserver?.disconnect();
    this.flashObserver = null;
    for (const off of this.disposers.splice(0)) {
      try {
        off();
      } catch {
        /* listener already gone */
      }
    }
    this.emitter.clear();
  }

  /* ── wiring ───────────────────────────────────────────────────────────────── */

  private install(): void {
    // A change to ANY of these can cascade to dependents.
    this.disposers.push(
      this.host.on('eventChange', (p: { event: EventModel }) => this.onTrigger(p?.event)),
    );
    this.disposers.push(this.host.on('dependencyCreate', () => this.onTrigger(undefined)));
    this.disposers.push(this.host.on('eventDelete', () => this.onTrigger(undefined)));
    // Auto-dispose when the host scheduler is destroyed.
    this.disposers.push(this.host.on('destroy', () => this.destroy()));
  }

  private onTrigger(trigger: EventModel | undefined): void {
    // Suppress recursion: our own write-backs re-fire `eventChange`.
    if (this.applying) return;
    this.runCascade(trigger);
  }

  /* ── cascade ──────────────────────────────────────────────────────────────── */

  private runCascade(trigger: EventModel | undefined): ScheduledSpan[] {
    if (this.destroyed || !this.cfg.enabled) return [];
    if (this.host.isDestroyed) return [];

    const store = this.host.getEventStore();
    const events = snapshotEvents(store);
    const dependencies = this.resolveDependencies();
    if (dependencies.length === 0) return [];

    const calendar = this.cfg.calendar ?? this.host.getConfig().calendar;
    const changes = computeCascade({
      events,
      dependencies,
      ...(calendar ? { calendar } : {}),
      direction: this.cfg.direction,
    });

    // Drop changes to the trigger itself: the user's gesture already placed it,
    // and re-writing it would fight the gesture / loop. The engine generally
    // leaves a moved predecessor put, but guard defensively.
    const applicable = trigger
      ? changes.filter((c) => c.id !== trigger.id)
      : changes;
    if (applicable.length === 0) return [];

    // Veto hook — let an app cancel the whole cascade.
    const vetoPayload: AutoRescheduleEvents['beforeAutoReschedule'] = {
      changes: applicable,
      ...(trigger ? { trigger } : {}),
    };
    if (this.emitter.emit('beforeAutoReschedule', vetoPayload) === false) return [];
    // Also surface the veto on the host so app-level `beforeAutoReschedule`
    // handlers work without subscribing to the plugin directly.
    if (this.host.emit('beforeAutoReschedule', vetoPayload) === false) return [];

    // Write back inside the re-entrancy guard so the resulting store `change`
    // events (and the host's `eventChange`) don't recurse into another cascade.
    this.applying = true;
    try {
      for (const span of applicable) {
        store.update(span.id, { startDate: span.startDate, endDate: span.endDate });
      }
    } finally {
      this.applying = false;
    }

    this.flashRescheduled(applicable);

    const result: AutoRescheduleResult = {
      changes: applicable,
      ...(trigger ? { trigger } : {}),
    };
    this.emitter.emit('autoReschedule', result);
    this.host.emit('autoReschedule', result);
    return applicable;
  }

  /**
   * Resolve the dependency set: explicit config wins, else the host's config.
   * `SchedulerConfig.dependencies` may now be either a plain array or a live
   * reactive `Store<DependencyModel>` (the "dependencies as a Store" feature), so
   * normalize either form into an array. Reading the store live means the cascade
   * always sees links created/deleted at runtime by the editing UI.
   */
  private resolveDependencies(): DependencyModel[] {
    if (this.cfg.dependencies) return this.cfg.dependencies;
    return toDependencyArray(this.host.getConfig().dependencies);
  }

  /**
   * Briefly mark the rescheduled bars so the repaint animates the cascade.
   *
   * The scheduler repaints its bars (replaceChildren) on every store change AND
   * after the drag gesture ends, so a class set directly on a bar node would be
   * wiped by the next repaint. To make the flash robust we (a) track the flashing
   * ids in `this.flashing`, (b) (re)apply the class via a `MutationObserver` on
   * the bars layer so freshly-painted bars get re-tagged, and (c) clear each id
   * after `animationMs`. All timers + the observer are torn down on destroy.
   */
  private flashRescheduled(changes: ScheduledSpan[]): void {
    const ms = this.cfg.animationMs;
    const root = this.host.el;
    if (ms <= 0 || !root || typeof root.querySelectorAll !== 'function') return;

    for (const c of changes) {
      const id = String(c.id);
      this.flashing.add(id);
      // Clear this id after the animation window.
      const clear = setTimeout(() => {
        this.animTimers.delete(clear);
        this.flashing.delete(id);
        this.applyFlashClasses();
        if (this.flashing.size === 0) {
          this.flashObserver?.disconnect();
          this.flashObserver = null;
        }
      }, ms);
      this.animTimers.add(clear);
    }

    this.ensureFlashObserver(root);
    // Apply now (after the synchronous store-change repaint that already ran) and
    // again on the next tick to cover the gesture's trailing `onEnd` repaint.
    this.applyFlashClasses();
    const kick = setTimeout(() => {
      this.animTimers.delete(kick);
      this.applyFlashClasses();
    }, 0);
    this.animTimers.add(kick);
  }

  /** Lazily attach a MutationObserver that re-tags flashing bars after repaints. */
  private ensureFlashObserver(root: HTMLElement): void {
    if (this.flashObserver || typeof MutationObserver === 'undefined') return;
    const bars = root.querySelector('.jects-scheduler__bars') ?? root;
    this.flashObserver = new MutationObserver(() => this.applyFlashClasses());
    this.flashObserver.observe(bars, { childList: true, subtree: true });
  }

  /** Sync the `--rescheduled` class on every bar to the `flashing` id set. */
  private applyFlashClasses(): void {
    if (this.destroyed) return;
    const root = this.host.el;
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const bars = root.querySelectorAll<HTMLElement>('.jects-scheduler__bar');
    for (const bar of bars) {
      const id = bar.dataset.eventId;
      const on = id != null && this.flashing.has(id);
      bar.classList.toggle('jects-scheduler__bar--rescheduled', on);
    }
  }
}

/**
 * Install auto-reschedule onto a scheduler. Returns the plugin (call
 * `.destroy()` to remove it; it is also auto-removed on scheduler destroy).
 *
 * @example
 *   const sched = new Scheduler(host, { resources, events, dependencies });
 *   installAutoReschedule(sched, { animationMs: 500 });
 *   // now dragging a predecessor cascades to its FS/SS/FF/SF successors.
 */
export function installAutoReschedule(
  host: AutoRescheduleHost,
  config: AutoRescheduleConfig = {},
): AutoReschedulePlugin {
  return new AutoReschedulePlugin(host, config);
}
