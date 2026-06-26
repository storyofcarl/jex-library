/**
 * axe-core a11y browser test for Checkbox (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { Checkbox } from './checkbox.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Checkbox a11y (axe-core)', () => {
  it('has no serious/critical violations with a visible label', async () => {
    const c = new Checkbox(host, { label: 'Accept terms' });
    await expectNoA11yViolations(host);
    c.destroy();
  });

  it('has no serious/critical violations when label is empty (aria-label fallback)', async () => {
    const c = new Checkbox(host, { label: '' });
    await expectNoA11yViolations(host);
    c.destroy();
  });

  it('has no serious/critical violations when checked, indeterminate, and disabled', async () => {
    const checked = new Checkbox(host, { label: 'On', checked: true });
    const mixed = new Checkbox(host, { label: 'Mixed', indeterminate: true });
    const disabled = new Checkbox(host, { label: 'Off', disabled: true });
    await expectNoA11yViolations(host);
    checked.destroy();
    mixed.destroy();
    disabled.destroy();
  });
});
