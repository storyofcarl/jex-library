/**
 * axe-core a11y browser test for DataView (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataView } from './data-view.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

const makeData = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, text: `Card ${i + 1}` }));

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('DataView a11y (axe-core)', () => {
  it('has no serious/critical violations when populated', async () => {
    const v = new DataView(host, { data: makeData(6), label: 'Cards' });
    await expectNoA11yViolations(host);
    v.destroy();
  });

  it('has no serious/critical violations in the empty state', async () => {
    const v = new DataView(host, { data: [], label: 'Cards', emptyText: 'Nothing' });
    expect(host.querySelector('.jects-dataview__empty')).toBeTruthy();
    await expectNoA11yViolations(host);
    v.destroy();
  });
});
