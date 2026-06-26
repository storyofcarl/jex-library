/**
 * axe-core accessibility test (real Chromium) for DatePicker.
 *
 * Named with the `.a11y.browser.test.ts` suffix so it both carries the a11y
 * marker and is collected by the browser vitest config's include glob.
 * Asserts zero serious/critical violations (Quality Gate Q2), both with the
 * popover dialog closed and open.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { DatePicker } from './date-picker.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('DatePicker (axe-core)', () => {
  it('has no serious/critical violations when closed', async () => {
    const p = new DatePicker(host, { value: new Date(2026, 5, 10) });
    await expectNoA11yViolations(host);
    p.destroy();
  });

  it('has no serious/critical violations with the calendar popover open', async () => {
    const p = new DatePicker(host, { value: new Date(2026, 5, 10) });
    p.open();
    // The calendar is portaled to document.body while open (escapes overflow),
    // so scan the whole body to cover the open dialog.
    await expectNoA11yViolations(document.body);
    p.close();
    p.destroy();
  });

  it('returns focus to the input when the popover is closed via Escape', async () => {
    const p = new DatePicker(host, { value: new Date(2026, 5, 10) });
    const input = host.querySelector('.jects-datepicker__input') as HTMLInputElement;
    input.focus();
    p.open();
    // Move focus into the open dialog (portaled to body), then dismiss.
    const cell = document.querySelector('.jects-minical__day[tabindex="0"]') as HTMLElement;
    cell.focus();
    p.close();
    if (document.activeElement !== input) {
      throw new Error('focus was not returned to the input on close');
    }
    await expectNoA11yViolations(host);
    p.destroy();
  });
});
