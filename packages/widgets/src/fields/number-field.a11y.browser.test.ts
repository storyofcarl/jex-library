/**
 * axe-core accessibility test for NumberField (real Chromium via Vitest browser mode).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2), including a correct
 * accessible name on the role=spinbutton and synced aria-valuenow after typing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NumberField } from './number-field.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('NumberField a11y (axe-core)', () => {
  it('labeled spinbutton with min/max/spinners has no serious/critical violations', async () => {
    const f = new NumberField(host, { label: 'Quantity', value: '5', min: 0, max: 10, step: 1 });
    await expectNoA11yViolations(host);
    f.destroy();
  });

  it('aria-valuenow stays in sync with typed text (not just on step/render)', async () => {
    const f = new NumberField(host, { label: 'Quantity', value: '5', min: 0, max: 10 });
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = '7';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.getAttribute('aria-valuenow')).toBe('7');
    await expectNoA11yViolations(host);
    f.destroy();
  });

  it('field named only by ariaLabel is accessible', async () => {
    const f = new NumberField(host, { ariaLabel: 'Age', value: '30' });
    await expectNoA11yViolations(host);
    f.destroy();
  });
});
