/**
 * axe-core accessibility test for TextField (real Chromium via Vitest browser mode).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { TextField } from './text-field.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('TextField a11y (axe-core)', () => {
  it('labeled field has no serious/critical violations', async () => {
    const f = new TextField(host, { label: 'Full name', value: 'Jane', clearable: true });
    await expectNoA11yViolations(host);
    f.destroy();
  });

  it('field named only by ariaLabel (no visible label) is accessible', async () => {
    const f = new TextField(host, { ariaLabel: 'Search', placeholder: 'Search…', inputType: 'search' });
    await expectNoA11yViolations(host);
    f.destroy();
  });

  it('invalid field with error and affixes is accessible', async () => {
    const f = new TextField(host, {
      label: 'Amount',
      prefix: '$',
      suffix: '.00',
      error: 'Required',
      value: '',
    });
    await expectNoA11yViolations(host);
    f.destroy();
  });

  it('disabled field is accessible', async () => {
    const f = new TextField(host, { label: 'Locked', value: 'x', disabled: true });
    await expectNoA11yViolations(host);
    f.destroy();
  });
});
