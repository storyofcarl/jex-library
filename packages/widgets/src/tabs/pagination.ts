/**
 * Pagination — a page navigator bound to a total item count and page size.
 *
 * Renders first/prev, a windowed list of page buttons with ellipses, then
 * next/last, and an optional page-size selector (reusing the Wave-1 Select).
 * Page numbers are 1-based. Navigation is keyboard-operable: the page list is a
 * group of buttons and ArrowLeft/Right step pages; Home/End jump to first/last.
 *
 * a11y: root is role="navigation" with aria-label; each page button carries
 * aria-label="Page N" and the current page sets aria-current="page".
 *
 * CSS lives in pagination.css (token-only, @layer jects.components).
 */

import { Widget, type WidgetConfig, type WidgetEvents, createEl, register } from '@jects/core';
import { renderIcon } from '@jects/icons';
import { Select } from '../choice/select.js';

export interface PaginationConfig extends WidgetConfig {
  /** Total number of items being paginated. */
  total?: number;
  /** Items per page. Default `10`. */
  pageSize?: number;
  /** Current page (1-based). Default `1`. */
  page?: number;
  /** How many numbered page buttons to keep around the current one. Default `1`. */
  siblingCount?: number;
  /** How many numbered page buttons to pin at each edge. Default `1`. */
  boundaryCount?: number;
  /** Show the first/last jump buttons. Default `true`. */
  showFirstLast?: boolean;
  /** Show the prev/next buttons. Default `true`. */
  showPrevNext?: boolean;
  /** Render a page-size selector with these options. Empty/undefined hides it. */
  pageSizeOptions?: number[];
  /** Accessible label for the navigation landmark. */
  ariaLabel?: string;
  /** Disabled state. */
  disabled?: boolean;
  /** Convenience handler (also via `.on('pageChange', ...)`). */
  onPageChange?: (page: number) => void;
}

export interface PaginationEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel a page change. */
  beforePageChange: { page: number; pagination: Pagination };
  /** Fired after the current page changes. */
  pageChange: { page: number; previous: number; pagination: Pagination };
  /** Fired after the page size changes (page is reset to 1). */
  pageSizeChange: { pageSize: number; pagination: Pagination };
}

/** Sentinel marking an ellipsis gap in the rendered page sequence. */
const GAP = -1;

export class Pagination extends Widget<PaginationConfig, PaginationEvents> {
  // Not a class-field initializer: `super()` runs render() (which may assign
  // this) before subclass field initializers would clobber it.
  private declare _sizeSelect?: Select;

  protected override defaults(): Partial<PaginationConfig> {
    return {
      total: 0,
      pageSize: 10,
      page: 1,
      siblingCount: 1,
      boundaryCount: 1,
      showFirstLast: true,
      showPrevNext: true,
    };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', {
      className: 'jects-pagination',
      attrs: { role: 'navigation' },
    });
    const nav = createEl('div', { className: 'jects-pagination__pages' });
    root.append(nav);
    nav.addEventListener('click', (e) => this.handleClick(e));
    nav.addEventListener('keydown', (e) => this.handleKeydown(e));
    return root;
  }

  // ---- derived geometry ---------------------------------------------------

  get total(): number {
    return Math.max(0, this.config.total ?? 0);
  }

  get pageSize(): number {
    return Math.max(1, this.config.pageSize ?? 10);
  }

  /** Total number of pages (at least 1). */
  get pageCount(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  /** Current page, clamped into [1, pageCount]. */
  get page(): number {
    const p = this.config.page ?? 1;
    return Math.min(Math.max(1, Math.trunc(p)), this.pageCount);
  }

  // ---- navigation ---------------------------------------------------------

  /** Go to a specific 1-based page (clamped). Vetoable; fires pageChange. */
  goTo(page: number): this {
    if (this.config.disabled) return this;
    const next = Math.min(Math.max(1, Math.trunc(page)), this.pageCount);
    const previous = this.page;
    if (next === previous) return this;
    if (this.emit('beforePageChange', { page: next, pagination: this }) === false) return this;
    this.config = { ...this.config, page: next };
    this.render();
    this.config.onPageChange?.(next);
    this.emit('pageChange', { page: next, previous, pagination: this });
    return this;
  }

  next(): this {
    return this.goTo(this.page + 1);
  }
  prev(): this {
    return this.goTo(this.page - 1);
  }
  first(): this {
    return this.goTo(1);
  }
  last(): this {
    return this.goTo(this.pageCount);
  }

  /** Change page size; resets to page 1 and fires pageSizeChange. */
  setPageSize(size: number): this {
    const next = Math.max(1, Math.trunc(size));
    if (next === this.pageSize) return this;
    this.config = { ...this.config, pageSize: next, page: 1 };
    this.render();
    this.emit('pageSizeChange', { pageSize: next, pagination: this });
    return this;
  }

  /**
   * Build the page sequence: boundary pages, sibling window around current, and
   * GAP sentinels where pages are skipped.
   */
  pageItems(): number[] {
    const count = this.pageCount;
    const boundary = Math.max(0, this.config.boundaryCount ?? 1);
    const sibling = Math.max(0, this.config.siblingCount ?? 1);
    const current = this.page;

    // Minimum count where no ellipsis is needed: boundaries on both ends,
    // the current page + its siblings, and the two gap slots.
    const totalToShow = boundary * 2 + sibling * 2 + 3 + 2;
    if (count <= totalToShow) {
      return range(1, count);
    }

    const startPages = range(1, boundary);
    const endPages = range(count - boundary + 1, count);

    const siblingStart = Math.max(
      Math.min(current - sibling, count - boundary - sibling * 2 - 1),
      boundary + 2,
    );
    const siblingEnd = Math.min(
      Math.max(current + sibling, boundary + sibling * 2 + 2),
      endPages.length > 0 ? endPages[0]! - 2 : count - 1,
    );

    const items: number[] = [...startPages];
    // Left gap or the single page bridging boundary → sibling window.
    if (siblingStart > boundary + 2) items.push(GAP);
    else if (boundary + 1 < count - boundary) items.push(boundary + 1);

    items.push(...range(siblingStart, siblingEnd));

    // Right gap or the single bridging page.
    if (siblingEnd < count - boundary - 1) items.push(GAP);
    else if (count - boundary > boundary) items.push(count - boundary);

    items.push(...endPages);
    return items;
  }

  // ---- interaction --------------------------------------------------------

  private handleClick(e: MouseEvent): void {
    const btn = (e.target as Element | null)?.closest('[data-action]') as HTMLElement | null;
    if (!btn || btn.hasAttribute('disabled')) return;
    const action = btn.dataset.action;
    switch (action) {
      case 'first':
        this.first();
        break;
      case 'prev':
        this.prev();
        break;
      case 'next':
        this.next();
        break;
      case 'last':
        this.last();
        break;
      case 'page': {
        const p = Number(btn.dataset.page);
        if (Number.isFinite(p)) this.goTo(p);
        break;
      }
      default:
        break;
    }
  }

  private handleKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        this.prev();
        this.focusCurrent();
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.next();
        this.focusCurrent();
        break;
      case 'Home':
        e.preventDefault();
        this.first();
        this.focusCurrent();
        break;
      case 'End':
        e.preventDefault();
        this.last();
        this.focusCurrent();
        break;
      default:
        break;
    }
  }

  /**
   * Restore keyboard focus after a keyboard-initiated navigation.
   *
   * Each navigation re-renders the page strip wholesale (nav.innerHTML), so the
   * button that had focus is removed from the DOM and focus falls back to
   * <body>. Re-focus the logically corresponding control: the current page
   * button, falling back to a still-enabled prev/next when an arrow keypress
   * reached an edge and disabled the button it was on.
   */
  private focusCurrent(): void {
    const nav = this.el.querySelector('.jects-pagination__pages');
    if (!nav) return;
    const current = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (current) {
      current.focus();
      return;
    }
    // No numbered current button is rendered for this page (e.g. it sits inside
    // an ellipsis window); fall back to the first still-enabled nav control.
    const fallback = nav.querySelector<HTMLElement>(
      '.jects-pagination__nav:not([disabled]), .jects-pagination__page:not([disabled])',
    );
    fallback?.focus();
  }

  // ---- rendering ----------------------------------------------------------

  protected override render(): void {
    const {
      showFirstLast = true,
      showPrevNext = true,
      ariaLabel = 'Pagination',
      disabled = false,
      pageSizeOptions,
    } = this.config;

    const el = this.el;
    el.className = ['jects-pagination', disabled ? 'jects-pagination--disabled' : '', this.config.cls ?? '']
      .filter(Boolean)
      .join(' ');
    el.setAttribute('aria-label', ariaLabel);

    const page = this.page;
    const count = this.pageCount;
    const atStart = page <= 1;
    const atEnd = page >= count;

    const nav = el.querySelector('.jects-pagination__pages') as HTMLElement;
    const parts: string[] = [];

    if (showFirstLast) {
      parts.push(this.navBtn('first', 'First page', 'chevrons-up-down', atStart || disabled, true));
    }
    if (showPrevNext) {
      parts.push(this.navBtn('prev', 'Previous page', 'chevron-left', atStart || disabled));
    }

    for (const item of this.pageItems()) {
      if (item === GAP) {
        parts.push(
          `<span class="jects-pagination__gap" aria-hidden="true">${renderIcon('more-horizontal', { size: 16 })}</span>`,
        );
        continue;
      }
      const current = item === page;
      parts.push(
        [
          `<button class="jects-pagination__page${current ? ' jects-pagination__page--current' : ''}"`,
          ` type="button" data-action="page" data-page="${item}"`,
          ` aria-label="Page ${item}"`,
          current ? ' aria-current="page"' : '',
          disabled ? ' disabled' : '',
          `>${item}</button>`,
        ].join(''),
      );
    }

    if (showPrevNext) {
      parts.push(this.navBtn('next', 'Next page', 'chevron-right', atEnd || disabled));
    }
    if (showFirstLast) {
      parts.push(this.navBtn('last', 'Last page', 'chevrons-up-down', atEnd || disabled, true));
    }

    nav.innerHTML = parts.join('');

    this.renderSizeSelect(pageSizeOptions, disabled);
  }

  private navBtn(
    action: string,
    label: string,
    icon: 'chevron-left' | 'chevron-right' | 'chevrons-up-down',
    isDisabled: boolean,
    edge = false,
  ): string {
    return [
      `<button class="jects-pagination__nav${edge ? ' jects-pagination__nav--edge' : ''}"`,
      ` type="button" data-action="${action}" aria-label="${label}"`,
      isDisabled ? ' disabled' : '',
      `>${renderIcon(icon, { size: 16 })}</button>`,
    ].join('');
  }

  private renderSizeSelect(options: number[] | undefined, disabled: boolean): void {
    const el = this.el;
    if (!options || options.length === 0) {
      this._sizeSelect?.destroy();
      delete this._sizeSelect;
      el.querySelector('.jects-pagination__size')?.remove();
      return;
    }

    let wrap = el.querySelector('.jects-pagination__size') as HTMLElement | null;
    if (!wrap) {
      wrap = createEl('div', { className: 'jects-pagination__size' });
      el.append(wrap);
    }

    const selectOpts = options.map((n) => ({ value: String(n), label: `${n} / page` }));
    if (!this._sizeSelect) {
      this._sizeSelect = new Select(wrap, {
        options: selectOpts,
        value: String(this.pageSize),
        ariaLabel: 'Items per page',
        disabled,
      });
      this._sizeSelect.on('change', ({ value }) => {
        if (value !== undefined) this.setPageSize(Number(value));
      });
    } else {
      this._sizeSelect.update({ options: selectOpts, value: String(this.pageSize), disabled });
    }
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    this._sizeSelect?.destroy();
    super.destroy();
  }
}

/** Inclusive integer range [start, end]; empty if start > end. */
function range(start: number, end: number): number[] {
  if (start > end) return [];
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

register(
  'pagination',
  Pagination as unknown as new (
    host: HTMLElement | string,
    config?: Record<string, unknown>,
  ) => Pagination,
);
