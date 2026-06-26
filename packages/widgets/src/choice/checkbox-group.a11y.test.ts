/**
 * axe-core a11y browser test for CheckboxGroup (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { CheckboxGroup } from './checkbox-group.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;
const opts = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana' },
  { value: 'c', label: 'Cherry', disabled: true },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('CheckboxGroup a11y (axe-core)', () => {
  it('has no serious/critical violations (labelled group)', async () => {
    const g = new CheckboxGroup(host, { options: opts, ariaLabel: 'Fruits', value: ['a'] });
    await expectNoA11yViolations(host);
    g.destroy();
  });

  it('has no serious/critical violations when the whole group is disabled', async () => {
    const g = new CheckboxGroup(host, { options: opts, ariaLabel: 'Fruits', disabled: true });
    await expectNoA11yViolations(host);
    g.destroy();
  });
});
