/**
 * Typed EventEmitter with the Jects veto convention.
 *
 * Convention (D3 / event contract):
 * - `emit('beforeX', payload)` returns `false` if ANY handler returned `false` (veto).
 *   Callers gate the action on the boolean result.
 * - `afterX` and plain events ignore handler return values; `emit` returns `true`.
 * - Handlers may be registered with `{ once, id }`. An `id` lets you `off(event, undefined, id)`
 *   or replace a previously-registered handler with the same id.
 */

export type EventMap = Record<string, unknown>;

export type Handler<P> = (payload: P) => unknown;

export interface HandlerOptions {
  /** Auto-remove after first invocation. */
  once?: boolean;
  /** Stable id for later removal / de-duplication. Re-registering the same id replaces. */
  id?: string;
}

interface Registration<P> {
  fn: Handler<P>;
  once: boolean;
  id?: string;
}

export class EventEmitter<Events extends EventMap = EventMap> {
  private readonly registry = new Map<keyof Events, Array<Registration<unknown>>>();

  /** Subscribe to `event`. Returns a disposer that removes this handler. */
  on<K extends keyof Events>(
    event: K,
    fn: Handler<Events[K]>,
    options: HandlerOptions = {},
  ): () => void {
    const list = this.registry.get(event) ?? [];
    const reg: Registration<unknown> = {
      fn: fn as Handler<unknown>,
      once: options.once ?? false,
      ...(options.id !== undefined ? { id: options.id } : {}),
    };
    if (options.id !== undefined) {
      const existing = list.findIndex((r) => r.id === options.id);
      if (existing >= 0) list.splice(existing, 1);
    }
    list.push(reg);
    this.registry.set(event, list);
    return () => this.off(event, fn);
  }

  /** Subscribe for a single emission. */
  once<K extends keyof Events>(event: K, fn: Handler<Events[K]>, options: HandlerOptions = {}): () => void {
    return this.on(event, fn, { ...options, once: true });
  }

  /**
   * Unsubscribe. Pass `fn` to remove a specific handler, or `id` to remove by id,
   * or neither to remove all handlers for `event`.
   */
  off<K extends keyof Events>(event: K, fn?: Handler<Events[K]>, id?: string): void {
    const list = this.registry.get(event);
    if (!list) return;
    if (!fn && id === undefined) {
      this.registry.delete(event);
      return;
    }
    const next = list.filter((r) => {
      if (fn && r.fn === (fn as Handler<unknown>)) return false;
      if (id !== undefined && r.id === id) return false;
      return true;
    });
    if (next.length) this.registry.set(event, next);
    else this.registry.delete(event);
  }

  /**
   * Emit `event` with `payload`. Returns `false` iff any handler returned exactly `false`
   * (the veto convention for `beforeX` events); otherwise `true`.
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): boolean {
    const list = this.registry.get(event);
    if (!list || list.length === 0) return true;
    let vetoed = false;
    // Snapshot so once-removal / re-entrant on()/off() is safe.
    for (const reg of [...list]) {
      if (reg.once) this.off(event, reg.fn as Handler<Events[K]>);
      const result = reg.fn(payload);
      if (result === false) vetoed = true;
    }
    return !vetoed;
  }

  /** Number of handlers for `event` (or total across all events if omitted). */
  listenerCount(event?: keyof Events): number {
    if (event !== undefined) return this.registry.get(event)?.length ?? 0;
    let total = 0;
    for (const list of this.registry.values()) total += list.length;
    return total;
  }

  /** Remove every handler for every event. */
  clear(): void {
    this.registry.clear();
  }
}
