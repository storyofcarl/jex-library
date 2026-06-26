/**
 * Scheduler — the resource scheduler Widget.
 *
 * Composes the framework-free primitives from `@jects/timeline-core` (the
 * `DefaultTimeAxis` time⇄pixel projection, the `DefaultRowVirtualizer` vertical
 * virtualization seam over core `computeWindow`/`OffsetIndex`, the bar
 * positioning + drag/resize/drag-create gestures, the orthogonal dependency
 * router, and the tooltip controller) into a complete, light-DOM resource
 * scheduler. The locked resource columns on the left reuse the same row geometry
 * as `@jects/grid`; editors reuse `@jects/widgets` (`Window`, `ContextMenu`).
 *
 * Light-DOM, class-based, token-pure CSS (D1/D6). Extends the core `Widget`, so
 * every `effect()`/listener/child widget it creates is auto-disposed on
 * `destroy()`.
 */

import {
  Widget,
  createEl,
  register,
  computeWindow,
  type RecordId,
} from '@jects/core';
import {
  DefaultTimeAxis,
  DefaultRowVirtualizer,
  WEEK_AND_DAY,
  PRESET_LADDER,
  zoomInStep,
  zoomOutStep,
  clampZoom,
  computeNonWorkingSpans,
  projectNonWorkingSpans,
  OrthogonalDependencyRouter,
  TimelineTooltip,
  startBarDrag,
  startDragCreate,
  zoneAtX,
  type TimeAxis,
  type TimeSpan,
  type ViewPreset,
  type EventBar,
  type TimelineEvent,
  type RowProvider,
  type TimelineRow,
  type DragMode,
  type BarDragController,
  type DragCreateController,
} from '@jects/timeline-core';
import { ContextMenu, type MenuItem } from '@jects/widgets';

import type {
  SchedulerConfig,
  SchedulerEvents,
  ResourceModel,
  EventModel,
  ResourceColumnConfig,
} from '../contract.js';
import {
  coerceResourceStore,
  coerceEventStore,
  type ResourceStore,
  type EventStore,
} from '../stores/stores.js';
import { layoutLane } from '../model/event-layout.js';
import { toLinks } from '../model/dependencies.js';
import { parseRRule, expandOccurrences } from '../model/recurrence.js';
import {
  projectTimeRangeConfigs,
  projectResourceTimeRangeConfigs,
} from '../model/time-ranges.js';
import { planInfiniteScroll } from '../model/infinite-scroll.js';
import { openEventEditor } from './event-editor.js';
import { formatTime } from './format.js';
import {
  coerceDependencyStore,
  type DependencyStore,
} from '../stores/dependency-store.js';
import {
  DependencyEditController,
  type DependencyEditHost,
} from './dependency-edit.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Internal: a resolved event span + its source record. */
interface ResolvedEvent {
  id: RecordId;
  resourceId: RecordId;
  span: TimeSpan;
  record: EventModel;
  /** When this is a materialized recurrence occurrence, the master id. */
  masterId?: RecordId;
}

export class Scheduler extends Widget<SchedulerConfig, SchedulerEvents> {
  /* ── data ─────────────────────────────────────────────────────────────── */
  private declare resourceStore: ResourceStore;
  private declare eventStore: EventStore;
  /**
   * Reactive store of dependencies. Created/deleted links from the
   * dependency-editing UI are written here (not into the config array) so they
   * are observable, first-class mutations. Seeded from `config.dependencies`.
   */
  private declare dependencyStore: DependencyStore;
  /**
   * The dependency drawing/editing controller (only when `dependenciesEditable`).
   * Declared (not field-initialized) because the Widget base calls
   * `render()→initEngine()` from inside its constructor, BEFORE subclass field
   * initializers run — a `= null` initializer would clobber the value set during
   * `initEngine()`. It is assigned there instead.
   */
  private declare depEdit: DependencyEditController | null;

  /* ── engine ───────────────────────────────────────────────────────────── */
  private declare axis: TimeAxis;
  private declare virtualizer: DefaultRowVirtualizer<ResourceModel>;
  private declare router: OrthogonalDependencyRouter<EventModel>;
  private declare tooltip: TimelineTooltip | null;
  private declare ctxMenu: ContextMenu | null;

  /* ── DOM parts ────────────────────────────────────────────────────────── */
  private declare elHeader: HTMLElement; // time header bands
  private declare elResourceHeader: HTMLElement; // locked columns header
  private declare elResourcePanel: HTMLElement; // locked left columns body
  private declare elScroller: HTMLElement; // scrollable time-grid viewport
  private declare elContent: HTMLElement; // sized to total content
  private declare elBars: HTMLElement; // event bars layer
  private declare elBackdrop: HTMLElement; // gridlines + shading layer
  private declare elDeps: SVGSVGElement; // dependency lines layer
  private declare elEmpty: HTMLElement;
  private declare elLive: HTMLElement; // polite aria-live announcer
  /** Id of the bar that currently holds the roving tabindex (Tab stop). */
  private focusedBarId: RecordId | null = null;

  /* ── geometry state ───────────────────────────────────────────────────── */
  private declare zoom: number;
  private declare preset: ViewPreset;
  private declare presets: ViewPreset[];
  private declare scrollTop: number;
  private declare scrollLeft: number;
  private declare rowHeight: number;
  /** Resolved events keyed by event id (incl. recurrence occurrences). */
  private declare visibleBars: Map<RecordId, EventBar<EventModel>>;
  /** Resolved-event metadata (master id / occurrence span) keyed by bar id. */
  private declare resolvedById: Map<RecordId, ResolvedEvent>;
  /** Absolute top (content y) of each resource row, by resource id. */
  private declare rowTops: Map<RecordId, number>;
  private declare resizeObs: ResizeObserver | null;
  private declare destroyed2: boolean;
  /**
   * The live drag / drag-create gesture controller, if any. Tracked + disposed
   * on destroy so an in-flight gesture cannot leak its global window listeners,
   * pointer capture, or stale closures past the widget's lifetime.
   */
  private activeDrag: BarDragController | DragCreateController | null = null;

  /* ─────────────────────────────────────────────────────────────────────── */

  protected override defaults(): Partial<SchedulerConfig> {
    return {
      orientation: 'horizontal',
      rowHeight: 48,
      overlap: 'stack',
      overscan: 5,
      snap: true,
      draggable: true,
      resizable: true,
      creatable: false,
      editable: true,
      dependenciesEditable: false,
      showNonWorkingTime: true,
      showNowMarker: true,
      emptyText: 'No resources',
    };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-scheduler' });
    // A scheduler is a composite, scrollable, keyboard-driven widget rather than
    // a static data grid; `role=application` + a label keeps it operable without
    // imposing the strict row/cell child structure a `grid` role would demand
    // (which axe enforces and which the virtualized, layered DOM cannot satisfy).
    root.setAttribute('role', 'application');
    root.setAttribute('aria-label', 'Resource scheduler');
    root.tabIndex = 0;

    // Two-column shell: locked resource panel | time grid.
    const corner = createEl('div', { className: 'jects-scheduler__corner' });
    const resourceHeader = createEl('div', { className: 'jects-scheduler__resource-header' });
    corner.appendChild(resourceHeader);

    const header = createEl('div', { className: 'jects-scheduler__time-header' });
    header.setAttribute('aria-hidden', 'true');

    const resourcePanel = createEl('div', { className: 'jects-scheduler__resources' });
    resourcePanel.setAttribute('role', 'list');
    resourcePanel.setAttribute('aria-label', 'Resources');

    const scroller = createEl('div', { className: 'jects-scheduler__scroller' });
    // The scroll region must be keyboard-reachable (axe scrollable-region-focusable).
    scroller.tabIndex = 0;
    scroller.setAttribute('role', 'group');
    scroller.setAttribute('aria-label', 'Schedule timeline');
    const content = createEl('div', { className: 'jects-scheduler__content' });
    const backdrop = createEl('div', { className: 'jects-scheduler__backdrop' });
    const deps = document.createElementNS(SVG_NS, 'svg');
    deps.setAttribute('class', 'jects-scheduler__deps');
    deps.setAttribute('aria-hidden', 'true');
    const bars = createEl('div', { className: 'jects-scheduler__bars' });
    // A toolbar-style group of focusable event "buttons" with roving tabindex,
    // navigable by arrow keys. (A `list` cannot contain interactive `button`
    // children, so we use `group` here and `button` on each bar.)
    bars.setAttribute('role', 'group');
    bars.setAttribute('aria-label', 'Scheduled events');
    content.append(backdrop, deps, bars);
    scroller.appendChild(content);

    const empty = createEl('div', { className: 'jects-scheduler__empty' });
    empty.hidden = true;

    // Visually-hidden polite live region: move/resize results are announced here
    // so screen-reader users get feedback after a keyboard or pointer change.
    const live = createEl('div', { className: 'jects-scheduler__live' });
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');

    root.append(corner, header, resourcePanel, scroller, empty, live);

    // Stash refs (fields set via declare; assigned here pre-render).
    this.elResourceHeader = resourceHeader;
    this.elHeader = header;
    this.elResourcePanel = resourcePanel;
    this.elScroller = scroller;
    this.elContent = content;
    this.elBackdrop = backdrop;
    this.elDeps = deps;
    this.elBars = bars;
    this.elEmpty = empty;
    this.elLive = live;

    return root;
  }

  protected override render(): void {
    // First render: initialise engine + listeners exactly once.
    if (this.axis === undefined) this.initEngine();
    this.applyOrientation();
    this.paint();
  }

  /* ── init ─────────────────────────────────────────────────────────────── */

  private initEngine(): void {
    const cfg = this.config;
    this.destroyed2 = false;
    this.resourceStore = coerceResourceStore(cfg.resources);
    this.eventStore = coerceEventStore(cfg.events);
    this.dependencyStore = coerceDependencyStore(cfg.dependencies);
    this.preset = cfg.preset ?? WEEK_AND_DAY;
    this.presets = cfg.presets ?? [...PRESET_LADDER];
    this.zoom = clampZoom(this.preset, cfg.zoom ?? 1);
    this.rowHeight = cfg.rowHeight ?? 48;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.visibleBars = new Map();
    this.resolvedById = new Map();
    this.rowTops = new Map();
    this.tooltip = null;
    this.ctxMenu = null;
    this.resizeObs = null;
    this.depEdit = null;

    const range = cfg.range ?? this.deriveRange();
    this.axis = new DefaultTimeAxis({
      range,
      preset: this.preset,
      zoom: this.zoom,
    });

    const provider: RowProvider<ResourceModel> = {
      count: () => this.resourceStore.count,
      rowAt: (i) => this.rowAt(i),
      indexOf: (id) => this.resourceStore.indexOf(id),
    };
    this.virtualizer = new DefaultRowVirtualizer<ResourceModel>({
      provider,
      rowHeight: this.rowHeight,
      overscan: cfg.overscan ?? 5,
    });

    this.router = new OrthogonalDependencyRouter<EventModel>({
      rowOffsets: this.rowTops,
    });

    // Re-paint whenever the underlying data changes.
    this.track(this.resourceStore.events.on('change', () => this.invalidateAndPaint()));
    this.track(this.eventStore.events.on('change', () => this.invalidateAndPaint()));
    this.track(this.dependencyStore.events.on('change', () => this.invalidateAndPaint()));

    // Dependency drawing / editing UI (terminals + drag-to-link + delete).
    if (cfg.dependenciesEditable) {
      this.el.classList.add('jects-scheduler--deps-editable');
      this.depEdit = new DependencyEditController(this.dependencyEditHost());
      this.track(() => {
        this.depEdit?.destroy();
        this.depEdit = null;
      });
    }

    // Scroll → repaint window. The `scroll` event fires on the scroll container
    // (`elScroller`) and does NOT bubble, so the listener must be bound there
    // directly (not on the root). Tracked for removal on destroy.
    const onScroll = (): void => this.onScroll();
    this.elScroller.addEventListener('scroll', onScroll);
    this.track(() => this.elScroller.removeEventListener('scroll', onScroll));

    // Pointer interactions on the bars layer. NOTE: the Widget base calls
    // render() → initEngine() from inside its constructor, BEFORE this subclass's
    // class-field arrow handlers are assigned, so we must NOT pass `this.onX`
    // directly here (it is still `undefined`). Wrap in a closure that resolves
    // the field lazily at event time, and keep the wrapper ref for removal.
    const onPointerDown = (e: PointerEvent): void => this.onPointerDown(e);
    this.elContent.addEventListener('pointerdown', onPointerDown as EventListener);
    this.track(() =>
      this.elContent.removeEventListener('pointerdown', onPointerDown as EventListener),
    );

    // Click / dblclick on bars.
    this.on2('.jects-scheduler__bar', 'click', (e, el) => this.onBarClick(e as MouseEvent, el));
    this.on2('.jects-scheduler__bar', 'dblclick', (e, el) => this.onBarDblClick(e as MouseEvent, el));

    // Roving-tabindex keyboard grid over the focusable event bars: arrows move
    // focus between bars (and across lanes), Enter/Space opens the editor, Delete
    // removes. Keydown is handled on the focused BAR (delegated), not only on the
    // root, so focused bars are operable. Focusing a bar makes it the Tab stop.
    this.on2('.jects-scheduler__bar', 'keydown', (e, el) => this.onBarKeyDown(e as KeyboardEvent, el));
    this.on2('.jects-scheduler__bar', 'focusin', (_e, el) => this.onBarFocus(el));

    // Tooltip (only when a resolver is supplied).
    if (cfg.eventTooltip) {
      this.tooltip = new TimelineTooltip({ host: this.elContent, placement: 'top', showDelay: 120 });
      this.track(() => this.tooltip?.destroy());
      this.on2('.jects-scheduler__bar', 'pointerenter', (e, el) =>
        this.showTooltip(e as PointerEvent, el),
      );
      this.on2('.jects-scheduler__bar', 'pointerleave', () => this.tooltip?.hide());
    }

    // Context menu for events.
    if (cfg.editable !== false) {
      this.ctxMenu = new ContextMenu(this.elContent, { items: [] });
      this.track(() => this.ctxMenu?.destroy());
      this.ctxMenu.on('select', ({ id }) => this.onMenuSelect(id));
      const onContextMenu = (e: MouseEvent): void => this.onContextMenu(e);
      this.elContent.addEventListener('contextmenu', onContextMenu as EventListener);
      this.track(() =>
        this.elContent.removeEventListener('contextmenu', onContextMenu as EventListener),
      );
    }

    // Keyboard: arrows scroll, +/- zoom.
    this.listen('keydown', (e) => this.onKeyDown(e));

    // Observe size so virtualization tracks the real viewport height.
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => this.paint());
      this.resizeObs.observe(this.elScroller);
      this.track(() => this.resizeObs?.disconnect());
    }

    // Any in-flight drag/drag-create controller is torn down on destroy so its
    // global window listeners / pointer capture / stale closure cannot outlive
    // the widget (e.g. route change or store reload mid-gesture).
    this.track(() => {
      this.activeDrag?.destroy();
      this.activeDrag = null;
    });
  }

  /** Derive a padded range from the events' min/max span. */
  private deriveRange(): TimeSpan {
    let min = Infinity;
    let max = -Infinity;
    this.eventStore.forEach((e) => {
      if (e.startDate < min) min = e.startDate;
      if (e.endDate > max) max = e.endDate;
    });
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      const now = Date.now();
      min = now;
      max = now + 86_400_000 * 14;
    }
    const pad = Math.max(86_400_000, (max - min) * 0.1);
    return { start: min - pad, end: max + pad };
  }

  private rowAt(i: number): TimelineRow<ResourceModel> | undefined {
    const record = this.resourceStore.getAt(i);
    if (!record) return undefined;
    return {
      id: record.id,
      record,
      height: record.rowHeight ?? this.rowHeight,
    };
  }

  /* ── orientation ──────────────────────────────────────────────────────── */

  private applyOrientation(): void {
    const orientation = this.config.orientation ?? 'horizontal';
    this.el.classList.toggle('jects-scheduler--vertical', orientation === 'vertical');
    this.el.classList.toggle('jects-scheduler--horizontal', orientation !== 'vertical');
  }

  /* ── painting ─────────────────────────────────────────────────────────── */

  private invalidateAndPaint(): void {
    if (this.destroyed2) return;
    this.virtualizer.invalidate();
    this.paint();
  }

  /** Full repaint: header, locked columns, backdrop, bars, dependencies. */
  private paint(): void {
    if (this.destroyed2) return;
    const empty = this.resourceStore.count === 0;
    this.elEmpty.hidden = !empty;
    this.elEmpty.textContent = this.config.emptyText ?? 'No resources';
    if (empty) {
      this.elBars.replaceChildren();
      this.elBackdrop.replaceChildren();
      this.elResourcePanel.replaceChildren();
      this.elHeader.replaceChildren();
      return;
    }

    const totalSize = this.virtualizer.count * this.rowHeight;
    const contentWidth = this.axis.contentWidth;
    this.elContent.style.width = `${contentWidth}px`;
    this.elContent.style.height = `${totalSize}px`;
    this.elDeps.setAttribute('width', String(contentWidth));
    this.elDeps.setAttribute('height', String(totalSize));

    this.paintHeader();
    this.paintResourceColumns();
    this.paintBackdrop();
    this.paintBars();
    this.paintDependencies();
    // Re-apply terminal handles + selection styling after the layers are rebuilt.
    this.depEdit?.afterPaint();
  }

  /**
   * Build the typed adapter the {@link DependencyEditController} operates through.
   * Exposes only the slice it needs (axis, bars, row offsets, the SVG/bars
   * layers, the store, coordinate mapping, emit/announce/repaint) — keeping the
   * controller decoupled from the widget internals + independently testable.
   */
  private dependencyEditHost(): DependencyEditHost {
    // Getters keep the references live across repaints (axis is stable, but
    // `visibleBars`/`rowTops`/`dependencyStore` are reassigned/cleared each paint,
    // so plain properties would snapshot stale references).
    const widget = this;
    return {
      get axis() {
        return widget.axis;
      },
      get visibleBars() {
        return widget.visibleBars;
      },
      get rowTops() {
        return widget.rowTops;
      },
      get dependencyStore() {
        return widget.dependencyStore;
      },
      barsLayer: this.elBars,
      depsLayer: this.elDeps,
      toContentX: (x) => widget.toContentX(x),
      toContentY: (y) => widget.toContentY(y),
      emit: (event, payload) => widget.emit(event as never, payload as never),
      announce: (msg) => widget.announce(msg),
      repaint: () => widget.paint(),
    };
  }

  /** Paint the multi-band time header for the visible pixel window. */
  private paintHeader(): void {
    const headers = this.preset.headers;
    const xStart = this.scrollLeft;
    const xEnd = this.scrollLeft + this.viewportWidth();
    const frag = document.createDocumentFragment();

    // Finest lane (ticks) drives the geometry; coarser bands are derived by
    // grouping ticks under their parent band cell.
    const ticks = this.axis.ticksInRange(xStart - 200, xEnd + 200);
    for (let b = 0; b < headers.length; b++) {
      const band = createEl('div', { className: 'jects-scheduler__header-band' });
      const isFinest = b === headers.length - 1;
      if (isFinest) {
        for (const tick of ticks) {
          const cell = createEl('div', { className: 'jects-scheduler__header-cell' });
          cell.style.left = `${tick.x - this.scrollLeft}px`;
          cell.style.width = `${tick.width}px`;
          cell.classList.toggle('jects-scheduler__header-cell--major', tick.major);
          cell.textContent = this.formatTick(tick.span.start, headers[b]!.format);
          band.appendChild(cell);
        }
      } else {
        // Major boundaries delimit the coarser cells.
        const majors = ticks.filter((t) => t.major);
        const bounds = majors.length > 0 ? majors : ticks.length > 0 ? [ticks[0]!] : [];
        for (let i = 0; i < bounds.length; i++) {
          const start = bounds[i]!;
          const next = bounds[i + 1];
          const cell = createEl('div', { className: 'jects-scheduler__header-cell' });
          cell.style.left = `${start.x - this.scrollLeft}px`;
          const width = next ? next.x - start.x : (ticks[ticks.length - 1]?.x ?? start.x) + 80 - start.x;
          cell.style.width = `${Math.max(0, width)}px`;
          cell.textContent = this.formatTick(start.span.start, headers[b]!.format);
          band.appendChild(cell);
        }
      }
      frag.appendChild(band);
    }
    this.elHeader.replaceChildren(frag);
  }

  /** Paint the locked resource columns body (virtualized). */
  private paintResourceColumns(): void {
    const columns = this.resolveColumns();
    // Header cells.
    const headerFrag = document.createDocumentFragment();
    for (const col of columns) {
      const cell = createEl('div', { className: 'jects-scheduler__resource-cell jects-scheduler__resource-cell--head' });
      cell.style.width = `${col.width ?? 140}px`;
      cell.textContent = col.text ?? String(col.field);
      headerFrag.appendChild(cell);
    }
    this.elResourceHeader.replaceChildren(headerFrag);

    const win = this.rowWindow();
    const frag = document.createDocumentFragment();
    this.elResourcePanel.style.height = `${win.totalSize}px`;
    for (let i = win.startIndex; i < win.endIndex; i++) {
      const record = this.resourceStore.getAt(i);
      if (!record) continue;
      const row = createEl('div', { className: 'jects-scheduler__resource-row' });
      row.setAttribute('role', 'listitem');
      row.setAttribute('aria-label', record.name);
      row.style.position = 'absolute';
      row.style.top = `${i * this.rowHeight}px`;
      row.style.height = `${this.rowHeight}px`;
      row.dataset.resourceId = String(record.id);
      for (const col of columns) {
        const cell = createEl('div', { className: 'jects-scheduler__resource-cell' });
        cell.style.width = `${col.width ?? 140}px`;
        if (col.renderer) cell.innerHTML = col.renderer(record);
        else cell.textContent = String(record[col.field] ?? '');
        row.appendChild(cell);
      }
      frag.appendChild(row);
    }
    this.elResourcePanel.replaceChildren(frag);
    // Sync vertical scroll position of locked panel with the time grid.
    this.elResourcePanel.scrollTop = this.scrollTop;
  }

  private resolveColumns(): ResourceColumnConfig[] {
    return this.config.columns ?? [{ field: 'name', text: 'Resource', width: 160 }];
  }

  /** Paint gridlines + non-working shading + now marker for the window. */
  private paintBackdrop(): void {
    const xStart = this.scrollLeft;
    const xEnd = this.scrollLeft + this.viewportWidth();
    const frag = document.createDocumentFragment();

    // Non-working shading.
    if (this.config.showNonWorkingTime !== false) {
      const spans = computeNonWorkingSpans(this.axis, this.config.calendar ?? {}, 'day');
      for (const box of projectNonWorkingSpans(spans, this.axis)) {
        const el = createEl('div', { className: 'jects-scheduler__nonworking' });
        el.style.left = `${box.x}px`;
        el.style.width = `${box.width}px`;
        frag.appendChild(el);
      }
    }

    // Global time ranges (shaded bands / marker lines spanning the whole grid).
    const timeRanges = this.config.timeRanges;
    if (timeRanges && timeRanges.length > 0) {
      for (const box of projectTimeRangeConfigs(timeRanges, this.axis)) {
        const el = createEl('div', {
          className: box.marker
            ? 'jects-scheduler__timerange jects-scheduler__timerange--marker'
            : 'jects-scheduler__timerange',
        });
        el.style.left = `${box.x}px`;
        if (!box.marker) el.style.width = `${box.width}px`;
        if (box.range.cls) el.classList.add(...box.range.cls.split(/\s+/).filter(Boolean));
        if (box.range.style) el.setAttribute('style', `${el.getAttribute('style') ?? ''}${box.range.style}`);
        if (box.range.name) {
          const label = createEl('div', { className: 'jects-scheduler__timerange-label' });
          label.textContent = box.range.name;
          el.appendChild(label);
        }
        frag.appendChild(el);
      }
    }

    // Resource-scoped time ranges (shaded only within their resource row band).
    // The row band is derived from the resource's store index (`index * rowHeight`)
    // rather than from `this.rowTops`, because `paintBackdrop` runs BEFORE
    // `paintBars` (where `rowTops` is (re)populated) — so reading `rowTops` here
    // would see a stale/empty map on the first paint of every cycle.
    const resourceTimeRanges = this.config.resourceTimeRanges;
    if (resourceTimeRanges && resourceTimeRanges.length > 0) {
      const boxes = projectResourceTimeRangeConfigs(resourceTimeRanges, this.axis, (resourceId) => {
        const index = this.resourceStore.indexOf(resourceId);
        if (index < 0) return undefined;
        return { top: index * this.rowHeight, height: this.rowHeight };
      });
      for (const box of boxes) {
        const el = createEl('div', {
          className: box.marker
            ? 'jects-scheduler__resource-timerange jects-scheduler__resource-timerange--marker'
            : 'jects-scheduler__resource-timerange',
        });
        el.style.left = `${box.x}px`;
        if (!box.marker) el.style.width = `${box.width}px`;
        el.style.top = `${box.top}px`;
        el.style.height = `${box.height}px`;
        if (box.range.cls) el.classList.add(...box.range.cls.split(/\s+/).filter(Boolean));
        if (box.range.style) el.setAttribute('style', `${el.getAttribute('style') ?? ''}${box.range.style}`);
        if (box.range.name) {
          const label = createEl('div', { className: 'jects-scheduler__resource-timerange-label' });
          label.textContent = box.range.name;
          el.appendChild(label);
        }
        frag.appendChild(el);
      }
    }

    // Vertical gridlines at each tick.
    for (const tick of this.axis.ticksInRange(xStart - 100, xEnd + 100)) {
      const line = createEl('div', { className: 'jects-scheduler__gridline' });
      line.classList.toggle('jects-scheduler__gridline--major', tick.major);
      line.style.left = `${tick.x}px`;
      frag.appendChild(line);
    }

    // Now marker.
    if (this.config.showNowMarker !== false) {
      const now = Date.now();
      if (now >= this.axis.range.start && now <= this.axis.range.end) {
        const marker = createEl('div', { className: 'jects-scheduler__now' });
        marker.style.left = `${this.axis.toX(now)}px`;
        frag.appendChild(marker);
      }
    }

    this.elBackdrop.replaceChildren(frag);
  }

  /** Lay out + paint the event bars for the visible rows. */
  private paintBars(): void {
    const win = this.rowWindow();
    const strategy = this.config.overlap ?? 'stack';
    const frag = document.createDocumentFragment();
    this.visibleBars.clear();
    this.resolvedById.clear();
    this.rowTops.clear();

    const visibleSpan = this.visibleSpan();

    for (let i = win.startIndex; i < win.endIndex; i++) {
      const resource = this.resourceStore.getAt(i);
      if (!resource) continue;
      const rowTop = i * this.rowHeight;
      this.rowTops.set(resource.id, rowTop);

      const events = this.resolveRowEvents(resource.id, visibleSpan);
      for (const e of events) this.resolvedById.set(e.id, e);
      const tlEvents: TimelineEvent<EventModel>[] = events.map((e) => ({
        id: e.id,
        rowId: e.resourceId,
        span: e.span,
        record: e.record,
        ...(e.record.percentDone !== undefined ? { progress: e.record.percentDone } : {}),
        editable: e.record.draggable !== false && !this.isOccurrence(e),
        ...(e.record.eventColor !== undefined ? { styleKey: e.record.eventColor } : {}),
      }));

      const { bars } = layoutLane<EventModel>({
        rowId: resource.id,
        events: tlEvents,
        axis: this.axis,
        rowHeight: this.rowHeight,
        strategy,
      });

      for (const bar of bars) {
        this.visibleBars.set(bar.event.id, bar);
        frag.appendChild(this.renderBar(bar, rowTop));
      }
    }
    this.elBars.replaceChildren(frag);
    this.syncRovingTabindex();
  }

  private renderBar(bar: EventBar<EventModel>, rowTop: number): HTMLElement {
    const ev = bar.event.record;
    const el = createEl('div', { className: 'jects-scheduler__bar' });
    el.dataset.eventId = String(bar.event.id);
    el.style.left = `${bar.x}px`;
    el.style.top = `${rowTop + bar.y}px`;
    el.style.width = `${bar.width}px`;
    el.style.height = `${bar.height}px`;
    // Bars are interactive controls (click selects, dbl-click/Enter edits, drag
    // moves), so expose an interactive role + name rather than a static
    // `listitem`. A roving tabindex (managed by the grid keyboard handler) keeps
    // exactly one bar in the Tab order; the focused bar gets tabIndex 0.
    el.setAttribute('role', 'button');
    el.tabIndex = -1;
    const name = ev.name ?? '';
    // An occurrence bar (recurrence repeat) is read-only — it cannot be moved
    // without an occurrence-exception model, so we surface that to AT + drag code.
    const locked = bar.event.editable === false;
    el.setAttribute('aria-label', this.barAriaLabel(ev, bar.event.span));
    if (locked) {
      el.classList.add('jects-scheduler__bar--locked');
      el.setAttribute('aria-readonly', 'true');
      el.dataset.locked = 'true';
    }
    if (bar.event.id !== ev.id) el.dataset.occurrence = 'true';
    if (bar.event.styleKey) el.dataset.color = bar.event.styleKey;

    const inner = createEl('div', { className: 'jects-scheduler__bar-label' });
    inner.textContent = name;
    el.appendChild(inner);

    if (typeof ev.percentDone === 'number' && ev.percentDone > 0) {
      const fill = createEl('div', { className: 'jects-scheduler__bar-progress' });
      fill.style.width = `${Math.min(100, ev.percentDone * 100)}%`;
      el.appendChild(fill);
    }
    return el;
  }

  /** Format a tick/time using the active pattern (UTC). */
  private formatTick(time: number, pattern?: string): string {
    return formatTime(time, pattern);
  }

  /** Announce a message to assistive tech via the polite live region. */
  private announce(message: string): void {
    if (this.destroyed2 || !this.elLive) return;
    // Clear then set on the next frame so identical consecutive messages re-fire.
    this.elLive.textContent = '';
    this.elLive.textContent = message;
  }

  private barAriaLabel(ev: EventModel, span?: TimeSpan): string {
    const name = ev.name ?? 'Event';
    const start = span?.start ?? ev.startDate;
    const end = span?.end ?? ev.endDate;
    return `${name}, ${this.formatTick(start, 'datetime')} to ${this.formatTick(end, 'datetime')}`;
  }

  /**
   * Whether a resolved event is a non-master recurrence occurrence (a
   * materialized repeat). These share the master `record` but carry their own
   * occurrence `span` + a `masterId`. There is no occurrence-exception model, so
   * occurrences must NOT be drag/resize-mutated (that would rewrite the master
   * and shift every repeat); they are rendered read-only.
   */
  private isOccurrence(e: ResolvedEvent): boolean {
    return e.masterId != null && e.id !== e.masterId;
  }

  /** Look up the resolved-event metadata (master id / occurrence span) for a bar. */
  private resolvedForBarEl(el: HTMLElement): ResolvedEvent | undefined {
    const id = el.dataset.eventId;
    if (id == null) return undefined;
    return this.resolvedById.get(id) ?? this.resolvedById.get(Number(id));
  }

  /** Resolve a row's events, expanding recurrence within the visible window. */
  private resolveRowEvents(resourceId: RecordId, window: TimeSpan): ResolvedEvent[] {
    const out: ResolvedEvent[] = [];
    this.eventStore.forEach((record) => {
      if (record.resourceId !== resourceId) return;
      const masterSpan: TimeSpan = { start: record.startDate, end: record.endDate };
      if (record.recurrenceRule) {
        const rule = parseRRule(record.recurrenceRule);
        if (rule) {
          const occs = expandOccurrences(masterSpan, rule, window);
          occs.forEach((span, idx) => {
            out.push({
              id: idx === 0 ? record.id : `${record.id}::${span.start}`,
              resourceId,
              span,
              record,
              masterId: record.id,
            });
          });
          return;
        }
      }
      // Non-recurring: include if it intersects the window.
      if (masterSpan.end > window.start && masterSpan.start < window.end) {
        out.push({ id: record.id, resourceId, span: masterSpan, record });
      }
    });
    return out;
  }

  /** Paint dependency connectors as SVG paths. */
  private paintDependencies(): void {
    // Read from the reactive store (seeded from config.dependencies); the editing
    // UI writes created/deleted links here, so this is the single source of truth.
    const deps = this.dependencyStore.toArray();
    if (deps.length === 0) {
      this.elDeps.replaceChildren();
      return;
    }
    const editable = this.config.dependenciesEditable === true;
    const links = toLinks(deps);
    const lines = this.router.route({ links, bars: this.visibleBars, axis: this.axis });
    const frag = document.createDocumentFragment();
    for (const line of lines) {
      // A wide invisible hit path under the visible line widens the click target
      // (selecting a 1.5px stroke is impractical). Only when editing is enabled.
      if (editable) {
        const hit = document.createElementNS(SVG_NS, 'path');
        hit.setAttribute('d', line.path);
        hit.setAttribute('class', 'jects-scheduler__dep-hit');
        hit.dataset.depId = String(line.link.id);
        frag.appendChild(hit);
      }
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', line.path);
      path.setAttribute('class', 'jects-scheduler__dep-line');
      path.dataset.depId = String(line.link.id);
      if (line.link.styleKey) path.dataset.color = line.link.styleKey;
      frag.appendChild(path);
      // Arrowhead at the target.
      const arrow = document.createElementNS(SVG_NS, 'path');
      arrow.setAttribute('d', this.router.arrowFor(line));
      arrow.setAttribute('class', 'jects-scheduler__dep-arrow');
      frag.appendChild(arrow);
    }
    // Make the SVG keyboard-reachable so a selected dependency can be deleted.
    if (editable) {
      this.elDeps.setAttribute('tabindex', '0');
      this.elDeps.removeAttribute('aria-hidden');
      this.elDeps.setAttribute('role', 'group');
      this.elDeps.setAttribute('aria-label', 'Dependencies');
    }
    this.elDeps.replaceChildren(frag);
  }

  /* ── windowing helpers ────────────────────────────────────────────────── */

  private rowWindow(): { startIndex: number; endIndex: number; totalSize: number; offset: number } {
    const w = computeWindow({
      scrollTop: this.scrollTop,
      viewportHeight: this.elScroller.clientHeight || 400,
      itemSize: this.rowHeight,
      count: this.resourceStore.count,
      overscan: this.config.overscan ?? 5,
    });
    return {
      startIndex: w.startIndex,
      endIndex: Math.min(this.resourceStore.count, w.endIndex + 1),
      totalSize: w.totalSize,
      offset: w.offset,
    };
  }

  /* ── interactions ─────────────────────────────────────────────────────── */

  private onScroll = (): void => {
    this.scrollTop = this.elScroller.scrollTop;
    this.scrollLeft = this.elScroller.scrollLeft;
    // Infinite scroll: grow the axis range when nearing either temporal edge so
    // the user never hits a hard wall. Done BEFORE syncing the header + painting
    // so the same frame reflects the extended range + compensated scroll.
    if (this.config.infiniteScroll) this.maybeExtendRange();
    this.elHeader.scrollLeft = this.scrollLeft;
    this.paint();
    this.emit('scroll', {
      scrollTop: this.scrollTop,
      scrollLeft: this.scrollLeft,
      visibleSpan: this.visibleSpan(),
    });
  };

  /**
   * Infinite-scroll step: when the viewport approaches the start/end of the axis
   * content, extend the axis range (and compensate `scrollLeft` for the left-edge
   * re-anchor) so scrolling continues seamlessly. A `range` set in config pins the
   * axis, so infinite scroll is a no-op then. Idempotent + safe to call on every
   * scroll — it returns early unless an edge is actually near.
   */
  private maybeExtendRange(): void {
    if (this.destroyed2 || this.config.range) return;
    const plan = planInfiniteScroll({
      axis: this.axis,
      scrollLeft: this.scrollLeft,
      viewportWidth: this.viewportWidth(),
    });
    if (!plan) return;
    this.axis.setRange(plan.range);
    if (plan.scrollLeftDelta !== 0) {
      const next = this.scrollLeft + plan.scrollLeftDelta;
      // Reposition the real scroller; mirror into our cached scrollLeft so the
      // ensuing paint() reads the compensated value (not the pre-extension one).
      this.elScroller.scrollLeft = next;
      this.scrollLeft = this.elScroller.scrollLeft;
    }
  }

  /**
   * Programmatically extend (or replace) the covered time range. Public so hosts
   * and tests can drive infinite-scroll / range growth without a real scroll
   * event. Repaints to reflect the new geometry.
   */
  setRange(range: TimeSpan): this {
    this.axis.setRange(range);
    this.paint();
    return this;
  }

  /**
   * Effective horizontal viewport width. Falls back to the full content width
   * when the element is detached / unsized (jsdom, hidden, pre-layout), so the
   * visible window covers everything rather than collapsing to zero.
   */
  private viewportWidth(): number {
    const w = this.elScroller.clientWidth;
    return w > 0 ? w : this.axis.contentWidth;
  }

  /** The time span currently visible (or the whole range when unsized). */
  private visibleSpan(): TimeSpan {
    const left = this.scrollLeft;
    const right = left + this.viewportWidth();
    return { start: this.axis.toTime(left), end: this.axis.toTime(right) };
  }

  /** Map a clientX to content-space x (subtract the content box left + scroll). */
  private toContentX(clientX: number): number {
    const rect = this.elContent.getBoundingClientRect();
    return clientX - rect.left;
  }
  private toContentY(clientY: number): number {
    const rect = this.elContent.getBoundingClientRect();
    return clientY - rect.top;
  }

  private barElFromEvent(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) return null;
    return target.closest('.jects-scheduler__bar');
  }

  private eventForBarEl(el: HTMLElement): EventModel | undefined {
    const id = el.dataset.eventId;
    if (id == null) return undefined;
    const bar = this.visibleBars.get(id) ?? this.visibleBars.get(Number(id));
    return bar?.event.record;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const barEl = this.barElFromEvent(e.target);
    if (barEl) {
      this.startBarGesture(e, barEl);
      return;
    }
    // Empty lane space → drag-create when enabled (takes precedence over pan, so
    // creation is never blocked). Otherwise drag-to-pan when enabled.
    if (this.config.creatable) {
      this.startCreateGesture(e);
      return;
    }
    if (this.config.panEnabled) this.startPanGesture(e);
  };

  /**
   * Drag-to-pan: holding the pointer on empty timeline background and dragging
   * scrolls the schedule horizontally + vertically by the inverse of the pointer
   * delta (grab-and-drag). Uses pointer capture + global listeners so the gesture
   * survives the pointer leaving the element, and is torn down on `destroy` via
   * `activeDrag` like every other gesture. Disabled (no-op) once destroyed.
   */
  private startPanGesture(down: PointerEvent): void {
    if (this.destroyed2) return;
    const startX = down.clientX;
    const startY = down.clientY;
    const startScrollLeft = this.elScroller.scrollLeft;
    const startScrollTop = this.elScroller.scrollTop;
    const target = down.target instanceof HTMLElement ? down.target : null;
    const pointerId = down.pointerId;
    try {
      target?.setPointerCapture?.(pointerId);
    } catch {
      /* best-effort (jsdom / detached nodes) */
    }
    this.el.classList.add('jects-scheduler--panning');

    const move = (e: PointerEvent): void => {
      if (e.pointerId !== pointerId || this.destroyed2) return;
      // Grab-and-drag: moving the pointer right reveals earlier content, so scroll
      // LEFT decreases (inverse of the delta). The `scroll` handler repaints + syncs.
      this.elScroller.scrollLeft = startScrollLeft - (e.clientX - startX);
      this.elScroller.scrollTop = startScrollTop - (e.clientY - startY);
    };
    const end = (): void => {
      this.el.classList.remove('jects-scheduler--panning');
      try {
        target?.releasePointerCapture?.(pointerId);
      } catch {
        /* best-effort */
      }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (this.activeDrag === panController) this.activeDrag = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    // Register with `activeDrag` so a mid-pan destroy() tears the listeners down.
    const panController = {
      destroy: end,
    } as unknown as BarDragController;
    this.activeDrag = panController;
  }

  private startBarGesture(down: PointerEvent, barEl: HTMLElement): void {
    const record = this.eventForBarEl(barEl);
    if (!record || record.draggable === false) return;
    const resolved = this.resolvedForBarEl(barEl);
    // Recurrence occurrences are read-only (no exception/override model): dragging
    // one would rewrite the shared master and shift every repeat. Refuse the
    // gesture rather than silently mutating the series.
    if (resolved && this.isOccurrence(resolved)) {
      this.announce('Recurring occurrences cannot be moved.');
      return;
    }
    const bar = this.visibleBars.get(barEl.dataset.eventId!) ?? this.visibleBars.get(Number(barEl.dataset.eventId));
    if (!bar) return;

    // Decide gesture zone (resize edges vs body move).
    const contentX = this.toContentX(down.clientX);
    const zone = zoneAtX(this.axis, bar, contentX, 6);
    let mode: DragMode = 'move';
    if (zone === 'start' && this.config.resizable !== false) mode = 'resize-start';
    else if (zone === 'end' && this.config.resizable !== false) mode = 'resize-end';
    if (mode === 'move' && this.config.draggable === false) return;

    // The origin is the visible span the user grabbed (the bar's own span), which
    // for a non-recurring event equals the record span.
    const origin: TimeSpan = { start: bar.event.span.start, end: bar.event.span.end };
    barEl.classList.add('jects-scheduler__bar--dragging');

    this.activeDrag = startBarDrag(down, {
      eventId: record.id,
      mode,
      origin,
      axis: this.axis,
      snap: this.config.snap !== false,
      onPreview: (state) => {
        if (this.destroyed2) return;
        const box = this.axis.spanToBox(state.span);
        barEl.style.left = `${box.x}px`;
        barEl.style.width = `${Math.max(1, box.width)}px`;
      },
      onCommit: (state) => {
        if (this.destroyed2) return;
        this.commitEventChange(record, origin, state.span);
      },
      onEnd: () => {
        this.activeDrag = null;
        if (this.destroyed2) return;
        barEl.classList.remove('jects-scheduler__bar--dragging');
        this.paint();
      },
    });
  }

  private startCreateGesture(down: PointerEvent): void {
    const y = this.toContentY(down.clientY);
    const rowIndex = Math.floor(y / this.rowHeight);
    const resource = this.resourceStore.getAt(rowIndex);
    if (!resource) return;
    const anchorTime = this.axis.toTime(this.toContentX(down.clientX));

    const ghost = createEl('div', { className: 'jects-scheduler__bar jects-scheduler__bar--ghost' });
    ghost.style.top = `${rowIndex * this.rowHeight + 4}px`;
    ghost.style.height = `${this.rowHeight - 8}px`;
    this.elBars.appendChild(ghost);

    this.activeDrag = startDragCreate(down, {
      rowId: resource.id,
      anchorTime,
      axis: this.axis,
      snap: this.config.snap !== false,
      toContentX: (clientX) => this.toContentX(clientX),
      onPreview: (state) => {
        if (this.destroyed2) return;
        const box = this.axis.spanToBox(state.span);
        ghost.style.left = `${box.x}px`;
        ghost.style.width = `${Math.max(1, box.width)}px`;
      },
      onCommit: (state) => {
        if (this.destroyed2) return;
        this.createEvent(resource.id, state.span);
      },
      onEnd: () => {
        this.activeDrag = null;
        ghost.remove();
      },
    });
  }

  /** Apply a moved/resized span with veto + emit, writing back to the store. */
  private commitEventChange(record: EventModel, from: TimeSpan, to: TimeSpan): void {
    if (this.destroyed2) return;
    if (from.start === to.start && from.end === to.end) return;
    if (this.emit('beforeEventChange', { event: record, from, to }) === false) {
      this.paint();
      return;
    }
    this.eventStore.update(record.id, { startDate: to.start, endDate: to.end });
    const updated = this.eventStore.getById(record.id) ?? record;
    this.emit('eventChange', { event: updated, from, to });
    this.announce(
      `${record.name ?? 'Event'} moved to ${this.formatTick(to.start, 'datetime')}.`,
    );
  }

  private createEvent(resourceId: RecordId, span: TimeSpan): void {
    if (this.emit('beforeEventCreate', { resourceId, span }) === false) return;
    const id = `evt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const record: EventModel = {
      id,
      resourceId,
      name: 'New event',
      startDate: span.start,
      endDate: span.end,
    };
    this.eventStore.add(record);
    const created = this.eventStore.getById(id) ?? record;
    this.emit('eventCreate', { event: created });
  }

  private onBarClick(e: MouseEvent, el: HTMLElement): void {
    const record = this.eventForBarEl(el);
    if (!record) return;
    const resource = this.resourceStore.getById(record.resourceId);
    this.emit('eventClick', { event: record, resource, native: e });
  }

  private onBarDblClick(e: MouseEvent, el: HTMLElement): void {
    const record = this.eventForBarEl(el);
    if (!record) return;
    const resource = this.resourceStore.getById(record.resourceId);
    this.emit('eventDblClick', { event: record, resource, native: e });
    if (this.config.editable !== false) this.editEvent(record);
  }

  /** Open the event editor popup (reuses @jects/widgets Window). */
  editEvent(record: EventModel): void {
    // Mount the editor Window at document.body, NOT inside the scheduler root —
    // the root sets `overflow: hidden`, which would clip a popup positioned over
    // it. Body-level mounting keeps the editor floating + un-clipped.
    openEventEditor(document.body, record, (changes) => {
      const from: TimeSpan = { start: record.startDate, end: record.endDate };
      const next = { ...record, ...changes };
      const to: TimeSpan = { start: next.startDate, end: next.endDate };
      if (this.emit('beforeEventChange', { event: record, from, to }) === false) return;
      this.eventStore.update(record.id, changes as Partial<EventModel>);
      const updated = this.eventStore.getById(record.id) ?? next;
      this.emit('eventChange', { event: updated, from, to });
    });
  }

  /* ── tooltip + menu ───────────────────────────────────────────────────── */

  private showTooltip(e: PointerEvent, el: HTMLElement): void {
    const record = this.eventForBarEl(el);
    const resolver = this.config.eventTooltip;
    if (!record || !resolver || !this.tooltip) return;
    const text = resolver(record);
    if (text == null) return;
    this.tooltip.showAt({ text, x: this.toContentX(e.clientX), y: this.toContentY(e.clientY) });
  }

  private menuTargetId: RecordId | null = null;

  private onContextMenu = (e: MouseEvent): void => {
    const barEl = this.barElFromEvent(e.target);
    if (!barEl || !this.ctxMenu) return;
    const record = this.eventForBarEl(barEl);
    if (!record) return;
    e.preventDefault();
    this.menuTargetId = record.id;
    const items: MenuItem[] = [
      { id: 'edit', text: 'Edit', icon: 'edit' },
      { id: 'delete', text: 'Delete', icon: 'trash' },
    ];
    this.ctxMenu.update({ items });
    this.ctxMenu.openAt(e.clientX, e.clientY);
  };

  private onMenuSelect(id: string): void {
    if (this.menuTargetId == null) return;
    const record = this.eventStore.getById(this.menuTargetId);
    if (!record) return;
    if (id === 'edit') this.editEvent(record);
    else if (id === 'delete') this.deleteEvent(record);
  }

  /** Delete an event with veto + emit. */
  deleteEvent(record: EventModel): void {
    if (this.emit('beforeEventDelete', { event: record }) === false) return;
    this.eventStore.remove(record.id);
    this.emit('eventDelete', { event: record });
  }

  /* ── keyboard ─────────────────────────────────────────────────────────── */

  private onKeyDown(e: KeyboardEvent): void {
    // Root-level keys (zoom + pan) only when the root itself is focused; bar
    // navigation is handled by onBarKeyDown on the focused bar.
    if (e.target !== this.el) return;
    switch (e.key) {
      case '+':
      case '=':
        this.zoomIn();
        e.preventDefault();
        break;
      case '-':
      case '_':
        this.zoomOut();
        e.preventDefault();
        break;
      case 'ArrowRight':
        this.elScroller.scrollLeft += this.rowHeight;
        e.preventDefault();
        break;
      case 'ArrowLeft':
        this.elScroller.scrollLeft -= this.rowHeight;
        e.preventDefault();
        break;
      case 'ArrowDown':
        this.elScroller.scrollTop += this.rowHeight;
        e.preventDefault();
        break;
      case 'ArrowUp':
        this.elScroller.scrollTop -= this.rowHeight;
        e.preventDefault();
        break;
    }
  }

  /* ── roving-tabindex bar grid ─────────────────────────────────────────── */

  /** All event-bar elements in document (visual top-to-bottom, left-to-right) order. */
  private barEls(): HTMLElement[] {
    const els = Array.from(
      this.elBars.querySelectorAll<HTMLElement>('.jects-scheduler__bar'),
    ).filter((el) => !el.classList.contains('jects-scheduler__bar--ghost'));
    els.sort((a, b) => {
      const ta = parseFloat(a.style.top) || 0;
      const tb = parseFloat(b.style.top) || 0;
      if (ta !== tb) return ta - tb;
      return (parseFloat(a.style.left) || 0) - (parseFloat(b.style.left) || 0);
    });
    return els;
  }

  /**
   * Keep exactly one bar in the Tab order (roving tabindex). The remembered
   * `focusedBarId` survives repaints; if it is gone, the first bar becomes the
   * Tab stop so the grid is always reachable.
   */
  private syncRovingTabindex(): void {
    const els = this.barEls();
    if (els.length === 0) {
      this.focusedBarId = null;
      return;
    }
    let active = this.focusedBarId == null
      ? undefined
      : els.find((el) => el.dataset.eventId === String(this.focusedBarId));
    if (!active) {
      active = els[0]!;
      this.focusedBarId = active.dataset.eventId ?? null;
    }
    for (const el of els) el.tabIndex = el === active ? 0 : -1;
  }

  private onBarFocus(el: HTMLElement): void {
    const id = el.dataset.eventId;
    if (id == null) return;
    if (this.focusedBarId !== id) {
      this.focusedBarId = id;
      for (const other of this.barEls()) other.tabIndex = other === el ? 0 : -1;
    }
  }

  private focusBarAt(index: number): void {
    const els = this.barEls();
    if (els.length === 0) return;
    const i = Math.max(0, Math.min(els.length - 1, index));
    const el = els[i]!;
    this.focusedBarId = el.dataset.eventId ?? null;
    for (const other of els) other.tabIndex = other === el ? 0 : -1;
    el.focus();
  }

  private onBarKeyDown(e: KeyboardEvent, el: HTMLElement): void {
    const els = this.barEls();
    const idx = els.indexOf(el);
    if (idx < 0) return;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        this.focusBarAt(idx + 1);
        e.preventDefault();
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        this.focusBarAt(idx - 1);
        e.preventDefault();
        break;
      case 'Home':
        this.focusBarAt(0);
        e.preventDefault();
        break;
      case 'End':
        this.focusBarAt(els.length - 1);
        e.preventDefault();
        break;
      case 'Enter':
      case ' ': {
        const record = this.eventForBarEl(el);
        if (record && this.config.editable !== false) this.editEvent(record);
        e.preventDefault();
        break;
      }
      case 'Delete':
      case 'Backspace': {
        const record = this.eventForBarEl(el);
        // Occurrence bars are read-only; do not delete the master from a repeat.
        const resolved = this.resolvedForBarEl(el);
        if (record && !(resolved && this.isOccurrence(resolved))) {
          this.deleteEvent(record);
          this.announce(`${record.name ?? 'Event'} deleted.`);
        }
        e.preventDefault();
        break;
      }
    }
  }

  /* ── public view API ──────────────────────────────────────────────────── */

  /** Current time⇄pixel projection (read-only access for PRO views/features). */
  getAxis(): TimeAxis {
    return this.axis;
  }
  /** The resource store. */
  getResourceStore(): ResourceStore {
    return this.resourceStore;
  }
  /** The event store. */
  getEventStore(): EventStore {
    return this.eventStore;
  }
  /** The reactive dependency store (links created/deleted by the editing UI). */
  getDependencyStore(): DependencyStore {
    return this.dependencyStore;
  }
  /**
   * The dependency drawing/editing controller, when `dependenciesEditable` is on
   * (else `null`). Exposes `select`/`deleteSelected`/`createDependency` for
   * programmatic dependency editing + tests.
   */
  getDependencyEditor(): DependencyEditController | null {
    return this.depEdit;
  }

  /** Switch the active preset and/or zoom. */
  setView(view: { preset?: ViewPreset; zoom?: number }): this {
    if (view.preset) this.preset = view.preset;
    if (view.zoom !== undefined) this.zoom = clampZoom(this.preset, view.zoom);
    this.axis.setView({ preset: this.preset, zoom: this.zoom });
    this.paint();
    this.emit('viewChange', { preset: this.preset, zoom: this.zoom });
    return this;
  }

  /** Zoom one step finer. */
  zoomIn(): this {
    const next = zoomInStep(this.preset, this.zoom, this.presets);
    return this.setView(next);
  }
  /** Zoom one step coarser. */
  zoomOut(): this {
    const next = zoomOutStep(this.preset, this.zoom, this.presets);
    return this.setView(next);
  }

  /** Scroll a time into horizontal view. */
  scrollToTime(time: TimeMs2): this {
    this.elScroller.scrollLeft = Math.max(0, this.axis.toX(time) - this.elScroller.clientWidth / 2);
    return this;
  }

  override update(patch: Partial<SchedulerConfig>): this {
    super.update(patch);
    return this;
  }

  override destroy(): void {
    this.destroyed2 = true;
    super.destroy();
  }
}

/** Local alias to avoid an extra import just for the public `scrollToTime` param. */
type TimeMs2 = number;

register(
  'scheduler',
  Scheduler as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Scheduler,
);
