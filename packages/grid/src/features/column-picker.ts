/**
 * ColumnPickerFeature — an end-user column chooser panel for @jects/grid.
 *
 * Bryntum/DHTMLX ship a "column picker" (a.k.a. column chooser / columns menu):
 * a popup that lists every column with a checkbox to show/hide it, and — in the
 * enterprise tier — affordances to reorder and pin (freeze) columns. This
 * feature provides exactly that, reusing the @jects/widgets `Checkbox` control
 * for the visibility toggles and plain token-styled buttons for reorder / pin.
 *
 * Design:
 *  - The panel is a light-DOM popup appended to the grid root (mirrors the
 *    context-menu popup host). It is fully keyboard operable: roving focus is
 *    delegated to native controls, Escape closes, an outside pointerdown closes,
 *    and focus is trapped while open.
 *  - All mutation flows through the `ColumnStateFeature` when one is installed
 *    (so order/width/visibility/pin persist), and otherwise falls back to the
 *    `GridApi` column mutators directly — the picker works with or without
 *    persistence.
 *  - Typed config + a typed event surface: `beforeColumnVisibility` is vetoable
 *    (house convention), `columnVisibility` / `columnPin` / `columnMove` notify,
 *    and `pickerOpen` / `pickerClose` bracket the panel lifecycle.
 *
 * Everything the feature creates (popup DOM, Checkbox widgets, document
 * listeners) is released on `destroy()` via the shared `Disposers` bag.
 */

import type { EventMap, Model } from '@jects/core';
import { createEl, EventEmitter } from '@jects/core';
import { Checkbox } from '@jects/widgets';
import type {
  ColumnDef,
  FrozenSide,
  GridApi,
  GridFeature,
} from '../contract.js';
import { Disposers, colId } from './shared.js';
import type { ColumnStateFeature } from './column-state.js';

/** Resolve a column's user-facing header label (falls back to id/field). */
function columnLabel<Row extends Model>(col: ColumnDef<Row>): string {
  if (typeof col.header === 'string' && col.header.trim() !== '') return col.header;
  return colId(col);
}

/** A typed event map for the picker (independent of the grid event bus). */
export interface ColumnPickerEvents extends EventMap {
  /** Vetoable: return `false` to keep the current visibility. */
  beforeColumnVisibility: { columnId: string; visible: boolean };
  /** A column was shown/hidden via the picker. */
  columnVisibility: { columnId: string; visible: boolean };
  /** A column was pinned/unpinned via the picker. */
  columnPin: { columnId: string; frozen: FrozenSide | null };
  /** A column was reordered via the picker. */
  columnMove: { columnId: string; fromIndex: number; toIndex: number };
  /** The panel opened. */
  pickerOpen: Record<string, never>;
  /** The panel closed. */
  pickerClose: Record<string, never>;
}

export interface ColumnPickerFeatureOptions {
  /** Panel heading text. Default `'Columns'`. */
  title?: string;
  /** Show per-row reorder (up/down) controls. Default `true`. */
  reorderable?: boolean;
  /**
   * Show per-row pin controls (cycle none → left → right). Default `true`.
   * Pinning only has an effect if the engine honours `column.frozen`.
   */
  pinnable?: boolean;
  /**
   * Enforce at least one visible column (block hiding the last one). Bryntum
   * does this so the grid is never left empty. Default `true`.
   */
  keepOneVisible?: boolean;
  /**
   * Include a "Show all" / "Hide all" footer action pair. Default `true`.
   */
  bulkActions?: boolean;
  /**
   * Columns whose id is listed here cannot be hidden/moved/pinned by the user
   * (e.g. a selection checkbox column). They still appear, disabled.
   */
  lockedColumns?: string[];
}

export class ColumnPickerFeature<Row extends Model = Model> implements GridFeature<Row> {
  readonly name = 'columnPicker';

  private api!: GridApi<Row>;
  private readonly disposers = new Disposers();
  private readonly events = new EventEmitter<ColumnPickerEvents>();

  private readonly title: string;
  private readonly reorderable: boolean;
  private readonly pinnable: boolean;
  private readonly keepOneVisible: boolean;
  private readonly bulkActions: boolean;
  private readonly locked: ReadonlySet<string>;

  private popup: HTMLElement | null = null;
  private list: HTMLElement | null = null;
  private readonly checkboxes = new Map<string, Checkbox>();
  private outside: ((e: Event) => void) | null = null;
  private trap: ((e: KeyboardEvent) => void) | null = null;
  private offColumnReorder: (() => void) | null = null;

  /**
   * The picker's own ordered view of *all* columns (visible AND hidden), keyed
   * by id. The grid engine drops hidden columns from `api.columns`, so the
   * picker keeps its own model so a hidden column can still be listed and
   * un-hidden. Live state (frozen/width/order) for a still-visible column is
   * always re-read from the grid; entries for currently-hidden columns are
   * remembered here.
   */
  private readonly knownDefs = new Map<string, ColumnDef<Row>>();
  private knownOrder: string[] = [];

  constructor(options: ColumnPickerFeatureOptions = {}) {
    this.title = options.title ?? 'Columns';
    this.reorderable = options.reorderable ?? true;
    this.pinnable = options.pinnable ?? true;
    this.keepOneVisible = options.keepOneVisible ?? true;
    this.bulkActions = options.bulkActions ?? true;
    this.locked = new Set(options.lockedColumns ?? []);
  }

  init(grid: GridApi<Row>): void {
    this.api = grid;
    grid.track(() => this.disposers.dispose());
    this.disposers.add(() => this.close());
    this.disposers.add(() => this.events.clear());

    this.seedModel();

    // A header trigger (a button carrying `data-column-picker`) toggles the panel.
    const onClick = (e: Event): void => this.handleTrigger(e as MouseEvent);
    grid.el.addEventListener('click', onClick);
    this.disposers.add(() => grid.el.removeEventListener('click', onClick));

    // Keep the panel in sync if columns change underneath it (e.g. another
    // feature reorders, or column state is restored).
    this.offColumnReorder = grid.on('columnReorder', () => {
      if (this.popup) this.rebuildList();
    });
    this.disposers.add(() => this.offColumnReorder?.());
  }

  /* ── column model (all columns, incl. hidden) ──────────────────────────── */

  /**
   * Seed the known-column model from the grid. Reads the live visible columns
   * (`api.columns`) plus — when the grid exposes its mount-time config via
   * `getConfig()` (the real engine does) — any columns hidden at mount, so they
   * appear in the panel from the start. Stays within `GridApi` for the data it
   * actually needs; the `getConfig` read is an optional best-effort enrichment.
   */
  private seedModel(): void {
    this.knownDefs.clear();
    this.knownOrder = [];

    // Mount-time defs (may include hidden columns the engine has since dropped).
    const cfgCols = this.configColumns();
    if (cfgCols) {
      for (const def of cfgCols) {
        const id = colId(def);
        if (!id || this.knownDefs.has(id)) continue;
        this.knownDefs.set(id, def);
        this.knownOrder.push(id);
      }
    }

    // Live visible columns take precedence for state + order.
    this.reconcile();
  }

  /** Best-effort read of the grid's configured columns (real engine only). */
  private configColumns(): ReadonlyArray<ColumnDef<Row>> | null {
    const maybe = this.api as unknown as {
      getConfig?: () => { columns?: ColumnDef<Row>[] };
    };
    if (typeof maybe.getConfig === 'function') {
      try {
        const cols = maybe.getConfig().columns;
        if (Array.isArray(cols)) return cols;
      } catch {
        /* not a Grid instance — fall back to live columns */
      }
    }
    return null;
  }

  /**
   * Refresh the known model against the live grid: update state for visible
   * columns, register any newly-appeared visible column, and rebuild the order
   * so visible columns follow the grid's order while hidden columns keep their
   * remembered slot (anchored after their previous visible neighbour).
   */
  private reconcile(): void {
    const live = this.api.columns;
    // Update / register every live (visible) column.
    for (const col of live) {
      const id = colId(col);
      if (!id) continue;
      this.knownDefs.set(id, col);
      if (!this.knownOrder.includes(id)) this.knownOrder.push(id);
    }

    // Recompute order: walk the previous known order, but interleave the live
    // (visible) order to honour reorders. Visible ids are taken in grid order;
    // hidden ids are slotted back at their nearest prior position.
    const liveIds = live.map((c) => colId(c)).filter(Boolean);
    const liveSet = new Set(liveIds);
    const result: string[] = [];
    let liveCursor = 0;
    for (const id of this.knownOrder) {
      if (liveSet.has(id)) {
        // Emit visible columns strictly in grid order.
        while (liveCursor < liveIds.length && !result.includes(liveIds[liveCursor]!)) {
          result.push(liveIds[liveCursor]!);
          liveCursor++;
        }
      } else if (this.knownDefs.has(id) && !result.includes(id)) {
        result.push(id);
      }
    }
    // Append any remaining live ids not yet placed.
    for (; liveCursor < liveIds.length; liveCursor++) {
      if (!result.includes(liveIds[liveCursor]!)) result.push(liveIds[liveCursor]!);
    }
    this.knownOrder = result;
  }

  /** The picker's current ordered column model (visible + hidden). */
  private modelColumns(): ColumnDef<Row>[] {
    this.reconcile();
    const out: ColumnDef<Row>[] = [];
    for (const id of this.knownOrder) {
      const def = this.knownDefs.get(id);
      if (def) out.push(def);
    }
    return out;
  }

  /** Look up a column def by id from the model, then the grid. */
  private modelColumn(id: string): ColumnDef<Row> | undefined {
    return this.api.getColumn(id) ?? this.knownDefs.get(id);
  }

  /* ── typed event surface ───────────────────────────────────────────────── */

  on<K extends keyof ColumnPickerEvents>(
    event: K,
    fn: (payload: ColumnPickerEvents[K]) => unknown,
  ): () => void {
    return this.events.on(event, fn);
  }

  off<K extends keyof ColumnPickerEvents>(
    event: K,
    fn?: (payload: ColumnPickerEvents[K]) => unknown,
  ): void {
    this.events.off(event, fn);
  }

  /* ── public API ────────────────────────────────────────────────────────── */

  /** Whether the picker panel is currently open. */
  isOpen(): boolean {
    return this.popup != null;
  }

  /** Toggle the panel at a screen position (defaults to the grid's top-left). */
  toggle(x?: number, y?: number): void {
    if (this.popup) this.close();
    else this.open(x, y);
  }

  /** Open the panel at a fixed screen position. */
  open(x = 0, y = 0): void {
    this.close();
    const popup = createEl('div', { className: 'jects-grid-colpicker' });
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', this.title);
    popup.style.position = 'fixed';
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;

    const heading = createEl('div', { className: 'jects-grid-colpicker__title' });
    heading.id = `${this.name}-title-${Math.random().toString(36).slice(2, 8)}`;
    heading.textContent = this.title;
    popup.setAttribute('aria-labelledby', heading.id);
    popup.appendChild(heading);

    const list = createEl('div', { className: 'jects-grid-colpicker__list' });
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', this.title);
    popup.appendChild(list);
    this.list = list;

    if (this.bulkActions) {
      const actions = createEl('div', { className: 'jects-grid-colpicker__actions' });
      const showAll = this.actionButton('Show all', () => this.setAllVisible(true));
      const hideAll = this.actionButton('Hide all', () => this.setAllVisible(false));
      actions.append(showAll, hideAll);
      popup.appendChild(actions);
    }

    this.api.el.appendChild(popup);
    this.popup = popup;

    this.rebuildList();
    this.installDismissers(popup);

    // Move focus into the panel for keyboard users.
    const first = popup.querySelector<HTMLElement>('input, button');
    first?.focus();

    this.events.emit('pickerOpen', {});
  }

  /** Close the panel and dispose its widgets/listeners. */
  close(): void {
    if (this.outside) {
      document.removeEventListener('pointerdown', this.outside, true);
      document.removeEventListener('keydown', this.outside, true);
      this.outside = null;
    }
    if (this.trap && this.popup) {
      this.popup.removeEventListener('keydown', this.trap);
      this.trap = null;
    }
    for (const cb of this.checkboxes.values()) cb.destroy();
    this.checkboxes.clear();
    const had = this.popup != null;
    this.popup?.remove();
    this.popup = null;
    this.list = null;
    if (had) this.events.emit('pickerClose', {});
  }

  /** Show or hide a column (honours the vetoable `beforeColumnVisibility`). */
  setColumnVisible(columnId: string, visible: boolean): boolean {
    if (this.locked.has(columnId)) return false;
    if (!visible && this.keepOneVisible && this.visibleCount() <= 1) {
      // Refuse to hide the last visible column.
      this.syncCheckbox(columnId);
      return false;
    }
    if (this.events.emit('beforeColumnVisibility', { columnId, visible }) === false) {
      this.syncCheckbox(columnId);
      return false;
    }
    // Remember the column def before the engine drops a now-hidden column from
    // its live `columns` list, so the picker can still list & un-hide it.
    const before = this.modelColumn(columnId);
    if (before) this.knownDefs.set(columnId, { ...before, hidden: !visible });

    const state = this.columnState();
    if (state) state.setVisible(columnId, visible);
    else this.api.updateColumn(columnId, { hidden: !visible } as Partial<ColumnDef<Row>>);
    this.events.emit('columnVisibility', { columnId, visible });
    // Sync just the toggled checkbox — do NOT rebuild the whole list, so the
    // control the user just interacted with keeps focus and identity.
    this.syncCheckbox(columnId);
    return true;
  }

  /** Pin a column to an edge (or unpin with `null`). */
  setColumnFrozen(columnId: string, frozen: FrozenSide | null): void {
    if (this.locked.has(columnId)) return;
    const before = this.modelColumn(columnId);
    if (before) {
      const next = { ...before };
      if (frozen) next.frozen = frozen;
      else delete next.frozen;
      this.knownDefs.set(columnId, next);
    }
    const state = this.columnState();
    if (state) state.setFrozen(columnId, frozen);
    else this.api.updateColumn(columnId, { frozen: frozen ?? undefined } as Partial<ColumnDef<Row>>);
    this.events.emit('columnPin', { columnId, frozen });
    if (this.popup) this.rebuildList();
  }

  /**
   * Move a column one step toward the start (`-1`) or end (`+1`) within the
   * FULL column model (visible + hidden), then push the reordered full list to
   * the grid. Operating on the full model is important: the engine's
   * `api.columns` omits hidden columns, so reordering off that view would drop
   * them on `setColumns`.
   */
  moveColumn(columnId: string, delta: -1 | 1): void {
    if (this.locked.has(columnId)) return;
    const model = this.modelColumns();
    const from = model.findIndex((c) => colId(c) === columnId);
    if (from < 0) return;
    const to = from + delta;
    if (to < 0 || to >= model.length) return;
    const next = [...model];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);

    // Update the picker's own order first so the model stays authoritative.
    this.knownOrder = next.map((c) => colId(c)).filter(Boolean);
    this.api.setColumns(next);
    this.api.emit('columnReorder', { columnId, fromIndex: from, toIndex: to });
    this.events.emit('columnMove', { columnId, fromIndex: from, toIndex: to });
    if (this.popup) this.rebuildList();
  }

  /** Bulk show/hide every (non-locked) column. */
  setAllVisible(visible: boolean): void {
    const cols = this.modelColumns();
    if (visible) {
      for (const col of cols) {
        const id = colId(col);
        if (id && col.hidden) this.setColumnVisible(id, true);
      }
      return;
    }
    // Hiding: respect keepOneVisible by leaving the first non-locked visible.
    let keptOne = false;
    for (const col of cols) {
      const id = colId(col);
      if (!id || col.hidden) continue;
      if (this.locked.has(id)) continue;
      if (this.keepOneVisible && !keptOne) {
        keptOne = true;
        continue;
      }
      this.setColumnVisible(id, false);
    }
  }

  /* ── internal: panel rendering ─────────────────────────────────────────── */

  private rebuildList(): void {
    const list = this.list;
    if (!list) return;
    for (const cb of this.checkboxes.values()) cb.destroy();
    this.checkboxes.clear();
    list.replaceChildren();

    const cols = this.modelColumns();
    cols.forEach((col, index) => {
      const id = colId(col);
      if (!id) return;
      const row = createEl('div', { className: 'jects-grid-colpicker__row' });
      row.dataset['columnId'] = id;
      const locked = this.locked.has(id);

      // Visibility checkbox (reuses the @jects/widgets Checkbox control).
      const cbHost = createEl('span', { className: 'jects-grid-colpicker__check' });
      const cb = new Checkbox(cbHost, {
        label: columnLabel(col),
        checked: !col.hidden,
        disabled: locked,
      });
      cb.on('change', ({ checked }) => {
        this.setColumnVisible(id, checked);
      });
      this.checkboxes.set(id, cb);
      row.appendChild(cbHost);

      const controls = createEl('span', { className: 'jects-grid-colpicker__controls' });

      if (this.pinnable) {
        const current = col.frozen ?? null;
        const pinBtn = this.iconButton(
          this.pinGlyph(current),
          `Pin ${columnLabel(col)} (${current ?? 'none'})`,
          () => this.setColumnFrozen(id, this.nextPin(current)),
        );
        pinBtn.classList.add('jects-grid-colpicker__pin');
        if (current) pinBtn.classList.add('jects-grid-colpicker__pin--active');
        pinBtn.disabled = locked;
        controls.appendChild(pinBtn);
      }

      if (this.reorderable) {
        const up = this.iconButton('↑', `Move ${columnLabel(col)} up`, () =>
          this.moveColumn(id, -1),
        );
        const down = this.iconButton('↓', `Move ${columnLabel(col)} down`, () =>
          this.moveColumn(id, 1),
        );
        up.disabled = locked || index === 0;
        down.disabled = locked || index === cols.length - 1;
        controls.append(up, down);
      }

      row.appendChild(controls);
      list.appendChild(row);
    });
  }

  private syncCheckbox(columnId: string): void {
    const col = this.modelColumn(columnId);
    const cb = this.checkboxes.get(columnId);
    if (col && cb) cb.update({ checked: !col.hidden });
  }

  private pinGlyph(side: FrozenSide | null): string {
    if (side === 'left') return '◀'; // ◀
    if (side === 'right') return '▶'; // ▶
    return '○'; // ○ (unpinned)
  }

  private nextPin(side: FrozenSide | null): FrozenSide | null {
    if (side == null) return 'left';
    if (side === 'left') return 'right';
    return null;
  }

  private actionButton(text: string, onClick: () => void): HTMLButtonElement {
    const btn = createEl('button', { className: 'jects-grid-colpicker__action' });
    btn.type = 'button';
    btn.textContent = text;
    btn.addEventListener('click', () => onClick());
    return btn;
  }

  private iconButton(glyph: string, ariaLabel: string, onClick: () => void): HTMLButtonElement {
    const btn = createEl('button', { className: 'jects-grid-colpicker__btn' });
    btn.type = 'button';
    btn.textContent = glyph;
    btn.setAttribute('aria-label', ariaLabel);
    btn.addEventListener('click', () => onClick());
    return btn;
  }

  /* ── internal: dismissers + helpers ────────────────────────────────────── */

  private installDismissers(popup: HTMLElement): void {
    const outside = (e: Event): void => {
      if (e.type === 'keydown') {
        if ((e as KeyboardEvent).key === 'Escape') this.close();
        return;
      }
      if (this.popup && this.popup.contains(e.target as Node)) return;
      // Ignore clicks on the trigger (it toggles separately).
      const trigger = (e.target as HTMLElement | null)?.closest?.('[data-column-picker]');
      if (trigger) return;
      this.close();
    };
    this.outside = outside;
    setTimeout(() => {
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', outside, true);
    }, 0);

    // Trap Tab focus within the panel while open.
    const trap = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const focusables = popup.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    this.trap = trap;
    popup.addEventListener('keydown', trap);
  }

  private handleTrigger(event: MouseEvent): void {
    const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-column-picker]');
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.popup) {
      this.close();
      return;
    }
    const rect = trigger.getBoundingClientRect();
    this.open(rect.left, rect.bottom);
  }

  private columnState(): ColumnStateFeature<Row> | undefined {
    return this.api.features.get('columnState') as ColumnStateFeature<Row> | undefined;
  }

  private visibleCount(): number {
    let n = 0;
    for (const col of this.modelColumns()) if (!col.hidden) n++;
    return n;
  }

  destroy(): void {
    this.disposers.dispose();
  }
}

/** Convenience factory. */
export function columnPickerFeature<Row extends Model = Model>(
  options?: ColumnPickerFeatureOptions,
): ColumnPickerFeature<Row> {
  return new ColumnPickerFeature<Row>(options);
}
