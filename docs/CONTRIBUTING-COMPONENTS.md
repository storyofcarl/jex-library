# Jects UI — Component Author's Guide

> The canonical brief handed to every component agent (Wave 1+). Read it fully.
> It freezes the foundation contracts your component must honor. When in doubt,
> copy the **reference component** `Button` (`packages/widgets/src/button/`).

---

## 0. Branding (locked)

| Aspect | Value |
|--------|-------|
| Product | **Jects UI** |
| npm scope | `@jects` |
| CSS class prefix | `jects-` (e.g. `.jects-btn`) |
| CSS token prefix | `--jects-` (e.g. `--jects-primary`) |
| Custom elements | `<jects-*>` |

---

## 1. Locked architectural decisions (D1–D12)

| # | Decision (short) |
|---|------------------|
| D1 | **Light-DOM, class-based engine. No Shadow DOM** for data components. Edit one stylesheet → restyle everything. |
| D2 | **Imperative public API is the stable contract:** `const w = new Comp(el, opts); w.on('x', fn); w.destroy();`. Wrappers wrap this. |
| D3 | **Reactivity via a tiny signals lib** (`signal/computed/effect/batch`). Fine-grained, not vdom. |
| D4 | **Monorepo:** pnpm workspaces + Turborepo + Vite (lib mode) + TS strict + Changesets. |
| D5 | **`@jects/core` is zero-dependency and framework-free.** Every package imports it. |
| D6 | **Theming = CSS custom properties only (runtime).** SCSS allowed for authoring, never in the contract. |
| D7 | **OKLCH channel-triplet tokens**, three tiers (primitive → semantic → component), single `--jects-radius`. |
| D8 | **Ship per package: ESM + UMD/IIFE + `.d.ts` + unbundled CSS.** Core externalized, not inlined. |
| D9 | **Grid renderer is pluggable** (DOM-recycling default; canvas later). |
| D10 | **Shared `@jects/timeline-core`** factored out before Gantt/Scheduler. |
| D11 | **Wrappers are thin + partly codegen'd** from a typed manifest. React memoizes the engine; Angular runs outside the zone; Vue uses `shallowRef`/`markRaw`. |
| D12 | **Testing: Vitest (browser mode for DOM) + Playwright (E2E/visual/a11y/perf).** jsdom lies about layout. |

---

## 2. House style (locked) — "Jects — Cool Zinc + Calm CMYK"

The default theme. shadcn **zinc**, but the neutral is nudged **cooler** to hue **272**
(leaning blue, short of slate's ~257 so it still reads as a refined gray), plus a **calm
CMYK** categorical palette for data-viz / tags / labels. All color tokens are OKLCH
triplets `L C H`, consumed as `oklch(var(--jects-x))`; channel-triplet form keeps alpha
working: `oklch(var(--jects-primary) / 0.5)`.

- **Neutral hue:** 272 across light & dark, low chroma (peaks ~0.018 mid-lightness).
- **Calm CMYK group** (`--jects-cmyk-cyan|magenta|yellow|key` + `-soft` tints) — restrained
  chroma, **not** for core UI chrome. Categorical order `[cyan, magenta, yellow, key]`,
  surfaced as a chart ramp `--jects-data-1 … --jects-data-8`.
- **success** `0.62 0.12 160`, **warning** `0.80 0.11 92` (reuses calm yellow).
- `--jects-radius` = `0.625rem`; derived radii cascade via `calc()` (`--jects-radius-sm/md/lg/xl`).

The exact triplet values are the single source of truth in
`packages/tokens/src/tokens.json`. Never hard-code colors — reference tokens.

---

## 3. Foundation contracts (`@jects/core`)

Full signatures. Import everything from `@jects/core`.

### 3.1 Signals / reactivity
```ts
function signal<T>(value: T): Signal<T>;            // .value get/set, .peek()
function computed<T>(fn: () => T): ReadonlySignal<T>;
function effect(fn: () => void): () => void;        // returns disposer
function batch<T>(fn: () => T): T;                   // coalesce writes
function untracked<T>(fn: () => T): T;
function isSignal(x: unknown): x is ReadonlySignal<unknown>;
interface Signal<T> { value: T; peek(): T }
interface ReadonlySignal<T> { readonly value: T; peek(): T }
```

### 3.2 EventEmitter (typed; veto convention)
```ts
class EventEmitter<Events extends EventMap = EventMap> {
  on<K extends keyof Events>(event: K, fn: Handler<Events[K]>, options?: HandlerOptions): () => void;
  once<K extends keyof Events>(event: K, fn: Handler<Events[K]>, options?: HandlerOptions): () => void;
  off<K extends keyof Events>(event: K, fn?: Handler<Events[K]>, id?: string): void;
  emit<K extends keyof Events>(event: K, payload: Events[K]): boolean; // false if a `beforeX` handler returned false
  listenerCount(event?: keyof Events): number;
  clear(): void;
}
type Handler<P> = (payload: P) => unknown;
interface HandlerOptions { once?: boolean; id?: string }
```
**Convention:** `emit('beforeX', payload)` returns `false` if **any** handler returned `false`
(veto — gate the action on it). `afterX`/plain events ignore handler return values.

### 3.3 Widget (abstract base — extend this)
```ts
abstract class Widget<Config extends WidgetConfig = WidgetConfig, Events extends EventMap = WidgetEvents> {
  readonly id: string;
  readonly el: HTMLElement;                 // single owned root
  constructor(host: HTMLElement | string, config?: Config);

  // override points:
  protected defaults(): Partial<Config>;    // component defaults (merged under user config)
  protected abstract buildEl(): HTMLElement; // build root once
  protected render(): void;                  // sync DOM to config (idempotent)

  update(patch: Partial<Config>): this;      // merge config + re-render
  getConfig(): Readonly<Config>;
  show(): this; hide(): this; get isDestroyed(): boolean;

  on/once/off/emit(...)                       // delegated to internal EventEmitter

  // protected helpers (auto-disposed on destroy):
  protected effect(fn: () => void): void;
  protected on2<E>(selector: string, evt: E, fn): void;  // delegated DOM listener on root
  protected listen<E>(evt: E, fn): void;                 // plain listener on root
  protected track(disposer: () => void): void;

  destroy(): void;                            // vetoable via `beforeDestroy`; removes el, disposes all
}
interface WidgetConfig { cls?: string; style?: Partial<CSSStyleDeclaration>; hidden?: boolean; disabled?: boolean }
interface WidgetEvents { beforeDestroy; destroy; render; show; hide } // each payload { widget }
```
Lifecycle: `constructor → buildEl() → render() → [update()→render()]* → destroy()`.

### 3.4 Store (DataCollection)
```ts
class Store<T extends Model = Model> {
  readonly events: EventEmitter<StoreEvents<T>>;   // add/remove/update/change/sort/filter/load
  readonly idField: string;
  constructor(config?: { data?: T[]; idField?: string; model?: (raw: Partial<T>) => T });

  parse(data: T[]): void;
  load(url: string): Promise<void>;
  get count(): number; get totalCount(): number;
  add(record: T | T[]): T[];
  remove(target: RecordId | T | Array<RecordId | T>): T[];
  update(id: RecordId, changes: Partial<T>): T | undefined;
  move(from: number, to: number): void;
  changeId(oldId: RecordId, newId: RecordId): void;
  getById(id: RecordId): T | undefined;
  getAt(i: number): T | undefined;
  indexOf(target: RecordId | T): number;
  forEach(fn): void; map<R>(fn): R[]; find(predicate): T | undefined; toArray(): T[];
  sort(by: (keyof T & string) | Comparator<T>, dir?: 'asc' | 'desc'): void;
  filter(filter: Predicate<T> | FilterConfig<T> | Array<...>): void;
  clearFilters(): void;
  group<K>(field: keyof T & string): Map<K, T[]>;
  serialize(): T[];
}
type RecordId = string | number;
type Model = Record<string, unknown>;
```

### 3.5 TreeStore (extends Store)
```ts
class TreeStore<T extends TreeNode = TreeNode> extends Store<T> {
  constructor(config?: StoreConfig<T> & {
    childrenField?: string;             // default 'children'
    loader?: (node: T) => Promise<T[]>;
    expanded?: RecordId[];
  });
  get items(): T[];
  getChildren(node: T | RecordId): T[];
  getItems(): T[];                                  // flat depth-first
  getVisible(): Array<{ node: T; depth: number }>;  // respects expansion
  isLeaf(node: T | RecordId): boolean;
  isExpanded(node: T | RecordId): boolean;
  expand(node): Promise<void>; collapse(node): void; toggle(node): Promise<void>;
  loadChildren(node: T): Promise<T[]>;
}
interface TreeNode extends Model { children?: TreeNode[] }
```

### 3.6 Factory / type registry
```ts
function register(type: string, ctor: WidgetCtor): void;
function create(config: { type: string } & Record<string, unknown>, host?: HTMLElement | string): Widget;
function createAll(configs: TypedConfig[], host?): Widget[];
function getCtor(type): WidgetCtor | undefined;
function isRegistered(type): boolean;
function registeredTypes(): string[];
function clearRegistry(): void;
```
Every component **must** `register('<type>', MyComponent)` at module load (see Button).

### 3.7 DOM utils
```ts
createEl<K>(tag: K, options?: CreateElOptions): HTMLElementTagNameMap[K];
classNames(...values: ClassValue[]): string;
setClass(el, name, on): void;
resolveHost(host: HTMLElement | string): HTMLElement;
on<E>(root, selector, evt, fn): Unbind;            // delegated
measureText(text: string, font: string): number;
getScrollbarWidth(): number;
getFocusable(el): HTMLElement[];
trapFocus(el): Unbind;
isRTL(el?): boolean;
```

### 3.8 Virtualization math
```ts
computeWindow(input: { scrollTop; viewportHeight; itemSize; count; overscan? }):
  { startIndex; endIndex; offset; totalSize };
class OffsetIndex {
  constructor(count: number, defaultSize?: number);
  setSize(i: number, size: number): void;
  sizeOf(i: number): number;
  offsetOf(i: number): number;   // top offset of item i
  indexAt(px: number): number;   // index spanning pixel px
  total(): number;
}
```

---

## 4. Package template (copy exactly)

Directory: `packages/<name>/`.

**`package.json`** (a component/lib package):
```jsonc
{
  "name": "@jects/<name>",
  "version": "0.0.0",
  "license": "UNLICENSED",
  "type": "module",
  "sideEffects": ["**/*.css"],
  "files": ["dist"],
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/<name>.js", "require": "./dist/<name>.umd.cjs" },
    "./style.css": "./dist/style.css"
  },
  "types": "./dist/index.d.ts",
  "module": "./dist/<name>.js",
  "main": "./dist/<name>.umd.cjs",
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch",
    "test": "vitest run",
    "test:browser": "vitest run --config vitest.browser.config.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  },
  "peerDependencies": { "@jects/core": "workspace:*", "@jects/theme": "workspace:*" },
  "devDependencies": {
    "@jects/core": "workspace:*", "@jects/theme": "workspace:*", "@jects/vite-config": "workspace:*",
    "@vitest/browser": "^2.1.8", "playwright": "^1.49.1",
    "vite": "^6.0.5", "vite-plugin-dts": "^4.4.0", "vitest": "^2.1.8"
  }
}
```

**`tsconfig.json`**:
```json
{ "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "types": [] },
  "include": ["src"], "exclude": ["dist", "node_modules", "**/*.test.ts"] }
```

**`vite.config.ts`** (uses the shared preset — externalizes `@jects/*`, emits ESM+UMD+dts):
```ts
import { jectsLibConfig } from '@jects/vite-config';
export default jectsLibConfig({ root: import.meta.dirname, name: 'Jects<Name>', fileName: '<name>' });
```

**`vitest.config.ts`** (default jsdom run) + **`vitest.browser.config.ts`** (real Chromium) — copy from `packages/widgets/`.

**Peer deps:** `@jects/core` (always) + whatever you use (`@jects/icons`, `@jects/theme`).
They are **externalized** (D8) — never bundled into your package.

---

## 5. CSS conventions

- One CSS file per component next to its source (`button/button.css`), aggregated in `src/styles.css`, imported by `src/index.ts` so it lands in `dist/style.css`.
- Everything inside `@layer jects.components { ... }`. The layer order is declared by `@jects/theme`:
  `@layer jects.reset, jects.tokens, jects.base, jects.components, jects.utilities;`
- **Reference only `--jects-*` tokens.** No hard-coded colors/sizes. Colors are
  `oklch(var(--jects-<token>))`; alpha via `oklch(var(--jects-<token>) / 0.5)`.
- **Naming (BEM-ish):** `.jects-{component}` block · `.jects-{component}__{part}` element ·
  `.jects-{component}--{modifier}` modifier. Internal computed vars use a leading underscore:
  `--_btn-bg`. Example from Button:
  `.jects-btn`, `.jects-btn__icon`, `.jects-btn__label`, `.jects-btn--primary`, `.jects-btn--sm`, `.jects-btn--loading`.
- Radii use the derived cascade: `var(--jects-radius-md)` etc. (driven by one `--jects-radius`).

---

## 6. Tier-2 token list (reference only these in CSS)

Semantic (light + dark, OKLCH triplets):
`background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`,
`primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `muted`,
`muted-foreground`, `accent`, `accent-foreground`, `destructive`, `destructive-foreground`,
`success`, `success-foreground`, `warning`, `warning-foreground`, `border`, `input`, `ring`.

Calm CMYK palette: `cmyk-cyan`, `cmyk-magenta`, `cmyk-yellow`, `cmyk-key` (+ `-soft` each);
chart ramp `data-1 … data-8`.

Scales: `space-0 … space-12`, `radius` (+ derived `radius-sm/md/lg/xl`), `font-family`,
`font-family-mono`, `font-size-xs/sm/md/lg/xl/2xl`, `font-weight-normal/medium/semibold/bold`,
`shadow-sm/md/lg`, `z-dropdown/sticky/overlay/modal/popover/tooltip`,
`duration-fast/normal/slow`.

Token names are typed: `import { type JectsTokenName, SEMANTIC_TOKENS } from '@jects/tokens'`.

---

## 7. Reference component anatomy (`Button`)

`packages/widgets/src/button/`:
- `button.ts` — `class Button extends Widget<ButtonConfig, ButtonEvents>` with
  `defaults()`, `buildEl()`, `render()`, a vetoable `beforeClick` → `click`, and
  `register('button', Button)`.
- `button.css` — themed, token-only, in `@layer jects.components`.
- `button.test.ts` — jsdom unit test (runs in `pnpm test`).
- `button.browser.test.ts` — **real Chromium** test (`pnpm test:browser`).
- `button.stories.ts` — usage examples / docs stories.

Pattern to copy:
```ts
export class MyComp extends Widget<MyConfig, MyEvents> {
  protected defaults() { return { /* component defaults */ }; }
  protected buildEl() { return createEl('div', { className: 'jects-mycomp' }); }
  protected render() { /* sync DOM to this.config — idempotent */ }
}
register('mycomp', MyComp as never);
```

---

## 8. Definition of Done (per component)

A component is **not** done until all of these are true:

- [ ] **Imperative API + types:** extends `Widget`; typed `Config`/`Events`; `defaults/buildEl/render`; vetoable `beforeX` events where actions can be cancelled.
- [ ] **Registered** with the factory (`register('<type>', Comp)`).
- [ ] **Themed CSS using only `--jects-*` tokens**, in `@layer jects.components`, BEM-ish naming. No hard-coded colors.
- [ ] **`destroy()` clean:** all effects/listeners auto-disposed (use the protected helpers); no leaks.
- [ ] **Vitest browser test** (real Chromium) covering render, key variants/states, primary interaction + event.
- [ ] **jsdom unit test** for logic (so it runs in the default `pnpm test`).
- [ ] **Docs example** (`*.stories.ts`) added.
- [ ] **Added to the customizer preview** so it recolors live.
- [ ] `pnpm --filter @jects/<name> build && typecheck && test` all green.
- [ ] Changeset added.

---

## 9. Verify

```bash
pnpm install
pnpm build       # turbo, topological (^build)
pnpm typecheck
pnpm test        # jsdom suites across packages
pnpm --filter @jects/widgets test:browser   # real Chromium (needs `pnpm exec playwright install chromium`)
pnpm customizer  # live theme builder
pnpm docs        # docs shell with light/dark toggle
```
