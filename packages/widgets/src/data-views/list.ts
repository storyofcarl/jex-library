/**
 * List — a virtualized, single-column data view bound to a @jects/core `Store`.
 *
 * Uses core `computeWindow` (fixed row height) so only the visible window of
 * rows is in the DOM, making it cheap for very large data sets. Supports
 * selection (single / multi), a custom item template, and keyboard navigation.
 *
 * Mirrors the Button reference pattern: extends `Widget<Config, Events>`,
 * `defaults()/buildEl()/render()`, factory `register`, vetoable `before*`.
 */

import {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  createEl,
  register,
  Store,
  type Model,
  type RecordId,
  computeWindow,
} from '@jects/core';

export type ListSelectionMode = 'single' | 'multi' | 'none';

export interface ListConfig<T extends Model = Model> extends WidgetConfig {
  /** Bound store. If omitted, one is created from `data`. */
  store?: Store<T>;
  /** Inline data (used to build a store when `store` is not supplied). */
  data?: T[];
  /** Field rendered as the row label when no `itemTemplate` is given. Default `'text'`. */
  labelField?: string;
  /** Fixed row height in px (required for virtualization). Default `36`. */
  itemSize?: number;
  /** Viewport height in px. Default `320`. */
  height?: number;
  /** Extra rows rendered beyond the viewport each side. Default `4`. */
  overscan?: number;
  /** Selection behaviour. Default `'single'`. */
  selectionMode?: ListSelectionMode;
  /** Custom row renderer returning trusted HTML (library-controlled). */
  itemTemplate?: (record: T, index: number) => string;
  /** Text shown when the store is empty. Default `'No items'`. */
  emptyText?: string;
  /** Accessible name for the listbox (`aria-label`). Default `'List'`. */
  label?: string;
}

export interface ListEvents<T extends Model = Model> extends WidgetEvents {
  /** Vetoable: return `false` to cancel selection. */
  beforeSelect: { record: T; id: RecordId; index: number; list: List<T> };
  select: { record: T; id: RecordId; index: number; selected: RecordId[]; list: List<T> };
  /** Fired on Enter / double-click. */
  activate: { record: T; id: RecordId; index: number; list: List<T> };
}

export class List<T extends Model = Model> extends Widget<ListConfig<T>, ListEvents<T>> {
  // `declare` so no field initializer is emitted (with useDefineForClassFields a
  // plain `field!` would be re-assigned `undefined` AFTER super() ran render()).
  private declare store: Store<T>;
  private declare viewport: HTMLElement;
  private declare spacer: HTMLElement;
  private declare content: HTMLElement;
  private declare selected: Set<RecordId>;
  // `declare` (no field initializer) so the value is not clobbered back to its
  // initializer AFTER super() runs the first render (useDefineForClassFields).
  // Initialized in initStore() so the active option is valid from first paint —
  // required for a correct aria-activedescendant on the initial render.
  private declare activeIndex: number;

  protected override defaults(): Partial<ListConfig<T>> {
    return {
      labelField: 'text',
      itemSize: 36,
      height: 320,
      overscan: 4,
      selectionMode: 'single',
      emptyText: 'No items',
      label: 'List',
    };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-list' });
    root.setAttribute('role', 'listbox');
    root.tabIndex = 0;

    this.viewport = createEl('div', { className: 'jects-list__viewport' });
    this.spacer = createEl('div', { className: 'jects-list__spacer' });
    this.content = createEl('div', { className: 'jects-list__content' });
    this.spacer.appendChild(this.content);
    this.viewport.appendChild(this.spacer);
    root.appendChild(this.viewport);

    this.viewport.addEventListener('scroll', () => this.renderWindow());
    root.addEventListener('click', (e) => this.handleClick(e as MouseEvent));
    root.addEventListener('dblclick', (e) => this.handleDblClick(e as MouseEvent));
    root.addEventListener('keydown', (e) => this.handleKeydown(e as KeyboardEvent));
    return root;
  }

  protected override render(): void {
    if (!this.store) this.initStore();
    const { height = 320, selectionMode = 'single', label = 'List' } = this.config;
    this.el.className = ['jects-list', this.config.cls ?? ''].filter(Boolean).join(' ');
    this.el.setAttribute('aria-multiselectable', String(selectionMode === 'multi'));
    this.el.setAttribute('aria-label', label);
    this.viewport.style.height = `${height}px`;
    this.renderWindow();
  }

  /** Stable DOM id for the option at `index` (used by aria-activedescendant). */
  private optionId(index: number): string {
    return `${this.id}-opt-${index}`;
  }

  /**
   * Keep DOM focus on the always-present listbox root and point
   * `aria-activedescendant` at the active option. This is the screen-reader
   * focus model that survives virtualization: window re-renders (on scroll or
   * store change) never move browser focus, and the active descendant id stays
   * valid as a reference even on the rare frame where its element is scrolled
   * out of the window.
   */
  private syncActiveDescendant(): void {
    const count = this.store.count;
    if (count === 0) {
      this.el.removeAttribute('aria-activedescendant');
      return;
    }
    this.el.setAttribute('aria-activedescendant', this.optionId(this.activeIndex));
  }

  /** Render only the rows inside the current scroll window. */
  private renderWindow(): void {
    if (!this.store) this.initStore();
    const { itemSize = 36, overscan = 4, labelField = 'text', emptyText = 'No items' } = this.config;
    const count = this.store.count;

    if (count === 0) {
      // An empty `role="listbox"` violates `aria-required-children` (a listbox
      // must contain group/option children). Drop the listbox role while empty
      // and present the message as a status region; restore listbox once
      // options exist.
      this.el.setAttribute('role', 'group');
      // `aria-multiselectable` is not allowed on role=group; only set it on the
      // listbox (restored below once options exist).
      this.el.removeAttribute('aria-multiselectable');
      this.spacer.style.height = '0px';
      this.content.style.transform = 'translateY(0px)';
      this.content.innerHTML = `<div class="jects-list__empty" role="status">${escapeHtml(emptyText)}</div>`;
      this.syncActiveDescendant();
      return;
    }
    this.el.setAttribute('role', 'listbox');
    this.el.setAttribute(
      'aria-multiselectable',
      String((this.config.selectionMode ?? 'single') === 'multi'),
    );

    const win = computeWindow({
      scrollTop: this.viewport.scrollTop,
      viewportHeight: this.viewport.clientHeight || (this.config.height ?? 320),
      itemSize,
      count,
      overscan,
    });

    // Force-render the active row even if it falls outside the computed window,
    // so its element (the aria-activedescendant target) is always present in the
    // DOM. Expanding the contiguous range keeps the translateY(offset) layout
    // valid (offset = startIndex * itemSize).
    const startIndex = Math.max(0, Math.min(win.startIndex, this.activeIndex));
    const endIndex = Math.min(count - 1, Math.max(win.endIndex, this.activeIndex));
    const offset = startIndex * itemSize;

    this.spacer.style.height = `${win.totalSize}px`;
    this.content.style.transform = `translateY(${offset}px)`;

    const rows: string[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      const record = this.store.getAt(i);
      if (!record) continue;
      const id = this.idOf(record);
      const isSelected = this.selected.has(id);
      const isActive = this.activeIndex === i;
      const inner = this.config.itemTemplate
        ? this.config.itemTemplate(record, i)
        : `<span class="jects-list__label">${escapeHtml(String((record as Record<string, unknown>)[labelField] ?? ''))}</span>`;
      // Stable per-option id for aria-activedescendant. DOM focus stays on the
      // listbox root (tabindex=-1 on options), so a window re-render on scroll
      // never moves focus or invalidates the roving-tabindex target.
      rows.push(
        `<div id="${this.optionId(i)}" class="jects-list__item${isSelected ? ' jects-list__item--selected' : ''}${isActive ? ' jects-list__item--active' : ''}"` +
          ` role="option" aria-selected="${isSelected}" data-id="${escapeAttr(String(id))}" data-index="${i}"` +
          ` style="height:${itemSize}px" tabindex="-1">${inner}</div>`,
      );
    }
    this.content.innerHTML = rows.join('');
    this.syncActiveDescendant();
  }

  // ---- store wiring -------------------------------------------------------

  private initStore(): void {
    this.activeIndex = 0;
    this.selected = new Set<RecordId>();
    this.store = this.config.store ?? new Store<T>({ data: this.config.data ?? [] });
    const off = this.store.events.on('change', () => this.renderWindow());
    this.track(off);
  }

  private idOf(record: T): RecordId {
    return (record as Record<string, unknown>)[this.store.idField] as RecordId;
  }

  getStore(): Store<T> {
    if (!this.store) this.initStore();
    return this.store;
  }

  getSelected(): RecordId[] {
    return [...this.selected];
  }

  // ---- interaction --------------------------------------------------------

  private handleClick(event: MouseEvent): void {
    if (!this.store) this.initStore();
    const item = (event.target as HTMLElement).closest<HTMLElement>('.jects-list__item');
    if (!item) return;
    const index = Number(item.dataset['index']);
    this.activeIndex = index;
    this.selectAt(index);
  }

  private handleDblClick(event: MouseEvent): void {
    if (!this.store) this.initStore();
    const item = (event.target as HTMLElement).closest<HTMLElement>('.jects-list__item');
    if (!item) return;
    this.activate(Number(item.dataset['index']));
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.store) this.initStore();
    const count = this.store.count;
    if (!count) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.setActive(Math.min(this.activeIndex + 1, count - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.setActive(Math.max(this.activeIndex - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        this.setActive(0);
        break;
      case 'End':
        event.preventDefault();
        this.setActive(count - 1);
        break;
      case ' ':
        event.preventDefault();
        this.selectAt(this.activeIndex);
        break;
      case 'Enter':
        event.preventDefault();
        this.selectAt(this.activeIndex);
        this.activate(this.activeIndex);
        break;
      default:
        break;
    }
  }

  private setActive(index: number): void {
    this.activeIndex = index;
    const { itemSize = 36 } = this.config;
    // Scroll the active row into view, then re-render the window.
    const top = index * itemSize;
    const bottom = top + itemSize;
    const vp = this.viewport;
    if (top < vp.scrollTop) vp.scrollTop = top;
    else if (bottom > vp.scrollTop + vp.clientHeight) vp.scrollTop = bottom - vp.clientHeight;
    // renderWindow() updates aria-activedescendant. Keep DOM focus on the
    // always-present root (never on an individual option) so virtualizing the
    // active row out of the DOM can never strip focus; the active option is
    // tracked purely via aria-activedescendant.
    this.renderWindow();
    this.el.focus();
  }

  private selectAt(index: number): void {
    const mode = this.config.selectionMode ?? 'single';
    if (mode === 'none') return;
    const record = this.store.getAt(index);
    if (!record) return;
    const id = this.idOf(record);
    if (this.emit('beforeSelect', { record, id, index, list: this }) === false) return;
    if (mode === 'single') {
      this.selected.clear();
      this.selected.add(id);
    } else if (this.selected.has(id)) {
      this.selected.delete(id);
    } else {
      this.selected.add(id);
    }
    this.renderWindow();
    this.emit('select', { record, id, index, selected: [...this.selected], list: this });
  }

  private activate(index: number): void {
    const record = this.store.getAt(index);
    if (!record) return;
    this.emit('activate', { record, id: this.idOf(record), index, list: this });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

register(
  'list',
  List as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => List,
);
