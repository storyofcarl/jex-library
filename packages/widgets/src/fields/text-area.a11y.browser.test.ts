/**
 * axe-core accessibility test for TextArea (real Chromium via Vitest browser mode).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { TextArea } from './text-area.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('TextArea a11y (axe-core)', () => {
  it('labeled textarea has no serious/critical violations', async () => {
    const f = new TextArea(host, { label: 'Bio', value: 'Hello', rows: 4 });
    await expectNoA11yViolations(host);
    f.destroy();
  });

  it('textarea with maxLength counter and error is accessible', async () => {
    const f = new TextArea(host, { label: 'Notes', maxLength: 100, error: 'Too short', value: 'x' });
    await expectNoA11yViolations(host);
    f.destroy();
  });

  it('disabled textarea is accessible', async () => {
    const f = new TextArea(host, { label: 'Read only', value: 'x', disabled: true });
    await expectNoA11yViolations(host);
    f.destroy();
  });
});
