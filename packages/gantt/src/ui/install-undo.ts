/**
 * `installUndoRedo` — the additive auto-install seam that wires the **Undo/redo
 * (State Tracking Manager)** feature into a `Gantt` out of the box, matching the
 * Bryntum/DHTMLX behaviour where undo/redo (Ctrl+Z / Ctrl+Y, an undo toolbar)
 * works WITHOUT the consumer manually calling `gantt.use(new GanttUndoRedo())`.
 *
 * It is the single integration point the `Gantt` widget calls in `setup()`
 * (mirroring `installResourceLayer`):
 *
 *   - If a `GanttUndoRedo` is ALREADY installed (the consumer passed one via
 *     `GanttOptions.plugins` or called `gantt.use(new GanttUndoRedo())`), it is
 *     adopted as the active undo/redo surface and nothing new is created — the
 *     consumer's explicit feature wins (so their config / toolbar host is kept).
 *   - Otherwise, unless undo/redo is explicitly turned off
 *     (`GanttOptions.undoRedo === false`), a `GanttUndoRedo` is constructed and
 *     installed via the public `api.use(...)` seam (so it tracks/disposes with the
 *     Gantt like any feature). When `undoRedo` is an object it is forwarded as the
 *     feature config (toolbar/keyboardShortcuts/maxStack/coalesceMs/labels …).
 *   - When `undoRedo === false` the layer stays inert and `api.features` has no
 *     `undoRedo` entry.
 *
 * This keeps the wiring contract-pure: it only touches the `GanttApi` (`features`,
 * `use`, `el`) and the `GanttUndoRedo` feature — zero reach into Gantt internals.
 * It is split into its own module so the `Gantt` class hook is a single additive
 * call (see wireNotes).
 */

import type { Model } from '@jects/core';
import type { GanttApi } from '../contract.js';
import { GanttUndoRedo, type GanttUndoRedoConfig } from './undo.js';

/** The feature name a `GanttUndoRedo` registers under (its `name` field). */
export const UNDO_REDO_FEATURE = 'undoRedo';

/**
 * The additive `GanttOptions` slice this seam reads. It is intentionally NOT in
 * the frozen `contract.ts` `GanttOptions` (the auto-install workflow reads it
 * structurally), so consumers can opt out / configure undo/redo without coupling
 * the contract to this feature.
 *
 *   - `undoRedo: true`  (or omitted)  → auto-install with defaults.
 *   - `undoRedo: false`               → do NOT auto-install.
 *   - `undoRedo: { … }`               → auto-install with this `GanttUndoRedoConfig`.
 */
export interface UndoRedoOption {
  /**
   * Auto-install the Undo/redo (STM) feature. Default `true` (parity with
   * Bryntum/DHTMLX, where undo/redo is on out of the box). `false` opts out;
   * an object is forwarded as the feature config.
   */
  undoRedo?: boolean | GanttUndoRedoConfig;
}

/**
 * Resolve (and, if needed, auto-install) the undo/redo layer for a Gantt.
 *
 * @param api     the host Gantt's public API (used only for `features`/`use`).
 * @param option  the `undoRedo` flag/config off `GanttOptions` (`true` by default).
 * @returns the active `GanttUndoRedo`, or `undefined` when undo/redo is opted out.
 */
export function installUndoRedo<T extends Model = Model>(
  api: GanttApi<T>,
  option: UndoRedoOption['undoRedo'],
): GanttUndoRedo<T> | undefined {
  // 1. Adopt an already-installed GanttUndoRedo (consumer-provided plugin). Its
  //    own config (toolbar host, shortcuts, labels …) is preserved — we never
  //    double-install.
  const existing = api.features.get(UNDO_REDO_FEATURE);
  if (existing instanceof GanttUndoRedo) {
    return existing as GanttUndoRedo<T>;
  }
  // Structural fallback: a feature named `undoRedo` that exposes the undo/redo
  // surface (covers a consumer subclass / a future drop-in that isn't a literal
  // `GanttUndoRedo` instance but quacks like one).
  if (existing && isUndoRedoFeature<T>(existing)) {
    return existing;
  }

  // 2. Explicit opt-out — leave the layer inert.
  if (option === false) return undefined;

  // 3. Auto-install from the `undoRedo` option (object → config; true/undefined →
  //    defaults). `api.use` runs `feature.init(api)` and tracks `feature.destroy()`
  //    on the Gantt, so it disposes with the widget.
  const config: GanttUndoRedoConfig =
    option && typeof option === 'object' ? option : {};
  const feature = new GanttUndoRedo<T>(config);
  api.use(feature);
  return feature;
}

/**
 * Structural guard: a feature that also implements the `GanttUndoRedo` public
 * undo/redo surface (so a consumer subclass / drop-in is adopted, not clobbered).
 */
function isUndoRedoFeature<T extends Model>(
  value: unknown,
): value is GanttUndoRedo<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { undo?: unknown }).undo === 'function' &&
    typeof (value as { redo?: unknown }).redo === 'function' &&
    'stm' in (value as object)
  );
}
