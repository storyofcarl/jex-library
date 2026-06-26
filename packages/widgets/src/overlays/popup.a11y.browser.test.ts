/**
 * axe-core a11y browser test for Popup (Quality Gate Q2).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Mounts the component in real Chromium and asserts zero serious/critical violations.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { Popup } from './popup.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;
let anchor: HTMLButtonElement;

beforeEach(() => {
  host = document.createElement('div');
  anchor = document.createElement('button');
  anchor.textContent = 'Open';
  document.body.append(host, anchor);
});
afterEach(() => {
  host.remove();
  anchor.remove();
});

describe('Popup a11y (axe-core, real Chromium)', () => {
  it('closed dialog popup has no serious/critical violations', async () => {
    const p = new Popup(host, { anchor, label: 'Account menu', text: 'Hello' });
    await expectNoA11yViolations(document.body);
    p.destroy();
  });

  it('open dialog popup with an accessible name passes axe', async () => {
    const p = new Popup(host, {
      anchor,
      label: 'Settings dialog',
      html: '<button type="button">Save</button><button type="button">Cancel</button>',
      open: true,
    });
    await expectNoA11yViolations(document.body);
    p.destroy();
  });

  it('open dialog named via aria-labelledby passes axe', async () => {
    const heading = document.createElement('h2');
    heading.id = 'popup-title';
    heading.textContent = 'Profile';
    host.appendChild(heading);
    const p = new Popup(host, {
      anchor,
      labelledby: 'popup-title',
      html: '<p>Body</p><button type="button">Done</button>',
      open: true,
    });
    await expectNoA11yViolations(document.body);
    p.destroy();
  });
});
