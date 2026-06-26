/**
 * `MultiBaselineCompare` — a self-contained `GanttFeature` that lifts the Gantt
 * from showing ONE baseline at a time to capturing and overlaying MANY named
 * baselines simultaneously (Bryntum's "multiple baselines" / DHTMLX baseline
 * compare).
 *
 * Why a plugin (not an edit to `gantt.ts`)
 * ----------------------------------------
 * The built-in path (`gantt.activeBaseline: string | null` →
 * `timeline-view`'s single `row.baseline` overlay) renders exactly one snapshot.
 * Rather than destructively widen that single-overlay seam (which other feature
 * agents touch concurrently), this feature is purely ADDITIVE: it
 *
 *   • proxies `api.captureBaseline` so every snapshot it records is remembered
 *     here (the engine/widget keep working unchanged), and
 *   • paints its OWN overlay layer into the timeline content element, one styled
 *     band per *active* baseline per visible task — derived from the rendered
 *     bar geometry (`data-task-id` + the axis projection), so it stays in
 *     lockstep with scroll, zoom, and every reschedule without reaching into
 *     timeline-view internals.
 *
 * It also mounts a small, fully keyboard-operable baseline picker (a checkbox
 * group) so users can toggle which captured baselines are compared, plus a
 * "Capture" action that snapshots the current schedule into the next slot.
 *
 * Distinct overlay styles: each active baseline is assigned a stable slot index
 * (0..N) which maps to a CSS modifier `--n{slot}`; the stylesheet ships variants
 * 0..5 (token-pure, `--jects-*` only) so up to six baselines read as visually
 * distinct compare bands. Variance (live end − baseline end) is surfaced per
 * band as an accessible label and a `data-variance-ms` attribute for tooling.
 */

import { createEl } from '@jects/core';
import type { Model, RecordId } from '@jects/core';
import type { TimeSpan } from '@jects/timeline-core';
import type {
  Baseline,
  BaselineTask,
  GanttApi,
  GanttFeature,
} from '../contract.js';

import './multi-baseline.css';

/** Number of visually-distinct overlay variants shipped by the stylesheet. */
export const MULTI_BASELINE_VARIANTS = 6;

/** A baseline the feature knows about (captured through it or seeded via config). */
export interface ManagedBaseline {
  /** Stable baseline id. */
  readonly id: string;
  /** Display name shown in the picker (defaults to `Baseline N`). */
  readonly name: string;
  /** Per-task snapshot, keyed by task id. */
  readonly tasks: ReadonlyMap<RecordId, BaselineTask>;
  /** When captured. */
  readonly takenAt: number;
  /** Whether the band is currently rendered. */
  active: boolean;
}

/** Construction options for {@link MultiBaselineCompare}. */
export interface MultiBaselineOptions {
  /**
   * Feature registry name. Defaults to `'multiBaselineCompare'`. Override only
   * to run more than one instance (unusual).
   */
  name?: string;
  /**
   * Baselines to seed immediately on install. Each entry is captured from the
   * CURRENT schedule under the given id/name and starts active unless
   * `active: false`.
   */
  initialBaselines?: ReadonlyArray<{ id: string; name?: string; active?: boolean }>;
  /**
   * Render the built-in picker UI. Default `true`. Set `false` to drive the
   * feature entirely from the API (`capture`/`setActive`) with your own chrome.
   */
  showPicker?: boolean;
  /** Accessible label for the picker region. Default `'Baseline compare'`. */
  pickerLabel?: string;
}

type AnyModel = Model;

/** Read the absolute top/height of a rendered bar row from the timeline DOM. */
interface RowGeom {
  top: number;
  height: number;
}

export class MultiBaselineCompare<T extends AnyModel = AnyModel>
  implements GanttFeature<T>
{
  readonly name: string;

  private api!: GanttApi<T>;
  private readonly opts: Required<Omit<MultiBaselineOptions, 'initialBaselines'>> & {
    initialBaselines: ReadonlyArray<{ id: string; name?: string; active?: boolean }>;
  };

  /** All baselines the feature manages, in capture order. */
  private readonly baselines: ManagedBaseline[] = [];
  /** Slot index per active baseline id → drives the CSS variant modifier. */
  private readonly slotOf = new Map<string, number>();

  /** The overlay layer injected into the timeline content element. */
  private overlay: HTMLElement | null = null;
  /** The baseline picker region (when `showPicker`). */
  private picker: HTMLElement | null = null;
  private pickerList: HTMLElement | null = null;

  private disposers: Array<() => void> = [];
  /** The un-proxied capture, bound to the api, used internally to avoid re-entry. */
  private originalCapture: GanttApi<T>['captureBaseline'] | null = null;
  /** Whether the proxy is currently installed (so destroy() should restore). */
  private proxyInstalled = false;
  /**
   * Snapshot of `captureBaseline`'s state on the api BEFORE we installed the
   * proxy, so we can restore it exactly (safe save-original/restore, like
   * undo.ts `restoreWrappers`) instead of blindly `delete`-ing — which would
   * destroy an own/instance method or break another feature's wrapper chain.
   */
  private hadOwnCapture = false;
  private prevCapture: GanttApi<T>['captureBaseline'] | null = null;
  private destroyed = false;
  private captureSeq = 0;
  /** Coalesce repaints triggered by a burst of schedule changes. */
  private rafHandle: number | null = null;

  constructor(options: MultiBaselineOptions = {}) {
    this.name = options.name ?? 'multiBaselineCompare';
    this.opts = {
      name: this.name,
      showPicker: options.showPicker ?? true,
      pickerLabel: options.pickerLabel ?? 'Baseline compare',
      initialBaselines: options.initialBaselines ?? [],
    };
  }

  /* ── lifecycle ─────────────────────────────────────────────────────────── */

  init(api: GanttApi<T>): void {
    this.api = api;

    // Proxy captureBaseline so anything captured (here OR by app code OR by the
    // built-in toolbar) is recorded for multi-overlay. We keep the original so
    // the engine/widget behaviour is untouched.
    this.installCaptureProxy();

    // Build the overlay layer + (optionally) the picker.
    this.mountOverlay();
    if (this.opts.showPicker) this.mountPicker();

    // Seed initial baselines from the current schedule.
    for (const seed of this.opts.initialBaselines) {
      const captured = this.capture(seed.id, seed.name);
      if (captured && seed.active === false) this.setActive(seed.id, false);
    }

    // Repaint overlays on every schedule mutation so bands track live bars.
    const repaint = (): void => this.scheduleRepaint();
    this.disposers.push(this.api.on('taskChange', repaint));
    this.disposers.push(this.api.on('scheduleChange', repaint));
    this.disposers.push(this.api.on('dependencyCreate', repaint));
    this.disposers.push(this.api.on('dependencyRemove', repaint));

    this.repaint();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafHandle != null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    for (const off of this.disposers) {
      try {
        off();
      } catch {
        /* best-effort */
      }
    }
    this.disposers = [];
    // Restore `captureBaseline` to exactly what it was before we wrapped it
    // (safe save-original/restore, mirroring undo.ts `restoreWrappers`). If it
    // was an OWN property (instance method, or another feature's wrapper) we put
    // that value back; only if it was inherited from the prototype do we delete
    // the own property we added so the prototype method is effective again.
    // Blindly `delete`-ing would have removed an instance method entirely.
    if (this.proxyInstalled) {
      const target = this.api as {
        captureBaseline?: GanttApi<T>['captureBaseline'];
      };
      if (this.hadOwnCapture && this.prevCapture) {
        target.captureBaseline = this.prevCapture;
      } else {
        delete target.captureBaseline;
      }
      this.proxyInstalled = false;
    }
    this.originalCapture = null;
    this.prevCapture = null;
    this.hadOwnCapture = false;
    this.overlay?.remove();
    this.overlay = null;
    this.picker?.remove();
    this.picker = null;
    this.pickerList = null;
    this.baselines.length = 0;
    this.slotOf.clear();
  }

  /* ── public feature API ────────────────────────────────────────────────── */

  /** All managed baselines (capture order). */
  getBaselines(): ReadonlyArray<ManagedBaseline> {
    return this.baselines.slice();
  }

  /** Currently-active (rendered) baseline ids, in slot order. */
  getActiveBaselineIds(): ReadonlyArray<string> {
    return this.baselines.filter((b) => b.active).map((b) => b.id);
  }

  /**
   * Capture the current schedule as a named baseline and add it as an active
   * compare band. If `id` already exists it is re-captured (snapshot refreshed)
   * and left in place. Returns the managed entry, or `undefined` if the widget
   * has no engine baseline support.
   */
  capture(id?: string, name?: string): ManagedBaseline | undefined {
    const seq = ++this.captureSeq;
    const baselineId = id ?? `baseline-${seq}`;
    const displayName = name ?? `Baseline ${this.baselines.length + 1}`;

    // Use the ORIGINAL (un-proxied) capture so we don't re-enter our own proxy.
    const cap = this.originalCapture ?? this.api.captureBaseline.bind(this.api);
    const baseline: Baseline = cap(baselineId, displayName);
    this.record(baseline, displayName);
    this.repaint();
    this.refreshPicker();
    return this.baselines.find((b) => b.id === baselineId);
  }

  /** Toggle whether a baseline is rendered. Unknown ids are ignored. */
  setActive(id: string, active: boolean): void {
    const b = this.baselines.find((x) => x.id === id);
    if (!b || b.active === active) return;
    b.active = active;
    this.reassignSlots();
    this.repaint();
    this.refreshPicker();
  }

  /** Forget a baseline entirely (removes its band + picker row). */
  remove(id: string): void {
    const idx = this.baselines.findIndex((b) => b.id === id);
    if (idx < 0) return;
    this.baselines.splice(idx, 1);
    this.reassignSlots();
    this.repaint();
    this.refreshPicker();
  }

  /**
   * Variance of a task vs a baseline (live end − baseline end, ms). Positive =
   * slipped later. `undefined` for an unknown task/baseline.
   */
  variance(taskId: RecordId, baselineId: string): number | undefined {
    const b = this.baselines.find((x) => x.id === baselineId);
    const snap = b?.tasks.get(taskId);
    const live = this.api.getTask(taskId);
    if (!snap || !live) return undefined;
    const liveSpan = this.spanOf(live);
    return liveSpan.end - snap.end;
  }

  /* ── capture proxy ─────────────────────────────────────────────────────── */

  private installCaptureProxy(): void {
    const target = this.api as { captureBaseline: GanttApi<T>['captureBaseline'] };
    // Snapshot the pre-install state so destroy() can restore the EXACT prior
    // method value (which may be an own/instance method, a prototype method, or
    // another feature's wrapper) rather than `delete`-ing it away.
    this.hadOwnCapture = Object.prototype.hasOwnProperty.call(target, 'captureBaseline');
    this.prevCapture = this.hadOwnCapture ? target.captureBaseline : null;
    const original = target.captureBaseline.bind(this.api);
    this.originalCapture = original;
    this.proxyInstalled = true;
    target.captureBaseline = (id: string, name?: string): Baseline => {
      const baseline = original(id, name);
      // Record (or refresh) so externally-captured baselines also become
      // compare bands. Don't auto-activate beyond the variant budget.
      this.record(baseline, name ?? baseline.name ?? `Baseline ${this.baselines.length + 1}`);
      this.scheduleRepaint();
      this.refreshPicker();
      return baseline;
    };
  }

  private record(baseline: Baseline, displayName: string): void {
    const existing = this.baselines.find((b) => b.id === baseline.id);
    if (existing) {
      const idx = this.baselines.indexOf(existing);
      this.baselines[idx] = {
        id: baseline.id,
        name: existing.name,
        tasks: baseline.tasks,
        takenAt: baseline.takenAt,
        active: existing.active,
      };
    } else {
      const active = this.activeCount() < MULTI_BASELINE_VARIANTS;
      this.baselines.push({
        id: baseline.id,
        name: displayName,
        tasks: baseline.tasks,
        takenAt: baseline.takenAt,
        active,
      });
    }
    this.reassignSlots();
  }

  private activeCount(): number {
    let n = 0;
    for (const b of this.baselines) if (b.active) n++;
    return n;
  }

  /** Assign each active baseline a stable slot index for its CSS variant. */
  private reassignSlots(): void {
    this.slotOf.clear();
    let slot = 0;
    for (const b of this.baselines) {
      if (!b.active) continue;
      this.slotOf.set(b.id, slot % MULTI_BASELINE_VARIANTS);
      slot++;
    }
  }

  /* ── overlay rendering ─────────────────────────────────────────────────── */

  private mountOverlay(): void {
    const content = this.timelineContent();
    if (!content) return;
    const overlay = createEl('div', { className: 'jects-gantt__baselines' });
    overlay.setAttribute('aria-hidden', 'true');
    // Sit behind the bars but above the backdrop: prepend so bars (later
    // children) paint over the bands.
    content.insertBefore(overlay, content.firstChild);
    this.overlay = overlay;
  }

  /** Coalesce repaints into a single animation frame. */
  private scheduleRepaint(): void {
    if (this.destroyed || this.rafHandle != null) return;
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: FrameRequestCallback): number => setTimeout(() => cb(0), 0) as unknown as number;
    this.rafHandle = raf(() => {
      this.rafHandle = null;
      this.repaint();
    });
  }

  /** Render one styled band per active baseline per visible task. */
  repaint(): void {
    if (this.destroyed) return;
    const overlay = this.overlay;
    if (!overlay) return;
    overlay.replaceChildren();

    const axis = this.api.timeline.axis as { spanToBox(span: TimeSpan): { x: number; width: number } };
    const geom = this.rowGeometry();
    const actives = this.baselines.filter((b) => b.active);
    if (!actives.length || !geom.size) return;

    const bandCount = Math.min(actives.length, MULTI_BASELINE_VARIANTS);
    for (const [taskId, row] of geom) {
      // Stack the bands within the lower portion of the row so multiple
      // baselines for one task are independently visible.
      const trackTop = row.top + row.height - 3 - bandCount * 4;
      let lane = 0;
      for (const b of actives) {
        const snap = b.tasks.get(taskId);
        if (!snap) continue;
        const slot = this.slotOf.get(b.id) ?? 0;
        const box = axis.spanToBox({ start: snap.start, end: snap.end });
        const band = createEl('div', {
          className: `jects-gantt__baseline-band jects-gantt__baseline-band--n${slot}`,
        });
        band.style.left = `${box.x}px`;
        band.style.width = `${Math.max(2, box.width)}px`;
        band.style.top = `${trackTop + lane * 4}px`;
        band.dataset.baselineId = b.id;
        band.dataset.taskId = String(taskId);
        const v = this.variance(taskId, b.id);
        if (v != null) band.dataset.varianceMs = String(v);
        // Accessible (not aria-hidden on the band itself; the overlay wrapper is
        // hidden, so expose a title for hover/tooling without polluting the AT
        // tree). Variance label aids QA/visual tests.
        band.title = this.bandTitle(b, v);
        overlay.append(band);
        lane++;
      }
    }
  }

  private bandTitle(b: ManagedBaseline, varianceMs: number | undefined): string {
    if (varianceMs == null) return b.name;
    const days = Math.round((varianceMs / 86_400_000) * 10) / 10;
    const sign = days > 0 ? `+${days}` : `${days}`;
    return `${b.name}: ${sign}d vs baseline`;
  }

  /**
   * Derive each visible task's row top/height from its rendered bar element.
   * This keeps overlay geometry in lockstep with the timeline's own layout
   * without reaching into `GanttTimelineView` internals.
   */
  private rowGeometry(): Map<RecordId, RowGeom> {
    const out = new Map<RecordId, RowGeom>();
    const el = this.api.timeline.el;
    const bars = el.querySelectorAll<HTMLElement>('.jects-gantt__bar[data-task-id]');
    for (const bar of Array.from(bars)) {
      const id = bar.dataset.taskId;
      if (id == null) continue;
      const top = parseFloat(bar.style.top || '0');
      const height = parseFloat(bar.style.height || '0') || this.rowHeightFallback();
      // Bars are positioned at `row.top + bar.y`; reconstruct a row band around
      // the bar centre so baseline lanes sit just below the live bar.
      const rowTop = top - 4;
      const rowHeight = height + 8;
      out.set(id, { top: rowTop, height: rowHeight });
    }
    return out;
  }

  private rowHeightFallback(): number {
    return 24;
  }

  /* ── picker UI ─────────────────────────────────────────────────────────── */

  private mountPicker(): void {
    const root = this.api.el;
    const picker = createEl('div', { className: 'jects-gantt__baseline-picker' });
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', this.opts.pickerLabel);

    const title = createEl('div', { className: 'jects-gantt__baseline-picker-title' });
    title.textContent = this.opts.pickerLabel;
    title.id = `${this.name}-title`;
    picker.setAttribute('aria-labelledby', title.id);

    const list = createEl('div', { className: 'jects-gantt__baseline-picker-list' });
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Active baselines');

    const capture = createEl('button', {
      className: 'jects-gantt__baseline-capture',
    }) as HTMLButtonElement;
    capture.type = 'button';
    capture.textContent = 'Capture baseline';
    const onCapture = (): void => {
      this.capture();
    };
    capture.addEventListener('click', onCapture);
    this.disposers.push(() => capture.removeEventListener('click', onCapture));

    picker.append(title, list, capture);
    root.append(picker);
    this.picker = picker;
    this.pickerList = list;
    this.refreshPicker();
  }

  private refreshPicker(): void {
    const list = this.pickerList;
    if (!list) return;
    list.replaceChildren();
    if (!this.baselines.length) {
      const empty = createEl('div', { className: 'jects-gantt__baseline-picker-empty' });
      empty.textContent = 'No baselines captured';
      list.append(empty);
      return;
    }
    for (const b of this.baselines) {
      const slot = this.slotOf.get(b.id);
      const row = createEl('label', { className: 'jects-gantt__baseline-picker-row' });

      const cb = createEl('input') as HTMLInputElement;
      cb.type = 'checkbox';
      cb.className = 'jects-gantt__baseline-picker-check';
      cb.checked = b.active;
      cb.setAttribute('aria-label', `Show ${b.name}`);
      const onToggle = (): void => this.setActive(b.id, cb.checked);
      cb.addEventListener('change', onToggle);
      this.disposers.push(() => cb.removeEventListener('change', onToggle));

      const swatch = createEl('span', {
        className:
          slot != null
            ? `jects-gantt__baseline-swatch jects-gantt__baseline-swatch--n${slot}`
            : 'jects-gantt__baseline-swatch jects-gantt__baseline-swatch--off',
      });
      swatch.setAttribute('aria-hidden', 'true');

      const label = createEl('span', { className: 'jects-gantt__baseline-picker-name' });
      label.textContent = b.name;

      row.append(cb, swatch, label);
      list.append(row);
    }
  }

  /* ── helpers ───────────────────────────────────────────────────────────── */

  private timelineContent(): HTMLElement | null {
    const el = this.api.timeline.el;
    return (
      el.querySelector<HTMLElement>('.jects-gantt__timeline-content') ?? el
    );
  }

  private spanOf(task: { start?: number; end?: number; duration?: number; milestone?: boolean }): TimeSpan {
    const start = task.start ?? 0;
    const end = task.milestone
      ? start
      : task.end ?? start + (task.duration ?? 86_400_000);
    return { start, end };
  }
}

/**
 * Convenience factory matching the `GanttFeature` plugin convention so callers
 * can `gantt.use(createMultiBaselineCompare({ ... }))` or pass it in
 * `GanttOptions.plugins`.
 */
export function createMultiBaselineCompare<T extends AnyModel = AnyModel>(
  options?: MultiBaselineOptions,
): MultiBaselineCompare<T> {
  return new MultiBaselineCompare<T>(options);
}
