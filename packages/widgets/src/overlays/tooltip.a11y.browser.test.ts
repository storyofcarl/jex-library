/**
 * axe-core a11y browser test for Tooltip (Quality Gate Q2).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Mounts the component in real Chromium and asserts zero serious/critical violations.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { Tooltip } from './tooltip.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;
let target: HTMLButtonElement;

beforeEach(() => {
  host = document.createElement('div');
  target = document.createElement('button');
  target.textContent = 'Hover me';
  document.body.append(host, target);
});
afterEach(() => {
  host.remove();
  target.remove();
});

describe('Tooltip a11y (axe-core, real Chromium)', () => {
  it('hidden tooltip has no serious/critical violations', async () => {
    const t = new Tooltip(host, { target, text: 'Helpful hint' });
    await expectNoA11yViolations(document.body);
    t.destroy();
  });

  it('visible tooltip with aria-describedby target passes axe', async () => {
    const t = new Tooltip(host, { target, text: 'Helpful hint', showDelay: 0 });
    t.showNow();
    await expectNoA11yViolations(document.body);
    t.destroy();
  });
});
