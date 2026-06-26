/**
 * AssignmentStore multi-assignment rendering — the view-side plugin.
 *
 * Wires the pure multi-assignment resolver (`model/assignments.ts`) into a live
 * `Scheduler` instance WITHOUT destructively editing the widget class. It is an
 * additive, instance-scoped plugin: install it on a scheduler and the view starts
 * rendering each event on EVERY resource lane it is assigned to (many-to-many),
 * reflecting assignment `units`, and repaints whenever the AssignmentStore
 * changes.
 *
 * How it hooks in (all instance-local, fully reverted on `dispose()`):
 *  1. Replaces the instance's private `resolveRowEvents(resourceId, window)` seam
 *     with an assignment-aware resolver. The returned objects are a SUPERSET of
 *     the scheduler's internal `ResolvedEvent` shape (`id/resourceId/span/record/
 *     masterId`), so the existing `paintBars`/recurrence/roving-tabindex code
 *     keeps working unchanged — they simply see assignment-derived rows.
 *  2. Wraps the instance's private `renderBar` so each painted bar reflects its
 *     assignment: `data-units`, an `aria` units suffix, and a CSS hook
 *     (`--_assign-units` custom property) the token-pure stylesheet consumes.
 *  3. Subscribes to the AssignmentStore's `change` event and repaints.
 *
 * This is the seam the integrator can fold directly into `Scheduler` later (see
 * the package wire notes); until then it ships as a zero-risk opt-in plugin.
 */

import './assignment-rendering.css';
import type { RecordId } from '@jects/core';
import type { TimeSpan, EventBar } from '@jects/timeline-core';
import type { Scheduler } from './scheduler.js';
import type { AssignmentModel, EventModel } from '../contract.js';
import {
  coerceAssignmentStore,
  type AssignmentStore,
} from '../stores/stores.js';
import {
  buildAssignmentIndex,
  resolveRowAssignedEvents,
  resolveUnits,
  type AssignmentIndex,
  type ResolvedAssignedEvent,
} from '../model/assignments.js';

/** What a scheduler's private `resolveRowEvents` returns (structural subset). */
interface InternalResolvedEvent {
  id: RecordId;
  resourceId: RecordId;
  span: TimeSpan;
  record: EventModel;
  masterId?: RecordId;
}

/**
 * The private members of `Scheduler` this plugin reaches into. Declared as a
 * structural shape (not `any`) so the patch stays as type-safe as a same-class
 * edit would be, while keeping the public widget surface untouched.
 */
interface SchedulerInternals {
  resolveRowEvents(resourceId: RecordId, window: TimeSpan): InternalResolvedEvent[];
  renderBar(bar: EventBar<EventModel>, rowTop: number): HTMLElement;
  getEventStore(): {
    forEach(fn: (r: EventModel) => void): void;
    getById(id: RecordId): EventModel | undefined;
  };
  isDestroyed: boolean;
  update(patch: Record<string, unknown>): unknown;
}

/** Options for {@link installAssignmentRendering}. */
export interface AssignmentRenderingOptions {
  /** The assignments to render. A live `AssignmentStore`, raw array, or omitted. */
  assignments?: AssignmentStore | AssignmentModel[];
  /**
   * Show a small textual units badge on bars whose units ≠ 1. Default true.
   * (Always reflected via `data-units` + aria regardless of this flag.)
   */
  showUnitsBadge?: boolean;
}

/** Handle returned by {@link installAssignmentRendering}. */
export interface AssignmentRenderingHandle {
  /** The live assignment store driving the rendering. */
  readonly store: AssignmentStore;
  /** Replace the assignment store and repaint. */
  setAssignments(src: AssignmentStore | AssignmentModel[]): void;
  /** Force-rebuild the index + repaint (e.g. after bulk mutation). */
  refresh(): void;
  /** Resolve the assignment metadata for a painted bar element, if any. */
  unitsForBarEl(el: HTMLElement): number | undefined;
  /** Remove the plugin: restore the original methods + drop listeners. */
  dispose(): void;
}

/**
 * Install multi-assignment rendering on a `Scheduler` instance.
 *
 * @param scheduler The target scheduler (already constructed).
 * @param options   Assignment source + display options.
 */
export function installAssignmentRendering(
  scheduler: Scheduler,
  options: AssignmentRenderingOptions = {},
): AssignmentRenderingHandle {
  const internals = scheduler as unknown as SchedulerInternals;
  const showBadge = options.showUnitsBadge !== false;

  let store: AssignmentStore = coerceAssignmentStore(options.assignments);
  let index: AssignmentIndex = buildAssignmentIndex(store);

  // Map bar-id → resolved assignment metadata, refreshed each resolve pass so the
  // renderer hook + public `unitsForBarEl` can read units without re-deriving.
  const resolvedById = new Map<RecordId, ResolvedAssignedEvent>();

  // ── 1. Override the row-event resolution seam ──────────────────────────────
  const originalResolve = internals.resolveRowEvents.bind(internals);
  internals.resolveRowEvents = (resourceId: RecordId, window: TimeSpan): InternalResolvedEvent[] => {
    // No assignments at all → defer entirely to the stock 1:1 resolver so legacy
    // behaviour (and its tests) are byte-for-byte unchanged.
    if (index.empty) return originalResolve(resourceId, window);

    const rows = resolveRowAssignedEvents(
      resourceId,
      window,
      internals.getEventStore(),
      index,
    );
    for (const row of rows) resolvedById.set(row.id, row);
    // Structurally compatible with the scheduler's internal ResolvedEvent.
    return rows;
  };

  // ── 2. Wrap renderBar to reflect units on every painted bar ────────────────
  const originalRenderBar = internals.renderBar.bind(internals);
  internals.renderBar = (bar: EventBar<EventModel>, rowTop: number): HTMLElement => {
    const el = originalRenderBar(bar, rowTop);
    const resolved = resolvedById.get(bar.event.id);
    const units = resolved ? resolved.units : barUnits(bar);
    el.dataset.units = String(units);
    // CSS hook (token-pure stylesheet reads this custom property).
    el.style.setProperty('--_assign-units', String(units));
    if (resolved?.assignment) el.dataset.assignmentId = String(resolved.assignment.id);

    // Augment the accessible name with the allocation when it is not the default,
    // so AT users hear "…, 50%" / "…, 2 units" without relying on the visual badge.
    if (units !== 1) {
      const base = el.getAttribute('aria-label') ?? '';
      el.setAttribute('aria-label', `${base}, ${formatUnits(units)}`);
      if (showBadge) appendBadge(el, units);
    }
    return el;
  };

  // ── 3. Repaint on assignment-store change ──────────────────────────────────
  let storeUnsub = store.events.on('change', () => repaint());

  function repaint(): void {
    if (internals.isDestroyed) return;
    index = buildAssignmentIndex(store);
    resolvedById.clear();
    internals.update({});
  }

  // Initial paint so the very first render reflects assignments.
  repaint();

  let disposed = false;
  return {
    get store() {
      return store;
    },
    setAssignments(src: AssignmentStore | AssignmentModel[]): void {
      storeUnsub();
      store = coerceAssignmentStore(src);
      storeUnsub = store.events.on('change', () => repaint());
      repaint();
    },
    refresh(): void {
      repaint();
    },
    unitsForBarEl(el: HTMLElement): number | undefined {
      const raw = el.dataset.units;
      return raw == null ? undefined : Number(raw);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      storeUnsub();
      // Restore the original instance methods.
      internals.resolveRowEvents = originalResolve;
      internals.renderBar = originalRenderBar;
      resolvedById.clear();
      if (!internals.isDestroyed) internals.update({});
    },
  };
}

/** Best-effort units when no resolved metadata is present (legacy bars). */
function barUnits(bar: EventBar<EventModel>): number {
  const u = (bar.event.record as { units?: number }).units;
  return resolveUnits(u == null ? undefined : ({ units: u } as AssignmentModel));
}

/** Human-readable units: integers as "N units"/"1 unit"; fractions as a percent. */
function formatUnits(units: number): string {
  if (Number.isInteger(units)) return units === 1 ? '1 unit' : `${units} units`;
  return `${Math.round(units * 100)}%`;
}

function appendBadge(el: HTMLElement, units: number): void {
  const badge = document.createElement('span');
  badge.className = 'jects-scheduler__bar-units';
  badge.setAttribute('aria-hidden', 'true');
  badge.textContent = Number.isInteger(units) ? `×${units}` : `${Math.round(units * 100)}%`;
  el.appendChild(badge);
}
