/**
 * axe-core a11y browser test for TabPanel (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2): under the default
 * lazy mode every tab's aria-controls must resolve to an existing panel shell,
 * so no dangling IDREFs are flagged.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { TabPanel } from './tab-panel.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;
const items = [
  { id: 'one', label: 'One', content: '<p>First panel</p>' },
  { id: 'two', label: 'Two', content: '<p>Second panel</p>' },
  { id: 'three', label: 'Three', content: '<p>Third panel</p>' },
];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('TabPanel a11y (axe-core)', () => {
  it('has no serious/critical violations under lazy default (no dangling aria-controls)', async () => {
    const tp = new TabPanel(host, { items, active: 'one' });
    // Every tab's aria-controls target must exist in the DOM (shell present).
    host.querySelectorAll<HTMLElement>('[role="tab"]').forEach((tab) => {
      const id = tab.getAttribute('aria-controls')!;
      expect(host.querySelector(`#${CSS.escape(id)}`)).toBeTruthy();
    });
    await expectNoA11yViolations(host);
    tp.destroy();
  });

  it('has no serious/critical violations when closable', async () => {
    const tp = new TabPanel(host, { items, active: 'two', closable: true, ariaLabel: 'Docs' });
    await expectNoA11yViolations(host);
    tp.destroy();
  });

  it('has no serious/critical violations in eager (non-lazy) mode', async () => {
    const tp = new TabPanel(host, { items, lazy: false });
    await expectNoA11yViolations(host);
    tp.destroy();
  });
});
