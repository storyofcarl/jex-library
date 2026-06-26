/**
 * axe-core a11y browser test for Pagination (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2) and verifies that
 * keyboard navigation does not leak focus to <body>: after an arrow keypress the
 * re-rendered current-page button (or an enabled nav control at an edge) keeps
 * focus, so consecutive keyboard steps remain possible (WCAG 2.1.1 / 2.4.3).
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { Pagination } from './pagination.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  document.querySelectorAll('.jects-select__listbox').forEach((n) => n.remove());
});

describe('Pagination a11y (axe-core)', () => {
  it('has no serious/critical violations (basic navigation landmark)', async () => {
    const p = new Pagination(host, { total: 95, pageSize: 10, page: 3 });
    await expectNoA11yViolations(host);
    p.destroy();
  });

  it('has no serious/critical violations with ellipsis gaps + page-size select', async () => {
    const p = new Pagination(host, {
      total: 1000,
      pageSize: 10,
      page: 25,
      pageSizeOptions: [10, 20, 50],
    });
    await expectNoA11yViolations(host);
    p.destroy();
  });

  it('keeps keyboard focus after arrow-key navigation (no focus leak to body)', async () => {
    const p = new Pagination(host, { total: 50, pageSize: 10, page: 2 });
    const pages = host.querySelector('.jects-pagination__pages') as HTMLElement;
    // Seed focus on the current-page button, as a keyboard user would have.
    (host.querySelector('[aria-current="page"]') as HTMLElement).focus();

    pages.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(p.page).toBe(3);
    // Focus must NOT have fallen back to <body>; it follows the new current page.
    expect(document.activeElement).not.toBe(document.body);
    expect((document.activeElement as HTMLElement).getAttribute('aria-current')).toBe('page');

    // Consecutive keyboard steps must still work.
    pages.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(p.page).toBe(4);
    expect(document.activeElement).not.toBe(document.body);
    p.destroy();
  });

  it('keeps focus on an enabled control when an arrow reaches an edge', async () => {
    const p = new Pagination(host, { total: 30, pageSize: 10, page: 2 });
    const pages = host.querySelector('.jects-pagination__pages') as HTMLElement;
    (host.querySelector('[aria-current="page"]') as HTMLElement).focus();
    // Step to the last page; the current button stays focused.
    pages.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(p.page).toBe(3);
    expect(document.activeElement).not.toBe(document.body);
    p.destroy();
  });

  it('has no serious/critical violations when disabled', async () => {
    const p = new Pagination(host, { total: 50, pageSize: 10, page: 2, disabled: true });
    await expectNoA11yViolations(host);
    p.destroy();
  });
});
