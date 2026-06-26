/**
 * axe-core accessibility test (real Chromium) for TimePicker.
 *
 * Named with the `.a11y.browser.test.ts` suffix so it both carries the a11y
 * marker and is collected by the browser vitest config's include glob.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { TimePicker } from './time-picker.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('TimePicker (axe-core)', () => {
  it('has no serious/critical violations in 12-hour mode', async () => {
    const t = new TimePicker(host, { value: { hours: 9, minutes: 30 }, hour12: true });
    await expectNoA11yViolations(host);
    t.destroy();
  });

  it('has no serious/critical violations in 24-hour mode', async () => {
    const t = new TimePicker(host, { value: { hours: 18, minutes: 45 }, hour12: false });
    await expectNoA11yViolations(host);
    t.destroy();
  });

  it('has no serious/critical violations when disabled', async () => {
    const t = new TimePicker(host, { value: { hours: 0, minutes: 0 }, disabled: true });
    await expectNoA11yViolations(host);
    t.destroy();
  });
});
