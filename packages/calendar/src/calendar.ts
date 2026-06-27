/**
 * @jects/calendar — the Calendar widget.
 *
 * An event calendar with switchable Day/Week/Month/Year/Agenda/Resource views,
 * built on @jects/core (`Widget`, `Store` via `EventStore`, signals) and reusing
 * @jects/widgets (`Window`) for the modal event editor.
 *
 * Capabilities: drag-create/move/resize timed + all-day events, recurring series
 * (daily/weekly/monthly/yearly), multi-day & all-day events, a mini-calendar date
 * navigator, today/selection, and category + resource filtering. Token-pure CSS,
 * grid roles + keyboard navigation, registered with the factory as `'calendar'`.
 *
 * NOTE: `super()` runs `buildEl()` before subclass field initializers, so DOM
 * listeners wired in `buildEl()` use bound methods, never class-field arrows.
 */

import {
  Widget,
  createEl,
  register,
  escape as esc,
  setHtml,
  trustedHtml,
  type RecordId,
} from '@jects/core';
import type {
  CalendarConfig,
  CalendarEvents,
  CalendarEvent,
  CalendarCategory,
  CalendarResource,
  CalendarViewType,
  EventOccurrence,
  DraftRange,
  CalendarInstance,
  RecurrenceRule,
} from './contract.js';
import { EventStore, normalizeEvent } from './event-store.js';
import { openEventEditor, type EditorResult } from './editor.js';
import { layoutDay } from './layout.js';
import { CalendarHistory } from './history.js';
import { zonedTime, weekdayLabels, monthLabels, formatClock } from './tz.js';
import { toIcs, toCsv, downloadFile, printElement } from './export.js';
import {
  addDays,
  addMonths,
  addYears,
  addMinutes,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  startOfYear,
  monthGrid,
  weekDays,
  isSameDay,
  isSameMonth,
  isoWeek,
  minutesIntoDay,
  atMinutes,
  dayKey,
  diffDays,
  rangesOverlap,
  type Weekday,
} from './date-utils.js';

const DEFAULT_VIEWS: CalendarViewType[] = [
  'day', 'week', 'month', 'year', 'agenda', 'resource', 'timeline',
];

/** Active pointer gesture for drag-create/move/resize. */
interface Gesture {
  kind: 'create' | 'move' | 'resize';
  pointerId: number;
  eventId?: RecordId | undefined;
  /** Anchor day + minute for create/move. */
  baseDay: Date;
  baseMinutes: number;
  /** Original event start/end for move/resize. */
  origStart?: Date | undefined;
  origEnd?: Date | undefined;
  /** For all-day rail / month drag-create. */
  allDay: boolean;
  resourceId?: string | undefined;
  /** Current preview range. */
  curStart: Date;
  curEnd: Date;
  moved: boolean;
}

export class Calendar extends Widget<CalendarConfig, CalendarEvents> implements CalendarInstance {
  /** The backing event store (recurrence-aware). */
  store!: EventStore;
  /** The active anchor date. */
  private anchor!: Date;
  /** Currently active view. */
  private activeView!: CalendarViewType;
  /** Currently selected day (for selection highlight). */
  private selectedDay: Date | null = null;
  /**
   * The month-grid focus cursor (APG grid roving-tabindex). One gridcell carries
   * tabIndex=0 (the cell matching this day); arrows move the cursor cell-to-cell
   * within the rendered grid, PageUp/PageDown change the month. Null until the
   * month view first renders.
   */
  private gridCursor: Date | null = null;
  /** Mini-calendar month being browsed (independent of anchor). */
  private miniMonth!: Date;

  private categories: CalendarCategory[] = [];
  private resources: CalendarResource[] = [];
  private categoryFilter = new Set<string>();
  private resourceFilter = new Set<string>();

  /** Sub-element refs (assigned in render). */
  private toolbarEl!: HTMLElement;
  private sidebarEl!: HTMLElement;
  private viewEl!: HTMLElement;
  private titleEl!: HTMLElement;

  private gesture: Gesture | undefined;
  private onDocMove: ((e: PointerEvent) => void) | undefined;
  private onDocUp: ((e: PointerEvent) => void) | undefined;
  /**
   * Epoch-ms deadline before which a `click` on a timed event is suppressed,
   * set when a drag-move/resize gesture completed so the browser's synthetic
   * post-pointerup click does not re-open the editor. See onGestureUp.
   */
  private suppressClickUntil = 0;
  private storeUnsub: (() => void) | undefined;
  /** Undo/redo history over the event store (gap: undo/redo parity). */
  private history: CalendarHistory | undefined;
  /** Visible windows already requested from the lazy data source (load-on-demand). */
  private loadedRanges = new Set<string>();
  /** Locale label caches, refreshed from `config.locale` on (re)render. */
  private wdNames: string[] = weekdayLabels(undefined, 'short');
  private moNames: string[] = monthLabels(undefined, 'long');
  /** True once initState() has run; the base-class first render is skipped until then. */
  private ready = false;

  constructor(host: HTMLElement | string, config?: CalendarConfig) {
    super(host, config);
    this.initState();
    this.ready = true;
    this.render();
  }

  protected override defaults(): Partial<CalendarConfig> {
    return {
      view: 'month',
      views: DEFAULT_VIEWS,
      weekStart: 0,
      editable: true,
      miniCalendar: true,
      toolbar: true,
      dayStartHour: 0,
      dayEndHour: 24,
      hourHeight: 48,
      snapMinutes: 15,
      editor: true,
    };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-cal' });
    root.tabIndex = 0;
    root.addEventListener('keydown', (e) => this.handleKeydown(e));
    root.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
    return root;
  }

  /** One-time state init from config (runs after super() in constructor). */
  private initState(): void {
    const cfg = this.config;
    // Store
    if (cfg.events instanceof EventStore) {
      this.store = cfg.events;
    } else {
      this.store = new EventStore({ data: Array.isArray(cfg.events) ? cfg.events : [] });
    }
    this.storeUnsub = this.store.events.on('change', () => {
      if (!this.isDestroyed) this.renderView();
    });
    this.track(() => this.storeUnsub?.());

    this.anchor = startOfDay(cfg.date ?? new Date());
    this.activeView = cfg.view ?? 'month';
    this.miniMonth = startOfMonth(this.anchor);
    this.categories = cfg.categories ?? [];
    this.resources = cfg.resources ?? [];
    this.categoryFilter = new Set(cfg.categoryFilter ?? []);
    this.resourceFilter = new Set(cfg.resourceFilter ?? []);
    this.refreshLocaleLabels();

    // Undo/redo history (Ctrl+Z / Ctrl+Y). Default on; opt out with history:false.
    if (cfg.history !== false) {
      this.history = new CalendarHistory(this.store);
      this.track(() => this.history?.destroy());
    }
  }

  /** Recompute the locale-driven weekday/month label arrays from config. */
  private refreshLocaleLabels(): void {
    this.wdNames = weekdayLabels(this.config.locale, 'short');
    this.moNames = monthLabels(this.config.locale, 'long');
  }

  /** Weekday short name for a 0..6 index (wraps), localized via `config.locale`. */
  private wd(i: number): string {
    return this.wdNames[((i % 7) + 7) % 7] as string;
  }
  /** Month name for a 0..11 index, localized via `config.locale`. */
  private mo(i: number): string {
    return this.moNames[((i % 12) + 12) % 12] as string;
  }

  /**
   * `HH:MM` clock label for a (display-projected) date. Uses `Intl` in the
   * configured locale when one is set; otherwise the stable 24h padding so the
   * default rendering is locale-independent.
   */
  private clockLabel(d: Date): string {
    if (this.config.locale) return formatClock(d, this.config.locale);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /* ── public API ────────────────────────────────────────────────────── */

  setView(view: CalendarViewType): this {
    if (view === this.activeView) return this;
    this.activeView = view;
    this.emit('viewChange', { view });
    // Light update: swap the root view modifier class and repaint just the view
    // body (renderView also re-syncs the toolbar's view-button states in place),
    // so the toolbar/sidebar DOM — and the focused/clicked button — survive.
    this.el.className = ['jects-cal', `jects-cal--${this.activeView}`, this.config.cls ?? '']
      .filter(Boolean)
      .join(' ');
    this.renderView();
    return this;
  }

  goToDate(date: Date): this {
    this.anchor = startOfDay(date);
    this.miniMonth = startOfMonth(this.anchor);
    this.emit('dateChange', { date: this.anchor });
    this.render();
    return this;
  }

  next(): this {
    return this.goToDate(this.step(1));
  }

  prev(): this {
    return this.goToDate(this.step(-1));
  }

  today(): this {
    return this.goToDate(new Date());
  }

  /* ── export / print (Bryntum/DHTMLX parity) ────────────────────────────── */

  /** Serialize every event to an RFC-5545 ICS string; downloads it in a browser. */
  exportICS(fileName = 'calendar'): string {
    const ics = toIcs(this.store.toArray());
    downloadFile(ics, fileName.endsWith('.ics') ? fileName : `${fileName}.ics`, 'text/calendar');
    return ics;
  }

  /** Serialize every event to a CSV ("Excel") string; downloads it in a browser. */
  exportExcel(fileName = 'calendar'): string {
    const csv = toCsv(this.store.toArray());
    downloadFile(csv, fileName.endsWith('.csv') ? fileName : `${fileName}.csv`, 'text/csv');
    return csv;
  }

  /** Open a print-friendly window for the current view. */
  print(): void {
    printElement(this.viewEl ?? this.el, this.viewTitle());
  }

  /* ── undo / redo (Ctrl+Z / Ctrl+Y) ─────────────────────────────────────── */

  /** Undo the last event mutation (create/move/resize/edit/delete). */
  undo(): boolean {
    return this.history?.undo() ?? false;
  }
  /** Redo the last undone mutation. */
  redo(): boolean {
    return this.history?.redo() ?? false;
  }
  /** Whether there is anything to undo. */
  canUndo(): boolean {
    return this.history?.canUndo ?? false;
  }
  /** Whether there is anything to redo. */
  canRedo(): boolean {
    return this.history?.canRedo ?? false;
  }

  /* ── load-on-demand ────────────────────────────────────────────────────── */

  /**
   * Load + merge events for `[start, end)` via the configured `loadEvents` data
   * source (load-on-demand). Each window is fetched at most once; merged events
   * that already exist (by id) are skipped, so re-renders don't refetch or
   * duplicate. No-op when no `loadEvents` is configured.
   */
  loadRange(start: Date, end: Date): void {
    const src = this.config.loadEvents;
    if (!src) return;
    const key = `${start.getTime()}_${end.getTime()}`;
    if (this.loadedRanges.has(key)) return;
    this.loadedRanges.add(key);
    const merge = (events: CalendarEvent[]): void => {
      if (this.isDestroyed) return;
      const fresh = events.filter((e) => e.id === undefined || this.store.getById(e.id) === undefined);
      if (fresh.length > 0) this.store.add(fresh.map(normalizeEvent));
    };
    const result = src(start, end);
    if (result instanceof Promise) {
      void result.then(merge).catch(() => this.loadedRanges.delete(key));
    } else {
      merge(result);
    }
  }

  private step(dir: number): Date {
    switch (this.activeView) {
      case 'day':
      case 'resource':
      case 'timeline':
        return addDays(this.anchor, dir);
      case 'week':
        return addDays(this.anchor, dir * 7);
      case 'agenda':
        return addDays(this.anchor, dir * 7);
      case 'month':
        return addMonths(this.anchor, dir);
      case 'year':
        return addYears(this.anchor, dir);
    }
  }

  /* ── config / re-render ────────────────────────────────────────────── */

  protected override render(): void {
    // The base Widget constructor calls render() before our constructor has run
    // initState(); skip that first paint — the constructor re-renders once ready.
    if (!this.ready) return;
    const cfg = this.config;
    // refresh derived state that may have changed via update()
    this.categories = cfg.categories ?? this.categories;
    this.resources = cfg.resources ?? this.resources;
    if (cfg.categoryFilter) this.categoryFilter = new Set(cfg.categoryFilter);
    if (cfg.resourceFilter) this.resourceFilter = new Set(cfg.resourceFilter);
    this.refreshLocaleLabels();

    this.el.className = ['jects-cal', `jects-cal--${this.activeView}`, cfg.cls ?? '']
      .filter(Boolean)
      .join(' ');

    this.el.replaceChildren();

    if (cfg.toolbar !== false) {
      this.toolbarEl = this.buildToolbar();
      this.el.append(this.toolbarEl);
    }

    const main = createEl('div', { className: 'jects-cal__main' });
    if (cfg.miniCalendar !== false) {
      this.sidebarEl = this.buildSidebar();
      main.append(this.sidebarEl);
    }
    this.viewEl = createEl('div', { className: 'jects-cal__view' });
    this.viewEl.setAttribute('role', 'group');
    this.viewEl.setAttribute('aria-label', this.viewTitle());
    main.append(this.viewEl);
    this.el.append(main);

    this.renderView();
  }

  override update(patch: Partial<CalendarConfig>): this {
    if (patch.events && patch.events instanceof EventStore && patch.events !== this.store) {
      this.storeUnsub?.();
      this.store = patch.events;
      this.storeUnsub = this.store.events.on('change', () => {
        if (!this.isDestroyed) this.renderView();
      });
      // Re-home undo/redo onto the new store; the old history's wrapper is undone.
      this.history?.destroy();
      this.history = this.config.history !== false ? new CalendarHistory(this.store) : undefined;
      this.loadedRanges.clear();
    } else if (Array.isArray(patch.events)) {
      this.store.parse(patch.events.map(normalizeEvent));
      this.loadedRanges.clear();
    }
    if (patch.date) {
      this.anchor = startOfDay(patch.date);
      this.miniMonth = startOfMonth(this.anchor);
    }
    if (patch.view) this.activeView = patch.view;
    super.update(patch);
    return this;
  }

  /* ── toolbar ───────────────────────────────────────────────────────── */

  private buildToolbar(): HTMLElement {
    const bar = createEl('div', { className: 'jects-cal__toolbar' });
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Calendar navigation');

    const nav = createEl('div', { className: 'jects-cal__nav' });
    const mk = (label: string, aria: string, cls: string, onClick: () => void): HTMLButtonElement => {
      const b = createEl('button', { className: `jects-cal__btn ${cls}` });
      b.type = 'button';
      setHtml(b, trustedHtml(esc(label)));
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', onClick);
      return b;
    };
    nav.append(
      mk('Today', 'Go to today', 'jects-cal__btn--today', () => this.today()),
      mk('‹', 'Previous', 'jects-cal__btn--prev', () => this.prev()),
      mk('›', 'Next', 'jects-cal__btn--next', () => this.next()),
    );

    this.titleEl = createEl('div', { className: 'jects-cal__title' });
    this.titleEl.setAttribute('aria-live', 'polite');
    this.titleEl.textContent = this.viewTitle();

    // The view switcher is a group of mutually-exclusive toggle buttons, not a
    // tablist: there is no role=tabpanel for it to control (the view body is a
    // role=group region), so exposing role=tab/tablist would promise an ARIA
    // relationship + arrow-key tab navigation that doesn't exist. Plain toggle
    // buttons with aria-pressed are the honest, complete pattern here.
    const views = createEl('div', { className: 'jects-cal__views' });
    views.setAttribute('role', 'group');
    views.setAttribute('aria-label', 'Calendar view');
    for (const v of this.config.views ?? DEFAULT_VIEWS) {
      const b = createEl('button', {
        className: `jects-cal__btn jects-cal__view-btn${v === this.activeView ? ' jects-cal__view-btn--active' : ''}`,
      });
      b.type = 'button';
      b.textContent = v.charAt(0).toUpperCase() + v.slice(1);
      b.setAttribute('aria-pressed', String(v === this.activeView));
      b.dataset.view = v;
      b.addEventListener('click', () => this.setView(v));
      views.append(b);
    }

    bar.append(nav, this.titleEl, views);
    return bar;
  }

  private viewTitle(): string {
    const a = this.anchor;
    switch (this.activeView) {
      case 'day':
      case 'resource':
      case 'timeline':
        return `${this.wd(a.getDay())}, ${this.mo(a.getMonth())} ${a.getDate()}, ${a.getFullYear()}`;
      case 'week':
      case 'agenda': {
        const s = startOfWeek(a, this.weekStart());
        const e = addDays(s, 6);
        if (isSameMonth(s, e)) return `${this.mo(s.getMonth())} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`;
        return `${this.mo(s.getMonth())} ${s.getDate()} – ${this.mo(e.getMonth())} ${e.getDate()}, ${e.getFullYear()}`;
      }
      case 'month':
        return `${this.mo(a.getMonth())} ${a.getFullYear()}`;
      case 'year':
        return `${a.getFullYear()}`;
    }
  }

  private weekStart(): Weekday {
    return (this.config.weekStart ?? 0) as Weekday;
  }

  /* ── sidebar (mini-calendar + filters) ─────────────────────────────── */

  private buildSidebar(): HTMLElement {
    const side = createEl('aside', { className: 'jects-cal__sidebar' });
    side.append(this.buildMiniCalendar());
    if (this.categories.length) side.append(this.buildCategoryFilter());
    if (this.resources.length) side.append(this.buildResourceFilter());
    return side;
  }

  private buildMiniCalendar(): HTMLElement {
    const mini = createEl('div', { className: 'jects-cal__mini' });
    const head = createEl('div', { className: 'jects-cal__mini-head' });
    const prev = createEl('button', { className: 'jects-cal__btn jects-cal__mini-nav' });
    prev.type = 'button';
    setHtml(prev, trustedHtml('‹'));
    prev.setAttribute('aria-label', 'Previous month');
    prev.addEventListener('click', () => {
      this.miniMonth = addMonths(this.miniMonth, -1);
      this.refreshSidebar();
    });
    const next = createEl('button', { className: 'jects-cal__btn jects-cal__mini-nav' });
    next.type = 'button';
    setHtml(next, trustedHtml('›'));
    next.setAttribute('aria-label', 'Next month');
    next.addEventListener('click', () => {
      this.miniMonth = addMonths(this.miniMonth, 1);
      this.refreshSidebar();
    });
    const label = createEl('div', { className: 'jects-cal__mini-label' });
    label.textContent = `${this.mo(this.miniMonth.getMonth())} ${this.miniMonth.getFullYear()}`;
    head.append(prev, label, next);

    const gridEl = createEl('div', { className: 'jects-cal__mini-grid' });
    gridEl.setAttribute('role', 'group');
    gridEl.setAttribute('aria-label', 'Mini calendar date picker');
    const ws = this.weekStart();
    for (let i = 0; i < 7; i++) {
      const d = createEl('div', { className: 'jects-cal__mini-dow' });
      d.textContent = this.wd((ws + i) % 7).slice(0, 1);
      d.setAttribute('aria-hidden', 'true');
      gridEl.append(d);
    }
    const today = new Date();
    for (const day of monthGrid(this.miniMonth, ws)) {
      const cell = createEl('button', { className: 'jects-cal__mini-day' });
      cell.type = 'button';
      cell.textContent = String(day.getDate());
      const inMonth = isSameMonth(day, this.miniMonth);
      if (!inMonth) cell.classList.add('jects-cal__mini-day--muted');
      if (isSameDay(day, today)) cell.classList.add('jects-cal__mini-day--today');
      if (isSameDay(day, this.anchor)) {
        cell.classList.add('jects-cal__mini-day--selected');
        cell.setAttribute('aria-current', 'date');
      }
      cell.setAttribute(
        'aria-label',
        `${this.wd(day.getDay())} ${this.mo(day.getMonth())} ${day.getDate()}`,
      );
      const captured = new Date(day);
      cell.addEventListener('click', () => this.goToDate(captured));
      gridEl.append(cell);
    }

    mini.append(head, gridEl);
    return mini;
  }

  private buildCategoryFilter(): HTMLElement {
    const box = createEl('div', { className: 'jects-cal__filter' });
    const h = createEl('div', { className: 'jects-cal__filter-title' });
    h.textContent = 'Categories';
    box.append(h);
    const list = createEl('div', { className: 'jects-cal__filter-list', attrs: { role: 'group' } });
    list.setAttribute('aria-label', 'Category filter');
    for (const c of this.categories) {
      list.append(this.filterRow(c.id, c.name, c.color, this.categoryFilter, 'category'));
    }
    box.append(list);
    return box;
  }

  private buildResourceFilter(): HTMLElement {
    const box = createEl('div', { className: 'jects-cal__filter' });
    const h = createEl('div', { className: 'jects-cal__filter-title' });
    h.textContent = 'Resources';
    box.append(h);
    const list = createEl('div', { className: 'jects-cal__filter-list', attrs: { role: 'group' } });
    list.setAttribute('aria-label', 'Resource filter');
    for (const r of this.resources) {
      list.append(this.filterRow(r.id, r.name, r.color, this.resourceFilter, 'resource'));
    }
    box.append(list);
    return box;
  }

  private filterRow(
    id: string,
    name: string,
    color: string | undefined,
    active: Set<string>,
    kind: 'category' | 'resource',
  ): HTMLElement {
    const row = createEl('label', { className: 'jects-cal__filter-row' });
    const cb = createEl('input', { className: 'jects-cal__filter-cb' });
    cb.type = 'checkbox';
    // empty filter set = show all => checked
    cb.checked = active.size === 0 || active.has(id);
    cb.addEventListener('change', () => this.toggleFilter(kind, id, cb.checked));
    const swatch = createEl('span', { className: 'jects-cal__filter-swatch' });
    if (color) swatch.style.setProperty('--_cal-swatch', `var(--jects-${color})`);
    const txt = createEl('span', { className: 'jects-cal__filter-name' });
    txt.textContent = name;
    row.append(cb, swatch, txt);
    return row;
  }

  private toggleFilter(kind: 'category' | 'resource', id: string, on: boolean): void {
    const ids = kind === 'category' ? this.categories.map((c) => c.id) : this.resources.map((r) => r.id);
    const set = kind === 'category' ? this.categoryFilter : this.resourceFilter;
    // Materialize "show all" into an explicit set before toggling.
    if (set.size === 0) for (const x of ids) set.add(x);
    if (on) set.add(id);
    else set.delete(id);
    // If everything is on, collapse back to "show all" (empty set).
    if (set.size === ids.length) set.clear();
    this.emit('filterChange', {
      categoryFilter: [...this.categoryFilter],
      resourceFilter: [...this.resourceFilter],
    });
    this.renderView();
  }

  private refreshSidebar(): void {
    if (!this.sidebarEl) return;
    const fresh = this.buildSidebar();
    this.sidebarEl.replaceWith(fresh);
    this.sidebarEl = fresh;
  }

  /* ── filtering ─────────────────────────────────────────────────────── */

  private passesFilter(ev: CalendarEvent): boolean {
    if (this.categoryFilter.size > 0) {
      if (!ev.categoryId || !this.categoryFilter.has(ev.categoryId)) return false;
    }
    if (this.resourceFilter.size > 0) {
      if (!ev.resourceId || !this.resourceFilter.has(ev.resourceId)) return false;
    }
    return true;
  }

  /**
   * Filtered occurrences overlapping [start, end). When a `timeZone` is
   * configured, timed occurrences are projected to that zone's wall-clock so the
   * downstream local-field layout math positions them at the zone-shifted hour;
   * the underlying `event` instant is left untouched (display-only projection).
   */
  occurrencesInRange(start: Date, end: Date): EventOccurrence[] {
    const occs = this.store
      .occurrencesInRange(start, end)
      .filter((o) => this.passesFilter(o.event));
    const tz = this.config.timeZone;
    if (!tz) return occs;
    return occs.map((o) =>
      o.event.allDay
        ? o
        : { ...o, start: zonedTime(o.start, tz), end: zonedTime(o.end, tz) },
    );
  }

  getCategory(id: string | undefined): CalendarCategory | undefined {
    return id ? this.categories.find((c) => c.id === id) : undefined;
  }

  /** Resolved color CSS value (token) for an event. */
  colorVar(ev: CalendarEvent): string {
    const cat = this.getCategory(ev.categoryId);
    return cat ? `var(--jects-${cat.color})` : 'oklch(var(--jects-primary))';
  }

  private visibleResources(): CalendarResource[] {
    if (this.resourceFilter.size === 0) return this.resources;
    return this.resources.filter((r) => this.resourceFilter.has(r.id));
  }

  /* ── view rendering dispatch ───────────────────────────────────────── */

  private renderView(): void {
    if (!this.viewEl) return;
    if (this.titleEl) this.titleEl.textContent = this.viewTitle();
    this.viewEl.setAttribute('aria-label', this.viewTitle());
    // sync active view button states
    if (this.toolbarEl) {
      this.toolbarEl.querySelectorAll<HTMLElement>('.jects-cal__view-btn').forEach((b) => {
        const on = b.dataset.view === this.activeView;
        b.classList.toggle('jects-cal__view-btn--active', on);
        b.setAttribute('aria-pressed', String(on));
      });
    }
    // Load-on-demand: ensure the visible window is fetched before painting.
    const r = this.viewRange();
    this.loadRange(r.start, r.end);
    this.viewEl.replaceChildren();
    switch (this.activeView) {
      case 'month': return this.renderMonth();
      case 'week': return this.renderTimeGrid(weekDays(this.anchor, this.weekStart()));
      case 'day': return this.renderTimeGrid([this.anchor]);
      case 'year': return this.renderYear();
      case 'agenda': return this.renderAgenda();
      case 'resource': return this.renderResource();
      case 'timeline': return this.renderTimeline();
    }
  }

  /** The inclusive [start, end) date window the active view currently covers. */
  private viewRange(): { start: Date; end: Date } {
    const a = this.anchor;
    switch (this.activeView) {
      case 'month': {
        const days = monthGrid(a, this.weekStart());
        return { start: startOfDay(days[0] ?? a), end: endOfDay(days[days.length - 1] ?? a) };
      }
      case 'week':
      case 'agenda':
        return { start: startOfWeek(a, this.weekStart()), end: endOfWeek(a, this.weekStart()) };
      case 'year':
        return { start: startOfYear(a), end: endOfDay(new Date(a.getFullYear(), 11, 31)) };
      case 'day':
      case 'resource':
      case 'timeline':
      default:
        return { start: startOfDay(a), end: endOfDay(a) };
    }
  }

  /* ── Month view ────────────────────────────────────────────────────── */

  private renderMonth(): void {
    const ws = this.weekStart();
    const days = monthGrid(this.anchor, ws);
    const rangeStart = startOfDay(days[0] ?? this.anchor);
    const rangeEnd = endOfDay(days[days.length - 1] ?? this.anchor);
    const occs = this.occurrencesInRange(rangeStart, rangeEnd);

    const grid = createEl('div', { className: 'jects-cal__month' });
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', this.viewTitle());

    // Roving tabindex (APG grid pattern): pick the cell that carries tabIndex=0.
    // Default the cursor to the anchor day; if the cursor fell outside the
    // currently rendered 6×7 window (e.g. after a month change), clamp it back
    // onto the anchor so exactly one cell is focusable.
    const firstDay = days[0]!;
    const lastDay = days[days.length - 1]!;
    if (
      !this.gridCursor ||
      this.gridCursor.getTime() < startOfDay(firstDay).getTime() ||
      this.gridCursor.getTime() > endOfDay(lastDay).getTime()
    ) {
      this.gridCursor = startOfDay(this.anchor);
    }
    const cursorKey = dayKey(this.gridCursor);
    grid.addEventListener('keydown', (e) => this.handleGridKeydown(e));

    const head = createEl('div', { className: 'jects-cal__month-head', attrs: { role: 'row' } });
    for (let i = 0; i < 7; i++) {
      const dh = createEl('div', { className: 'jects-cal__month-dow', attrs: { role: 'columnheader' } });
      dh.textContent = this.wd((ws + i) % 7);
      head.append(dh);
    }
    grid.append(head);

    const today = new Date();
    for (let w = 0; w < 6; w++) {
      const row = createEl('div', { className: 'jects-cal__month-row', attrs: { role: 'row' } });
      for (let d = 0; d < 7; d++) {
        const day = days[w * 7 + d];
        if (!day) continue;
        const cell = createEl('div', { className: 'jects-cal__month-cell' });
        cell.setAttribute('role', 'gridcell');
        const cellKey = dayKey(day);
        cell.tabIndex = cellKey === cursorKey ? 0 : -1;
        cell.dataset.day = cellKey;
        if (!isSameMonth(day, this.anchor)) cell.classList.add('jects-cal__month-cell--muted');
        if (isSameDay(day, today)) cell.classList.add('jects-cal__month-cell--today');
        if (this.selectedDay && isSameDay(day, this.selectedDay)) {
          cell.classList.add('jects-cal__month-cell--selected');
        }
        cell.setAttribute(
          'aria-label',
          `${this.wd(day.getDay())} ${this.mo(day.getMonth())} ${day.getDate()}`,
        );

        const num = createEl('div', { className: 'jects-cal__month-num' });
        num.textContent = String(day.getDate());
        cell.append(num);

        const dayOccs = occs
          .filter((o) => this.occursOnDay(o, day))
          .sort((a, b) => Number(b.event.allDay) - Number(a.event.allDay) || a.start.getTime() - b.start.getTime());

        const evWrap = createEl('div', { className: 'jects-cal__month-events' });
        const MAX = 3;
        dayOccs.slice(0, MAX).forEach((o) => evWrap.append(this.eventChip(o, day, true)));
        if (dayOccs.length > MAX) {
          const more = createEl('button', { className: 'jects-cal__more' });
          more.type = 'button';
          more.textContent = `+${dayOccs.length - MAX} more`;
          more.addEventListener('click', (e) => {
            e.stopPropagation();
            this.setView('day');
            this.goToDate(day);
          });
          evWrap.append(more);
        }
        cell.append(evWrap);

        const captured = new Date(day);
        cell.addEventListener('click', () => {
          this.selectedDay = captured;
          this.gridCursor = startOfDay(captured);
          this.emit('dateClick', { date: captured, allDay: true });
          this.renderView();
        });
        cell.addEventListener('dblclick', () => {
          this.requestEdit(null, {
            start: startOfDay(captured),
            end: endOfDay(captured),
            allDay: true,
          });
        });

        row.append(cell);
      }
      grid.append(row);
    }
    this.viewEl.append(grid);
  }

  private occursOnDay(o: EventOccurrence, day: Date): boolean {
    return rangesOverlap(o.start, o.end, startOfDay(day), endOfDay(day));
  }

  /**
   * APG grid keyboard navigation for the Month view: move the roving focus
   * cursor cell-to-cell (Arrow keys), to the row ends (Home/End), and change the
   * displayed month (PageUp/PageDown). Enter/Space on a focused cell opens the
   * create editor for that day. Handled here (not in the root handler) so it can
   * move a focus cursor rather than the anchor date. Returns early for non-grid
   * keys so other handlers still see them.
   */
  private handleGridKeydown(e: KeyboardEvent): void {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.jects-cal__month-cell');
    if (!cell || !cell.dataset.day) return;
    const cursor = this.gridCursor ?? this.parseDayKey(cell.dataset.day);
    let next: Date | null = null;
    let changeMonth = 0;
    switch (e.key) {
      case 'ArrowRight': next = addDays(cursor, 1); break;
      case 'ArrowLeft': next = addDays(cursor, -1); break;
      case 'ArrowDown': next = addDays(cursor, 7); break;
      case 'ArrowUp': next = addDays(cursor, -7); break;
      case 'Home': next = addDays(cursor, -((cursor.getDay() - this.weekStart() + 7) % 7)); break;
      case 'End': next = addDays(cursor, 6 - ((cursor.getDay() - this.weekStart() + 7) % 7)); break;
      case 'PageDown': changeMonth = 1; break;
      case 'PageUp': changeMonth = -1; break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        e.stopPropagation();
        this.requestEdit(null, {
          start: startOfDay(cursor),
          end: endOfDay(cursor),
          allDay: true,
        });
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();

    if (changeMonth !== 0) {
      // Move the whole grid a month and keep the cursor on the same day-of-month
      // where possible (addMonths clamps). Re-anchor + re-render, then focus.
      const target = addMonths(this.gridCursor ?? this.anchor, changeMonth);
      this.gridCursor = startOfDay(target);
      this.goToDate(target);
      this.focusGridCursor();
      return;
    }
    if (!next) return;
    this.gridCursor = startOfDay(next);
    // If the cursor stepped outside the rendered 6×7 window, page the anchor
    // month so the cursor day becomes visible; otherwise just repaint the grid
    // (adjacent-month spill days are already part of the rendered grid).
    const grid = monthGrid(this.anchor, this.weekStart());
    const inGrid =
      next.getTime() >= startOfDay(grid[0]!).getTime() &&
      next.getTime() <= endOfDay(grid[grid.length - 1]!).getTime();
    if (!inGrid) this.anchor = startOfMonth(next);
    this.renderView();
    this.focusGridCursor();
  }

  /** Move DOM focus to the month-grid cell matching the current cursor. */
  private focusGridCursor(): void {
    if (!this.gridCursor || !this.viewEl) return;
    const key = dayKey(this.gridCursor);
    const cell = this.viewEl.querySelector<HTMLElement>(
      `.jects-cal__month-cell[data-day="${key}"]`,
    );
    cell?.focus();
  }

  private eventChip(o: EventOccurrence, _day: Date, compact: boolean): HTMLElement {
    const chip = createEl('button', { className: 'jects-cal__event jects-cal__event--chip' });
    chip.type = 'button';
    chip.style.setProperty('--_cal-event', this.colorVar(o.event));
    chip.dataset.eventId = String(o.event.id);
    const time = o.event.allDay ? '' : `${this.clockLabel(o.start)} `;
    setHtml(
      chip,
      trustedHtml(
        compact
          ? `<span class="jects-cal__event-dot" aria-hidden="true"></span><span class="jects-cal__event-time">${time}</span><span class="jects-cal__event-title">${esc(o.event.title)}</span>`
          : `<span class="jects-cal__event-title">${esc(o.event.title)}</span>`,
      ),
    );
    chip.setAttribute('aria-label', `${o.event.title}${time ? ` at ${time.trim()}` : ', all day'}`);
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.emit('eventClick', { event: o.event, occurrence: o });
      this.requestEdit(o);
    });
    return chip;
  }

  /* ── Day / Week time grid ──────────────────────────────────────────── */

  private renderTimeGrid(days: Date[]): void {
    const startHour = this.config.dayStartHour ?? 0;
    const endHour = this.config.dayEndHour ?? 24;
    const startMin = startHour * 60;
    const endMin = endHour * 60;
    const hourH = this.config.hourHeight ?? 48;
    const totalH = ((endMin - startMin) / 60) * hourH;

    const rangeStart = startOfDay(days[0] ?? this.anchor);
    const rangeEnd = endOfDay(days[days.length - 1] ?? this.anchor);
    const occs = this.occurrencesInRange(rangeStart, rangeEnd);

    const wrap = createEl('div', { className: 'jects-cal__timegrid' });
    // Drive the day-column count for the header, all-day rail AND body via a
    // single custom property on the shared container so it inherits to all three
    // (it was previously set only on the body `cols`, a sibling of the header/
    // all-day rail, so those fell back to 1 column and the day headers wrapped).
    wrap.style.setProperty('--_cal-cols', String(days.length));

    // Header row: all-day rail
    const header = createEl('div', { className: 'jects-cal__tg-header' });
    header.append(createEl('div', { className: 'jects-cal__tg-corner' }));
    const today = new Date();
    for (const day of days) {
      const dh = createEl('div', { className: 'jects-cal__tg-daycol-head' });
      if (isSameDay(day, today)) dh.classList.add('jects-cal__tg-daycol-head--today');
      setHtml(
        dh,
        trustedHtml(
          `<span class="jects-cal__tg-dow">${this.wd(day.getDay())}</span><span class="jects-cal__tg-date">${day.getDate()}</span>`,
        ),
      );
      const captured = new Date(day);
      dh.addEventListener('click', () => {
        if (days.length > 1) {
          this.setView('day');
          this.goToDate(captured);
        }
      });
      header.append(dh);
    }
    wrap.append(header);

    // All-day rail
    const allDayRail = createEl('div', { className: 'jects-cal__tg-allday' });
    const allDayLabel = createEl('div', { className: 'jects-cal__tg-allday-label' });
    allDayLabel.textContent = 'All day';
    allDayRail.append(allDayLabel);
    for (const day of days) {
      const lane = createEl('div', { className: 'jects-cal__tg-allday-lane' });
      lane.dataset.day = dayKey(day);
      const allDayOccs = occs.filter(
        (o) => o.event.allDay && this.occursOnDay(o, day),
      );
      for (const o of allDayOccs) lane.append(this.eventBar(o, day));
      const captured = new Date(day);
      lane.addEventListener('dblclick', () => {
        this.requestEdit(null, { start: startOfDay(captured), end: endOfDay(captured), allDay: true });
      });
      allDayRail.append(lane);
    }
    wrap.append(allDayRail);

    // Scroll body: time gutter + day columns
    const body = createEl('div', { className: 'jects-cal__tg-body' });
    body.style.setProperty('--_cal-hour-h', `${hourH}px`);

    const gutter = createEl('div', { className: 'jects-cal__tg-gutter' });
    for (let h = startHour; h < endHour; h++) {
      const slot = createEl('div', { className: 'jects-cal__tg-hour' });
      slot.style.height = `${hourH}px`;
      const lab = createEl('span', { className: 'jects-cal__tg-hour-label' });
      lab.textContent = `${String(h).padStart(2, '0')}:00`;
      slot.append(lab);
      gutter.append(slot);
    }
    body.append(gutter);

    const cols = createEl('div', { className: 'jects-cal__tg-cols' });
    cols.style.setProperty('--_cal-cols', String(days.length));
    for (const day of days) {
      const col = createEl('div', { className: 'jects-cal__tg-col' });
      col.style.height = `${totalH}px`;
      col.dataset.day = dayKey(day);
      col.setAttribute('role', 'group');
      col.setAttribute('aria-label', `${this.wd(day.getDay())} ${this.mo(day.getMonth())} ${day.getDate()}`);
      if (isSameDay(day, today)) col.classList.add('jects-cal__tg-col--today');

      // hour grid lines
      for (let h = startHour; h < endHour; h++) {
        const line = createEl('div', { className: 'jects-cal__tg-line' });
        line.style.height = `${hourH}px`;
        col.append(line);
      }

      // "now" indicator
      if (isSameDay(day, today)) {
        const nowMin = minutesIntoDay(today);
        if (nowMin >= startMin && nowMin <= endMin) {
          const now = createEl('div', { className: 'jects-cal__tg-now' });
          now.style.top = `${((nowMin - startMin) / (endMin - startMin)) * totalH}px`;
          col.append(now);
        }
      }

      // timed events
      const laid = layoutDay(occs.filter((o) => this.occursOnDay(o, day)), day, startMin, endMin);
      for (const lo of laid) {
        col.append(this.timedEvent(lo, totalH));
      }

      col.dataset.startMin = String(startMin);
      col.dataset.endMin = String(endMin);
      cols.append(col);
    }
    body.append(cols);
    wrap.append(body);
    this.viewEl.append(wrap);
  }

  private eventBar(o: EventOccurrence, _day: Date): HTMLElement {
    const bar = createEl('button', { className: 'jects-cal__event jects-cal__event--bar' });
    bar.type = 'button';
    bar.style.setProperty('--_cal-event', this.colorVar(o.event));
    bar.dataset.eventId = String(o.event.id);
    bar.textContent = o.event.title;
    bar.setAttribute('aria-label', `${o.event.title}, all day`);
    bar.addEventListener('click', (e) => {
      e.stopPropagation();
      this.emit('eventClick', { event: o.event, occurrence: o });
      this.requestEdit(o);
    });
    return bar;
  }

  private timedEvent(lo: ReturnType<typeof layoutDay>[number], totalH: number): HTMLElement {
    const o = lo.occurrence;
    const ev = createEl('div', { className: 'jects-cal__event jects-cal__event--timed' });
    ev.style.setProperty('--_cal-event', this.colorVar(o.event));
    ev.dataset.eventId = String(o.event.id);
    ev.setAttribute('role', 'button');
    ev.tabIndex = 0;
    const widthPct = 100 / lo.columns;
    ev.style.top = `${lo.top * totalH}px`;
    ev.style.height = `${Math.max(lo.height * totalH, 16)}px`;
    ev.style.left = `${lo.column * widthPct}%`;
    ev.style.width = `calc(${widthPct}% - 2px)`;
    const time = this.clockLabel(o.start);
    setHtml(
      ev,
      trustedHtml(
        `<span class="jects-cal__event-time">${time}</span>` +
          `<span class="jects-cal__event-title">${esc(o.event.title)}</span>` +
          (o.event.readOnly ? '' : '<span class="jects-cal__event-resize" aria-hidden="true"></span>'),
      ),
    );
    ev.setAttribute('aria-label', `${o.event.title} at ${time}`);
    ev.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('jects-cal__event-resize')) return;
      // Suppress the synthetic click that follows a successful drag-move/resize,
      // so dragging a timed event does not also open the editor.
      if (Date.now() < this.suppressClickUntil) {
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      this.emit('eventClick', { event: o.event, occurrence: o });
      this.requestEdit(o);
    });
    ev.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.requestEdit(o);
      }
    });
    return ev;
  }

  /* ── Year view ─────────────────────────────────────────────────────── */

  private renderYear(): void {
    const ws = this.weekStart();
    const year = this.anchor.getFullYear();
    const rangeStart = startOfYear(this.anchor);
    const rangeEnd = endOfDay(new Date(year, 11, 31));
    const occs = this.occurrencesInRange(rangeStart, rangeEnd);
    const counts = new Map<string, number>();
    for (const o of occs) {
      let d = startOfDay(o.start);
      const last = startOfDay(o.end);
      // mark every day the occurrence spans
      let guard = 0;
      while (d.getTime() <= last.getTime() && guard++ < 366) {
        const k = dayKey(d);
        counts.set(k, (counts.get(k) ?? 0) + 1);
        d = addDays(d, 1);
      }
    }

    const grid = createEl('div', { className: 'jects-cal__year' });
    const today = new Date();
    for (let m = 0; m < 12; m++) {
      const monthDate = new Date(year, m, 1);
      const mwrap = createEl('div', { className: 'jects-cal__year-month' });
      const mh = createEl('button', { className: 'jects-cal__year-month-head' });
      mh.type = 'button';
      mh.textContent = this.mo(m);
      mh.addEventListener('click', () => {
        this.setView('month');
        this.goToDate(monthDate);
      });
      mwrap.append(mh);

      const mg = createEl('div', { className: 'jects-cal__year-grid', attrs: { role: 'group' } });
      mg.setAttribute('aria-label', `${this.mo(m)} ${year}`);
      for (let i = 0; i < 7; i++) {
        const dow = createEl('div', { className: 'jects-cal__year-dow' });
        dow.textContent = this.wd((ws + i) % 7).slice(0, 1);
        dow.setAttribute('aria-hidden', 'true');
        mg.append(dow);
      }
      for (const day of monthGrid(monthDate, ws)) {
        const cell = createEl('button', { className: 'jects-cal__year-day' });
        cell.type = 'button';
        cell.textContent = String(day.getDate());
        if (!isSameMonth(day, monthDate)) cell.classList.add('jects-cal__year-day--muted');
        if (isSameDay(day, today)) cell.classList.add('jects-cal__year-day--today');
        const n = counts.get(dayKey(day)) ?? 0;
        if (n > 0 && isSameMonth(day, monthDate)) {
          cell.classList.add('jects-cal__year-day--has');
          cell.setAttribute('aria-label', `${this.mo(m)} ${day.getDate()}, ${n} event${n > 1 ? 's' : ''}`);
        }
        const captured = new Date(day);
        cell.addEventListener('click', () => {
          this.setView('day');
          this.goToDate(captured);
        });
        mg.append(cell);
      }
      mwrap.append(mg);
      grid.append(mwrap);
    }
    this.viewEl.append(grid);
  }

  /* ── Agenda view ───────────────────────────────────────────────────── */

  private renderAgenda(): void {
    const ws = this.weekStart();
    const start = startOfWeek(this.anchor, ws);
    const end = endOfWeek(this.anchor, ws);
    const occs = this.occurrencesInRange(start, end);

    const list = createEl('div', { className: 'jects-cal__agenda' });
    list.setAttribute('role', 'list');
    let any = false;
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      const dayOccs = occs
        .filter((o) => this.occursOnDay(o, day))
        .sort((a, b) => Number(b.event.allDay) - Number(a.event.allDay) || a.start.getTime() - b.start.getTime());
      if (dayOccs.length === 0) continue;
      any = true;
      const group = createEl('div', { className: 'jects-cal__agenda-day', attrs: { role: 'listitem' } });
      const dh = createEl('div', { className: 'jects-cal__agenda-date' });
      dh.textContent = `${this.wd(day.getDay())}, ${this.mo(day.getMonth())} ${day.getDate()}`;
      if (isSameDay(day, new Date())) dh.classList.add('jects-cal__agenda-date--today');
      group.append(dh);
      for (const o of dayOccs) {
        const row = createEl('button', { className: 'jects-cal__agenda-row' });
        row.type = 'button';
        row.style.setProperty('--_cal-event', this.colorVar(o.event));
        row.dataset.eventId = String(o.event.id);
        const time = o.event.allDay ? 'All day' : this.clockLabel(o.start);
        setHtml(
          row,
          trustedHtml(
            `<span class="jects-cal__agenda-time">${esc(time)}</span>` +
              `<span class="jects-cal__agenda-dot" aria-hidden="true"></span>` +
              `<span class="jects-cal__agenda-title">${esc(o.event.title)}</span>` +
              (o.event.location ? `<span class="jects-cal__agenda-loc">${esc(o.event.location)}</span>` : ''),
          ),
        );
        row.setAttribute('aria-label', `${o.event.title}, ${time}`);
        row.addEventListener('click', () => {
          this.emit('eventClick', { event: o.event, occurrence: o });
          this.requestEdit(o);
        });
        group.append(row);
      }
      list.append(group);
    }
    if (!any) {
      const empty = createEl('div', { className: 'jects-cal__empty' });
      empty.textContent = 'No events this week.';
      list.append(empty);
    }
    this.viewEl.append(list);
  }

  /* ── Resource view (single day, columns per resource) ──────────────── */

  private renderResource(): void {
    const resources = this.visibleResources();
    if (resources.length === 0) {
      const empty = createEl('div', { className: 'jects-cal__empty' });
      empty.textContent = 'No resources configured.';
      this.viewEl.append(empty);
      return;
    }
    const startHour = this.config.dayStartHour ?? 0;
    const endHour = this.config.dayEndHour ?? 24;
    const startMin = startHour * 60;
    const endMin = endHour * 60;
    const hourH = this.config.hourHeight ?? 48;
    const totalH = ((endMin - startMin) / 60) * hourH;
    const day = this.anchor;
    const occs = this.occurrencesInRange(startOfDay(day), endOfDay(day));

    const wrap = createEl('div', { className: 'jects-cal__timegrid jects-cal__timegrid--resource' });
    // Set the column count on the shared container so the header inherits it too
    // (see renderTimeGrid — the header is a sibling of the body `cols`).
    wrap.style.setProperty('--_cal-cols', String(resources.length));

    const header = createEl('div', { className: 'jects-cal__tg-header' });
    header.append(createEl('div', { className: 'jects-cal__tg-corner' }));
    for (const r of resources) {
      const dh = createEl('div', { className: 'jects-cal__tg-daycol-head' });
      setHtml(dh, trustedHtml(`<span class="jects-cal__tg-dow">${esc(r.name)}</span>`));
      if (r.color) dh.style.setProperty('--_cal-res', `var(--jects-${r.color})`);
      header.append(dh);
    }
    wrap.append(header);

    const body = createEl('div', { className: 'jects-cal__tg-body' });
    body.style.setProperty('--_cal-hour-h', `${hourH}px`);
    const gutter = createEl('div', { className: 'jects-cal__tg-gutter' });
    for (let h = startHour; h < endHour; h++) {
      const slot = createEl('div', { className: 'jects-cal__tg-hour' });
      slot.style.height = `${hourH}px`;
      const lab = createEl('span', { className: 'jects-cal__tg-hour-label' });
      lab.textContent = `${String(h).padStart(2, '0')}:00`;
      slot.append(lab);
      gutter.append(slot);
    }
    body.append(gutter);

    const cols = createEl('div', { className: 'jects-cal__tg-cols' });
    cols.style.setProperty('--_cal-cols', String(resources.length));
    for (const r of resources) {
      const col = createEl('div', { className: 'jects-cal__tg-col' });
      col.style.height = `${totalH}px`;
      col.dataset.day = dayKey(day);
      col.dataset.resourceId = r.id;
      col.dataset.startMin = String(startMin);
      col.dataset.endMin = String(endMin);
      col.setAttribute('role', 'group');
      col.setAttribute('aria-label', r.name);
      for (let h = startHour; h < endHour; h++) {
        const line = createEl('div', { className: 'jects-cal__tg-line' });
        line.style.height = `${hourH}px`;
        col.append(line);
      }
      const resOccs = occs.filter((o) => o.event.resourceId === r.id && this.occursOnDay(o, day));
      const laid = layoutDay(resOccs, day, startMin, endMin);
      for (const lo of laid) col.append(this.timedEvent(lo, totalH));
      cols.append(col);
    }
    body.append(cols);
    wrap.append(body);
    this.viewEl.append(wrap);
  }

  /* ── Timeline view (horizontal time axis, resources as rows) ───────────── */

  /**
   * A horizontal-time-axis view: hours run left→right across the top, and each
   * resource is a row (band) with events drawn as horizontal bars positioned +
   * sized by their start/end along the axis — the scheduler-style row band.
   * Falls back to a single "All events" row when no resources are configured.
   */
  private renderTimeline(): void {
    const startHour = this.config.dayStartHour ?? 0;
    const endHour = this.config.dayEndHour ?? 24;
    const startMin = startHour * 60;
    const endMin = endHour * 60;
    const span = Math.max(1, endMin - startMin);
    const day = this.anchor;
    const occs = this.occurrencesInRange(startOfDay(day), endOfDay(day)).filter(
      (o) => !o.event.allDay && this.occursOnDay(o, day),
    );

    const rows: Array<{ id: string | undefined; name: string; color?: string | undefined }> =
      this.visibleResources().length > 0
        ? this.visibleResources().map((r) => ({ id: r.id, name: r.name, color: r.color }))
        : [{ id: undefined, name: 'All events' }];

    const wrap = createEl('div', { className: 'jects-cal__timeline' });
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', `Timeline ${this.viewTitle()}`);

    // Time-axis header.
    const header = createEl('div', { className: 'jects-cal__tl-header' });
    header.append(createEl('div', { className: 'jects-cal__tl-rowhead jects-cal__tl-corner' }));
    const axis = createEl('div', { className: 'jects-cal__tl-axis' });
    axis.style.setProperty('--_cal-tl-hours', String(endHour - startHour));
    for (let h = startHour; h < endHour; h++) {
      const tick = createEl('div', { className: 'jects-cal__tl-tick' });
      tick.textContent = `${String(h).padStart(2, '0')}:00`;
      axis.append(tick);
    }
    header.append(axis);
    wrap.append(header);

    // One band per resource row.
    for (const row of rows) {
      const band = createEl('div', { className: 'jects-cal__tl-row' });
      const head = createEl('div', { className: 'jects-cal__tl-rowhead' });
      head.textContent = row.name;
      if (row.color) head.style.setProperty('--_cal-res', `var(--jects-${row.color})`);
      band.append(head);

      const track = createEl('div', { className: 'jects-cal__tl-track' });
      track.dataset.day = dayKey(day);
      if (row.id !== undefined) track.dataset.resourceId = row.id;
      // hour gridlines
      for (let h = startHour; h < endHour; h++) {
        const line = createEl('div', { className: 'jects-cal__tl-line' });
        line.style.left = `${((h - startHour) / (endHour - startHour)) * 100}%`;
        track.append(line);
      }
      const rowOccs = occs.filter((o) => (row.id === undefined ? true : o.event.resourceId === row.id));
      for (const o of rowOccs) {
        const s = Math.max(startMin, minutesIntoDay(o.start));
        const e = Math.min(endMin, o.end.getTime() > endOfDay(day).getTime() ? endMin : minutesIntoDay(o.end));
        const left = ((s - startMin) / span) * 100;
        const width = (Math.max(e - s, 15) / span) * 100;
        const bar = createEl('button', { className: 'jects-cal__event jects-cal__tl-event' });
        bar.type = 'button';
        bar.style.setProperty('--_cal-event', this.colorVar(o.event));
        bar.style.left = `${left}%`;
        bar.style.width = `${width}%`;
        bar.dataset.eventId = String(o.event.id);
        setHtml(
          bar,
          trustedHtml(
            `<span class="jects-cal__event-time">${this.clockLabel(o.start)}</span>` +
              `<span class="jects-cal__event-title">${esc(o.event.title)}</span>`,
          ),
        );
        bar.setAttribute('aria-label', `${o.event.title} at ${this.clockLabel(o.start)}`);
        bar.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.emit('eventClick', { event: o.event, occurrence: o });
          this.requestEdit(o);
        });
        track.append(bar);
      }
      band.append(track);
      wrap.append(band);
    }
    this.viewEl.append(wrap);
  }

  /* ── editor / create / update / delete ─────────────────────────────── */

  requestEdit(occurrence: EventOccurrence | null, draft?: DraftRange): void {
    if (this.config.editor === false) {
      if (draft) this.emit('rangeSelect', { start: draft.start, end: draft.end, allDay: draft.allDay });
      return;
    }
    const isEdit = !!occurrence;
    const ev = occurrence?.event ?? null;
    if (ev?.readOnly) return;
    openEventEditor(this.el, {
      event: ev,
      defaultStart: draft?.start ?? occurrence?.start ?? new Date(),
      defaultEnd: draft?.end ?? occurrence?.end ?? addMinutes(new Date(), 60),
      defaultAllDay: draft?.allDay,
      defaultResourceId: draft?.resourceId,
      categories: this.categories,
      resources: this.resources,
      onSave: (r) => this.commitEditor(ev, r),
      onDelete: isEdit && ev ? () => this.deleteEvent(ev) : undefined,
    });
  }

  private commitEditor(existing: CalendarEvent | null, r: EditorResult): void {
    // The editor now surfaces the full rule (freq + interval/byWeekday/count/
    // until/exDates), seeded from the existing series. For a NEW event we take it
    // verbatim. For an EDIT we reconcile against the prior rule:
    //   • same frequency  → merge over the previous rule, so detail the form did
    //     not re-surface (e.g. a `until` bound when the form shows a `count`) is
    //     preserved rather than silently dropped.
    //   • different frequency → replace wholesale with a minimal rule for the new
    //     frequency, since the seeded advanced inputs no longer apply.
    let recurrence: RecurrenceRule | undefined = r.recurrence;
    const prev = existing?.recurrence;
    if (recurrence && prev) {
      recurrence =
        prev.freq === recurrence.freq
          ? { ...prev, ...recurrence }
          : { freq: recurrence.freq, interval: 1 };
    }
    if (existing) {
      if (this.emit('beforeEventUpdate', { event: existing, start: r.start, end: r.end }) === false) return;
      this.store.update(existing.id, {
        title: r.title,
        start: r.start,
        end: r.end,
        allDay: r.allDay,
        description: r.description,
        location: r.location,
        categoryId: r.categoryId,
        resourceId: r.resourceId,
        recurrence,
      });
      this.emit('eventUpdate', { event: existing, start: r.start, end: r.end });
    } else {
      const draft: DraftRange = { start: r.start, end: r.end, allDay: r.allDay, resourceId: r.resourceId };
      if (this.emit('beforeEventCreate', { draft }) === false) return;
      const created = this.store.addEvent({
        title: r.title,
        start: r.start,
        end: r.end,
        allDay: r.allDay,
        description: r.description,
        location: r.location,
        categoryId: r.categoryId,
        resourceId: r.resourceId,
        recurrence,
      });
      this.emit('eventCreate', { event: created });
    }
  }

  /** Public: delete an event (vetoable). */
  deleteEvent(ev: CalendarEvent): boolean {
    if (this.emit('beforeEventDelete', { event: ev }) === false) return false;
    this.store.remove(ev.id);
    this.emit('eventDelete', { event: ev });
    return true;
  }

  /* ── drag interactions ─────────────────────────────────────────────── */

  private handlePointerDown(e: PointerEvent): void {
    if (this.config.editable === false) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;

    // Resize handle on a timed event
    const resizeHandle = target.closest<HTMLElement>('.jects-cal__event-resize');
    if (resizeHandle) {
      const evEl = resizeHandle.closest<HTMLElement>('[data-event-id]');
      if (evEl) {
        e.preventDefault();
        this.beginResize(e, evEl);
        return;
      }
    }

    // Move an existing timed event
    const eventEl = target.closest<HTMLElement>('.jects-cal__event--timed');
    if (eventEl && eventEl.dataset.eventId) {
      // delay decision: pointermove threshold distinguishes click vs drag
      this.beginMove(e, eventEl);
      return;
    }

    // Drag-create in a time column
    const col = target.closest<HTMLElement>('.jects-cal__tg-col');
    if (col && col.dataset.day && !target.closest('.jects-cal__event')) {
      e.preventDefault();
      this.beginCreate(e, col);
      return;
    }

    // Drag-create across the all-day rail (Day/Week) — spans whole days.
    const lane = target.closest<HTMLElement>('.jects-cal__tg-allday-lane');
    if (lane && lane.dataset.day && !target.closest('.jects-cal__event')) {
      e.preventDefault();
      this.beginAllDayCreate(e, lane);
      return;
    }

    // Drag-create across month cells — selects an all-day date range. We do NOT
    // preventDefault so a plain (non-dragged) click still selects the day.
    const monthCell = target.closest<HTMLElement>('.jects-cal__month-cell');
    if (
      monthCell &&
      monthCell.dataset.day &&
      !target.closest('.jects-cal__event') &&
      !target.closest('.jects-cal__more')
    ) {
      this.beginAllDayCreate(e, monthCell);
      return;
    }
  }

  private colMinutes(col: HTMLElement, clientY: number): { day: Date; minutes: number } {
    const rect = col.getBoundingClientRect();
    const startMin = Number(col.dataset.startMin ?? 0);
    const endMin = Number(col.dataset.endMin ?? 1440);
    const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    let minutes = startMin + ratio * (endMin - startMin);
    const snap = this.config.snapMinutes ?? 15;
    minutes = Math.round(minutes / snap) * snap;
    minutes = Math.min(endMin, Math.max(startMin, minutes));
    const day = this.parseDayKey(col.dataset.day!);
    return { day, minutes };
  }

  private parseDayKey(key: string): Date {
    const parts = key.split('-').map(Number);
    const y = parts[0] ?? new Date().getFullYear();
    const m = parts[1] ?? 1;
    const d = parts[2] ?? 1;
    return new Date(y, m - 1, d);
  }

  private beginCreate(e: PointerEvent, col: HTMLElement): void {
    const { day, minutes } = this.colMinutes(col, e.clientY);
    const snap = this.config.snapMinutes ?? 15;
    this.gesture = {
      kind: 'create',
      pointerId: e.pointerId,
      baseDay: day,
      baseMinutes: minutes,
      allDay: false,
      resourceId: col.dataset.resourceId,
      curStart: atMinutes(day, minutes),
      curEnd: atMinutes(day, minutes + snap),
      moved: false,
    };
    this.attachGestureDoc(col);
  }

  /**
   * Begin an all-day drag-create from an all-day rail lane or a month cell. The
   * gesture spans whole days; dragging across `[data-day]` holders extends the
   * range, and `pointerup` opens the create editor for the resulting all-day span.
   */
  private beginAllDayCreate(e: PointerEvent, el: HTMLElement): void {
    const day = this.parseDayKey(el.dataset.day!);
    this.gesture = {
      kind: 'create',
      pointerId: e.pointerId,
      baseDay: day,
      baseMinutes: 0,
      allDay: true,
      resourceId: el.dataset.resourceId,
      curStart: startOfDay(day),
      curEnd: endOfDay(day),
      moved: false,
    };
    this.attachGestureDoc(el);
  }

  /** Resolve the calendar day under a viewport point (for all-day day-drag). */
  private dayUnderPoint(x: number, y: number): Date | null {
    // `elementFromPoint` is absent in some non-layout hosts (jsdom) — degrade to
    // "no day resolved" so the gesture keeps its anchor day rather than throwing.
    if (typeof document.elementFromPoint !== 'function') return null;
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const holder = el?.closest<HTMLElement>('[data-day]');
    return holder?.dataset.day ? this.parseDayKey(holder.dataset.day) : null;
  }

  private beginMove(e: PointerEvent, evEl: HTMLElement): void {
    const id = evEl.dataset.eventId!;
    const ev = this.store.getById(id);
    if (!ev || ev.readOnly) return;
    const col = evEl.closest<HTMLElement>('.jects-cal__tg-col');
    if (!col) return;
    const { minutes } = this.colMinutes(col, e.clientY);
    this.gesture = {
      kind: 'move',
      pointerId: e.pointerId,
      eventId: id,
      baseDay: this.parseDayKey(col.dataset.day!),
      baseMinutes: minutes,
      origStart: new Date(ev.start),
      origEnd: new Date(ev.end),
      allDay: false,
      curStart: new Date(ev.start),
      curEnd: new Date(ev.end),
      moved: false,
    };
    this.attachGestureDoc(col);
  }

  private beginResize(e: PointerEvent, evEl: HTMLElement): void {
    const id = evEl.dataset.eventId!;
    const ev = this.store.getById(id);
    if (!ev || ev.readOnly) return;
    const col = evEl.closest<HTMLElement>('.jects-cal__tg-col');
    if (!col) return;
    this.gesture = {
      kind: 'resize',
      pointerId: e.pointerId,
      eventId: id,
      baseDay: this.parseDayKey(col.dataset.day!),
      baseMinutes: minutesIntoDay(ev.start),
      origStart: new Date(ev.start),
      origEnd: new Date(ev.end),
      allDay: false,
      curStart: new Date(ev.start),
      curEnd: new Date(ev.end),
      moved: true,
    };
    this.attachGestureDoc(col);
  }

  private attachGestureDoc(col: HTMLElement): void {
    this.onDocMove = (ev: PointerEvent) => this.onGestureMove(ev, col);
    this.onDocUp = (ev: PointerEvent) => this.onGestureUp(ev);
    document.addEventListener('pointermove', this.onDocMove);
    document.addEventListener('pointerup', this.onDocUp);
  }

  /**
   * Tear down an in-flight gesture: remove the document-level pointer listeners,
   * drop the gesture state, and strip any preview ghost. Safe to call when no
   * gesture is active. Invoked both at the natural end of a gesture and from
   * destroy(), so a widget torn down mid-drag never leaks document listeners
   * that would later fire callbacks against a detached viewEl.
   */
  private cancelGesture(): void {
    if (this.onDocMove) {
      document.removeEventListener('pointermove', this.onDocMove);
      this.onDocMove = undefined;
    }
    if (this.onDocUp) {
      document.removeEventListener('pointerup', this.onDocUp);
      this.onDocUp = undefined;
    }
    this.gesture = undefined;
    // viewEl may already be detached during destroy(); guard the lookup.
    this.viewEl?.querySelector('.jects-cal__ghost')?.remove();
  }

  override destroy(): void {
    this.cancelGesture();
    super.destroy();
  }

  private onGestureMove(e: PointerEvent, col: HTMLElement): void {
    const g = this.gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    g.moved = true;
    const snap = this.config.snapMinutes ?? 15;

    // All-day day-spanning create (all-day rail / month grid): extend the range
    // to the calendar day under the pointer; no time-grid minute math.
    if (g.allDay && g.kind === 'create') {
      const day = this.dayUnderPoint(e.clientX, e.clientY) ?? g.baseDay;
      const lo = g.baseDay.getTime() <= day.getTime() ? g.baseDay : day;
      const hi = g.baseDay.getTime() <= day.getTime() ? day : g.baseDay;
      g.curStart = startOfDay(lo);
      g.curEnd = endOfDay(hi);
      return;
    }

    const { day, minutes } = this.colMinutes(col, e.clientY);

    if (g.kind === 'create') {
      const a = g.baseMinutes;
      const b = minutes;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      g.curStart = atMinutes(g.baseDay, lo);
      g.curEnd = atMinutes(g.baseDay, Math.max(hi, lo + snap));
    } else if (g.kind === 'move' && g.origStart && g.origEnd) {
      const durMin = (g.origEnd.getTime() - g.origStart.getTime()) / 60000;
      const dayDelta = diffDays(g.baseDay, day);
      let newStart = atMinutes(addDays(g.origStart, dayDelta), minutes - g.baseMinutes + minutesIntoDay(g.origStart));
      // snap
      const sm = Math.round(minutesIntoDay(newStart) / snap) * snap;
      newStart = atMinutes(startOfDay(newStart), sm);
      g.curStart = newStart;
      g.curEnd = addMinutes(newStart, durMin);
    } else if (g.kind === 'resize' && g.origStart) {
      let endMinutes = Math.round(minutes / snap) * snap;
      const minEnd = minutesIntoDay(g.origStart) + snap;
      endMinutes = Math.max(endMinutes, minEnd);
      g.curEnd = atMinutes(g.baseDay, endMinutes);
    }
    this.paintGesturePreview();
  }

  private paintGesturePreview(): void {
    const g = this.gesture;
    if (!g) return;
    let ghost = this.viewEl.querySelector<HTMLElement>('.jects-cal__ghost');
    const startHour = this.config.dayStartHour ?? 0;
    const endHour = this.config.dayEndHour ?? 24;
    const startMin = startHour * 60;
    const endMin = endHour * 60;
    const span = endMin - startMin;

    if (g.kind === 'move' || g.kind === 'resize') {
      // re-render to reposition the actual event preview cheaply via ghost
    }
    if (!ghost) {
      ghost = createEl('div', { className: 'jects-cal__ghost' });
      const col = this.findColumn(g.curStart, g.resourceId);
      (col ?? this.viewEl).append(ghost);
    } else {
      const col = this.findColumn(g.curStart, g.resourceId);
      if (col && ghost.parentElement !== col) col.append(ghost);
    }
    const host = ghost.parentElement as HTMLElement | null;
    if (host) {
      const totalH = host.getBoundingClientRect().height;
      const s = Math.max(startMin, minutesIntoDay(g.curStart));
      const e2 = Math.min(endMin, minutesIntoDay(g.curEnd) || endMin);
      ghost.style.top = `${((s - startMin) / span) * totalH}px`;
      ghost.style.height = `${Math.max(((e2 - s) / span) * totalH, 12)}px`;
      ghost.textContent =
        `${String(g.curStart.getHours()).padStart(2, '0')}:${String(g.curStart.getMinutes()).padStart(2, '0')}`;
    }
  }

  private findColumn(day: Date, resourceId?: string): HTMLElement | null {
    const key = dayKey(day);
    const cols = this.viewEl.querySelectorAll<HTMLElement>('.jects-cal__tg-col');
    for (const c of cols) {
      if (c.dataset.day === key && (resourceId === undefined || c.dataset.resourceId === resourceId)) {
        return c;
      }
    }
    // resource view: column keyed by resource only
    if (resourceId) {
      for (const c of cols) if (c.dataset.resourceId === resourceId) return c;
    }
    return null;
  }

  private onGestureUp(e: PointerEvent): void {
    const g = this.gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    // A drag that actually moved must NOT be followed by the native click that
    // the browser fires on the event element after pointerup (which would pop
    // the editor open). Stamp a short suppression window the timed-event click
    // handler checks. Resize gestures start with moved===true but never want a
    // trailing edit either.
    if (g.moved) this.suppressClickUntil = Date.now() + 350;
    // Shared teardown: remove document listeners + clear gesture + ghost.
    this.cancelGesture();

    if (g.kind === 'create') {
      if (!g.moved) return; // a plain click, not a drag
      this.requestEdit(null, {
        start: g.curStart,
        end: g.curEnd,
        allDay: g.allDay,
        resourceId: g.resourceId,
      });
      return;
    }

    if (!g.moved || !g.eventId) {
      this.renderView();
      return;
    }
    const ev = this.store.getById(g.eventId);
    if (!ev) return;
    if (this.emit('beforeEventUpdate', { event: ev, start: g.curStart, end: g.curEnd }) === false) {
      this.renderView();
      return;
    }
    if (g.kind === 'move') this.store.moveEvent(g.eventId, g.curStart, g.curEnd);
    else this.store.resizeEvent(g.eventId, g.curEnd);
    this.emit('eventUpdate', { event: ev, start: g.curStart, end: g.curEnd });
  }

  /* ── keyboard navigation ───────────────────────────────────────────── */

  private handleKeydown(e: KeyboardEvent): void {
    // Only act when focus is on the calendar root or a grid cell (not inputs).
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Undo / redo (Ctrl/Cmd+Z, Ctrl/Cmd+Y, Ctrl/Cmd+Shift+Z).
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.undo();
        return;
      }
      if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        this.redo();
        return;
      }
    }

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        this.goToDate(addDays(this.anchor, 1));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.goToDate(addDays(this.anchor, -1));
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.goToDate(addDays(this.anchor, this.activeView === 'month' || this.activeView === 'year' ? 7 : 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.goToDate(addDays(this.anchor, this.activeView === 'month' || this.activeView === 'year' ? -7 : -1));
        break;
      case 'PageDown':
        e.preventDefault();
        this.next();
        break;
      case 'PageUp':
        e.preventDefault();
        this.prev();
        break;
      case 't':
      case 'T':
        this.today();
        break;
      case 'Enter':
        if (e.target === this.el) {
          e.preventDefault();
          this.requestEdit(null, {
            start: startOfDay(this.anchor),
            end: endOfDay(this.anchor),
            allDay: true,
          });
        }
        break;
    }
  }

  /** ISO week of the anchor — exposed for consumers/tests. */
  weekNumber(): number {
    return isoWeek(this.anchor);
  }
}

// Register for declarative composition: create({ type: 'calendar', ... }).
register(
  'calendar',
  Calendar as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Calendar,
);
