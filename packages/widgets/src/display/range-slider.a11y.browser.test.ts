/**
 * axe-core a11y browser test for RangeSlider (real Chromium).
 * Asserts zero serious/critical violations (Quality Gate Q2).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { RangeSlider } from './range-slider.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('RangeSlider a11y (axe-core)', () => {
  it('has no serious/critical violations with a default range', async () => {
    const r = new RangeSlider(host, { min: 0, max: 100, low: 20, high: 80 });
    await expectNoA11yViolations(host);
    r.destroy();
  });

  it('has no serious/critical violations when disabled', async () => {
    const r = new RangeSlider(host, { min: 0, max: 100, low: 10, high: 90, disabled: true });
    await expectNoA11yViolations(host);
    r.destroy();
  });
});
