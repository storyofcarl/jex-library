/**
 * axe-core a11y browser test for Dialog (Quality Gate Q2).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Mounts the component in real Chromium and asserts zero serious/critical violations.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { Dialog } from './dialog.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
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

  it('acknowledge dialog passes axe', async () => {
    const d = new Dialog(host, {
      title: 'Heads up',
      text: 'The export finished with warnings.',
      actions: [{ key: 'ok', text: 'Got it', variant: 'primary' }],
    });
    await expectNoA11yViolations(document.body);
    d.destroy();
  });
});
