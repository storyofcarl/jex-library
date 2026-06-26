/**
 * axe-core a11y browser test for ComboBox (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2), both collapsed and
 * with the listbox popup open, in single and multi mode.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { ComboBox } from './combobox.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;
const opts = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry', disabled: true },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  document.querySelectorAll('.jects-combobox__listbox').forEach((n) => n.remove());
});

describe('ComboBox a11y (axe-core)', () => {
  it('has no serious/critical violations when collapsed (placeholder name)', async () => {
    const c = new ComboBox(host, { options: opts, placeholder: 'Fruit' });
    await expectNoA11yViolations(host);
    c.destroy();
  });

  it('has no serious/critical violations with empty placeholder (aria-label fallback)', async () => {
    const c = new ComboBox(host, { options: opts });
    await expectNoA11yViolations(host);
    c.destroy();
  });

  it('has no serious/critical violations when the listbox is open', async () => {
    const c = new ComboBox(host, { options: opts, ariaLabel: 'Fruit' });
    c.open();
    await expectNoA11yViolations(document.body);
    c.destroy();
  });

  it('has no serious/critical violations in multi mode with chips', async () => {
    const c = new ComboBox(host, { options: opts, ariaLabel: 'Fruit', multiple: true, values: ['apple', 'banana'] });
    await expectNoA11yViolations(host);
    c.destroy();
  });
});
