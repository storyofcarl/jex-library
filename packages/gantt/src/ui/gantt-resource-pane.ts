/**
 * `GanttResourcePane` — the **integrated, axis-synced resource pane** for the
 * Gantt (Bryntum/DHTMLX "ResourceHistogram + Resource Utilization + Resources"
 * docked-pane parity).
 *
 * The package already ships three standalone resource views — `ResourceHistogram`
 * (time-phased allocation column chart), `ResourceUtilizationView` (drill-down
 * utilization grid) and `ResourceView` (the resources list). Each is individually
 * functional, but to reach reference-product parity the Gantt must mount them
 * **out of the box** in a docked pane that:
 *
 *   - shares the Gantt's own time axis (`gantt.timeline.axis`) so the histogram
 *     columns line up with the task bars and re-project in lockstep on zoom/pan;
 *   - keeps the histogram's horizontal scroll glued to the timeline scroller, so
 *     scrolling the chart scrolls the histogram and vice-versa (axis lockstep);
 *   - refreshes on every `scheduleChange` / `taskChange` / `assign` / `unassign`
 *     / `resourceChange` so allocation stays live as the plan and staffing change;
 *   - offers a toolbar to TOGGLE which view is shown (histogram / utilization /
 *     resources), exactly like the reference products' resource-pane tab strip.
 *
 * Architecture — additive + concurrency-safe (mirrors the other Gantt features):
 *   - A self-contained `GanttFeature` (its own root + CSS). It does NOT edit the
 *     `Gantt` class, the contract, the barrel, or any config. It installs via
 *     `gantt.use(new GanttResourcePane())` (or `{ plugins: [...] }`), reads the
 *     public `GanttApi` + `ResourceApi`, and mounts the three shipped view
 *     widgets, wiring them to the shared axis + refresh events.
 *   - When no resource layer is wired (`gantt.resources` is `undefined`) the
 *     feature is inert but still tracked for clean teardown — resources can be
 *     added later and the pane lit up by re-installing.
 *   - Pure helpers (`pickInitialView`, `resolveTaskSpan`) carry the small amount
 *     of decision logic so it is unit-testable without a DOM or a live Gantt.
 *
 * All listeners + mounted widgets + DOM are released on `destroy()` (also run via
 * the host's `track()` when the Gantt is destroyed). All times are epoch ms (UTC).
 */

import './gantt-resource-pane.css';
import { createEl, type Model, type RecordId } from '@jects/core';
import type { TimeUnit } from '@jects/timeline-core';
import type { GanttApi, GanttFeature, TaskModel } from '../contract.js';
import type { ResourceApi } from '../resource/resource-contract.js';
import { ResourceHistogram } from './resource-histogram.js';
import { ResourceUtilizationView } from './resource-utilization.js';
import { ResourceView } from '../resource/resource-view.js';

const BLOCK = 'jects-gantt-resource-pane';
const DAY_MS = 86_400_000;
const TIMELINE_SCROLLER_SELECTOR = '.jects-gantt__timeline-scroller';

/* ═══════════════════════════════════════════════════════════════════════════
   1. PUBLIC TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

/** Which sub-view the docked pane is showing. */
export type ResourcePaneView = 'histogram' | 'utilization' | 'resources';

/** A toolbar tab descriptor (id + visible/accessible label). */
export interface ResourcePaneTab {
  view: ResourcePaneView;
  label: string;
}

/** Configuration for {@link GanttResourcePane}. */
export interface GanttResourcePaneConfig {
  /**
   * Element to mount the pane into. When omitted, the feature appends its own
   * docked region to the Gantt root (`gantt.el`), under the task-tree/timeline
   * split — the out-of-the-box docked-pane behaviour.
   */
  mountInto?: HTMLElement;
  /**
   * Which views to expose as toolbar tabs, in order. Defaults to all three
   * (`['histogram', 'utilization', 'resources']`). Pass a subset to restrict the
   * pane (e.g. just the histogram).
   */
  views?: ReadonlyArray<ResourcePaneView>;
  /** Which view is shown first. Defaults to the first entry of {@link views}. */
  initialView?: ResourcePaneView;
  /**
   * Histogram bucket width in ms (e.g. one day / week). Defaults to one day.
   * Forwarded to the mounted {@link ResourceHistogram}.
   */
  histogramBucketMs?: number;
  /** Histogram lane height in px. Default `48`. */
  histogramLaneHeight?: number;
  /** Utilization period unit (day/week/month/…). Default `'week'`. */
  utilizationUnit?: TimeUnit;
  /** Hours per working day used by the utilization math. Default `8`. */
  hoursPerDay?: number;
  /** Accessible label for the whole pane region. Default `'Resource pane'`. */
  label?: string;
  /**
   * Start collapsed (toolbar visible, body hidden). The user expands via the
   * toolbar toggle. Default `false` (expanded).
   */
  collapsed?: boolean;
}

/**
 * Resolved (defaulted) config shape used internally — every optional field of
 * {@link GanttResourcePaneConfig} present.
 */
interface ResolvedConfig {
  mountInto: HTMLElement | undefined;
  views: ReadonlyArray<ResourcePaneView>;
  initialView: ResourcePaneView;
  histogramBucketMs: number;
  histogramLaneHeight: number;
  utilizationUnit: TimeUnit;
  hoursPerDay: number;
  label: string;
  collapsed: boolean;
}

const ALL_VIEWS: ReadonlyArray<ResourcePaneView> = ['histogram', 'utilization', 'resources'];

const VIEW_LABELS: Record<ResourcePaneView, string> = {
  histogram: 'Histogram',
  utilization: 'Utilization',
  resources: 'Resources',
};

/* ═══════════════════════════════════════════════════════════════════════════
   2. PURE HELPERS (unit-testable, no DOM / no live Gantt)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Resolve the first view to show: the explicit `initialView` when it is one of
 * the enabled `views`, else the first enabled view. Pure.
 */
export function pickInitialView(
  views: ReadonlyArray<ResourcePaneView>,
  initialView: ResourcePaneView | undefined,
): ResourcePaneView {
  if (initialView && views.includes(initialView)) return initialView;
  return views[0] ?? 'histogram';
}

/**
 * Resolve a task's time span `[start, end)` for the histogram, preferring the
 * engine's computed schedule (which reflects calendars + propagation) and falling
 * back to the task's own start/end/duration. Returns `undefined` when the task is
 * not schedulable. Pure over the two lookups it is given.
 */
export function resolveTaskSpan<T extends Model = Model>(
  taskId: RecordId,
  getSchedule: (id: RecordId) => { start: number; end: number } | undefined,
  getTask: (id: RecordId) => TaskModel<T> | undefined,
): { start: number; end: number } | undefined {
  const sched = getSchedule(taskId);
  if (sched && sched.end > sched.start) return { start: sched.start, end: sched.end };
  const task = getTask(taskId);
  if (!task) return undefined;
  const start = typeof task.start === 'number' ? task.start : undefined;
  if (start === undefined) return undefined;
  let end = typeof task.end === 'number' ? task.end : undefined;
  if (end === undefined) {
    const dur = typeof task.duration === 'number' ? task.duration : DAY_MS;
    end = start + Math.max(0, dur);
  }
  if (!(end > start)) end = start + 1;
  return { start, end };
}

/** Build the toolbar tab descriptors for the enabled views. Pure. */
export function buildTabs(views: ReadonlyArray<ResourcePaneView>): ResourcePaneTab[] {
  return views.map((view) => ({ view, label: VIEW_LABELS[view] }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. THE FEATURE
   ═══════════════════════════════════════════════════════════════════════════ */

/** Registry/feature name for {@link GanttResourcePane}. */
export const GANTT_RESOURCE_PANE_FEATURE = 'ganttResourcePane';

/**
 * The integrated resource pane. Install with `gantt.use(new GanttResourcePane())`
 * (or `new Gantt(host, { plugins: [new GanttResourcePane()] })`). It mounts the
 * histogram / utilization / resources views in a docked, axis-synced pane with a
 * toolbar to switch between them, and keeps them live as the schedule and
 * assignments change.
 */
export class GanttResourcePane<T extends Model = Model, R extends Model = Model>
  implements GanttFeature<T>
{
  readonly name = GANTT_RESOURCE_PANE_FEATURE;

  private readonly cfg: ResolvedConfig;
  private api: GanttApi<T, R> | null = null;
  private destroyed = false;
  private disposers: Array<() => void> = [];

  /** The pane root (owned unless `mountInto` was supplied). */
  private root: HTMLElement | null = null;
  private ownsRoot = false;
  private body: HTMLElement | null = null;
  private tabButtons = new Map<ResourcePaneView, HTMLButtonElement>();
  private collapseBtn: HTMLButtonElement | null = null;

  /** The currently shown view. */
  private current: ResourcePaneView;
  private collapsed: boolean;

  /** Mounted view widgets (built lazily, kept for refresh + teardown). */
  private histogram: ResourceHistogram<T, R> | null = null;
  private utilization: ResourceUtilizationView<T, R> | null = null;
  private resourceView: ResourceView<T, R> | null = null;
  private histogramHost: HTMLElement | null = null;
  private utilizationHost: HTMLElement | null = null;
  private resourceHost: HTMLElement | null = null;

  /** Coalesce bursts of refresh requests into one paint per frame. */
  private rafId = 0;
  /** Re-entrancy guard for the horizontal-scroll lockstep. */
  private syncingScroll = false;

  constructor(config: GanttResourcePaneConfig = {}) {
    const views =
      config.views && config.views.length > 0 ? config.views.slice() : ALL_VIEWS.slice();
    this.cfg = {
      mountInto: config.mountInto,
      views,
      initialView: pickInitialView(views, config.initialView),
      histogramBucketMs: config.histogramBucketMs ?? DAY_MS,
      histogramLaneHeight: config.histogramLaneHeight ?? 48,
      utilizationUnit: config.utilizationUnit ?? 'week',
      hoursPerDay: config.hoursPerDay ?? 8,
      label: config.label ?? 'Resource pane',
      collapsed: config.collapsed ?? false,
    };
    this.current = this.cfg.initialView;
    this.collapsed = this.cfg.collapsed;
  }

  /* ── GanttFeature ───────────────────────────────────────────────────────── */

  init(api: GanttApi<T>): void {
    this.destroyed = false;
    this.disposers = [];
    this.api = api as GanttApi<T, R>;

    this.buildChrome(api);
    this.mountViews();
    // Initial view selection WITHOUT the auto-expand `showView` does (so a
    // `collapsed: true` config stays collapsed on mount).
    this.syncTabState();
    this.applyCollapsed();
    if (!this.collapsed) this.refreshView(this.current);

    // Live refresh: spans move (schedule/task change) and staffing changes
    // (assign/unassign/resourceChange) all re-drive the views. These are emitted
    // by the host Gantt — assignment events flow through it from the manager.
    this.disposers.push(api.on('scheduleChange', () => this.scheduleRefresh()));
    this.disposers.push(api.on('taskChange', () => this.scheduleRefresh()));
    const hostOn = api as unknown as { on(e: string, fn: () => void): () => void };
    this.disposers.push(hostOn.on('assign', () => this.scheduleRefresh()));
    this.disposers.push(hostOn.on('unassign', () => this.scheduleRefresh()));
    this.disposers.push(hostOn.on('resourceChange', () => this.scheduleRefresh()));

    // Axis lockstep: glue the histogram's horizontal scroll to the timeline
    // scroller (and back), so the two panes pan together.
    this.wireScrollLockstep(api);

    api.track(() => this.destroy());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // Detach from the host's feature registry so a destroyed pane is no longer
    // listed (the Gantt's tracked disposer also calls `removeFeature` → `destroy`,
    // which the `destroyed` guard above makes a no-op, so this is re-entrant-safe).
    const host = this.api;
    if (host) {
      try {
        host.removeFeature(this.name);
      } catch {
        /* best-effort */
      }
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    for (const off of this.disposers) {
      try {
        off();
      } catch {
        /* best-effort */
      }
    }
    this.disposers = [];
    this.histogram?.destroy();
    this.utilization?.destroy();
    this.resourceView?.destroy();
    this.histogram = null;
    this.utilization = null;
    this.resourceView = null;
    if (this.ownsRoot) this.root?.remove();
    this.root = null;
    this.body = null;
    this.tabButtons.clear();
    this.api = null;
  }

  /* ── public surface ─────────────────────────────────────────────────────── */

  /** The pane root element (or `null` before `init`/after `destroy`). */
  get element(): HTMLElement | null {
    return this.root;
  }

  /** The view currently shown. */
  get view(): ResourcePaneView {
    return this.current;
  }

  /** Whether the pane body is collapsed. */
  get isCollapsed(): boolean {
    return this.collapsed;
  }

  /** Switch the visible view (no-op if not one of the enabled views). */
  showView(view: ResourcePaneView): void {
    if (!this.cfg.views.includes(view)) return;
    this.current = view;
    // Expand if collapsed — selecting a tab reveals the body (reference behaviour).
    if (this.collapsed) this.setCollapsed(false);
    this.syncTabState();
    this.syncBodyVisibility();
    // Repaint the freshly-revealed view so it reflects the latest model.
    this.refreshView(view);
  }

  /** Collapse / expand the pane body. */
  setCollapsed(collapsed: boolean): void {
    if (this.collapsed === collapsed) return;
    this.collapsed = collapsed;
    this.applyCollapsed();
    if (!collapsed) this.refreshView(this.current);
  }

  /** Force an immediate repaint of the active view (synchronous). */
  refresh(): void {
    this.refreshView(this.current);
  }

  /* ── chrome construction ────────────────────────────────────────────────── */

  private buildChrome(api: GanttApi<T>): void {
    const root = this.cfg.mountInto ?? createEl('div', { className: `${BLOCK}` });
    if (!this.cfg.mountInto) {
      root.classList.add(BLOCK);
      api.el.append(root);
      this.ownsRoot = true;
    } else {
      root.classList.add(BLOCK);
    }
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', this.cfg.label);
    this.root = root;

    // Toolbar: a tablist of view toggles + a collapse toggle.
    const toolbar = createEl('div', { className: `${BLOCK}__toolbar` });

    const tablist = createEl('div', { className: `${BLOCK}__tablist` });
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', `${this.cfg.label} views`);

    for (const tab of buildTabs(this.cfg.views)) {
      const btn = createEl('button', {
        className: `${BLOCK}__tab`,
        text: tab.label,
      }) as HTMLButtonElement;
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.id = `${BLOCK}-tab-${tab.view}`;
      btn.setAttribute('aria-controls', `${BLOCK}-panel-${tab.view}`);
      btn.dataset.view = tab.view;
      btn.addEventListener('click', () => this.showView(tab.view));
      btn.addEventListener('keydown', (e) => this.onTabKeydown(e, tab.view));
      this.tabButtons.set(tab.view, btn);
      tablist.append(btn);
    }
    toolbar.append(tablist);

    // Collapse / expand toggle (Bryntum/DHTMLX docked-pane affordance).
    const collapseBtn = createEl('button', {
      className: `${BLOCK}__collapse`,
    });
    collapseBtn.type = 'button';
    collapseBtn.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    this.collapseBtn = collapseBtn;
    toolbar.append(collapseBtn);

    // Body: one host per view, only the active one shown.
    const body = createEl('div', { className: `${BLOCK}__body` });
    this.body = body;

    root.append(toolbar, body);
  }

  /** Per-tab roving keyboard nav (Left/Right/Home/End across the tablist). */
  private onTabKeydown(e: KeyboardEvent, view: ResourcePaneView): void {
    const views = this.cfg.views;
    const idx = views.indexOf(view);
    let next = -1;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (idx + 1) % views.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (idx - 1 + views.length) % views.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = views.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const target = views[next];
    if (target == null) return;
    this.showView(target);
    this.tabButtons.get(target)?.focus();
  }

  /* ── view mounting ──────────────────────────────────────────────────────── */

  private mountViews(): void {
    const api = this.api;
    const body = this.body;
    if (!api || !body) return;
    const resources = api.resources;

    for (const view of this.cfg.views) {
      const host = createEl('div', { className: `${BLOCK}__panel` });
      host.id = `${BLOCK}-panel-${view}`;
      host.setAttribute('role', 'tabpanel');
      host.setAttribute('aria-labelledby', `${BLOCK}-tab-${view}`);
      host.tabIndex = 0;
      body.append(host);

      if (!resources) {
        // No resource layer — render an inert, accessible empty state.
        host.append(
          createEl('div', {
            className: `${BLOCK}__empty`,
            text: 'No resource data',
          }),
        );
        continue;
      }

      switch (view) {
        case 'histogram':
          this.histogramHost = host;
          this.histogram = this.buildHistogram(api, resources, host);
          break;
        case 'utilization':
          this.utilizationHost = host;
          this.utilization = this.buildUtilization(api, resources, host);
          break;
        case 'resources':
          this.resourceHost = host;
          this.resourceView = new ResourceView<T, R>(host, { api: resources });
          break;
      }
    }
  }

  private buildHistogram(
    api: GanttApi<T, R>,
    resources: ResourceApi<T, R>,
    host: HTMLElement,
  ): ResourceHistogram<T, R> {
    return new ResourceHistogram<T, R>(host, {
      api: resources,
      axis: api.timeline.axis,
      getTaskSpan: (id) =>
        resolveTaskSpan<T>(
          id,
          (tid) => {
            const s = api.getSchedule(tid);
            return s && typeof s.start === 'number' && typeof s.end === 'number'
              ? { start: s.start, end: s.end }
              : undefined;
          },
          (tid) => api.getTask(tid),
        ),
      bucketMs: this.cfg.histogramBucketMs,
      laneHeight: this.cfg.histogramLaneHeight,
    });
  }

  private buildUtilization(
    api: GanttApi<T, R>,
    resources: ResourceApi<T, R>,
    host: HTMLElement,
  ): ResourceUtilizationView<T, R> {
    return new ResourceUtilizationView<T, R>(host, {
      api: resources,
      tasks: { getTask: (id) => api.getTask(id) },
      unit: this.cfg.utilizationUnit,
      hoursPerDay: this.cfg.hoursPerDay,
    });
  }

  /* ── view state ─────────────────────────────────────────────────────────── */

  private showsView(view: ResourcePaneView): boolean {
    return this.current === view;
  }

  private syncTabState(): void {
    for (const [view, btn] of this.tabButtons) {
      const active = view === this.current;
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
      btn.classList.toggle(`${BLOCK}__tab--active`, active);
    }
  }

  private syncBodyVisibility(): void {
    const hosts: Array<[ResourcePaneView, HTMLElement | null]> = [
      ['histogram', this.histogramHost],
      ['utilization', this.utilizationHost],
      ['resources', this.resourceHost],
    ];
    for (const [view, host] of hosts) {
      if (!host) continue;
      const active = this.showsView(view) && !this.collapsed;
      host.hidden = !active;
    }
  }

  private applyCollapsed(): void {
    const root = this.root;
    const body = this.body;
    if (!root || !body) return;
    root.classList.toggle(`${BLOCK}--collapsed`, this.collapsed);
    body.hidden = this.collapsed;
    this.syncBodyVisibility();
    if (this.collapseBtn) {
      this.collapseBtn.setAttribute('aria-expanded', this.collapsed ? 'false' : 'true');
      this.collapseBtn.setAttribute(
        'aria-label',
        this.collapsed ? 'Expand resource pane' : 'Collapse resource pane',
      );
      this.collapseBtn.textContent = this.collapsed ? '▸' : '▾';
    }
    this.syncTabState();
  }

  /* ── refresh ────────────────────────────────────────────────────────────── */

  /** Coalesce refresh requests into one paint on the next frame. */
  private scheduleRefresh(): void {
    if (this.destroyed) return;
    if (typeof requestAnimationFrame !== 'function') {
      this.refreshView(this.current);
      return;
    }
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      if (!this.destroyed) this.refreshView(this.current);
    });
  }

  /**
   * Repaint a single view. Only the ACTIVE view is repainted on a refresh tick
   * (the hidden ones repaint when next shown), keeping live updates cheap.
   */
  private refreshView(view: ResourcePaneView): void {
    if (this.collapsed) return;
    switch (view) {
      case 'histogram':
        this.histogram?.refresh();
        this.syncHistogramWidth();
        break;
      case 'utilization':
        // The Widget base re-renders on `update`, recomputing the dataset.
        this.utilization?.update({});
        break;
      case 'resources':
        this.resourceView?.update({});
        break;
    }
  }

  /* ── axis lockstep (horizontal scroll sync) ─────────────────────────────── */

  private get timelineScroller(): HTMLElement | null {
    const api = this.api;
    if (!api) return null;
    return api.timeline.el.querySelector<HTMLElement>(TIMELINE_SCROLLER_SELECTOR);
  }

  /**
   * Match the histogram panel's content width to the shared axis content width so
   * its horizontal scrollbar tracks the timeline's, and keep the two scroll
   * offsets glued. The histogram already positions its bars from the same axis, so
   * equal content widths ⇒ aligned columns under a synced scrollLeft.
   */
  private syncHistogramWidth(): void {
    const host = this.histogramHost;
    const api = this.api;
    if (!host || !api) return;
    host.style.setProperty('--_pane-axis-width', `${Math.max(api.timeline.axis.contentWidth, 1)}px`);
  }

  private wireScrollLockstep(api: GanttApi<T>): void {
    const scroller = this.timelineScroller;
    if (!scroller) return;

    const onTimelineScroll = (): void => {
      if (this.syncingScroll) return;
      const host = this.histogramHost;
      if (!host || host.hidden) return;
      this.syncingScroll = true;
      host.scrollLeft = scroller.scrollLeft;
      this.syncingScroll = false;
    };
    scroller.addEventListener('scroll', onTimelineScroll);
    this.disposers.push(() => scroller.removeEventListener('scroll', onTimelineScroll));

    // And the reverse: scrolling the histogram scrolls the timeline.
    const bindHistogramScroll = (): void => {
      const host = this.histogramHost;
      if (!host) return;
      const onPaneScroll = (): void => {
        if (this.syncingScroll) return;
        const tl = this.timelineScroller;
        if (!tl) return;
        this.syncingScroll = true;
        tl.scrollLeft = host.scrollLeft;
        this.syncingScroll = false;
      };
      host.addEventListener('scroll', onPaneScroll);
      this.disposers.push(() => host.removeEventListener('scroll', onPaneScroll));
    };
    bindHistogramScroll();
    void api; // (kept for symmetry / future axis-event wiring)
  }
}

/**
 * Convenience factory + auto-install: build a {@link GanttResourcePane} and
 * install it on `gantt`. Returns the feature so the caller can drive
 * `showView` / `setCollapsed` / `refresh`.
 */
export function installResourcePane<T extends Model = Model, R extends Model = Model>(
  gantt: GanttApi<T>,
  config?: GanttResourcePaneConfig,
): GanttResourcePane<T, R> {
  const feature = new GanttResourcePane<T, R>(config);
  gantt.use(feature);
  return feature;
}
