/** jsdom unit test for Pagination — render + interaction + emitted event. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Pagination } from './pagination.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  document.querySelectorAll('.jects-select__listbox').forEach((n) => n.remove());
});

describe('Pagination (jsdom)', () => {
  it('renders a navigation landmark with page buttons', () => {
    const p = new Pagination(host, { total: 95, pageSize: 10, page: 1 });
    const nav = host.querySelector('[role="navigation"]')!;
    expect(nav).toBeTruthy();
    expect(nav.getAttribute('aria-label')).toBe('Pagination');
    expect(host.querySelectorAll('.jects-pagination__page').length).toBeGreaterThan(0);
    p.destroy();
  });

  it('computes page count from total/pageSize', () => {
    const p = new Pagination(host, { total: 95, pageSize: 10 });
    expect(p.pageCount).toBe(10);
    p.update({ total: 100, pageSize: 25 });
    expect(p.pageCount).toBe(4);
    p.destroy();
  });

  it('marks the current page with aria-current', () => {
    const p = new Pagination(host, { total: 50, pageSize: 10, page: 3 });
    const current = host.querySelector('[aria-current="page"]') as HTMLElement;
    expect(current).toBeTruthy();
    expect(current.textContent).toBe('3');
    p.destroy();
  });

  it('clicking a page button navigates and emits pageChange', () => {
    const p = new Pagination(host, { total: 50, pageSize: 10, page: 1 });
    const spy = vi.fn();
    p.on('pageChange', spy);
    const btn = host.querySelector('[data-page="3"]') as HTMLButtonElement;
    btn.click();
    expect(p.page).toBe(3);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ page: 3, previous: 1 });
    p.destroy();
  });

  it('prev/next buttons step pages and disable at the edges', () => {
    const p = new Pagination(host, { total: 30, pageSize: 10, page: 1 });
    const prev = host.querySelector('[data-action="prev"]') as HTMLButtonElement;
    const next = host.querySelector('[data-action="next"]') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    next.click();
    expect(p.page).toBe(2);
    p.last();
    expect(p.page).toBe(3);
    expect((host.querySelector('[data-action="next"]') as HTMLButtonElement).disabled).toBe(true);
    p.destroy();
  });

  it('first/last jump to the boundaries', () => {
    const p = new Pagination(host, { total: 100, pageSize: 10, page: 5 });
    (host.querySelector('[data-action="first"]') as HTMLButtonElement).click();
    expect(p.page).toBe(1);
    (host.querySelector('[data-action="last"]') as HTMLButtonElement).click();
    expect(p.page).toBe(10);
    p.destroy();
  });

  it('beforePageChange veto cancels navigation', () => {
    const p = new Pagination(host, { total: 50, pageSize: 10, page: 1 });
    p.on('beforePageChange', () => false);
    (host.querySelector('[data-page="2"]') as HTMLButtonElement).click();
    expect(p.page).toBe(1);
    p.destroy();
  });

  it('renders ellipsis gaps for large page counts', () => {
    const p = new Pagination(host, { total: 1000, pageSize: 10, page: 25 });
    expect(host.querySelectorAll('.jects-pagination__gap').length).toBe(2);
    // page 1 and page 100 (boundary pages) are always present
    expect(host.querySelector('[data-page="1"]')).toBeTruthy();
    expect(host.querySelector('[data-page="100"]')).toBeTruthy();
    expect(host.querySelector('[data-page="25"]')).toBeTruthy();
    p.destroy();
  });

  it('ArrowLeft/Right keyboard steps pages', () => {
    const p = new Pagination(host, { total: 50, pageSize: 10, page: 2 });
    const pages = host.querySelector('.jects-pagination__pages') as HTMLElement;
    pages.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(p.page).toBe(3);
    pages.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(p.page).toBe(2);
    pages.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(p.page).toBe(1);
    p.destroy();
  });

  it('renders a page-size Select and emits pageSizeChange', () => {
    const p = new Pagination(host, {
      total: 240,
      pageSize: 20,
      page: 3,
      pageSizeOptions: [10, 20, 50],
    });
    expect(host.querySelector('.jects-pagination__size [role="combobox"]')).toBeTruthy();
    const spy = vi.fn();
    p.on('pageSizeChange', spy);
    p.setPageSize(50);
    expect(p.pageSize).toBe(50);
    expect(p.page).toBe(1); // reset to first page
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ pageSize: 50 });
    p.destroy();
  });

  it('disabled blocks navigation', () => {
    const p = new Pagination(host, { total: 50, pageSize: 10, page: 2, disabled: true });
    p.next();
    expect(p.page).toBe(2);
    p.destroy();
  });

  it('clamps an out-of-range page', () => {
    const p = new Pagination(host, { total: 30, pageSize: 10, page: 99 });
    expect(p.page).toBe(3);
    p.destroy();
  });

  it('destroy removes the element and the inner select', () => {
    const p = new Pagination(host, { total: 50, pageSize: 10, pageSizeOptions: [10, 20] });
    p.destroy();
    expect(host.querySelector('.jects-pagination')).toBeNull();
    expect(document.querySelector('.jects-select__listbox')).toBeNull();
  });
});
