/**
 * axe-core a11y browser test for Select (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2), both when the
 * trigger is collapsed and when the listbox popup is open.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { Select } from './select.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;
const opts = [
  { value: 'r', label: 'Red' },
  { value: 'g', label: 'Green' },
  { value: 'b', label: 'Blue', disabled: true },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  document.querySelectorAll('.jects-select__listbox').forEach((n) => n.remove());
});

describe('Select a11y (axe-core)', () => {
  it('has no serious/critical violations when collapsed (placeholder only)', async () => {
    const s = new Select(host, { options: opts, placeholder: 'Pick a color' });
    await expectNoA11yViolations(host);
    s.destroy();
  });

  it('has no serious/critical violations with an empty placeholder (aria-label fallback)', async () => {
    const s = new Select(host, { options: opts, placeholder: '' });
    await expectNoA11yViolations(host);
    s.destroy();
  });

  it('has no serious/critical violations when the listbox is open', async () => {
    const s = new Select(host, { options: opts, ariaLabel: 'Color', value: 'r', clearable: true });
    s.open();
    // The listbox panel mounts to document.body, so scan the whole document.
    await expectNoA11yViolations(document.body);
    s.destroy();
  });

  it('has no serious/critical violations when disabled', async () => {
    const s = new Select(host, { options: opts, ariaLabel: 'Color', disabled: true });
    await expectNoA11yViolations(host);
    s.destroy();
  });
});
