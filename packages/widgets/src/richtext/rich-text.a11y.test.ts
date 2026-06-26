/**
 * axe-core a11y browser test for RichText (real Chromium).
 * Run with `pnpm --filter @jects/widgets test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RichText } from './rich-text.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('RichText a11y (axe-core)', () => {
  it('has no serious/critical violations with the default toolbar', async () => {
    const rt = new RichText(host, {
      value: '<h2>Title</h2><p>Body text.</p>',
      label: 'Article body',
    });
    await expectNoA11yViolations(host);
    rt.destroy();
  });

  it('has no serious/critical violations when empty', async () => {
    const rt = new RichText(host, { value: '', placeholder: 'Write…' });
    await expectNoA11yViolations(host);
    rt.destroy();
  });

  it('has no serious/critical violations when read-only', async () => {
    const rt = new RichText(host, { value: '<p>Locked.</p>', readOnly: true });
    await expectNoA11yViolations(host);
    rt.destroy();
  });

  it('toolbar is keyboard-operable via roving tabindex + arrow keys', async () => {
    const rt = new RichText(host, { value: '<p>x</p>' });
    const buttons = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button[data-command]'),
    );
    // Exactly one enabled button is in the tab order (roving tabindex).
    const focusable = buttons.filter((b) => b.getAttribute('tabindex') === '0');
    expect(focusable.length).toBe(1);
    focusable[0]!.focus();
    expect(document.activeElement).toBe(focusable[0]);
    // ArrowRight moves focus to the next toolbar button.
    focusable[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1]!.getAttribute('tabindex')).toBe('0');
    await expectNoA11yViolations(host);
    rt.destroy();
  });

  it('does not put aria-pressed on action buttons (non-toggles)', async () => {
    const rt = new RichText(host, {
      toolbar: ['bold', 'undo', 'redo', 'link', 'h1', 'clear'],
    });
    expect(
      host.querySelector('button[data-command="bold"]')!.hasAttribute('aria-pressed'),
    ).toBe(true);
    for (const cmd of ['undo', 'redo', 'link', 'h1', 'clear']) {
      expect(
        host.querySelector(`button[data-command="${cmd}"]`)!.hasAttribute('aria-pressed'),
      ).toBe(false);
    }
    await expectNoA11yViolations(host);
    rt.destroy();
  });
});
