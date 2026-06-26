/**
 * axe-core accessibility test (real Chromium) for MiniCalendar.
 *
 * Named with the `.a11y.browser.test.ts` suffix so it both carries the a11y
 * marker and is collected by the browser vitest config's include glob.
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { MiniCalendar } from './mini-calendar.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('MiniCalendar (axe-core)', () => {
  it('has no serious/critical violations (default, Sunday start)', async () => {
    const c = new MiniCalendar(host, { value: new Date(2026, 5, 10), viewDate: new Date(2026, 5, 10) });
    await expectNoA11yViolations(host);
    c.destroy();
  });

  it('has no serious/critical violations (Monday start, no value)', async () => {
    const c = new MiniCalendar(host, { viewDate: new Date(2026, 5, 15), weekStart: 1 });
    await expectNoA11yViolations(host);
    c.destroy();
  });

  it('has no serious/critical violations with min/max disabled days', async () => {
    const c = new MiniCalendar(host, {
      viewDate: new Date(2026, 5, 15),
      min: new Date(2026, 5, 10),
      max: new Date(2026, 5, 20),
    });
    await expectNoA11yViolations(host);
    c.destroy();
  });
});
