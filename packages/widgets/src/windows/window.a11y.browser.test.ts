/**
 * axe-core a11y browser test for Window (Quality Gate Q2).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Mounts the component in real Chromium and asserts zero serious/critical violations.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { Window } from './window.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Window a11y (axe-core, real Chromium)', () => {
  it('titled window has no serious/critical violations', async () => {
    const w = new Window(host, {
      title: 'Inspector',
      html: '<p>Body content</p><button type="button">Action</button>',
    });
    await expectNoA11yViolations(document.body);
    w.destroy();
  });

  it('modal window with backdrop passes axe', async () => {
    const w = new Window(host, {
      title: 'Settings',
      modal: true,
      html: '<button type="button">Save</button><button type="button">Cancel</button>',
    });
    await expectNoA11yViolations(document.body);
    w.destroy();
  });

  it('window labelled via config label passes axe', async () => {
    const w = new Window(host, {
      label: 'Color picker',
      html: '<input type="text" aria-label="Hex value" />',
    });
    await expectNoA11yViolations(document.body);
    w.destroy();
  });
});
