# @jects/core

> The framework-free, zero-dependency spine every Jects UI component is built on.

## Overview

`@jects/core` is the engine layer of Jects UI. It has **zero runtime dependencies** and is **framework-free** (no React/Vue/Svelte) — it works directly against the DOM. Every other `@jects/*` component package builds on top of it.

It provides:

- A fine-grained **signals** reactivity system (`signal`/`computed`/`effect`/`batch`).
- A typed **EventEmitter** with the Jects veto convention (`beforeX` events can cancel an action).
- The **`Widget`** base class — the lifecycle/render contract every component extends.
- A **`Store` / `TreeStore`** data layer (records, sort, filter, group, tree expansion, lazy loading).
- A **factory / type registry** (`register` / `create`) for declarative, `{ type, ... }`-driven instantiation.
- Framework-free **DOM utilities** (`createEl`, delegated events, focus trap, text measurement, RTL).
- Pure **virtualization** math (`computeWindow` + a Fenwick-tree `OffsetIndex`).

## Installation

```bash
pnpm add @jects/core
```

`@jects/core` is zero-dependency and is the base every `@jects/*` component depends on (it is a peer/transitive dependency of all of them). Ships ESM (`dist/core.js`), CJS (`dist/core.umd.cjs`), and types (`dist/index.d.ts`).

## Integration / Usage

### Build a custom Widget

Extend `Widget`, implement `buildEl()` (called once to create the root), and optionally `render()` (called after build and after every `update()`):

```ts
import { Widget, type WidgetConfig, createEl } from '@jects/core';

interface BadgeConfig extends WidgetConfig {
  text?: string;
}

class Badge extends Widget<BadgeConfig> {
  protected defaults(): Partial<BadgeConfig> {
    return { text: '' };
  }

  protected buildEl(): HTMLElement {
    return createEl('span', { className: 'badge' });
  }

  protected render(): void {
    this.applyBaseConfig();             // applies cls/style/hidden/disabled
    this.el.textContent = this.config.text ?? '';
  }
}

const badge = new Badge('#host', { text: 'New' });
badge.update({ text: 'Updated' });      // merges config + re-renders
badge.on('destroy', ({ widget }) => console.log('gone', widget.id));
badge.destroy();                        // vetoable via 'beforeDestroy'
```

The constructor takes `(host: HTMLElement | string, config?)`. `host` may be an element or a CSS selector. Inside a widget you also get protected helpers: `effect(fn)` (auto-disposed reactive effect), `on2(selector, evt, fn)` (delegated DOM listener), `listen(evt, fn)` (direct listener), and `track(disposer)` — all auto-cleaned on `destroy()`.

### Reactive state with signals

```ts
import { signal, computed, effect, batch } from '@jects/core';

const count = signal(0);
const doubled = computed(() => count.value * 2);

const stop = effect(() => console.log('doubled is', doubled.value));

batch(() => {                 // coalesce writes — effect runs once
  count.value = 1;
  count.value = 2;
});

stop();                       // dispose the effect
```

### Data with Store / TreeStore

```ts
import { Store } from '@jects/core';

const store = new Store<{ id: number; name: string; age: number }>({
  data: [{ id: 1, name: 'Ada', age: 36 }],
});

store.add({ id: 2, name: 'Linus', age: 30 });
store.sort('age', 'desc');
store.filter({ field: 'age', operator: 'gte', value: 31 });

store.events.on('change', ({ action }) => console.log('store changed:', action));
console.log(store.count, store.getById(1));
```

`TreeStore` extends `Store` for hierarchical data — `expand`/`collapse`/`toggle`, `getVisible()` (flattened display order), and lazy children via a `loader`:

```ts
import { TreeStore } from '@jects/core';

const tree = new TreeStore({
  data: [{ id: 'a', name: 'Root', children: [{ id: 'b', name: 'Child' }] }],
  expanded: ['a'],
});
await tree.expand('a');
tree.getVisible(); // [{ node, depth }, ...]
```

### Factory: declarative instantiation

```ts
import { register, create, createAll } from '@jects/core';

register('badge', Badge);
const w = create({ type: 'badge', text: 'Hi' }, '#host');
const many = createAll([{ type: 'badge', text: 'A' }, { type: 'badge', text: 'B' }]);
```

### Virtualization

```ts
import { computeWindow, OffsetIndex } from '@jects/core';

// Fixed-size rows, O(1):
const win = computeWindow({ scrollTop: 800, viewportHeight: 400, itemSize: 40, count: 10000 });
// → { startIndex, endIndex, offset, totalSize }

// Variable-size rows, O(log n) via a Fenwick tree:
const idx = new OffsetIndex(10000, 40);
idx.setSize(5, 80);
idx.offsetOf(6);  // prefix sum (top offset of row 6)
idx.indexAt(1234); // which row spans pixel 1234
```

## Features / Reference

### Signals (`signals.js`)
| Export | Description |
| --- | --- |
| `signal(value)` | Writable reactive cell (`.value`, `.peek()`). |
| `computed(fn)` | Lazily-evaluated, cached derived signal. |
| `effect(fn)` | Runs `fn`, re-runs on dependency change; returns a disposer. |
| `batch(fn)` | Coalesces writes so dependents run once; returns `fn`'s result. |
| `untracked(fn)` | Reads without tracking dependencies. |
| `isSignal(x)` | True for any signal (writable or computed). |
| `Signal<T>` / `ReadonlySignal<T>` | Signal type interfaces. |

### Events (`events.js`)
| Export | Description |
| --- | --- |
| `EventEmitter<Events>` | Typed emitter. `on`/`once`/`off`/`emit`/`listenerCount`/`clear`. |
| `EventMap` | `Record<string, unknown>` — event payload map shape. |
| `Handler<P>` / `HandlerOptions` | Handler type; options carry `{ once, id }`. |

**Veto convention:** `emit('beforeX', payload)` returns `false` if any handler returned exactly `false`; callers gate the action on that boolean.

### Widget (`widget.js`)
| Export | Description |
| --- | --- |
| `Widget<Config, Events>` | Abstract base: lifecycle, `el`/`id`, `update`, `show`/`hide`, `destroy`, event bus, auto-disposed effects/listeners. |
| `WidgetConfig` | Base config: `cls`, `style`, `hidden`, `disabled`. |
| `WidgetEvents` | Built-in events: `beforeDestroy`, `destroy`, `render`, `show`, `hide`. |

### Store / TreeStore (`store.js`, `tree-store.js`)
| Export | Description |
| --- | --- |
| `Store<T>` | Record collection: `parse`/`load`, `add`/`remove`/`update`/`move`, `sort`/`filter`/`group`, `count`/`getById`/`toArray`, `events`. |
| `TreeStore<T>` | Tree data: `items`, `getChildren`, `getVisible`, `expand`/`collapse`/`toggle`, `loadChildren`. |
| `StoreConfig` / `StoreEvents` | Store options / typed event payloads (`load`/`add`/`remove`/`update`/`change`/`sort`/`filter`). |
| `TreeStoreConfig` / `TreeNode` | Tree options (`childrenField`, `loader`, `expanded`) / node shape. |
| `Model`, `RecordId`, `Comparator`, `Predicate`, `SortDir`, `FilterConfig` | Supporting types. |

### Factory (`factory.js`)
| Export | Description |
| --- | --- |
| `register(type, ctor)` | Register a widget constructor under a type name (idempotent, last wins). |
| `create(config, host?)` | Instantiate from `{ type, ... }`; detached `<div>` host if omitted. |
| `createAll(configs, host?)` | Instantiate many configs. |
| `getCtor` / `isRegistered` / `registeredTypes` / `clearRegistry` | Registry inspection / reset. |
| `WidgetCtor` / `TypedConfig` | Constructor + declarative config types. |

### DOM utilities (`dom.js`)
| Export | Description |
| --- | --- |
| `createEl(tag, options?)` | Create an element with className/attrs/dataset/style/children/listeners. |
| `classNames(...values)` | Combine string/array/`{name:bool}` class values. |
| `setClass(el, name, on)` | Add/remove a class. |
| `resolveHost(host)` | Resolve an element-or-selector host. |
| `on(root, selector, evt, fn)` | Delegated event binding; returns an `Unbind`. |
| `measureText(text, font)` | Canvas-based text width (px), layout-free. |
| `getScrollbarWidth()` | Native scrollbar width (px), cached. |
| `getFocusable(el)` / `trapFocus(el)` | Tabbable descendants / focus trap. |
| `isRTL(el?)` | Right-to-left detection. |
| `ClassValue` / `CreateElOptions` / `Unbind` | Supporting types. |

### Virtualization (`virtualization.js`)
| Export | Description |
| --- | --- |
| `computeWindow(input)` | O(1) visible window for fixed-size items (with overscan). |
| `OffsetIndex` | Fenwick-tree prefix-sum index for variable row heights — `setSize`/`offsetOf`/`indexAt`/`total`, O(log n). |
| `WindowInput` / `WindowResult` | Input/result types. |

## Examples

### Minimal custom Widget + Store subscription

```ts
import { Widget, Store, createEl, type WidgetConfig } from '@jects/core';

interface CounterConfig extends WidgetConfig {
  store: Store<{ id: number }>;
}

class CountLabel extends Widget<CounterConfig> {
  protected buildEl(): HTMLElement {
    return createEl('div', { className: 'count' });
  }

  protected render(): void {
    this.applyBaseConfig();
    this.el.textContent = `Records: ${this.config.store.count}`;
    // Re-render whenever the store changes (auto-disposed on destroy):
    this.track(this.config.store.events.on('change', () => {
      this.el.textContent = `Records: ${this.config.store.count}`;
    }));
  }
}

const store = new Store<{ id: number }>({ data: [{ id: 1 }] });
const label = new CountLabel('#app', { store });
store.add({ id: 2 }); // label updates to "Records: 2"
```

## Notes

- **Core is the stable contract.** Component packages depend on these exports — treat them as the public, versioned API surface.
- **No Shadow DOM.** Widgets own a single light-DOM root (`widget.el`), so global CSS/theme tokens cascade in and data components stay style-able and inspectable.
- **Auto-cleanup.** `destroy()` runs `beforeDestroy` (vetoable), removes `el`, and disposes every effect/listener/disposer registered via `effect`/`on2`/`listen`/`track`.
- **Zero dependencies** keeps the engine small and portable; the signals implementation follows the preact-signals / `@vue/reactivity` push-pull model in ~150 LOC.
