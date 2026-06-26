/**
 * XSS hardening suite for the untrusted-HTML surfaces of `@jects/widgets`
 * (docs/SECURITY.md row 3 RichText + row 4 Tooltips/Popovers).
 *
 * Injects the standard payloads into each surface's untrusted field and asserts:
 *  - a global flag (`window.__xss`) stays false (no handler/script executed),
 *  - the rendered DOM carries no `<script>`/`<iframe>`/`<object>`/`<embed>`, no
 *    `on*` handler attribute, and no `javascript:`/`vbscript:`/`data:text/html`/
 *    CSS `expression()` survivors, and
 *  - legitimate formatting still renders.
 *
 * jsdom unit test — runs in the default `pnpm test`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RichText } from '../richtext/rich-text.js';
import { Tooltip } from '../overlays/tooltip.js';
import { Popup } from '../overlays/popup.js';

declare global {
  // eslint-disable-next-line no-var
  interface Window {
    __xss?: boolean;
  }
}

/** The standard injection payloads from docs/SECURITY.md §4. Each one tries to
 *  flip `window.__xss` via a handler, script, or scheme. */
const PAYLOADS: readonly string[] = [
  '<img src=x onerror="window.__xss=true">',
  '<script>window.__xss=true</script>',
  '<a href="javascript:window.__xss=true">link</a>',
  '<svg onload="window.__xss=true"></svg>',
  '"><iframe src="javascript:window.__xss=true"></iframe>',
  '<a href="data:text/html,<script>window.__xss=true</script>">d</a>',
  '<p style="width: expression(window.__xss=true)">x</p>',
  '<img src="x" style="background:url(javascript:window.__xss=true)">',
];

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  window.__xss = false;
});
afterEach(() => {
  host.remove();
  window.__xss = false;
});

/** Assert that a rendered subtree carries no executable / navigating constructs. */
function assertClean(root: HTMLElement): void {
  expect(root.querySelector('script')).toBeNull();
  expect(root.querySelector('iframe')).toBeNull();
  expect(root.querySelector('object')).toBeNull();
  expect(root.querySelector('embed')).toBeNull();

  // No `on*` event-handler attribute survives anywhere.
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
    }
  }

  // No dangerous URL schemes / CSS expressions survive in the serialized markup.
  const html = root.innerHTML.toLowerCase();
  expect(html).not.toContain('javascript:');
  expect(html).not.toContain('vbscript:');
  expect(html).not.toContain('data:text/html');
  expect(html).not.toContain('expression(');
}

function getEditable(root: HTMLElement): HTMLElement {
  return root.querySelector('.jects-richtext__editable') as HTMLElement;
}

describe('XSS — RichText (paste / import / setHTML)', () => {
  it('setHTML routes every payload through the core sanitizer', () => {
    const rt = new RichText(host, { value: '' });
    const editable = getEditable(host);
    for (const payload of PAYLOADS) {
      rt.setHTML(payload);
      assertClean(editable);
    }
    expect(window.__xss).toBe(false);
    rt.destroy();
  });

  it('paste sanitizes injected HTML (pasteClean on)', () => {
    const rt = new RichText(host, { value: '' });
    const editable = getEditable(host);
    for (const payload of PAYLOADS) {
      rt.setHTML('');
      const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
        clipboardData: { getData(type: string): string };
      };
      ev.clipboardData = {
        getData: (type: string) => (type === 'text/html' ? payload : ''),
      };
      editable.dispatchEvent(ev);
      assertClean(editable);
    }
    expect(window.__xss).toBe(false);
    rt.destroy();
  });

  it('paste sanitizes injected HTML (pasteClean off — safety net still runs)', () => {
    const rt = new RichText(host, { value: '', pasteClean: false });
    const editable = getEditable(host);
    for (const payload of PAYLOADS) {
      rt.setHTML('');
      const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
        clipboardData: { getData(type: string): string };
      };
      ev.clipboardData = {
        getData: (type: string) => (type === 'text/html' ? payload : ''),
      };
      editable.dispatchEvent(ev);
      assertClean(editable);
    }
    expect(window.__xss).toBe(false);
    rt.destroy();
  });

  it('source-view import sanitizes raw HTML on apply', () => {
    const rt = new RichText(host, { value: '', sourceView: true });
    const source = host.querySelector('.jects-richtext__source') as HTMLTextAreaElement;
    const editable = getEditable(host);
    for (const payload of PAYLOADS) {
      source.value = payload;
      // Toggle source-view OFF -> commits source.value back through setHTML().
      rt.exec('sourceView');
      assertClean(editable);
      // Re-enter source view for the next iteration.
      rt.exec('sourceView');
    }
    expect(window.__xss).toBe(false);
    rt.destroy();
  });

  it('preserves legitimate formatting and text', () => {
    const rt = new RichText(host, { value: '' });
    rt.setHTML('<p>Hello <b>world</b> &amp; friends</p>');
    const html = getEditable(host).innerHTML;
    expect(html).toContain('Hello');
    expect(html.toLowerCase()).toContain('<b>world</b>');
    rt.destroy();
  });
});

describe('XSS — Tooltip (html surface)', () => {
  it('sanitizes html content for every payload', () => {
    for (const payload of PAYLOADS) {
      const tip = new Tooltip(host, { html: payload });
      assertClean(tip.el);
      tip.destroy();
    }
    expect(window.__xss).toBe(false);
  });

  it('renders legitimate markup', () => {
    const tip = new Tooltip(host, { html: '<b>Save</b> the file' });
    expect(tip.el.querySelector('b')?.textContent).toBe('Save');
    expect(tip.el.textContent).toContain('the file');
    tip.destroy();
  });

  it('text content is never interpreted as HTML', () => {
    const tip = new Tooltip(host, { text: '<img src=x onerror="window.__xss=true">' });
    expect(tip.el.querySelector('img')).toBeNull();
    expect(tip.el.textContent).toContain('<img');
    expect(window.__xss).toBe(false);
    tip.destroy();
  });
});

describe('XSS — Popup (html surface)', () => {
  it('sanitizes html content for every payload', () => {
    for (const payload of PAYLOADS) {
      const popup = new Popup(host, { html: payload, open: true, label: 'p' });
      assertClean(popup.el);
      popup.destroy();
    }
    expect(window.__xss).toBe(false);
  });

  it('renders legitimate markup', () => {
    const popup = new Popup(host, { html: '<b>Confirm</b> action', open: true, label: 'p' });
    expect(popup.el.querySelector('b')?.textContent).toBe('Confirm');
    expect(popup.el.textContent).toContain('action');
    popup.destroy();
  });

  it('text content is never interpreted as HTML', () => {
    const popup = new Popup(host, {
      text: '<script>window.__xss=true</script>',
      open: true,
      label: 'p',
    });
    expect(popup.el.querySelector('script')).toBeNull();
    expect(popup.el.textContent).toContain('<script>');
    expect(window.__xss).toBe(false);
    popup.destroy();
  });
});
