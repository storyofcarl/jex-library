/**
 * axe-core a11y browser test for RadioGroup (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { RadioGroup } from './radio-group.js';
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
});

describe('RadioGroup a11y (axe-core)', () => {
  it('has no serious/critical violations (labelled group, roving tabindex)', async () => {
    const rg = new RadioGroup(host, { options: opts, ariaLabel: 'Pick a color', value: 'g' });
    await expectNoA11yViolations(host);
    rg.destroy();
  });

  it('has no serious/critical violations when the whole group is disabled', async () => {
    const rg = new RadioGroup(host, { options: opts, ariaLabel: 'Colors', disabled: true });
    await expectNoA11yViolations(host);
    rg.destroy();
  });

  it('has no serious/critical violations in horizontal orientation', async () => {
    const rg = new RadioGroup(host, { options: opts, ariaLabel: 'Colors', orientation: 'horizontal' });
    await expectNoA11yViolations(host);
    rg.destroy();
  });
});
