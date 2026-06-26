/**
 * axe-core a11y browser test for Radio (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { Radio } from './radio.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Radio a11y (axe-core)', () => {
  it('has no serious/critical violations with a visible label', async () => {
    const r = new Radio(host, { label: 'Option A', value: 'a', name: 'g' });
    await expectNoA11yViolations(host);
    r.destroy();
  });

  it('has no serious/critical violations when checked and disabled', async () => {
    const checked = new Radio(host, { label: 'Selected', value: 'a', name: 'g', checked: true });
    const disabled = new Radio(host, { label: 'Unavailable', value: 'b', name: 'g', disabled: true });
    await expectNoA11yViolations(host);
    checked.destroy();
    disabled.destroy();
  });
});
