/**
 * axe-core accessibility tests (Quality Gate Q2) for the Feedback cluster, run
 * in real Chromium via Vitest browser mode.
 *
 * Named `*.a11y.browser.test.ts` so it is the a11y suite for this cluster AND
 * is picked up by the `*.browser.test.ts` include glob in
 * `vitest.browser.config.ts` (run via `pnpm --filter @jects/widgets test:browser`).
 *
 * Each interactive surface (toaster + toasts of every variant, alert, confirm,
 * prompt) is mounted into the live document and asserted to have ZERO
 * serious/critical violations.
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { MessageManager, alert, confirm, prompt, type DialogHandle } from './message-manager.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  document.querySelectorAll('.jects-dialog-overlay').forEach((n) => n.remove());
});

describe('MessageManager a11y (real Chromium)', () => {
  it('toaster region with mixed-variant toasts has no serious/critical violations', async () => {
    const m = new MessageManager(host, { max: 10 });
    m.push({ title: 'Saved', message: 'Your changes were saved', variant: 'success' });
    m.push({ message: 'Heads up — check your input', variant: 'info' });
    m.push({ title: 'Careful', message: 'This may overwrite data', variant: 'warning' });
    m.push({ title: 'Failed', message: 'Could not connect', variant: 'error' });
    await expectNoA11yViolations(host);
    m.destroy();
  });

  it('a non-closable toast still has no violations', async () => {
    const m = new MessageManager(host);
    m.push({ title: 'Note', message: 'Read-only toast', variant: 'info', closable: false });
    await expectNoA11yViolations(host);
    m.destroy();
  });
});

describe('Dialog a11y (real Chromium)', () => {
  async function checkDialog<R>(handle: DialogHandle<R>): Promise<void> {
    try {
      await expectNoA11yViolations(document.body);
    } finally {
      handle.cancel();
      await handle.catch(() => undefined);
    }
  }

  it('alert dialog has no serious/critical violations', async () => {
    await checkDialog(alert({ title: 'Heads up', message: 'Operation complete' }));
  });

  it('confirm dialog (alertdialog) has no serious/critical violations', async () => {
    await checkDialog(confirm({ title: 'Delete file?', message: 'This cannot be undone' }));
  });

  it('prompt dialog with a labelled input has no serious/critical violations', async () => {
    await checkDialog(
      prompt({ title: 'Rename', message: 'Enter a new name', defaultValue: 'document' }),
    );
  });

  it('prompt with only a placeholder (aria-label fallback) has no violations', async () => {
    await checkDialog(prompt({ placeholder: 'Search term' }));
  });
});
