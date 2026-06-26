/**
 * axe-core accessibility test (real Chromium, Vitest browser mode).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 *
 * Asserts the FilePicker drop zone + file list have zero serious/critical
 * a11y violations, including after files are added (progressbar rows + remove
 * buttons must carry accessible names).
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { FilePicker } from './file-picker.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('FilePicker (axe-core)', () => {
  it('has no serious/critical violations (empty)', async () => {
    const p = new FilePicker(host, { label: 'Drop files', hint: 'Up to 5 MB' });
    await expectNoA11yViolations(host);
    p.destroy();
  });

  it('has no serious/critical violations when disabled', async () => {
    const p = new FilePicker(host, { disabled: true });
    await expectNoA11yViolations(host);
    p.destroy();
  });

  it('has no serious/critical violations with files in the list', async () => {
    const p = new FilePicker(host);
    const file = new File(['hello world'], 'notes.txt', { type: 'text/plain' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = host.querySelector('.jects-filepicker__input') as HTMLInputElement;
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    p.setProgress(p.getFiles()[0]!.id, 42);
    await expectNoA11yViolations(host);
    p.destroy();
  });
});
