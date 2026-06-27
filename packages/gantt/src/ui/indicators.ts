/**
 * `GanttIndicatorsFeature` — the Gantt **Indicators** feature (Bryntum-parity).
 *
 * Small glyphs rendered at a task bar's **start** or **end** edge that flag
 * scheduling facts the bar itself can't show: a date **constraint**, a
 * **deadline**, a **late** finish (past its deadline), and a scheduling
 * **conflict** reported by the engine. Consumers can add **custom** indicators
 * via a `getIndicators(task, ctx)` callback.
 *
 * Design (concurrency-safe, contract-pure):
 *   - It is a `GanttFeature` — installed via `gantt.use(new GanttIndicatorsFeature())`
 *     or `new Gantt(el, { plugins: [new GanttIndicatorsFeature()] })`. It touches
 *     ONLY the public `GanttApi` (engine reads, root `el`, events, `track`).
 *   - It never edits the timeline renderer. Instead it decorates the already-laid
 *     out `.jects-gantt__bar` elements after every repaint, observed through a
 *     `MutationObserver` on the bars layer (the layer's children are rebuilt on
 *     each `refresh()`), so it survives drags, reschedules, baseline/critical
 *     toggles, and expand/collapse without coupling to a specific event.
 *   - Indicator icons come from `@jects/icons` (inline SVG, `currentColor`).
 *   - Each indicator span is keyboard-focusable, has an accessible label, and a
 *     native `title` tooltip; clicking/activating one emits `indicatorClick`.
 *
 * All times are epoch ms (UTC), matching the rest of the Gantt contract.
 */

import './indicators.css';
import { setHtml, trustedHtml } from '@jects/core';
import type { Model, RecordId } from '@jects/core';
import type {
  GanttApi,
  GanttFeature,
  TaskModel,
  ConstraintType,
  TaskSchedule,
} from '../contract.js';

/**
 * Glyph names for indicators. These mirror the `@jects/icons` Lucide-compatible
 * set (calendar/clock/alert-triangle/info/flag) but are inlined here so the
 * feature stays self-contained — `@jects/icons` is an externalized peer that a
 * consumer can also wire in (see the feature docs / wire notes). The geometry is
 * identical to the shared icon set so the visual language matches the rest of UI.
 */
export type IndicatorIconName = 'calendar' | 'clock' | 'alert-triangle' | 'info' | 'flag';

/** Inner SVG bodies (24×24, stroke = currentColor) for each indicator glyph. */
const ICON_BODY: Record<IndicatorIconName, string> = {
  calendar:
    '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 2v4"/><path d="M16 2v4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  'alert-triangle':
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22V4"/>',
};

/** Render an indicator glyph to an inline SVG string (stroke = currentColor). */
export function renderIndicatorIcon(name: IndicatorIconName, size = 12, strokeWidth = 2.25): string {
  return (
    `<svg class="jects-icon" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="currentColor" stroke-width="${strokeWidth}" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_BODY[name]}</svg>`
  );
}

/** Which edge of the bar an indicator pins to. */
export type IndicatorSide = 'start' | 'end';

/** Built-in indicator kinds (plus `'custom'` for consumer-supplied ones). */
export type IndicatorKind = 'constraint' | 'deadline' | 'late' | 'conflict' | 'custom';

/**
 * A single resolved indicator to paint on a task bar. Producers return these
 * from the built-in resolvers or a custom `getIndicators` callback.
 */
export interface GanttIndicator {
  /** Stable id within the task (used as a DOM/dedup key). */
  id: string;
  /** The indicator kind (drives the default icon + CSS modifier). */
  kind: IndicatorKind;
  /** Which bar edge to pin to. Default depends on the kind. */
  side?: IndicatorSide;
  /** The icon to render. Defaults to a per-kind glyph when omitted. */
  icon?: IndicatorIconName;
  /** Accessible label + native tooltip text. */
  tooltip: string;
  /** The date the indicator refers to (epoch ms), surfaced on click. */
  date?: number;
  /** Extra CSS class appended to the indicator span. */
  cls?: string;
}

/** Context handed to a custom indicator resolver. */
export interface IndicatorContext<T extends Model = Model> {
  /** The owning Gantt API (engine reads, etc.). */
  api: GanttApi<T>;
  /** The task's last computed schedule, if any. */
  schedule: TaskSchedule | undefined;
  /** The task's deadline (epoch ms), resolved from the model, if any. */
  deadline: number | undefined;
}

/** Configuration for the Indicators feature. */
export interface GanttIndicatorsConfig<T extends Model = Model> {
  /** Render the constraint indicator (constraintType/Date). Default `true`. */
  constraintIndicators?: boolean;
  /** Render the deadline indicator (task `deadline`). Default `true`. */
  deadlineIndicators?: boolean;
  /** Render the late indicator when the finish passes the deadline. Default `true`. */
  lateIndicators?: boolean;
  /** Render a conflict indicator for engine-reported conflicts. Default `true`. */
  conflictIndicators?: boolean;
  /**
   * Resolve extra (custom) indicators for a task. Returned indicators are
   * appended after the built-ins. Throwing/returning nothing is safe.
   */
  getIndicators?(task: TaskModel<T>, ctx: IndicatorContext<T>): GanttIndicator[] | undefined;
  /**
   * Convenience callback fired when any indicator is clicked/activated. Mirrors
   * the `indicatorClick` event the feature emits on the Gantt (the event needs a
   * cast on `gantt.on` because it's a feature-added event, so this typed callback
   * is the ergonomic path).
   */
  onIndicatorClick?(payload: IndicatorClickPayload<T>): void;
}

/** Event payload when an indicator is clicked/activated. */
export interface IndicatorClickPayload<T extends Model = Model> {
  task: TaskModel<T>;
  indicator: GanttIndicator;
  native: Event;
}

const ICON_FOR: Record<IndicatorKind, IndicatorIconName> = {
  constraint: 'calendar',
  deadline: 'flag',
  late: 'alert-triangle',
  conflict: 'info',
  custom: 'info',
};

const DEFAULT_SIDE: Record<IndicatorKind, IndicatorSide> = {
  constraint: 'start',
  deadline: 'end',
  late: 'end',
  conflict: 'end',
  custom: 'end',
};

const BLOCK = 'jects-gantt__indicator';
const BLOCK_LAYER = 'jects-gantt__indicators';

/** Human-readable label for a constraint type (for the indicator tooltip). */
const CONSTRAINT_LABEL: Record<ConstraintType, string> = {
  asSoonAsPossible: 'As soon as possible',
  asLateAsPossible: 'As late as possible',
  startNoEarlierThan: 'Start no earlier than',
  startNoLaterThan: 'Start no later than',
  finishNoEarlierThan: 'Finish no earlier than',
  finishNoLaterThan: 'Finish no later than',
  mustStartOn: 'Must start on',
  mustFinishOn: 'Must finish on',
};

/**
 * The Indicators feature. Stateless across tasks; all DOM it creates lives under
 * `.jects-gantt__bar` elements and is fully removed on `destroy()`.
 */
export class GanttIndicatorsFeature<T extends Model = Model> implements GanttFeature<T> {
  readonly name = 'indicators';

  private readonly config: Required<
    Omit<GanttIndicatorsConfig<T>, 'getIndicators' | 'onIndicatorClick'>
  > &
    Pick<GanttIndicatorsConfig<T>, 'getIndicators' | 'onIndicatorClick'>;

  private api: GanttApi<T> | null = null;
  private barsLayer: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private clickHandler: ((e: Event) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private rafId = 0;
  /** Conflict task ids from the last schedule, refreshed on schedule events. */
  private conflictIds = new Set<RecordId>();
  /** Engine-subscription unsubscribers, released on `destroy()`. */
  private disposers: Array<() => void> = [];
  private destroyed = false;

  constructor(config: GanttIndicatorsConfig<T> = {}) {
    this.config = {
      constraintIndicators: config.constraintIndicators ?? true,
      deadlineIndicators: config.deadlineIndicators ?? true,
      lateIndicators: config.lateIndicators ?? true,
      conflictIndicators: config.conflictIndicators ?? true,
      ...(config.getIndicators ? { getIndicators: config.getIndicators } : {}),
      ...(config.onIndicatorClick ? { onIndicatorClick: config.onIndicatorClick } : {}),
    };
  }

  /* ── GanttFeature ──────────────────────────────────────────────────────── */

  init(api: GanttApi<T>): void {
    // Re-init after destroy() (instance reuse) must not double-subscribe or
    // resurrect stale state; start from a clean slate.
    this.destroyed = false;
    this.disposers = [];
    this.conflictIds = new Set<RecordId>();
    this.api = api;
    const layer = api.timeline.el.querySelector<HTMLElement>('.jects-gantt__bars');
    this.barsLayer = layer;

    // Track conflicts from schedule passes so the conflict indicator stays fresh.
    // The schedule result carries the authoritative conflict set; the `conflict`
    // event is a redundant fast-path for the same data. Each `on()` returns an
    // unsubscriber we MUST release in destroy() — otherwise removeFeature() (which
    // calls destroy() while the Gantt is still alive) leaks these handlers, which
    // keep firing schedulePaint() on a dead feature and hold its closures alive.
    this.disposers.push(
      api.on('scheduleChange', ({ result }) => {
        this.conflictIds = new Set(result.conflicts.map((c) => c.taskId));
        this.schedulePaint();
      }),
    );
    this.disposers.push(
      api.on('conflict', ({ conflicts }) => {
        this.conflictIds = new Set(conflicts.map((c) => c.taskId));
        this.schedulePaint();
      }),
    );
    this.disposers.push(api.on('taskChange', () => this.schedulePaint()));

    if (layer) {
      // Re-decorate whenever the bars layer is rebuilt (every timeline repaint
      // clears + repopulates its children). Coalesced to one paint per frame.
      const observer = new MutationObserver(() => this.schedulePaint());
      observer.observe(layer, { childList: true });
      this.observer = observer;

      // Delegated activation: pointer + keyboard, so indicators are operable.
      const onClick = (e: Event): void => this.handleActivate(e, e.target as HTMLElement);
      const onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const span = (e.target as HTMLElement)?.closest?.(`.${BLOCK}`) as HTMLElement | null;
        if (!span) return;
        e.preventDefault();
        this.handleActivate(e, span);
      };
      layer.addEventListener('click', onClick, true);
      layer.addEventListener('keydown', onKey);
      this.clickHandler = onClick;
      this.keyHandler = onKey;
    }

    api.track(() => this.destroy());
    // Initial paint over whatever is already rendered.
    this.paint();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    // Release the engine subscriptions (scheduleChange/conflict/taskChange) so
    // they stop firing on this dead feature. Best-effort per disposer.
    for (const off of this.disposers) {
      try {
        off();
      } catch {
        /* best-effort */
      }
    }
    this.disposers = [];
    this.observer?.disconnect();
    this.observer = null;
    if (this.barsLayer) {
      if (this.clickHandler) this.barsLayer.removeEventListener('click', this.clickHandler, true);
      if (this.keyHandler) this.barsLayer.removeEventListener('keydown', this.keyHandler);
      this.clearAll(this.barsLayer);
    }
    this.clickHandler = null;
    this.keyHandler = null;
    this.barsLayer = null;
    this.conflictIds = new Set<RecordId>();
    this.api = null;
  }

  /* ── indicator resolution (pure, unit-testable) ────────────────────────── */

  /**
   * Resolve the full ordered list of indicators for a task: the enabled
   * built-ins (constraint, deadline, late, conflict) followed by any custom
   * indicators. Exposed so logic can be tested without the DOM.
   */
  indicatorsFor(task: TaskModel<T>): GanttIndicator[] {
    const api = this.api;
    const schedule = api?.getSchedule(task.id);
    const deadline = resolveDeadline(task);
    const out: GanttIndicator[] = [];

    if (this.config.constraintIndicators) {
      const ct = task.constraintType;
      if (ct && ct !== 'asSoonAsPossible' && ct !== 'asLateAsPossible') {
        const ind: GanttIndicator = {
          id: 'constraint',
          kind: 'constraint',
          tooltip:
            CONSTRAINT_LABEL[ct] +
            (task.constraintDate != null ? ` ${formatDate(task.constraintDate)}` : ''),
        };
        if (task.constraintDate != null) ind.date = task.constraintDate;
        out.push(ind);
      } else if (ct === 'asLateAsPossible') {
        out.push({ id: 'constraint', kind: 'constraint', tooltip: CONSTRAINT_LABEL[ct] });
      }
    }

    if (this.config.deadlineIndicators && deadline != null) {
      out.push({
        id: 'deadline',
        kind: 'deadline',
        tooltip: `Deadline ${formatDate(deadline)}`,
        date: deadline,
      });
    }

    if (this.config.lateIndicators && deadline != null) {
      const finish = task.end ?? schedule?.end;
      if (finish != null && finish > deadline) {
        out.push({
          id: 'late',
          kind: 'late',
          tooltip: `Late: finishes ${formatDate(finish)}, after deadline ${formatDate(deadline)}`,
          date: finish,
        });
      }
    }

    if (this.config.conflictIndicators && this.conflictIds.has(task.id)) {
      out.push({ id: 'conflict', kind: 'conflict', tooltip: 'Scheduling conflict' });
    }

    if (this.config.getIndicators) {
      // `api` is non-null in normal (installed) operation; it can be null when
      // `indicatorsFor` is exercised in isolation (unit tests). The cast keeps the
      // public `IndicatorContext.api` typed non-null for the common path.
      const ctx: IndicatorContext<T> = { api: api as GanttApi<T>, schedule, deadline };
      let custom: GanttIndicator[] | undefined;
      try {
        custom = this.config.getIndicators(task, ctx);
      } catch {
        custom = undefined;
      }
      if (custom) out.push(...custom);
    }

    return out;
  }

  /* ── painting ──────────────────────────────────────────────────────────── */

  /** Coalesce repaints to one per animation frame (or microtask in jsdom). */
  private schedulePaint(): void {
    if (this.rafId) return;
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: FrameRequestCallback): number => {
            queueMicrotask(() => cb(0));
            return 1;
          };
    this.rafId = raf(() => {
      this.rafId = 0;
      this.paint();
    });
  }

  /** (Re)decorate every visible bar with its resolved indicators. */
  paint(): void {
    const layer = this.barsLayer;
    const api = this.api;
    if (!layer || !api) return;

    const bars = layer.querySelectorAll<HTMLElement>('.jects-gantt__bar');
    for (const bar of bars) {
      const idStr = bar.dataset.taskId;
      if (idStr == null) continue;
      const task = this.taskFromBar(idStr);
      if (!task) {
        this.clearBar(bar);
        continue;
      }
      const indicators = this.indicatorsFor(task);
      this.decorateBar(bar, task, indicators);
    }
  }

  private decorateBar(bar: HTMLElement, task: TaskModel<T>, indicators: GanttIndicator[]): void {
    // Remove any prior decoration first (idempotent re-paint).
    this.clearBar(bar);
    if (indicators.length === 0) return;

    const startLayer = makeLayer('start');
    const endLayer = makeLayer('end');

    for (const ind of indicators) {
      const side = ind.side ?? DEFAULT_SIDE[ind.kind];
      (side === 'start' ? startLayer : endLayer).append(this.buildIndicatorEl(task, ind));
    }
    if (startLayer.childElementCount) bar.append(startLayer);
    if (endLayer.childElementCount) bar.append(endLayer);
  }

  private buildIndicatorEl(task: TaskModel<T>, ind: GanttIndicator): HTMLElement {
    const span = document.createElement('span');
    span.className = `${BLOCK} ${BLOCK}--${ind.kind}${ind.cls ? ` ${ind.cls}` : ''}`;
    span.dataset.indicatorId = ind.id;
    span.dataset.indicatorKind = ind.kind;
    span.tabIndex = 0;
    span.setAttribute('role', 'button');
    span.setAttribute('aria-label', ind.tooltip);
    span.title = ind.tooltip;
    const icon = ind.icon ?? ICON_FOR[ind.kind];
    setHtml(span, trustedHtml(renderIndicatorIcon(icon)));
    // Stash the task id so delegated activation can resolve back to the model.
    span.dataset.taskId = String(task.id);
    if (ind.date != null) span.dataset.date = String(ind.date);
    return span;
  }

  private handleActivate(native: Event, target: HTMLElement | null): void {
    const span = target?.closest?.(`.${BLOCK}`) as HTMLElement | null;
    if (!span || !this.api) return;
    const idStr = span.dataset.taskId;
    if (idStr == null) return;
    const task = this.taskFromBar(idStr);
    if (!task) return;
    const indicators = this.indicatorsFor(task);
    const indicator = indicators.find((i) => i.id === span.dataset.indicatorId);
    if (!indicator) return;
    native.stopPropagation();
    const payload: IndicatorClickPayload<T> = { task, indicator, native };
    this.config.onIndicatorClick?.(payload);
    (this.api as unknown as {
      emit(event: 'indicatorClick', payload: IndicatorClickPayload<T>): boolean;
    }).emit('indicatorClick', payload);
  }

  /* ── helpers ───────────────────────────────────────────────────────────── */

  private taskFromBar(idStr: string): TaskModel<T> | undefined {
    const api = this.api;
    if (!api) return undefined;
    // Bar ids are stringified; the engine stores the original id type. Try the
    // string first, then a numeric coercion for numeric ids.
    return (
      api.getTask(idStr) ??
      (/^-?\d+$/.test(idStr) ? api.getTask(Number(idStr)) : undefined)
    );
  }

  private clearBar(bar: HTMLElement): void {
    for (const layer of bar.querySelectorAll(`.${BLOCK_LAYER}`)) layer.remove();
  }

  private clearAll(root: HTMLElement): void {
    for (const layer of root.querySelectorAll(`.${BLOCK_LAYER}`)) layer.remove();
  }
}

function makeLayer(side: IndicatorSide): HTMLElement {
  const el = document.createElement('span');
  el.className = `${BLOCK_LAYER} ${BLOCK_LAYER}--${side}`;
  el.setAttribute('aria-hidden', 'false');
  return el;
}

/** Resolve a task's deadline (epoch ms) from the model's `deadline`/`data`. */
export function resolveDeadline(task: Model): number | undefined {
  const direct = (task as { deadline?: unknown }).deadline;
  if (typeof direct === 'number') return direct;
  if (direct instanceof Date) return direct.getTime();
  const data = (task as { data?: { deadline?: unknown } }).data;
  const nested = data?.deadline;
  if (typeof nested === 'number') return nested;
  if (nested instanceof Date) return nested.getTime();
  return undefined;
}

/** Compact UTC date for tooltips (YYYY-MM-DD). */
function formatDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
