/**
 * axe-core a11y browser test for List (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 *
 * Also guards the focus-on-scroll regression: a window re-render must never
 * drop DOM focus off the listbox root, and the active option is tracked via
 * aria-activedescendant so virtualizing it out cannot strip focus or aria state.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { List } from './list.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

const makeData = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, text: `Item ${i + 1}` }));

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('List a11y (axe-core)', () => {
  it('has no serious/critical violations when populated', async () => {
    const l = new List(host, { data: makeData(200), label: 'Items', height: 240 });
    await expectNoA11yViolations(host);
    l.destroy();
  });

  it('has no serious/critical violations in the empty state', async () => {
    const l = new List(host, { data: [], label: 'Items', emptyText: 'Nothing here' });
    await expectNoA11yViolations(host);
    l.destroy();
  });

  it('keeps focus on the listbox root after scrolling (focus not dropped to body)', async () => {
    const l = new List(host, { data: makeData(500), label: 'Items', height: 200 });
    const root = host.querySelector<HTMLElement>('.jects-list')!;
    root.focus();
    expect(document.activeElement).toBe(root);

    const vp = host.querySelector<HTMLElement>('.jects-list__viewport')!;
    vp.scrollTop = 4000;
    vp.dispatchEvent(new Event('scroll'));

    expect(document.activeElement).toBe(root);
    expect(root.getAttribute('aria-activedescendant')).toBeTruthy();
    await expectNoA11yViolations(host);
    l.destroy();
  });

  it('keeps the active descendant valid through keyboard navigation', async () => {
    const l = new List(host, { data: makeData(500), label: 'Items', height: 200 });
    const root = host.querySelector<HTMLElement>('.jects-list')!;
    root.focus();
    for (let i = 0; i < 40; i++) {
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    }
    expect(document.activeElement).toBe(root);
    const activeId = root.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    expect(host.querySelector(`#${CSS.escape(activeId!)}`)).toBeTruthy();
    await expectNoA11yViolations(host);
    l.destroy();
  });
});
