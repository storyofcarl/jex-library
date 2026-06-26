/**
 * Scheduler — Undo / Redo controller (the live-view wiring for the STM).
 *
 * {@link SchedulerStm} is the framework-free state-tracking core: it captures
 * reversible transactions from store deltas and exposes `undo()` / `redo()`.
 * This module is the seam that binds it to a running `Scheduler`:
 *
 *   - It is a standalone **plugin** installed via
 *     `installUndoRedo(scheduler, config)` (or `new UndoRedoController(...)`), so
 *     it never edits the main `Scheduler` class. It uses ONLY the scheduler's
 *     public surface (`getEventStore()`, `getDependencyStore()`, `on()`, `el`).
 *   - It auto-registers the scheduler's event + dependency stores with the STM,
 *     plus any extra stores (e.g. an external assignment store) supplied in
 *     config — so every event move/resize/create/delete AND dependency /
 *     assignment edit is undoable from a single install.
 *   - It binds **Ctrl/⌘+Z = undo** and **Ctrl/⌘+Y (or Ctrl/⌘+Shift+Z) = redo**
 *     on the scheduler root, announcing each step through the scheduler's polite
 *     live region for screen-reader users.
 *   - It is disposable: `destroy()` removes the key listener, restores the
 *     wrapped store methods (via the STM), and is auto-invoked when the host
 *     scheduler is destroyed (it tracks `destroy`).
 *
 * The controller depends on a small STRUCTURAL host interface rather than the
 * concrete `Scheduler` class, so it has no circular import with the view module
 * and is trivially testable headless with a fake host.
 */

import type { RecordId, Model } from '@jects/core';
import {
  SchedulerStm,
  type SchedulerStmConfig,
  type SchedulerStmEvents,
  type StmState,
  type StmTransaction,
  type TrackableStore,
  type TrackedStoreEntry,
} from '../model/undo.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Structural host
   ═══════════════════════════════════════════════════════════════════════════ */

/** The slice of the host `Scheduler` the undo/redo controller needs. */
export interface UndoRedoHost {
  /** The scheduler root element (key bindings + live-region announce). */
  readonly el: HTMLElement;
  /** The reactive event store (move/resize/create/delete captured here). */
  getEventStore(): TrackableStore;
  /** The reactive dependency store (link create/delete captured here). */
  getDependencyStore(): TrackableStore;
  /** Subscribe to a host event (used to auto-dispose on `destroy`). */
  on<E extends string>(event: E, fn: (payload: never) => unknown): () => void;
  readonly isDestroyed?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Config
   ═══════════════════════════════════════════════════════════════════════════ */

/** Undo/redo controller configuration. */
export interface UndoRedoConfig {
  /** Whether tracking starts enabled. Default `true`. */
  enabled?: boolean;
  /** Max retained undo transactions (ring buffer). `0` = unlimited. */
  maxTransactions?: number;
  /**
   * Bind Ctrl/⌘+Z / Ctrl/⌘+Y keyboard shortcuts on the scheduler root.
   * Default `true`.
   */
  keyboard?: boolean;
  /**
   * Extra stores to track beyond the scheduler's event + dependency stores —
   * e.g. an external `AssignmentStore`. Each needs a unique `name`.
   */
  extraStores?: TrackedStoreEntry[];
  /** Announce undo/redo steps via the scheduler's live region. Default `true`. */
  announce?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Controller
   ═══════════════════════════════════════════════════════════════════════════ */

export class UndoRedoController {
  private readonly host: UndoRedoHost;
  private readonly cfg: Required<Omit<UndoRedoConfig, 'extraStores'>> &
    Pick<UndoRedoConfig, 'extraStores'>;
  private readonly stm: SchedulerStm;
  private readonly disposers: Array<() => void> = [];
  private destroyed = false;
  /** Pending flash-clear timers, cancelled on destroy. */
  private readonly flashTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Active flash repaint observers, disconnected on destroy. */
  private readonly flashObservers = new Set<MutationObserver>();

  constructor(host: UndoRedoHost, config: UndoRedoConfig = {}) {
    this.host = host;
    this.cfg = {
      enabled: config.enabled ?? true,
      maxTransactions: config.maxTransactions ?? 0,
      keyboard: config.keyboard ?? true,
      announce: config.announce ?? true,
      ...(config.extraStores ? { extraStores: config.extraStores } : {}),
    };

    const stores: TrackedStoreEntry[] = [
      { name: 'events', store: host.getEventStore() },
      { name: 'dependencies', store: host.getDependencyStore() },
      ...(this.cfg.extraStores ?? []),
    ];
    const stmConfig: SchedulerStmConfig = {
      stores,
      enabled: this.cfg.enabled,
      ...(this.cfg.maxTransactions ? { maxTransactions: this.cfg.maxTransactions } : {}),
    };
    this.stm = new SchedulerStm(stmConfig);

    this.install();
  }

  /* ── public API ───────────────────────────────────────────────────────── */

  /** The underlying state-tracking manager (for advanced / programmatic use). */
  get manager(): SchedulerStm {
    return this.stm;
  }

  /** Undo the most recent transaction. Returns it, or `null` if none. */
  undo(): StmTransaction | null {
    const tx = this.stm.undo();
    if (tx) {
      this.announce(`Undo: ${tx.title}.`);
      this.flash(tx);
    }
    return tx;
  }

  /** Redo the most recently undone transaction. Returns it, or `null` if none. */
  redo(): StmTransaction | null {
    const tx = this.stm.redo();
    if (tx) {
      this.announce(`Redo: ${tx.title}.`);
      this.flash(tx);
    }
    return tx;
  }

  /** Whether there is anything to undo. */
  get canUndo(): boolean {
    return this.stm.canUndo;
  }
  /** Whether there is anything to redo. */
  get canRedo(): boolean {
    return this.stm.canRedo;
  }

  /** Run `fn` inside a single named transaction (coalesces its store writes). */
  transact<R>(title: string, fn: () => R): R {
    return this.stm.transact(title, fn);
  }

  /** Subscribe to an STM event (`transaction` / `undo` / `redo` / `change`). */
  on<K extends keyof SchedulerStmEvents>(
    event: K,
    fn: (payload: SchedulerStmEvents[K]) => unknown,
  ): () => void {
    return this.stm.on(event, fn);
  }

  /** Current stack snapshot. */
  state(): StmState {
    return this.stm.state();
  }

  /** Enable capture. */
  enable(): this {
    this.stm.enable();
    return this;
  }
  /** Disable capture (mutations pass through untracked). */
  disable(): this {
    this.stm.disable();
    return this;
  }
  /** Clear all history. */
  reset(): void {
    this.stm.reset();
  }

  /** Remove listeners + restore wrapped store methods. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const t of this.flashTimers) clearTimeout(t);
    this.flashTimers.clear();
    for (const o of this.flashObservers) o.disconnect();
    this.flashObservers.clear();
    for (const off of this.disposers.splice(0)) {
      try {
        off();
      } catch {
        /* already gone */
      }
    }
    this.stm.destroy();
  }

  /* ── wiring ───────────────────────────────────────────────────────────── */

  private install(): void {
    if (this.cfg.keyboard) this.bindKeyboard();
    // Auto-dispose with the host scheduler.
    this.disposers.push(this.host.on('destroy', () => this.destroy()));
  }

  private bindKeyboard(): void {
    const root = this.host.el;
    if (!root || typeof root.addEventListener !== 'function') return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (this.destroyed || this.host.isDestroyed) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      // Redo: Ctrl/⌘+Y, or Ctrl/⌘+Shift+Z (the mac/editor convention).
      if (key === 'y' || (key === 'z' && e.shiftKey)) {
        if (this.canRedo) {
          this.redo();
          e.preventDefault();
        }
        return;
      }
      // Undo: Ctrl/⌘+Z (without Shift).
      if (key === 'z' && !e.shiftKey) {
        if (this.canUndo) {
          this.undo();
          e.preventDefault();
        }
      }
    };
    root.addEventListener('keydown', onKeyDown as EventListener);
    this.disposers.push(() =>
      root.removeEventListener('keydown', onKeyDown as EventListener),
    );
  }

  /**
   * Briefly highlight the event bars touched by an undone/redone transaction so
   * the reverted/re-applied change is visible. The scheduler rebuilds its bar
   * elements (via `replaceChildren`) on *every* repaint — not just the one the
   * store mutation triggers, but also asynchronous ones from its ResizeObserver
   * and scroll handler — discarding the class. A single deferred re-apply can
   * therefore race a later repaint and lose the highlight, so instead a
   * `MutationObserver` re-applies it after each rebuild for the duration of the
   * flash window, then it is cleared. Token-pure (the CSS honours
   * `prefers-reduced-motion`).
   */
  private flash(tx: StmTransaction): void {
    const root = this.host.el;
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const ids = new Set(
      tx.actions.filter((a) => a.store === 'events').map((a) => String(a.id)),
    );
    if (ids.size === 0) return;

    const CLASS = 'jects-scheduler__bar--reverted';
    const apply = (): void => {
      const bars = root.querySelectorAll<HTMLElement>('.jects-scheduler__bar');
      for (const bar of bars) {
        const id = bar.dataset.eventId;
        if (id != null && ids.has(id)) bar.classList.add(CLASS);
      }
    };
    const clear = (): void => {
      const bars = root.querySelectorAll<HTMLElement>(`.${CLASS}`);
      for (const bar of bars) bar.classList.remove(CLASS);
    };

    apply();

    // Re-apply whenever the bar layer is rebuilt (childList changes anywhere in
    // the subtree). Class mutations are not observed, so `apply()` cannot loop.
    let observer: MutationObserver | null = null;
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(() => {
        if (!this.destroyed) apply();
      });
      observer.observe(root, { childList: true, subtree: true });
      this.flashObservers.add(observer);
    }

    const off = setTimeout(() => {
      this.flashTimers.delete(off);
      if (observer) {
        observer.disconnect();
        this.flashObservers.delete(observer);
      }
      if (!this.destroyed) clear();
    }, 600);
    this.flashTimers.add(off);
  }

  /** Announce a message through the scheduler's polite live region, if present. */
  private announce(message: string): void {
    if (!this.cfg.announce) return;
    const root = this.host.el;
    if (!root || typeof root.querySelector !== 'function') return;
    const live = root.querySelector<HTMLElement>('.jects-scheduler__live');
    if (!live) return;
    // Clear then set so identical consecutive messages re-announce.
    live.textContent = '';
    live.textContent = message;
  }
}

/**
 * Install undo/redo onto a scheduler. Returns the controller (call `.destroy()`
 * to remove it; it is also auto-removed on scheduler destroy).
 *
 * @example
 *   const sched = new Scheduler(host, { resources, events, dependencies });
 *   const undo = installUndoRedo(sched);
 *   // …user drags a bar, creates a link, deletes an event…
 *   undo.undo();   // reverts the last action  (also Ctrl/⌘+Z)
 *   undo.redo();   // re-applies it             (also Ctrl/⌘+Y)
 */
export function installUndoRedo(
  host: UndoRedoHost,
  config: UndoRedoConfig = {},
): UndoRedoController {
  return new UndoRedoController(host, config);
}

/** Re-export the STM core types for ergonomic single-import consumption. */
export type {
  SchedulerStm,
  SchedulerStmConfig,
  SchedulerStmEvents,
  StmState,
  StmTransaction,
} from '../model/undo.js';

/** Local alias (kept for clarity in downstream typings). */
export type UndoableId = RecordId;
/** Local alias for a tracked record shape. */
export type UndoableRecord = Model;
