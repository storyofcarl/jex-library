/**
 * TaskBoard — a kanban board Widget built on @jects/core.
 *
 * Columns (vertical) optionally crossed by swimlanes (horizontal). Cards live in
 * a flat `Store<KanbanCard>` and are grouped by `(column, lane)` then sorted by
 * `order`. Cards are draggable across columns/lanes with reorder, multiselect,
 * and edge auto-scroll (pointer events). WIP limits (soft flag + strict veto),
 * column collapse/lock/reorder, search/filter, a modal card editor and inline
 * quick-edit are all layered on top.
 *
 * Registered with the factory as `taskboard`.
 */

import {
  Widget,
  Store,
  createEl,
  register,
  type RecordId,
} from '@jects/core';

import { cardAccessibleLabel, clamp, renderCardBody } from './card.js';
import { AjaxDataProvider } from './data-provider.js';
import { openCardEditor } from './editor.js';
import type {
  BoardFilterDef,
  CardDropTarget,
  CardSyncOp,
  ExportOptions,
  KanbanCard,
  KanbanColumnDef,
  KanbanLaneDef,
  SortField,
  TaskBoardConfig,
  TaskBoardDataProvider,
  TaskBoardEvents,
} from './types.js';

const DEFAULT_COLUMN_WIDTH = 280;
const AUTOSCROLL_EDGE = 48; // px from edge that triggers auto-scroll
const AUTOSCROLL_SPEED = 18; // px per frame
const LONGPRESS_MS = 350; // touch hold before a card drag begins

/**
 * A reversible board mutation captured on the undo/redo history stack. Each
 * entry stores the per-card snapshots needed to roll forward (`redo`) or back
 * (`undo`); column reorders store the before/after id order instead.
 */
interface HistoryEntry {
  kind: 'cards' | 'columns';
  /** For `cards`: prior + next field snapshots keyed by card id. */
  cards?: Array<{ id: RecordId; before: Partial<KanbanCard>; after: Partial<KanbanCard> }>;
  /** For `columns`: prior + next left-to-right id order. */
  before?: RecordId[];
  after?: RecordId[];
}

interface DragState {
  pointerId: number;
  pointerType: string;
  ids: RecordId[];
  from: { column: RecordId; lane: RecordId | undefined };
  startX: number;
  startY: number;
  moved: boolean;
  /**
   * Touch only: gate that opens when the long-press timer fires. Until then a
   * touch move is treated as a scroll (not a drag), so the board scrolls
   * normally and a card only lifts after a deliberate hold.
   */
  longPressReady: boolean;
  ghost?: HTMLElement | undefined;
  placeholder?: HTMLElement | undefined;
  target?: CardDropTarget | undefined;
  rafScroll?: number | undefined;
  lastClientX: number;
  lastClientY: number;
  /** The card element the pointer listeners + capture were bound to. */
  cardEl: HTMLElement;
  /** Removes the pointermove/pointerup/pointercancel listeners + releases capture. */
  unbind: () => void;
}

interface ColDragState {
  id: RecordId;
  startX: number;
  moved: boolean;
  /** Removes the document-level pointermove/pointerup listeners. */
  unbind: () => void;
}

export class TaskBoard extends Widget<TaskBoardConfig, TaskBoardEvents> {
  /** Card data store (built from `cards` unless `store` was supplied). */
  store!: Store<KanbanCard>;
  /** Whether we own (and must dispose of) the store. */
  private ownsStore = false;

  /** Column definitions in current left-to-right order. */
  private columns: KanbanColumnDef[] = [];
  /** Lane definitions (empty => swimlanes off). */
  private lanes: KanbanLaneDef[] = [];
  /** Per-column collapsed/locked runtime state (seeded from defs). */
  private columnState = new Map<RecordId, { collapsed: boolean; locked: boolean }>();
  private laneState = new Map<RecordId, { collapsed: boolean }>();

  /** Current multi-selection of card ids. */
  private selected = new Set<RecordId>();
  /** Live search query (lowercased). */
  private query = '';

  /** Active card drag, if any. */
  private drag: DragState | undefined;
  /** Active column-header drag (reorder), if any. */
  private colDrag: ColDragState | undefined;
  /** Pending long-press timer id (touch), cleared if the touch ends/moves early. */
  private longPressTimer: ReturnType<typeof setTimeout> | undefined;

  /** Remote data provider (REST/WS), if configured. */
  private provider: TaskBoardDataProvider | undefined;
  /** Unsubscribe from the provider's WebSocket subscription. */
  private unsubscribeRemote: (() => void) | undefined;
  /**
   * Set while we are applying a remote op from the provider's subscription, so
   * the resulting store mutation is NOT echoed back to the provider (no loop)
   * and is NOT captured on the undo stack.
   */
  private applyingRemote = false;

  /** Undo / redo history (most-recent last). */
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  /** Set while replaying a history entry so undo/redo isn't itself recorded. */
  private applyingHistory = false;

  /** Active toolbar sort field (`order` = manual/default). */
  private sortField: SortField = 'order';
  /** Sort direction toggle for the active field. */
  private sortDir: 1 | -1 = 1;
  /** Ids of the currently active toolbar filters. */
  private activeFilters = new Set<string>();
  /** Toolbar sort `<select>` (when sortable). */
  private sortSelect?: HTMLSelectElement;

  /**
   * Re-entrancy guard. Set while we are applying our own store mutations
   * (commitMove/applyCardEdit/addCard) so the store 'change' handler does not
   * fire a redundant renderBodies() per-record mid-loop; we render once at the
   * end. This both avoids an N-render storm and prevents intermediate renders
   * reading a transient store state with partially reassigned order indices.
   */
  private applying = false;

  /** Scroll viewport element holding the columns row. */
  private scroller!: HTMLElement;
  /** Toolbar search input (when toolbar enabled). */
  private searchInput?: HTMLInputElement;
  /** Polite live region for announcing keyboard moves to screen readers. */
  private liveRegion: HTMLElement | undefined;

  constructor(host: HTMLElement | string, config?: TaskBoardConfig) {
    super(host, config);
    // Field initializers have run; finish wiring after first render.
    this.sortField = config?.sortField ?? 'order';
    this.initStore();
    this.syncDefs();
    this.render();
    // React to store changes (additive workflow may mutate it externally).
    if (this.store) {
      this.track(
        this.store.events.on('change', () => {
          // Skip self-triggered renders: our own mutation methods set `applying`
          // and render exactly once when done. Only react to EXTERNAL changes.
          if (this.applying) return;
          if (!this.isDestroyed) this.renderBodies();
        }),
      );
    }
    // Wire up the remote data provider (REST + optional WebSocket), if any.
    this.initProvider();
  }

  // ── remote data provider ──────────────────────────────────────────────────

  private initProvider(): void {
    let provider = this.config.dataProvider;
    if (!provider && this.config.syncUrl) {
      provider = new AjaxDataProvider({
        url: this.config.syncUrl,
        ...(this.config.wsUrl != null ? { wsUrl: this.config.wsUrl } : {}),
      });
    }
    if (!provider) return;
    this.provider = provider;

    // Initial load from the remote source into our (owned) store.
    void provider
      .load()
      .then((cards) => {
        if (this.isDestroyed) return;
        const prev = this.applying;
        this.applying = true;
        try {
          this.store.parse(cards);
        } finally {
          this.applying = prev;
        }
        this.renderBodies();
      })
      .catch(() => {
        /* surface via console in the browser; tests assert on the mock */
      });

    // Subscribe to remote changes (WebSocket) and apply them to the live board.
    if (provider.subscribe) {
      this.unsubscribeRemote = provider.subscribe((op) => this.applyRemoteOp(op));
    }
  }

  /** Apply a remote op into the store WITHOUT echoing it back or recording undo. */
  private applyRemoteOp(op: CardSyncOp): void {
    if (this.isDestroyed) return;
    const prevApplying = this.applying;
    const prevRemote = this.applyingRemote;
    this.applying = true;
    this.applyingRemote = true;
    try {
      if (op.action === 'remove') {
        this.store.remove(op.id);
      } else if (op.action === 'add') {
        if (op.card) this.store.add(op.card as KanbanCard);
      } else {
        if (op.card) this.store.update(op.id, op.card);
      }
    } finally {
      this.applying = prevApplying;
      this.applyingRemote = prevRemote;
    }
    this.renderBodies();
    this.emit('remoteChange', { board: this, op });
  }

  /** Push an optimistic mutation to the provider (fire-and-forget). */
  private pushSync(op: CardSyncOp): void {
    if (!this.provider || this.applyingRemote) return;
    void this.provider.sync(op).catch(() => {
      /* optimistic: the local store already reflects the change */
    });
  }

  protected override defaults(): Partial<TaskBoardConfig> {
    return {
      columnWidth: DEFAULT_COLUMN_WIDTH,
      draggable: true,
      multiSelect: true,
      autoScroll: true,
      columnReorder: true,
      toolbar: true,
      editable: true,
      searchPlaceholder: 'Search cards…',
    };
  }

  protected buildEl(): HTMLElement {
    const el = createEl('div', {
      className: 'jects-kanban',
      attrs: { role: 'group' },
    });
    // Delegated pointer/keyboard handling lives on the root.
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('dblclick', (e) => this.onDblClick(e));
    el.addEventListener('keydown', (e) => this.onKeyDown(e));
    el.addEventListener('click', (e) => this.onClick(e));
    return el;
  }

  // ── store / defs ────────────────────────────────────────────────────────

  private initStore(): void {
    if (this.config.store) {
      this.store = this.config.store;
      this.ownsStore = false;
    } else {
      this.store = new Store<KanbanCard>({ data: this.config.cards ?? [], idField: 'id' });
      this.ownsStore = true;
    }
  }

  private syncDefs(): void {
    this.columns = (this.config.columns ?? []).map((c) => ({ ...c }));
    this.lanes = (this.config.lanes ?? []).map((l) => ({ ...l }));
    for (const c of this.columns) {
      if (!this.columnState.has(c.id)) {
        this.columnState.set(c.id, { collapsed: !!c.collapsed, locked: !!c.locked });
      }
    }
    for (const l of this.lanes) {
      if (!this.laneState.has(l.id)) this.laneState.set(l.id, { collapsed: !!l.collapsed });
    }
  }

  // ── data helpers ──────────────────────────────────────────────────────────

  private matchesQuery(card: KanbanCard): boolean {
    if (!this.query) return true;
    const hay = `${card.title ?? ''} ${card.description ?? ''} ${card.assignee ?? ''} ${(
      card.tags ?? []
    )
      .map((t) => t.text)
      .join(' ')}`.toLowerCase();
    return hay.includes(this.query);
  }

  /**
   * Whether a card passes the active toolbar filters + ad-hoc `filterFn`. A card
   * is kept only if it satisfies EVERY active filter predicate (AND), so the
   * toolbar narrows progressively.
   */
  private matchesFilters(card: KanbanCard): boolean {
    if (this.config.filterFn && !this.config.filterFn(card)) return false;
    if (this.activeFilters.size === 0) return true;
    const defs = this.config.filters ?? [];
    for (const id of this.activeFilters) {
      const def = defs.find((f) => f.id === id);
      if (def && !def.test(card)) return false;
    }
    return true;
  }

  /** A card is visible iff it matches the search query AND the active filters. */
  private isVisible(card: KanbanCard): boolean {
    return this.matchesQuery(card) && this.matchesFilters(card);
  }

  /** Comparator for the active sort field; falls back to manual `order` then id. */
  private cardCompare(a: KanbanCard, b: KanbanCard): number {
    const field = this.sortField;
    if (field !== 'order') {
      const diff = sortValue(field, a) - sortValue(field, b) || sortText(field, a, b);
      if (diff !== 0) return diff * this.sortDir;
    }
    const oa = a.order ?? 0;
    const ob = b.order ?? 0;
    if (oa !== ob) return oa - ob;
    return String(a.id).localeCompare(String(b.id));
  }

  /** Cards for a (column, lane), filtered by search/filters, sorted by the active field. */
  private cardsIn(column: RecordId, lane?: RecordId): KanbanCard[] {
    const out: KanbanCard[] = [];
    this.store.forEach((card) => {
      if (card.column !== column) return;
      if (this.lanes.length > 0 && (card.lane ?? this.lanes[0]?.id) !== lane) return;
      if (!this.isVisible(card)) return;
      out.push(card);
    });
    out.sort((a, b) => this.cardCompare(a, b));
    return out;
  }

  private columnDef(id: RecordId): KanbanColumnDef | undefined {
    return this.columns.find((c) => c.id === id);
  }

  private columnCount(id: RecordId): number {
    let n = 0;
    this.store.forEach((c) => {
      if (c.column === id) n++;
    });
    return n;
  }

  // ── render ────────────────────────────────────────────────────────────────

  protected override render(): void {
    // Guard: the base Widget constructor calls render() before this subclass's
    // field initializers / initStore() have run. Skip until we're wired up.
    if (!this.store || !this.columnState) return;

    const el = this.el;
    el.className = ['jects-kanban', this.config.cls ?? ''].filter(Boolean).join(' ');
    el.setAttribute('aria-label', this.config.label ?? 'Task board');

    // jects-safe-html: clears content; no interpolation
    el.innerHTML = '';

    // Keep a persistent live region attached across re-renders. Created lazily
    // here (the field set in buildEl() may be reset by class-field init order).
    if (!this.liveRegion) {
      this.liveRegion = createEl('div', {
        className: 'jects-kanban__live',
        attrs: { 'aria-live': 'polite', 'aria-atomic': 'true', role: 'status' },
      });
    }
    el.appendChild(this.liveRegion);

    if (this.config.toolbar) el.appendChild(this.buildToolbar());

    this.scroller = createEl('div', { className: 'jects-kanban__scroller' });
    const row = createEl('div', { className: 'jects-kanban__columns' });
    for (const col of this.columns) row.appendChild(this.buildColumn(col));
    this.scroller.appendChild(row);
    el.appendChild(this.scroller);
  }

  private buildToolbar(): HTMLElement {
    const bar = createEl('div', { className: 'jects-kanban__toolbar', attrs: { role: 'toolbar' } });
    const search = createEl('input', {
      className: 'jects-kanban__search',
      attrs: {
        type: 'search',
        placeholder: this.config.searchPlaceholder ?? 'Search cards…',
        'aria-label': 'Search cards',
      },
    }) as HTMLInputElement;
    search.value = this.query;
    search.addEventListener('input', () => {
      this.query = search.value.trim().toLowerCase();
      this.renderBodies();
    });
    this.searchInput = search;
    bar.appendChild(search);

    if (this.config.sortable) bar.appendChild(this.buildSortControl());
    if (this.config.filters && this.config.filters.length > 0) {
      bar.appendChild(this.buildFilterControl(this.config.filters));
    }
    return bar;
  }

  /** Toolbar sort `<select>` — picks the field cards are ordered by within columns. */
  private buildSortControl(): HTMLElement {
    const wrap = createEl('label', { className: 'jects-kanban__sort' });
    // jects-safe-html: static markup; no interpolation
    wrap.innerHTML = `<span class="jects-kanban__sort-label">Sort</span>`;
    const select = createEl('select', {
      className: 'jects-kanban__sort-select',
      attrs: { 'aria-label': 'Sort cards by' },
    }) as HTMLSelectElement;
    const options: Array<[SortField, string]> = [
      ['order', 'Manual'],
      ['priority', 'Priority'],
      ['title', 'Title'],
      ['votes', 'Votes'],
      ['due', 'Due date'],
    ];
    for (const [value, text] of options) {
      const opt = createEl('option', { attrs: { value } }) as HTMLOptionElement;
      opt.textContent = text;
      if (value === this.sortField) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      this.setSortField(select.value as SortField);
    });
    this.sortSelect = select;
    wrap.appendChild(select);
    return wrap;
  }

  /** Toolbar filter chips — toggle each {@link BoardFilterDef} on/off. */
  private buildFilterControl(filters: BoardFilterDef[]): HTMLElement {
    const wrap = createEl('div', {
      className: 'jects-kanban__filters',
      attrs: { role: 'group', 'aria-label': 'Filters' },
    });
    for (const def of filters) {
      const on = this.activeFilters.has(def.id);
      const btn = createEl('button', {
        className: [
          'jects-kanban__filter',
          on ? 'jects-kanban__filter--on' : '',
        ]
          .filter(Boolean)
          .join(' '),
        attrs: {
          type: 'button',
          'data-filter': def.id,
          'aria-pressed': String(on),
        },
      });
      btn.textContent = def.label;
      btn.addEventListener('click', () => this.toggleFilter(def.id));
      wrap.appendChild(btn);
    }
    return wrap;
  }

  private buildColumn(col: KanbanColumnDef): HTMLElement {
    const st = this.columnState.get(col.id) ?? { collapsed: false, locked: false };
    const width = col.width ?? this.config.columnWidth ?? DEFAULT_COLUMN_WIDTH;
    const colEl = createEl('section', {
      className: [
        'jects-kanban-col',
        st.collapsed ? 'jects-kanban-col--collapsed' : '',
        st.locked ? 'jects-kanban-col--locked' : '',
      ]
        .filter(Boolean)
        .join(' '),
      attrs: {
        'data-col': String(col.id),
        'aria-label': col.title ?? String(col.id),
      },
    });
    if (!st.collapsed) colEl.style.width = `${width}px`;
    if (col.color != null) {
      const n = ((Math.trunc(col.color) - 1) % 8 + 8) % 8 + 1;
      colEl.style.setProperty('--_kb-col-accent', `oklch(var(--jects-data-${n}))`);
    }

    colEl.appendChild(this.buildColumnHeader(col, st));

    if (!st.collapsed) {
      if (this.lanes.length > 0) {
        for (const lane of this.lanes) colEl.appendChild(this.buildLaneBody(col, lane));
      } else {
        colEl.appendChild(this.buildBody(col, undefined));
      }
    }
    return colEl;
  }

  private buildColumnHeader(
    col: KanbanColumnDef,
    st: { collapsed: boolean; locked: boolean },
  ): HTMLElement {
    const header = createEl('header', {
      className: 'jects-kanban-col__header',
      attrs: this.config.columnReorder && !st.locked ? { 'data-col-handle': String(col.id) } : {},
    });

    const toggle = createEl('button', {
      className: 'jects-kanban-col__toggle',
      attrs: {
        type: 'button',
        'aria-expanded': String(!st.collapsed),
        'data-toggle': String(col.id),
        'aria-label': `${st.collapsed ? 'Expand' : 'Collapse'} column ${col.title ?? col.id}`,
      },
    });
    toggle.textContent = st.collapsed ? '▸' : '▾';
    header.appendChild(toggle);

    const title = createEl('h3', { className: 'jects-kanban-col__title' });
    title.textContent = col.title ?? String(col.id);
    header.appendChild(title);

    const count = this.columnCount(col.id);
    const countEl = createEl('span', { className: 'jects-kanban-col__count' });
    if (col.limit != null) {
      countEl.textContent = `${count}/${col.limit}`;
      if (count > col.limit) countEl.classList.add('jects-kanban-col__count--over');
    } else {
      countEl.textContent = String(count);
    }
    header.appendChild(countEl);

    if (st.locked) {
      const lock = createEl('span', {
        className: 'jects-kanban-col__lock',
        attrs: { 'aria-label': 'Locked', title: 'Locked' },
      });
      lock.textContent = '🔒';
      header.appendChild(lock);
    }
    return header;
  }

  private buildLaneBody(col: KanbanColumnDef, lane: KanbanLaneDef): HTMLElement {
    const wrap = createEl('div', {
      className: 'jects-kanban-col__lane',
      attrs: { 'data-lane': String(lane.id) },
    });
    const head = createEl('div', { className: 'jects-kanban-col__lane-head' });
    head.textContent = lane.title ?? String(lane.id);
    wrap.appendChild(head);
    wrap.appendChild(this.buildBody(col, lane.id));
    return wrap;
  }

  private buildBody(col: KanbanColumnDef, lane: RecordId | undefined): HTMLElement {
    const body = createEl('div', {
      className: 'jects-kanban-col__body',
      attrs: {
        role: 'list',
        'data-col': String(col.id),
        ...(lane != null ? { 'data-lane': String(lane) } : {}),
      },
    });
    this.fillBody(body, col.id, lane);
    return body;
  }

  private fillBody(body: HTMLElement, column: RecordId, lane: RecordId | undefined): void {
    // jects-safe-html: clears content; no interpolation
    body.innerHTML = '';
    const cards = this.cardsIn(column, lane);
    for (const card of cards) body.appendChild(this.buildCard(card));
    if (cards.length === 0) {
      // Keep the list ARIA contract valid: the empty-state is itself a listitem.
      const empty = createEl('div', {
        className: 'jects-kanban-col__empty',
        attrs: { role: 'listitem' },
      });
      empty.textContent = 'No cards';
      body.appendChild(empty);
    }
  }

  private buildCard(card: KanbanCard): HTMLElement {
    const el = createEl('article', {
      className: [
        'jects-kanban-card',
        this.selected.has(card.id) ? 'jects-kanban-card--selected' : '',
      ]
        .filter(Boolean)
        .join(' '),
      attrs: {
        role: 'listitem',
        tabindex: '0',
        'data-card': String(card.id),
        'aria-label': cardAccessibleLabel(card),
        // `aria-current` is valid on a generic listitem; `aria-selected` is not.
        ...(this.selected.has(card.id) ? { 'aria-current': 'true' } : {}),
      },
    });
    // jects-safe-html: renderCardBody escapes card fields / sanitizes bodyItems html
    el.innerHTML = renderCardBody(card, this.config.cardRenderer);
    return el;
  }

  /** Re-render just the column bodies + header counts (cheap; keeps scroller). */
  private renderBodies(): void {
    if (this.isDestroyed || !this.el.isConnected && !this.scroller) {
      // Still proceed if scroller exists in detached mode (tests).
    }
    const cols = this.el.querySelectorAll<HTMLElement>('.jects-kanban-col');
    cols.forEach((colEl) => {
      const colId = this.idForEl(colEl.getAttribute('data-col'));
      if (colId == null) return;
      const def = this.columnDef(colId);
      // Update count.
      const countEl = colEl.querySelector<HTMLElement>('.jects-kanban-col__count');
      if (countEl && def) {
        const count = this.columnCount(colId);
        if (def.limit != null) {
          countEl.textContent = `${count}/${def.limit}`;
          countEl.classList.toggle('jects-kanban-col__count--over', count > def.limit);
        } else {
          countEl.textContent = String(count);
        }
      }
      const bodies = colEl.querySelectorAll<HTMLElement>('.jects-kanban-col__body');
      bodies.forEach((body) => {
        const laneId = this.idForEl(body.getAttribute('data-lane'));
        this.fillBody(body, colId, laneId);
      });
    });
  }

  /** Announce a message to assistive tech via the polite live region. */
  private announce(message: string): void {
    if (!this.liveRegion) return;
    // Clear then set on the next frame so repeated identical messages re-announce.
    this.liveRegion.textContent = '';
    const region = this.liveRegion;
    requestAnimationFrame(() => {
      if (!this.isDestroyed) region.textContent = message;
    });
  }

  /** Resolve a data-attr string to the matching def id (string or number). */
  private idForEl(raw: string | null): RecordId | undefined {
    if (raw == null) return undefined;
    // Prefer an exact column/lane id match preserving the original type.
    for (const c of this.columns) if (String(c.id) === raw) return c.id;
    for (const l of this.lanes) if (String(l.id) === raw) return l.id;
    return raw;
  }

  // ── events: click / selection / toggles ───────────────────────────────────

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const toggle = target.closest<HTMLElement>('[data-toggle]');
    if (toggle) {
      const id = this.idForEl(toggle.getAttribute('data-toggle'));
      if (id != null) this.toggleColumn(id);
      return;
    }
    const vote = target.closest<HTMLElement>('[data-vote]');
    if (vote) {
      const id = this.idForCard(this.cardElFor(vote) ?? vote);
      if (id != null) this.toggleVote(id);
      return;
    }
  }

  private cardElFor(target: HTMLElement): HTMLElement | null {
    return target.closest<HTMLElement>('.jects-kanban-card');
  }

  private selectCard(id: RecordId, additive: boolean): void {
    if (!this.config.multiSelect || !additive) {
      this.selected.clear();
      this.selected.add(id);
    } else if (this.selected.has(id)) {
      this.selected.delete(id);
    } else {
      this.selected.add(id);
    }
    this.applySelectionClasses();
    this.emit('selectionChange', { board: this, ids: [...this.selected] });
  }

  private applySelectionClasses(): void {
    const cards = this.el.querySelectorAll<HTMLElement>('.jects-kanban-card');
    cards.forEach((c) => {
      const id = this.idForCard(c);
      const on = id != null && this.selected.has(id);
      c.classList.toggle('jects-kanban-card--selected', on);
      if (on) c.setAttribute('aria-current', 'true');
      else c.removeAttribute('aria-current');
    });
  }

  private idForCard(el: HTMLElement): RecordId | undefined {
    const raw = el.getAttribute('data-card');
    if (raw == null) return undefined;
    // Match against store to preserve id type.
    let found: RecordId | undefined;
    this.store.forEach((c) => {
      if (found == null && String(c.id) === raw) found = c.id;
    });
    return found ?? raw;
  }

  // ── column collapse / lock / reorder ──────────────────────────────────────

  /** Toggle a column's collapsed state. */
  toggleColumn(id: RecordId): this {
    const st = this.columnState.get(id);
    if (!st) return this;
    st.collapsed = !st.collapsed;
    this.render();
    this.emit('columnToggle', { board: this, column: id, collapsed: st.collapsed });
    return this;
  }

  /** Set a column's locked state. Locked columns reject drops/drags/reorder. */
  setColumnLocked(id: RecordId, locked: boolean): this {
    const st = this.columnState.get(id);
    if (!st) return this;
    st.locked = locked;
    this.render();
    return this;
  }

  /** Reorder a column to a new index. */
  moveColumn(id: RecordId, toIndex: number): this {
    const from = this.columns.findIndex((c) => c.id === id);
    if (from < 0) return this;
    const clamped = clamp(toIndex, 0, this.columns.length - 1);
    if (from === clamped) return this;
    const before = this.columns.map((c) => c.id);
    const [def] = this.columns.splice(from, 1);
    if (def) this.columns.splice(clamped, 0, def);
    this.recordHistory({ kind: 'columns', before, after: this.columns.map((c) => c.id) });
    this.render();
    this.emit('columnReorder', { board: this, order: this.columns.map((c) => c.id) });
    return this;
  }

  /** Apply a column id order (used by undo/redo of reorders). */
  private applyColumnOrder(order: RecordId[]): void {
    const byId = new Map(this.columns.map((c) => [c.id, c]));
    const next: KanbanColumnDef[] = [];
    for (const id of order) {
      const def = byId.get(id);
      if (def) next.push(def);
    }
    // Keep any columns not present in `order` (defensive) at the end.
    for (const c of this.columns) if (!order.includes(c.id)) next.push(c);
    this.columns = next;
    this.render();
    this.emit('columnReorder', { board: this, order: this.columns.map((c) => c.id) });
  }

  // ── editing ───────────────────────────────────────────────────────────────

  private onDblClick(e: MouseEvent): void {
    const cardEl = this.cardElFor(e.target as HTMLElement);
    if (!cardEl) return;
    const id = this.idForCard(cardEl);
    if (id == null) return;
    const card = this.store.getById(id);
    if (!card) return;
    this.emit('cardActivate', { board: this, card });
    if (this.config.editable) this.editCard(id);
  }

  /** Open the modal card editor for `id`. Vetoable via `beforeCardEdit`. */
  editCard(id: RecordId): this {
    const card = this.store.getById(id);
    if (!card) return this;
    if (this.emit('beforeCardEdit', { board: this, card }) === false) return this;
    openCardEditor(this, card, (changes) => this.applyCardEdit(id, changes));
    return this;
  }

  /** Apply edited fields to a card and emit `cardEdit`. */
  applyCardEdit(id: RecordId, changes: Partial<KanbanCard>): this {
    const existing = this.store.getById(id);
    // Snapshot the prior values of the fields we're about to change (for undo).
    const before: Partial<KanbanCard> = {};
    if (existing) {
      for (const key of Object.keys(changes) as Array<keyof KanbanCard>) {
        (before as Record<string, unknown>)[key as string] = existing[key];
      }
    }
    const prev = this.applying;
    this.applying = true;
    let updated: KanbanCard | undefined;
    try {
      updated = this.store.update(id, changes);
    } finally {
      this.applying = prev;
    }
    if (updated) {
      if (existing) {
        this.recordHistory({
          kind: 'cards',
          cards: [{ id, before, after: { ...changes } }],
        });
      }
      this.pushSync({ action: 'update', id, card: { ...changes } });
      this.renderBodies();
      this.emit('cardEdit', { board: this, card: updated, changes });
    }
    return this;
  }

  /** Toggle a card's vote (count ±1 + `voted` flag). Recorded for undo + synced. */
  toggleVote(id: RecordId): this {
    const card = this.store.getById(id);
    if (!card) return this;
    const cur = card.votes ?? { count: 0, voted: false };
    const voted = !cur.voted;
    const count = Math.max(0, cur.count + (voted ? 1 : -1));
    return this.applyCardEdit(id, { votes: { count, voted } });
  }

  /** Start inline quick-edit of a card title in place. */
  quickEditCard(id: RecordId): this {
    const cardEl = this.el.querySelector<HTMLElement>(`.jects-kanban-card[data-card="${cssEscape(String(id))}"]`);
    const titleEl = cardEl?.querySelector<HTMLElement>('.jects-kanban-card__title');
    const card = this.store.getById(id);
    if (!cardEl || !card) return this;

    const input = createEl('input', {
      className: 'jects-kanban-card__quick-edit',
      attrs: { type: 'text', 'aria-label': 'Edit title' },
    }) as HTMLInputElement;
    input.value = String(card.title ?? '');

    const commit = (save: boolean): void => {
      input.removeEventListener('keydown', onKey);
      input.removeEventListener('blur', onBlur);
      if (save && input.value !== String(card.title ?? '')) {
        this.applyCardEdit(id, { title: input.value });
      } else {
        this.renderBodies();
      }
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        commit(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        commit(false);
      }
    };
    const onBlur = (): void => commit(true);
    input.addEventListener('keydown', onKey);
    input.addEventListener('blur', onBlur);

    if (titleEl) titleEl.replaceWith(input);
    else cardEl.prepend(input);
    input.focus();
    input.select();
    return this;
  }

  // ── keyboard ──────────────────────────────────────────────────────────────

  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;

    // Undo/redo (board-level, regardless of focused card). Skipped while typing
    // in a field so native text undo keeps working.
    if (
      this.config.undoRedo &&
      (e.ctrlKey || e.metaKey) &&
      !target.closest('input, textarea, select, [contenteditable="true"]')
    ) {
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.undo();
        return;
      }
      if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        this.redo();
        return;
      }
    }

    const cardEl = this.cardElFor(target);
    if (!cardEl) return;
    const id = this.idForCard(cardEl);
    if (id == null) return;

    const isArrow =
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight';

    // Keyboard MOVE: Ctrl/Cmd + Arrow relocates the card itself (WCAG 2.1.1),
    // giving keyboard + screen-reader users the board's primary action without
    // a pointer. Left/Right cross columns; Up/Down reorder within a column.
    if (isArrow && (e.ctrlKey || e.metaKey) && this.config.draggable !== false) {
      e.preventDefault();
      this.keyboardMove(id, e.key);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const card = this.store.getById(id);
      if (card) {
        this.emit('cardActivate', { board: this, card });
        if (this.config.editable) this.editCard(id);
      }
    } else if (e.key === 'F2') {
      e.preventDefault();
      this.quickEditCard(id);
    } else if (e.key === ' ') {
      e.preventDefault();
      this.selectCard(id, e.ctrlKey || e.metaKey || e.shiftKey);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      this.moveFocus(cardEl, e.key === 'ArrowDown' ? 1 : -1);
    }
  }

  /**
   * Move a card with the keyboard, enforcing the same WIP/lock/veto rules as a
   * pointer drag (via moveCard → commitMove), then restore focus to the moved
   * card and announce the result to assistive tech.
   */
  private keyboardMove(id: RecordId, key: string): void {
    const card = this.store.getById(id);
    if (!card) return;
    if (this.columnState.get(card.column)?.locked) return;

    const lane = this.lanes.length > 0 ? (card.lane ?? this.lanes[0]?.id) : undefined;

    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      // Cross to the previous/next (non-collapsed, unlocked) column at the same
      // vertical index.
      const fromIdx = this.columns.findIndex((c) => c.id === card.column);
      if (fromIdx < 0) return;
      const dir = key === 'ArrowRight' ? 1 : -1;
      let targetIdx = fromIdx + dir;
      while (targetIdx >= 0 && targetIdx < this.columns.length) {
        const col = this.columns[targetIdx];
        if (col && !this.columnState.get(col.id)?.locked) break;
        targetIdx += dir;
      }
      const targetCol = this.columns[targetIdx];
      if (!targetCol) {
        this.announce(`${cardAccessibleLabel(card)} is at the edge of the board.`);
        return;
      }
      const order = this.cardsIn(card.column, lane).findIndex((c) => c.id === id);
      const index = clamp(order < 0 ? 0 : order, 0, this.cardsIn(targetCol.id, lane).length);
      const before = this.store.getById(id)?.column;
      this.moveCard(id, { column: targetCol.id, lane, index });
      const after = this.store.getById(id)?.column;
      if (after === before) {
        // Rejected (e.g. strict WIP limit).
        this.announce(
          `${cardAccessibleLabel(card)} could not move to ${targetCol.title ?? String(targetCol.id)} (column full).`,
        );
      } else {
        this.announce(`${cardAccessibleLabel(card)} moved to ${targetCol.title ?? String(targetCol.id)}.`);
      }
    } else {
      // Reorder within the current column.
      const siblings = this.cardsIn(card.column, lane);
      const pos = siblings.findIndex((c) => c.id === id);
      if (pos < 0) return;
      const dir = key === 'ArrowDown' ? 1 : -1;
      const nextPos = pos + dir;
      if (nextPos < 0 || nextPos >= siblings.length) {
        this.announce(`${cardAccessibleLabel(card)} is at the edge of the column.`);
        return;
      }
      this.moveCard(id, { column: card.column, lane, index: nextPos });
      this.announce(`${cardAccessibleLabel(card)} moved to position ${nextPos + 1}.`);
    }

    // Restore focus to the moved card (renderBodies rebuilt the elements).
    requestAnimationFrame(() => {
      if (this.isDestroyed) return;
      const moved = this.el.querySelector<HTMLElement>(
        `.jects-kanban-card[data-card="${cssEscape(String(id))}"]`,
      );
      moved?.focus();
    });
  }

  private moveFocus(from: HTMLElement, dir: 1 | -1): void {
    const cards = [...this.el.querySelectorAll<HTMLElement>('.jects-kanban-card')];
    const idx = cards.indexOf(from);
    const next = cards[idx + dir];
    if (next) next.focus();
  }

  // ── pointer / drag-and-drop ───────────────────────────────────────────────

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;

    // Ignore interactive controls.
    if (target.closest('button, input, a, [data-toggle]')) return;

    // Column-header reorder drag.
    const handle = target.closest<HTMLElement>('[data-col-handle]');
    if (handle && this.config.columnReorder && !this.cardElFor(target)) {
      this.startColumnDrag(e, handle);
      return;
    }

    const cardEl = this.cardElFor(target);
    if (!cardEl) return;
    const id = this.idForCard(cardEl);
    if (id == null) return;
    const card = this.store.getById(id);
    if (!card) return;

    // Selection (ctrl/meta/shift = additive).
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!this.selected.has(id) || !additive) {
      this.selectCard(id, additive);
    }

    if (!this.config.draggable) return;
    const fromCol = this.columnDef(card.column);
    const fromLocked = this.columnState.get(card.column)?.locked;
    if (fromLocked || (fromCol && this.columnState.get(fromCol.id)?.locked)) return;

    // Begin a (possibly multi-card) card drag.
    const ids = this.selected.has(id) && this.selected.size > 1 ? [...this.selected] : [id];
    const pointerId = e.pointerId;
    const onMove = (ev: PointerEvent): void => this.onPointerMove(ev);
    const onUp = (ev: PointerEvent): void => {
      // Remove listeners + release capture before handling the up so a torn-down
      // board (destroy mid-drag) never leaves these bound to a detached cardEl.
      this.drag?.unbind();
      this.onPointerUp(ev);
    };
    // A single idempotent unbinder, also invoked by destroy() if a drag is live.
    let unbound = false;
    const unbind = (): void => {
      if (unbound) return;
      unbound = true;
      cardEl.removeEventListener('pointermove', onMove);
      cardEl.removeEventListener('pointerup', onUp);
      cardEl.removeEventListener('pointercancel', onUp);
      try {
        cardEl.releasePointerCapture?.(pointerId);
      } catch {
        /* capture may already be gone */
      }
    };
    const isTouch = e.pointerType === 'touch';
    this.drag = {
      pointerId,
      pointerType: e.pointerType,
      ids,
      from: { column: card.column, lane: card.lane },
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      // Mouse/pen drag immediately; touch must wait out the long-press hold.
      longPressReady: !isTouch,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      cardEl,
      unbind,
    };
    cardEl.setPointerCapture?.(pointerId);
    cardEl.addEventListener('pointermove', onMove);
    cardEl.addEventListener('pointerup', onUp);
    cardEl.addEventListener('pointercancel', onUp);

    // Touch: arm a long-press. When it fires the card "lifts" (drag becomes
    // available + a visual affordance is shown) without the user moving yet.
    if (isTouch) {
      cardEl.classList.add('jects-kanban-card--press');
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = undefined;
        if (this.drag && this.drag.pointerId === pointerId) {
          this.drag.longPressReady = true;
          cardEl.classList.remove('jects-kanban-card--press');
          cardEl.classList.add('jects-kanban-card--lifted');
        }
      }, LONGPRESS_MS);
    }
  }

  /** Clear an armed long-press timer + its visual affordance classes. */
  private clearLongPress(cardEl?: HTMLElement): void {
    if (this.longPressTimer != null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = undefined;
    }
    const el = cardEl ?? this.drag?.cardEl;
    el?.classList.remove('jects-kanban-card--press', 'jects-kanban-card--lifted');
  }

  private onPointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    d.lastClientX = e.clientX;
    d.lastClientY = e.clientY;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.startX) < 4 && Math.abs(e.clientY - d.startY) < 4) return;
      // Touch: a move BEFORE the long-press fires is a scroll gesture, not a
      // drag — cancel the pending lift and let the page scroll naturally.
      if (!d.longPressReady) {
        this.clearLongPress(d.cardEl);
        this.drag?.unbind();
        this.drag = undefined;
        return;
      }
      d.moved = true;
      // Stop the page from scrolling now that a real card drag is underway.
      e.preventDefault();
      this.beginGhost(d, e);
      this.el.classList.add('jects-kanban--dragging');
    }
    e.preventDefault();
    this.updateDropTarget(d, e);
    if (d.ghost) {
      d.ghost.style.left = `${e.clientX}px`;
      d.ghost.style.top = `${e.clientY}px`;
    }
    if (this.config.autoScroll) this.maybeAutoScroll();
  }

  private beginGhost(d: DragState, e: PointerEvent): void {
    const ghost = createEl('div', { className: 'jects-kanban__ghost' });
    const firstId = d.ids[0];
    ghost.textContent =
      d.ids.length > 1
        ? `${d.ids.length} cards`
        : String((firstId != null ? this.store.getById(firstId)?.title : '') ?? '');
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    document.body.appendChild(ghost);
    d.ghost = ghost;

    const ph = createEl('div', { className: 'jects-kanban__placeholder' });
    d.placeholder = ph;
  }

  private updateDropTarget(d: DragState, e: PointerEvent): void {
    const body = this.bodyAtPoint(e.clientX, e.clientY);
    if (!body) {
      d.placeholder?.remove();
      d.target = undefined;
      return;
    }
    const colId = this.idForEl(body.getAttribute('data-col'));
    const laneId = this.idForEl(body.getAttribute('data-lane'));
    if (colId == null) return;
    if (this.columnState.get(colId)?.locked) {
      d.placeholder?.remove();
      d.target = undefined;
      return;
    }

    // Determine insertion index by Y against existing (non-dragged) cards.
    const cards = [...body.querySelectorAll<HTMLElement>('.jects-kanban-card')].filter(
      (c) => {
        const id = this.idForCard(c);
        return id != null && !d.ids.includes(id);
      },
    );
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const cardEl = cards[i];
      if (!cardEl) continue;
      const rect = cardEl.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    d.target = { column: colId, lane: laneId, index };

    // Position placeholder.
    if (d.placeholder) {
      const empty = body.querySelector('.jects-kanban-col__empty');
      empty?.remove();
      const before = cards[index];
      if (index >= cards.length || !before) body.appendChild(d.placeholder);
      else body.insertBefore(d.placeholder, before);
    }
  }

  private bodyAtPoint(x: number, y: number): HTMLElement | null {
    // `elementsFromPoint` is absent under jsdom; fall back to a geometric hit
    // test over the rendered bodies so drag still resolves a drop target.
    if (typeof document.elementsFromPoint === 'function') {
      const els = document.elementsFromPoint(x, y);
      for (const el of els) {
        const body = (el as HTMLElement).closest?.('.jects-kanban-col__body');
        if (body && this.el.contains(body)) return body as HTMLElement;
      }
      return null;
    }
    const bodies = this.el.querySelectorAll<HTMLElement>('.jects-kanban-col__body');
    for (const body of bodies) {
      const r = body.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return body;
    }
    return null;
  }

  /**
   * Auto-scroll near edges while dragging. Horizontally scrolls the board's
   * column scroller; vertically scrolls the scrollable column/lane body under
   * the pointer (so long columns and swimlanes can be reached on touch + mouse).
   */
  private maybeAutoScroll(): void {
    const d = this.drag;
    if (!d) return;
    const x = d.lastClientX;
    const y = d.lastClientY;

    // Horizontal (whole board).
    const rect = this.scroller.getBoundingClientRect();
    let dx = 0;
    if (x < rect.left + AUTOSCROLL_EDGE) dx = -AUTOSCROLL_SPEED;
    else if (x > rect.right - AUTOSCROLL_EDGE) dx = AUTOSCROLL_SPEED;

    // Vertical (column/lane body under the pointer).
    const body = this.bodyAtPoint(x, y);
    let dy = 0;
    if (body) {
      const brect = body.getBoundingClientRect();
      if (y < brect.top + AUTOSCROLL_EDGE) dy = -AUTOSCROLL_SPEED;
      else if (y > brect.bottom - AUTOSCROLL_EDGE) dy = AUTOSCROLL_SPEED;
    }

    if (dx === 0 && dy === 0) {
      if (d.rafScroll) {
        cancelAnimationFrame(d.rafScroll);
        d.rafScroll = undefined;
      }
      return;
    }
    if (d.rafScroll) return;
    const step = (): void => {
      if (!this.drag) return;
      if (dx !== 0) this.scroller.scrollLeft += dx;
      if (dy !== 0 && body) body.scrollTop += dy;
      this.drag.rafScroll = requestAnimationFrame(step);
    };
    d.rafScroll = requestAnimationFrame(step);
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.clearLongPress(d.cardEl);
    this.drag = undefined;
    this.el.classList.remove('jects-kanban--dragging');
    if (d.rafScroll) cancelAnimationFrame(d.rafScroll);
    d.ghost?.remove();
    d.placeholder?.remove();

    if (!d.moved || !d.target) {
      this.renderBodies();
      return;
    }
    this.commitMove(d.ids, d.from, d.target);
  }

  /** Apply a card move/reorder, enforcing WIP limits and emitting events. */
  private commitMove(
    ids: RecordId[],
    from: { column: RecordId; lane?: RecordId | undefined },
    to: CardDropTarget,
  ): void {
    const cards = ids
      .map((id) => this.store.getById(id))
      .filter((c): c is KanbanCard => c != null);
    if (cards.length === 0) return;

    const targetDef = this.columnDef(to.column);
    const crossingColumn = cards.some((c) => c.column !== to.column);

    // WIP limit enforcement (only when entering a different column or growing it).
    if (targetDef?.limit != null && crossingColumn) {
      const incoming = cards.filter((c) => c.column !== to.column).length;
      const projected = this.columnCount(to.column) + incoming;
      if (projected > targetDef.limit) {
        if (targetDef.strictLimit) {
          this.emit('limitReject', { board: this, column: to.column, limit: targetDef.limit });
          this.renderBodies();
          return;
        }
      }
    }

    if (this.emit('beforeCardMove', { board: this, cards, from, to }) === false) {
      this.renderBodies();
      return;
    }

    // Compute the target sibling order, excluding the moving cards.
    const siblings = this.cardsIn(to.column, to.lane).filter((c) => !ids.includes(c.id));
    const insertAt = clamp(to.index, 0, siblings.length);

    // Build the new ordered id list for the target group.
    const movingOrdered = ids
      .map((id) => this.store.getById(id))
      .filter((c): c is KanbanCard => c != null);
    const newGroup = [
      ...siblings.slice(0, insertAt),
      ...movingOrdered,
      ...siblings.slice(insertAt),
    ];

    // Reassign column/lane + dense order indices. Guard against the store's
    // per-update 'change' triggering an intermediate renderBodies() that would
    // read a transient, partially-reassigned state (and storm N renders).
    // Capture before/after snapshots per touched card for the undo stack and
    // collect the sync ops to push to the provider once the loop completes.
    const histCards: NonNullable<HistoryEntry['cards']> = [];
    const syncOps: CardSyncOp[] = [];
    const prev = this.applying;
    this.applying = true;
    try {
      newGroup.forEach((card, i) => {
        const patch: Partial<KanbanCard> = { order: i };
        if (card.column !== to.column) patch.column = to.column;
        if (this.lanes.length > 0 && card.lane !== to.lane) patch.lane = to.lane;
        const before: Partial<KanbanCard> = { order: card.order ?? i };
        if ('column' in patch) before.column = card.column;
        if ('lane' in patch) before.lane = card.lane;
        histCards.push({ id: card.id, before, after: { ...patch } });
        syncOps.push({ action: 'update', id: card.id, card: { ...patch } });
        this.store.update(card.id, patch);
      });
    } finally {
      this.applying = prev;
    }

    if (histCards.length > 0) this.recordHistory({ kind: 'cards', cards: histCards });
    for (const op of syncOps) this.pushSync(op);

    this.renderBodies();
    this.emit('cardMove', { board: this, cards, from, to });
  }

  // ── column drag (reorder) ─────────────────────────────────────────────────

  private startColumnDrag(e: PointerEvent, handle: HTMLElement): void {
    const id = this.idForEl(handle.getAttribute('data-col-handle'));
    if (id == null) return;
    if (this.columnState.get(id)?.locked) return;
    const onMove = (ev: PointerEvent): void => {
      if (!this.colDrag) return;
      if (!this.colDrag.moved && Math.abs(ev.clientX - this.colDrag.startX) < 6) return;
      this.colDrag.moved = true;
    };
    const onUp = (ev: PointerEvent): void => {
      const cd = this.colDrag;
      this.colDrag = undefined;
      cd?.unbind();
      if (!cd || !cd.moved) return;
      const overCol = (ev.target as HTMLElement)?.closest?.<HTMLElement>('.jects-kanban-col');
      const overId = overCol ? this.idForEl(overCol.getAttribute('data-col')) : undefined;
      if (overId != null && overId !== cd.id) {
        const toIndex = this.columns.findIndex((c) => c.id === overId);
        if (toIndex >= 0) this.moveColumn(cd.id, toIndex);
      }
    };
    // Idempotent unbinder — also invoked by destroy() if a column drag is live,
    // so the document-level listeners can never outlive the board.
    let unbound = false;
    const unbind = (): void => {
      if (unbound) return;
      unbound = true;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    this.colDrag = { id, startX: e.clientX, moved: false, unbind };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  // ── public API ────────────────────────────────────────────────────────────

  /** Current selected card ids. */
  getSelection(): RecordId[] {
    return [...this.selected];
  }

  /** Replace the selection. */
  setSelection(ids: RecordId[]): this {
    this.selected = new Set(ids);
    this.applySelectionClasses();
    this.emit('selectionChange', { board: this, ids: [...this.selected] });
    return this;
  }

  /** Programmatically move a card to a column/lane at an index. */
  moveCard(id: RecordId, to: CardDropTarget): this {
    const card = this.store.getById(id);
    if (!card) return this;
    this.commitMove([id], { column: card.column, lane: card.lane }, to);
    return this;
  }

  /** Add a card to a column (appended). Returns the stored card. */
  addCard(card: KanbanCard): KanbanCard | undefined {
    const order = this.cardsIn(card.column, card.lane).length;
    const prev = this.applying;
    this.applying = true;
    let stored: KanbanCard | undefined;
    try {
      [stored] = this.store.add({ order, ...card });
    } finally {
      this.applying = prev;
    }
    if (stored) this.pushSync({ action: 'add', id: stored.id, card: { ...stored } });
    this.renderBodies();
    return stored;
  }

  /** Set/clear the search query programmatically. */
  setQuery(q: string): this {
    this.query = q.trim().toLowerCase();
    if (this.searchInput) this.searchInput.value = q;
    this.renderBodies();
    return this;
  }

  // ── toolbar sort ──────────────────────────────────────────────────────────

  /**
   * Set the field cards are ordered by within columns. `order` restores the
   * manual drag order; any other field overrides it (priority/title/votes/due).
   * Re-selecting the same field toggles ascending/descending.
   */
  setSortField(field: SortField): this {
    if (field === this.sortField && field !== 'order') {
      this.sortDir = this.sortDir === 1 ? -1 : 1;
    } else {
      this.sortField = field;
      this.sortDir = 1;
    }
    if (this.sortSelect && this.sortSelect.value !== field) this.sortSelect.value = field;
    this.renderBodies();
    return this;
  }

  /** The active sort field. */
  getSortField(): SortField {
    return this.sortField;
  }

  // ── toolbar filter ────────────────────────────────────────────────────────

  /** Toggle a toolbar filter (by its {@link BoardFilterDef.id}) on/off. */
  toggleFilter(id: string): this {
    if (this.activeFilters.has(id)) this.activeFilters.delete(id);
    else this.activeFilters.add(id);
    this.syncFilterButtons();
    this.renderBodies();
    return this;
  }

  /** Replace the active filter set. */
  setFilters(ids: string[]): this {
    this.activeFilters = new Set(ids);
    this.syncFilterButtons();
    this.renderBodies();
    return this;
  }

  /** Active filter ids. */
  getActiveFilters(): string[] {
    return [...this.activeFilters];
  }

  private syncFilterButtons(): void {
    const btns = this.el.querySelectorAll<HTMLElement>('[data-filter]');
    btns.forEach((btn) => {
      const id = btn.getAttribute('data-filter');
      const on = id != null && this.activeFilters.has(id);
      btn.classList.toggle('jects-kanban__filter--on', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }

  // ── undo / redo ───────────────────────────────────────────────────────────

  /** Record a reversible entry (no-op unless `undoRedo` is enabled). */
  private recordHistory(entry: HistoryEntry): void {
    if (!this.config.undoRedo || this.applyingHistory || this.applyingRemote) return;
    this.undoStack.push(entry);
    this.redoStack = [];
    this.emitHistoryChange();
  }

  /** Apply a card-snapshot map (used by undo/redo). */
  private applyCardSnapshots(
    snaps: Array<{ id: RecordId; patch: Partial<KanbanCard> }>,
  ): void {
    const prevApplying = this.applying;
    const prevHistory = this.applyingHistory;
    this.applying = true;
    this.applyingHistory = true;
    try {
      for (const { id, patch } of snaps) this.store.update(id, patch);
    } finally {
      this.applying = prevApplying;
      this.applyingHistory = prevHistory;
    }
    this.renderBodies();
  }

  /** Whether there is an entry to undo. */
  canUndo(): boolean {
    return this.config.undoRedo === true && this.undoStack.length > 0;
  }

  /** Whether there is an entry to redo. */
  canRedo(): boolean {
    return this.config.undoRedo === true && this.redoStack.length > 0;
  }

  /** Undo the most recent recorded mutation. */
  undo(): this {
    const entry = this.undoStack.pop();
    if (!entry) return this;
    this.applyingHistory = true;
    try {
      if (entry.kind === 'columns' && entry.before) {
        this.applyColumnOrder(entry.before);
      } else if (entry.cards) {
        this.applyCardSnapshots(entry.cards.map((c) => ({ id: c.id, patch: c.before })));
      }
    } finally {
      this.applyingHistory = false;
    }
    this.redoStack.push(entry);
    this.emitHistoryChange();
    return this;
  }

  /** Redo the most recently undone mutation. */
  redo(): this {
    const entry = this.redoStack.pop();
    if (!entry) return this;
    this.applyingHistory = true;
    try {
      if (entry.kind === 'columns' && entry.after) {
        this.applyColumnOrder(entry.after);
      } else if (entry.cards) {
        this.applyCardSnapshots(entry.cards.map((c) => ({ id: c.id, patch: c.after })));
      }
    } finally {
      this.applyingHistory = false;
    }
    this.undoStack.push(entry);
    this.emitHistoryChange();
    return this;
  }

  private emitHistoryChange(): void {
    this.emit('historyChange', {
      board: this,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    });
  }

  // ── export ────────────────────────────────────────────────────────────────

  /**
   * Export the board's cards as a string. `json` returns the serialized card
   * array; `csv` returns a header + one row per card (core scalar fields). `png`
   * returns a data-URL when a canvas is available, else falls back to JSON.
   */
  export(options: ExportOptions = {}): string {
    const format = options.format ?? 'json';
    const cards = this.store.serialize();
    if (format === 'csv') return toCsv(cards, this.columns);
    if (format === 'png') return toPngDataUrl(this.el) ?? JSON.stringify(cards, null, 2);
    return JSON.stringify(cards, null, 2);
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    // Tear down the remote subscription (WebSocket) so it can't fire into a torn-
    // down board, and clear any pending long-press timer.
    this.clearLongPress();
    if (this.unsubscribeRemote) {
      try {
        this.unsubscribeRemote();
      } catch {
        /* socket may already be closed */
      }
      this.unsubscribeRemote = undefined;
    }
    // Tear down any in-flight card drag: cancel auto-scroll RAF, remove the
    // pointermove/pointerup/pointercancel listeners on the (possibly detached)
    // cardEl, release pointer capture, and drop the ghost/placeholder. Without
    // unbind() those listeners would survive destroy() holding a live closure
    // over a torn-down board and fire moveCard()/render() against a removed el.
    if (this.drag) {
      if (this.drag.rafScroll) cancelAnimationFrame(this.drag.rafScroll);
      this.drag.unbind();
      this.drag.ghost?.remove();
      this.drag.placeholder?.remove();
      this.drag = undefined;
    }
    // Tear down any in-flight column-header reorder drag: these listeners live on
    // `document`, so leaking them is a genuine global-listener leak.
    if (this.colDrag) {
      this.colDrag.unbind();
      this.colDrag = undefined;
    }
    if (this.ownsStore) this.store?.events.clear();
    super.destroy();
  }
}

/** Numeric component of a sort field's value (NaN-safe; 0 for text fields). */
function sortValue(field: SortField, card: KanbanCard): number {
  switch (field) {
    case 'priority': {
      const p = (card as Record<string, unknown>)['priority'];
      const n = typeof p === 'number' ? p : Number(p);
      return Number.isFinite(n) ? n : 0;
    }
    case 'votes':
      // Higher vote counts sort first by default (negate).
      return -(card.votes?.count ?? 0);
    case 'due': {
      const t = card.due ? Date.parse(card.due) : NaN;
      return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
    }
    default:
      return 0;
  }
}

/** Text tiebreaker for fields that compare as strings (`title`). */
function sortText(field: SortField, a: KanbanCard, b: KanbanCard): number {
  if (field === 'title') {
    return String(a.title ?? '').localeCompare(String(b.title ?? ''));
  }
  return 0;
}

/** CSV-quote a single field value (RFC-4180-ish: wrap + double inner quotes). */
function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Serialize cards to CSV with a fixed header of core scalar fields. */
function toCsv(cards: KanbanCard[], columns: KanbanColumnDef[]): string {
  const colTitle = new Map(columns.map((c) => [String(c.id), c.title ?? String(c.id)]));
  const header = [
    'id',
    'column',
    'columnTitle',
    'lane',
    'order',
    'title',
    'description',
    'assignee',
    'due',
    'progress',
    'tags',
    'votes',
    'attachments',
    'comments',
  ];
  const rows = cards.map((c) =>
    [
      c.id,
      c.column,
      colTitle.get(String(c.column)) ?? '',
      c.lane ?? '',
      c.order ?? '',
      c.title ?? '',
      c.description ?? '',
      c.assignee ?? '',
      c.due ?? '',
      c.progress ?? '',
      (c.tags ?? []).map((t) => t.text).join('; '),
      c.votes?.count ?? '',
      (c.attachments ?? []).length,
      (c.comments ?? []).length,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}

/**
 * Best-effort PNG snapshot. The DOM isn't directly rasterizable without an
 * SVG/foreignObject round-trip, so we draw a minimal labeled canvas as a print/
 * image fallback. Returns `undefined` when no canvas is available (e.g. jsdom),
 * letting `export` fall back to JSON.
 */
function toPngDataUrl(el: HTMLElement): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  if (typeof canvas.toDataURL !== 'function') return undefined;
  const rect = el.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width) || 1024);
  canvas.height = Math.max(1, Math.round(rect.height) || 768);
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.font = '14px sans-serif';
  ctx.fillText('Task board export', 12, 24);
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return undefined;
  }
}

/** Minimal CSS.escape fallback for attribute selectors (ids are simple). */
function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/["\\\]]/g, '\\$&');
}

register(
  'taskboard',
  TaskBoard as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => TaskBoard,
);
