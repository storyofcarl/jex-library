/**
 * axe-core accessibility test (real Chromium) for DateTimeField.
 *
 * Named with the `.a11y.browser.test.ts` suffix so it both carries the a11y
 * marker and is collected by the browser vitest config's include glob.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { DateTimeField } from './date-time-field.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('DateTimeField (axe-core)', () => {
  it('has no serious/critical violations with a value', async () => {
    const f = new DateTimeField(host, { value: new Date(2026, 5, 10, 9, 30) });
    await expectNoA11yViolations(host);
    f.destroy();
  });

  it('has no serious/critical violations when empty', async () => {
    const f = new DateTimeField(host, {});
    await expectNoA11yViolations(host);
    f.destroy();
  });

  it('has no serious/critical violations with the date popover open', async () => {
    const f = new DateTimeField(host, { value: new Date(2026, 5, 10, 9, 30) });
    const input = host.querySelector('.jects-datepicker__input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    // The date calendar is portaled to document.body while open.
    await expectNoA11yViolations(document.body);
    f.destroy();
  });
});
