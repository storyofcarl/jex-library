/**
 * Fine-grained reactivity — a tiny push/pull signals implementation in the
 * preact-signals / `@vue/reactivity` model. ~150 LOC, zero deps.
 *
 * - `signal(v)` — a readable/writable reactive cell (`.value`).
 * - `computed(fn)` — a lazily-evaluated, cached derived signal.
 * - `effect(fn)` — runs `fn`, re-runs when any read dependency changes; returns a disposer.
 * - `batch(fn)` — coalesces writes so dependents run once.
 */

type Subscriber = ReactiveNode;

/** A node that can depend on signals (effect or computed). */
interface ReactiveNode {
  /** Re-run / invalidate this node. */
  notify(): void;
  /** Signals this node currently depends on (for cleanup). */
  deps: Set<SignalCore<unknown>>;
}

let activeSub: ReactiveNode | null = null;
let batchDepth = 0;
const pendingEffects = new Set<EffectNode>();

function runPending(): void {
  if (batchDepth > 0) return;
  // Snapshot to allow effects to schedule further effects safely.
  const queue = [...pendingEffects];
  pendingEffects.clear();
  for (const e of queue) {
    if (!e.disposed) e.run();
  }
}

class SignalCore<T> {
  private _value: T;
  readonly subs = new Set<Subscriber>();

  constructor(value: T) {
    this._value = value;
  }

  get value(): T {
    if (activeSub) {
      this.subs.add(activeSub);
      activeSub.deps.add(this as SignalCore<unknown>);
    }
    return this._value;
  }

  set value(next: T) {
    if (Object.is(next, this._value)) return;
    this._value = next;
    this.notifySubs();
  }

  /** Read without registering a dependency. */
  peek(): T {
    return this._value;
  }

  notifySubs(): void {
    // Copy because notify() may mutate the set (computeds re-subscribe lazily).
    for (const sub of [...this.subs]) sub.notify();
    runPending();
  }
}

export interface Signal<T> {
  value: T;
  peek(): T;
}

export interface ReadonlySignal<T> {
  readonly value: T;
  peek(): T;
}

/** Create a writable reactive signal. */
export function signal<T>(value: T): Signal<T> {
  return new SignalCore(value);
}

/** True if `x` is any kind of signal (writable or computed). */
export function isSignal(x: unknown): x is ReadonlySignal<unknown> {
  return x instanceof SignalCore || x instanceof ComputedNode;
}

function cleanup(node: ReactiveNode): void {
  for (const dep of node.deps) dep.subs.delete(node);
  node.deps.clear();
}

class ComputedNode<T> implements ReactiveNode {
  readonly deps = new Set<SignalCore<unknown>>();
  readonly subs = new Set<Subscriber>();
  private _value!: T;
  private _stale = true;

  constructor(private readonly fn: () => T) {}

  notify(): void {
    if (this._stale) return;
    this._stale = true;
    // Propagate staleness to downstream subscribers.
    for (const sub of [...this.subs]) sub.notify();
  }

  private recompute(): void {
    cleanup(this);
    const prev = activeSub;
    activeSub = this;
    try {
      this._value = this.fn();
    } finally {
      activeSub = prev;
    }
    this._stale = false;
  }

  get value(): T {
    if (this._stale) this.recompute();
    // Register the *reader* as a subscriber, and link transitively.
    if (activeSub) {
      this.subs.add(activeSub);
      // Bridge: when our deps change we notify, and our subs read fresh.
    }
    return this._value;
  }

  peek(): T {
    if (this._stale) this.recompute();
    return this._value;
  }
}

/** Create a cached derived signal. Recomputes lazily when dependencies change. */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
  return new ComputedNode(fn);
}

class EffectNode implements ReactiveNode {
  readonly deps = new Set<SignalCore<unknown>>();
  disposed = false;
  private running = false;

  constructor(private readonly fn: () => void) {
    this.run();
  }

  notify(): void {
    if (this.disposed) return;
    pendingEffects.add(this);
  }

  run(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    cleanup(this);
    const prev = activeSub;
    activeSub = this;
    try {
      this.fn();
    } finally {
      activeSub = prev;
      this.running = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cleanup(this);
    pendingEffects.delete(this);
  }
}

/**
 * Run `fn` immediately and re-run it whenever any signal it reads changes.
 * Returns a disposer that stops the effect and releases its subscriptions.
 */
export function effect(fn: () => void): () => void {
  const node = new EffectNode(fn);
  return () => node.dispose();
}

/**
 * Coalesce multiple writes: effects/computeds dependent on signals written
 * inside `fn` run at most once, after `fn` returns. Returns `fn`'s result.
 */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    runPending();
  }
}

/** Read a value (signal or plain) without tracking. */
export function untracked<T>(fn: () => T): T {
  const prev = activeSub;
  activeSub = null;
  try {
    return fn();
  } finally {
    activeSub = prev;
  }
}
