/**
 * axe-core a11y browser test for Switch (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { Switch } from './switch.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Switch a11y (axe-core)', () => {
  it('has no serious/critical violations with a visible label', async () => {
    const s = new Switch(host, { label: 'Wi-Fi' });
    await expectNoA11yViolations(host);
    s.destroy();
  });

  it('has no serious/critical violations when label is empty (aria-label fallback)', async () => {
    const s = new Switch(host, { label: '' });
    await expectNoA11yViolations(host);
    s.destroy();
  });

  it('has no serious/critical violations when checked and disabled', async () => {
    const on = new Switch(host, { label: 'On', checked: true });
    const disabled = new Switch(host, { label: 'Locked', disabled: true, checked: true });
    await expectNoA11yViolations(host);
    on.destroy();
    disabled.destroy();
  });
});
