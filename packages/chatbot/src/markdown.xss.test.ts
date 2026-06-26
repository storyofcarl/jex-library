/**
 * XSS hardening suite for the chatbot Markdown renderer (docs/SECURITY.md
 * surface #11). The renderer escapes all raw HTML in the message source up
 * front, so caller-supplied tags can never reach the DOM as live markup.
 *
 * Each payload is rendered to HTML, injected into a real element's innerHTML,
 * and the resulting DOM is asserted clean: no <script>, no on* handlers, no
 * javascript:/data:text-html URLs, and a global hook that flips to `true` if
 * any injected handler/alert ever fires.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderMarkdown } from './markdown.js';

declare global {
  // eslint-disable-next-line no-var
  var __xss: boolean;
}

const PAYLOADS: readonly string[] = [
  '<img src=x onerror="window.__xss=true">',
  '<script>window.__xss=true</script>',
  '<svg onload="window.__xss=true">',
  '"><iframe src="javascript:window.__xss=true"></iframe>',
  '[click](javascript:window.__xss=true)',
  '[data](data:text/html;base64,PHNjcmlwdD53aW5kb3cuX194c3M9dHJ1ZTwvc2NyaXB0Pg==)',
  '<a href="javascript:window.__xss=true">x</a>',
  '<body onload="window.__xss=true">',
  '<div style="background:url(javascript:window.__xss=true)">x</div>',
];

describe('chatbot markdown XSS hardening', () => {
  let host: HTMLElement;
  let realAlert: typeof window.alert;

  beforeEach(() => {
    globalThis.__xss = false;
    realAlert = window.alert;
    window.alert = (): void => {
      globalThis.__xss = true;
    };
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    window.alert = realAlert;
    host.remove();
  });

  for (const payload of PAYLOADS) {
    it(`neutralizes payload: ${payload.slice(0, 40)}`, () => {
      const out = renderMarkdown(payload);
      const lower = out.toLowerCase();

      // No raw passthrough markup: dangerous tags only survive HTML-escaped
      // (`&lt;script`), never as live `<script`/`<iframe`/`<svg`/`<img` tags.
      // (Handler/URL keywords like `onload`/`javascript:` are allowed to appear
      // ONLY as escaped, inert text — the DOM assertions below prove they are
      // not live attributes or URLs.)
      expect(lower).not.toContain('<script');
      expect(lower).not.toContain('<iframe');
      expect(lower).not.toContain('<svg');
      expect(lower).not.toContain('<img');

      // Inject into a live DOM node and let jsdom parse it.
      host.innerHTML = out;
      // Force any deferred load handlers by re-reading the subtree.
      void host.querySelectorAll('*').length;

      // No live element nodes from the payload should exist.
      expect(host.querySelector('script')).toBeNull();
      expect(host.querySelector('iframe')).toBeNull();
      expect(host.querySelector('svg')).toBeNull();
      expect(host.querySelector('img')).toBeNull();

      // No element carries an on* handler attribute or a js: url.
      for (const el of Array.from(host.querySelectorAll('*'))) {
        for (const attr of Array.from(el.attributes)) {
          expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
          const val = attr.value.toLowerCase().replace(/\s+/g, '');
          expect(val.includes('javascript:')).toBe(false);
          expect(val.includes('data:text/html')).toBe(false);
        }
      }

      expect(globalThis.__xss).toBe(false);
    });
  }

  it('keeps legitimate markdown formatting intact', () => {
    const html = renderMarkdown('Hello **world** and `code` and [site](https://example.com).');
    host.innerHTML = html;

    expect(host.querySelector('strong')?.textContent).toBe('world');
    expect(host.querySelector('code')?.textContent).toBe('code');
    const link = host.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.textContent).toBe('site');
    expect(host.textContent).toContain('Hello');
    expect(globalThis.__xss).toBe(false);
  });

  it('renders dangerous payload text as visible, inert content', () => {
    // The raw tags survive as escaped, human-readable text (not markup).
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    host.innerHTML = html;
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(host.querySelector('img')).toBeNull();
    expect(globalThis.__xss).toBe(false);
  });
});
