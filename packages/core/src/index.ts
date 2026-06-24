/**
 * @jects/core — the framework-free spine of Jects UI.
 *
 * Zero runtime dependencies. Exports signals/reactivity, the typed EventEmitter,
 * the Widget base class, Store/TreeStore data layer, the factory/type registry,
 * DOM utilities, and virtualization math.
 */

// Reactivity
export {
  signal,
  computed,
  effect,
  batch,
  untracked,
  isSignal,
  type Signal,
  type ReadonlySignal,
} from './signals.js';

// Events
export {
  EventEmitter,
  type EventMap,
  type Handler,
  type HandlerOptions,
} from './events.js';

// Widget base
export {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
} from './widget.js';

// Data layer
export {
  Store,
  type StoreConfig,
  type StoreEvents,
  type Model,
  type RecordId,
  type Comparator,
  type Predicate,
  type SortDir,
  type FilterConfig,
} from './store.js';
export {
  TreeStore,
  type TreeStoreConfig,
  type TreeNode,
} from './tree-store.js';

// Factory / registry
export {
  register,
  create,
  createAll,
  getCtor,
  isRegistered,
  registeredTypes,
  clearRegistry,
  type WidgetCtor,
  type TypedConfig,
} from './factory.js';

// DOM utilities
export {
  createEl,
  classNames,
  setClass,
  resolveHost,
  on,
  measureText,
  getScrollbarWidth,
  getFocusable,
  trapFocus,
  isRTL,
  type ClassValue,
  type CreateElOptions,
  type Unbind,
} from './dom.js';

// Virtualization
export {
  computeWindow,
  OffsetIndex,
  type WindowInput,
  type WindowResult,
} from './virtualization.js';
