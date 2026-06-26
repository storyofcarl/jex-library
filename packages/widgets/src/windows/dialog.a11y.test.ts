/**
 * axe-core a11y browser test for Dialog (Quality Gate Q2).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Mounts the component in real Chromium and asserts zero serious/critical
 * violations. Dialog is a modal Window preset, so this also exercises the modal
 * accessible-name, focus-trap and background-inerting paths from the quality fix.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { Dialog } from './dialog.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;
let background: HTMLElement;

beforeEach(() => {
  background = document.createElement('div');
  background.innerHTML = '<button type="button">Background action</button>';
  document.body.appendChild(background);
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  background.remove();
});

describe('Dialog a11y (axe-core, real Chromium)', () => {
  it('confirm dialog with actions has no serious/critical violations', async () => {
    const d = new Dialog(host, {
      title: 'Delete file?',
      text: 'This action cannot be undone.',
      tone: 'destructive',
      actions: [
        { key: 'cancel', text: 'Cancel', variant: 'outline' },
        { key: 'delete', text: 'Delete', variant: 'destructive' },
      ],
    });
    await expectNoA11yViolations(document.body);
    d.destroy();
  });

  it('label-only dialog (no title) still passes axe', async () => {
    const d = new Dialog(host, {
      label: 'Quick confirm',
      text: 'Proceed?',
      actions: [{ key: 'ok', text: 'OK', variant: 'primary' }],
    });
    await expectNoA11yViolations(document.body);
    d.destroy();
  });

  it('modal dialog inerts background content', async () => {
    const d = new Dialog(host, {
      title: 'Heads up',
      text: 'The export finished with warnings.',
      actions: [{ key: 'ok', text: 'Got it', variant: 'primary' }],
    });
    if (!background.inert || background.getAttribute('aria-hidden') !== 'true') {
      throw new Error('Modal dialog did not inert background content');
    }
    await expectNoA11yViolations(document.body);
    d.destroy();
    if (background.inert || background.hasAttribute('aria-hidden')) {
      throw new Error('Modal dialog did not restore background content on teardown');
    }
  });
});
