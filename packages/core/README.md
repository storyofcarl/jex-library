# @jects/core — the framework-free, zero-dependency engine that powers every Jects UI component.

## What it is

`@jects/core` is the spine of the [Jects UI](https://github.com/storyofcarl/jex-library) suite: a small, framework-free runtime that works directly against the DOM with **zero runtime dependencies**. It provides fine-grained signals, a typed `EventEmitter`, the `Widget` lifecycle base class, a `Store`/`TreeStore` data layer, a component factory/type registry, DOM utilities, virtualization math, and HTML sanitization. Every other `@jects/*` package builds on these exports as its stable, versioned contract.

## Install

```bash
pnpm add @jects/core
```

`@jects/core` has no runtime dependencies and is a peer/transitive dependency of all other Jects component packages. It ships ESM (`dist/core.js`), CJS (`dist/core.umd.cjs`), and types (`dist/index.d.ts`).

## Minimal example

Extend `Widget`, create the root in `buildEl()`, and paint in `render()`:

```ts
import { Widget, createEl, type WidgetConfig } from '@jects/core';

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
    this.applyBaseConfig();              // applies cls/style/hidden/disabled
    this.el.textContent = this.config.text ?? '';
  }
}

// host may be an element or a CSS selector
const badge = new Badge('#host', { text: 'New' });
badge.update({ text: 'Updated' });       // merges config + re-renders
badge.destroy();                         // vetoable via 'beforeDestroy'
```

## Subpath exports

The package currently exposes a single entry point (`.`). Subpaths are planned; all APIs below are available from the root import `@jects/core`.

## Common recipes

### Reactive state with signals

```ts
import { signal, computed, effect, batch } from '@jects/core';

const count = signal(0);
const doubled = computed(() => count.value * 2);

const stop = effect(() => console.log('doubled is', doubled.value));

batch(() => {                  // coalesce writes — effect runs once
  count.value = 1;
  count.value = 2;
});

stop();                        // dispose the effect
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

### Declarative instantiation via the factory

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
idx.offsetOf(6);   // prefix sum (top offset of row 6)
idx.indexAt(1234); // which row spans pixel 1234
```

## Events

The typed `EventEmitter` (`on`/`once`/`off`/`emit`/`listenerCount`/`clear`) underpins widgets and stores.

- **`Widget` events** (`WidgetEvents`): `beforeDestroy`, `destroy`, `render`, `show`, `hide`.
- **`Store` events** (`StoreEvents`): `load`, `add`, `remove`, `update`, `change`, `sort`, `filter`.
- **Veto convention:** emitting a `beforeX` event returns `false` if any handler returned exactly `false`; callers gate the action on that boolean (e.g. `destroy()` is cancelable via `beforeDestroy`).

## Theming

Components are styled via `--jects-*` CSS custom properties cascading through light DOM (no Shadow DOM). `@jects/core` itself ships no stylesheet; include `@jects/theme` for tokens. See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

`@jects/core` provides the primitives interactive components rely on — `getFocusable(el)` and `trapFocus(el)` for keyboard focus management, plus `isRTL(el?)` for right-to-left layouts. ARIA semantics are the responsibility of the components built on top.

## Stability & support

**Stable.** Core is the versioned contract every other package depends on; its exports are treated as the public API surface and are covered by unit tests across signals, events, the widget lifecycle, stores, the factory, DOM utilities, virtualization, and sanitization.

Part of the Jects UI suite. Live demo: <https://jexlibrary.vercel.app>. Commercial terms: see LICENSE.md.
