/**
 * axe-core a11y browser test for Container (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { Container } from './container.js';
import '../button/button.js'; // registers 'button' for factory items
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Container a11y (axe-core)', () => {
  it('has no serious/critical violations for a flex container of buttons', async () => {
    const c = new Container(host, {
      items: [
        { type: 'button', text: 'One' },
        { type: 'button', text: 'Two' },
      ],
    });
    await expectNoA11yViolations(host);
    c.destroy();
  });

  it('has no serious/critical violations as a labelled toolbar', async () => {
    const c = new Container(host, {
      role: 'toolbar',
      ariaLabel: 'Actions',
      items: [
        { type: 'button', text: 'Save' },
        { type: 'button', text: 'Cancel' },
      ],
    });
    await expectNoA11yViolations(host);
    c.destroy();
  });

  it('has no serious/critical violations in grid layout', async () => {
    const c = new Container(host, {
      layout: 'grid',
      columns: 2,
      items: [
        { type: 'button', text: 'A' },
        { type: 'button', text: 'B' },
      ],
    });
    await expectNoA11yViolations(host);
    c.destroy();
  });
});
