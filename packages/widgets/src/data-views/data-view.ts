/**
 * DataView — templated cards laid out in a responsive grid, bound to a
 * @jects/core `Store`. Each record is rendered by a card template; the grid
 * reflows by a configurable minimum column width. Supports selection and an
 * empty state.
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
  escape as escapeHtml,
  sanitizeHtml,
} from '@jects/core';

export type DataViewSelectionMode = 'single' | 'multi' | 'none';

export interface DataViewConfig<T extends Model = Model> extends WidgetConfig {
  /** Bound store. If omitted, one is created from `data`. */
  store?: Store<T>;
  /** Inline data (used to build a store when `store` is not supplied). */
  data?: T[];
  /** Field rendered as a card title when no `cardTemplate` is given. Default `'text'`. */
  titleField?: string;
  /**
   * Custom card renderer returning HTML. Sanitized through the shared
   * `@jects/core` allow-list sanitizer before insertion unless `trusted: true`.
   * Authors interpolating record values into the markup should escape them with
   * the exported `escape()` helper.
   */
  cardTemplate?: (record: T, index: number) => string;
  /** Minimum card width in px for the responsive grid. Default `200`. */
  minCardWidth?: number;
  /** Gap between cards in px. Default `12`. */
  gap?: number;
  /** Selection behaviour. Default `'single'`. */
  selectionMode?: DataViewSelectionMode;
  /** Plain-text message shown when the store is empty. Always escaped. Default `'No items'`. */
  emptyText?: string;
  /**
   * HTML for the empty state (used instead of `emptyText`). Sanitized through
   * the shared `@jects/core` sanitizer unless `trusted: true`.
   */
  emptyHtml?: string;
  /** Opt out of HTML sanitization for `emptyHtml` / `cardTemplate` output. Default `false`. */
  trusted?: boolean;
  /** Accessible name for the listbox (`aria-label`). Default `'Items'`. */
  label?: string;
}

export interface DataViewEvents<T extends Model = Model> extends WidgetEvents {
  /** Vetoable: return `false` to cancel selection. */
  beforeSelect: { record: T; id: RecordId; index: number; view: DataView<T> };
  select: { record: T; id: RecordId; index: number; selected: RecordId[]; view: DataView<T> };
  /** Fired on Enter / double-click of a card. */
  activate: { record: T; id: RecordId; index: number; view: DataView<T> };
}

export class DataView<T extends Model = Model> extends Widget<DataViewConfig<T>, DataViewEvents<T>> {
  // `declare` so no field initializer is emitted (with useDefineForClassFields a
  // plain `field!` would be re-assigned `undefined` AFTER super() ran render()).
  private declare store: Store<T>;
  private declare grid: HTMLElement;
  private declare selected: Set<RecordId>;
  private activeIndex = 0;

  protected override defaults(): Partial<DataViewConfig<T>> {
    return {
      titleField: 'text',
      minCardWidth: 200,
      gap: 12,
      selectionMode: 'single',
      emptyText: 'No items',
      label: 'Items',
    };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', { className: 'jects-dataview' });
    root.setAttribute('role', 'listbox');
    root.tabIndex = 0;
    this.grid = createEl('div', { className: 'jects-dataview__grid' });
    root.appendChild(this.grid);

    root.addEventListener('click', (e) => this.handleClick(e as MouseEvent));
    root.addEventListener('dblclick', (e) => this.handleDblClick(e as MouseEvent));
    root.addEventListener('keydown', (e) => this.handleKeydown(e as KeyboardEvent));
    return root;
  }

  protected override render(): void {
    if (!this.store) this.initStore();
    const {
      minCardWidth = 200,
      gap = 12,
      titleField = 'text',
      selectionMode = 'single',
      emptyText = 'No items',
      label = 'Items',
    } = this.config;

    this.el.className = ['jects-dataview', this.config.cls ?? ''].filter(Boolean).join(' ');
    this.el.setAttribute('aria-label', label);
    this.grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${minCardWidth}px, 1fr))`;
    this.grid.style.gap = `${gap}px`;

    if (this.store.count === 0) {
      // An empty `role="listbox"` violates `aria-required-children`; drop the
      // listbox role while empty and present a status region instead.
      // `aria-multiselectable` is not allowed on role=group, so remove it too.
      this.el.setAttribute('role', 'group');
      this.el.removeAttribute('aria-multiselectable');
      this.grid.classList.add('jects-dataview__grid--empty');
      const emptyHtml = this.config.emptyHtml;
      // `emptyText` is plain text (escaped); `emptyHtml` is authored markup
      // (sanitized unless trusted). Default to the escaped text message.
      const emptyInner =
        emptyHtml !== undefined
          ? this.config.trusted
            ? emptyHtml
            : sanitizeHtml(emptyHtml)
          : escapeHtml(emptyText);
      this.grid.innerHTML = `<div class="jects-dataview__empty" role="status">${emptyInner}</div>`;
      return;
    }
    this.el.setAttribute('role', 'listbox');
    this.el.setAttribute('aria-multiselectable', String(selectionMode === 'multi'));
    this.grid.classList.remove('jects-dataview__grid--empty');

    const cards = this.store.map((record, index) => {
      const id = this.idOf(record);
      const isSelected = this.selected.has(id);
      const isActive = this.activeIndex === index;
      let inner: string;
      if (this.config.cardTemplate) {
        // Renderer output is authored HTML → sanitized by default; only the
        // explicit `trusted` opt-out injects it raw.
        const tpl = this.config.cardTemplate(record, index);
        inner = this.config.trusted ? tpl : sanitizeHtml(tpl);
      } else {
        inner = `<div class="jects-dataview__title">${escapeHtml(String((record as Record<string, unknown>)[titleField] ?? ''))}</div>`;
      }
      return (
        `<div class="jects-dataview__card${isSelected ? ' jects-dataview__card--selected' : ''}${isActive ? ' jects-dataview__card--active' : ''}"` +
        ` role="option" aria-selected="${isSelected}" data-id="${escapeAttr(String(id))}" data-index="${index}"` +
        ` tabindex="${isActive ? 0 : -1}">${inner}</div>`
      );
    });
    this.grid.innerHTML = cards.join('');
  }

  // ---- store wiring -------------------------------------------------------

  private initStore(): void {
    this.selected = new Set<RecordId>();
    this.store = this.config.store ?? new Store<T>({ data: this.config.data ?? [] });
    const off = this.store.events.on('change', () => this.render());
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
    const card = (event.target as HTMLElement).closest<HTMLElement>('.jects-dataview__card');
    if (!card) return;
    const index = Number(card.dataset['index']);
    this.activeIndex = index;
    this.selectAt(index);
  }

  private handleDblClick(event: MouseEvent): void {
    if (!this.store) this.initStore();
    const card = (event.target as HTMLElement).closest<HTMLElement>('.jects-dataview__card');
    if (!card) return;
    this.activate(Number(card.dataset['index']));
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.store) this.initStore();
    const count = this.store.count;
    if (!count) return;
    const cols = this.columnCount();
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        this.setActive(Math.min(this.activeIndex + 1, count - 1));
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.setActive(Math.max(this.activeIndex - 1, 0));
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.setActive(Math.min(this.activeIndex + cols, count - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.setActive(Math.max(this.activeIndex - cols, 0));
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

  private columnCount(): number {
    const cards = this.grid.querySelectorAll<HTMLElement>('.jects-dataview__card');
    if (cards.length < 2) return 1;
    const firstTop = cards[0]!.offsetTop;
    let cols = 0;
    for (const c of cards) {
      if (c.offsetTop !== firstTop) break;
      cols++;
    }
    return Math.max(1, cols);
  }

  private setActive(index: number): void {
    this.activeIndex = index;
    this.render();
    this.grid
      .querySelector<HTMLElement>(`.jects-dataview__card[data-index="${index}"]`)
      ?.focus();
  }

  private selectAt(index: number): void {
    const mode = this.config.selectionMode ?? 'single';
    if (mode === 'none') return;
    const record = this.store.getAt(index);
    if (!record) return;
    const id = this.idOf(record);
    if (this.emit('beforeSelect', { record, id, index, view: this }) === false) return;
    if (mode === 'single') {
      this.selected.clear();
      this.selected.add(id);
    } else if (this.selected.has(id)) {
      this.selected.delete(id);
    } else {
      this.selected.add(id);
    }
    this.render();
    this.emit('select', { record, id, index, selected: [...this.selected], view: this });
  }

  private activate(index: number): void {
    const record = this.store.getAt(index);
    if (!record) return;
    this.emit('activate', { record, id: this.idOf(record), index, view: this });
  }
}

// The shared `escape()` (imported as `escapeHtml`) already escapes quotes, so it
// is safe for both element text and double-quoted attribute values.
const escapeAttr = escapeHtml;

register(
  'dataview',
  DataView as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => DataView,
);
