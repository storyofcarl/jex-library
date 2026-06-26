import { describe, it, expect } from 'vitest';
import { escape, escapeHtml, sanitizeHtml } from './sanitize.js';

describe('escape', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escape(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });

  it('neutralizes a script-injection payload as inert text', () => {
    const out = escape('<script>alert(1)</script>');
    expect(out).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).not.toContain('<script');
  });

  it('escapeHtml is the same function', () => {
    expect(escapeHtml).toBe(escape);
  });
});

describe('sanitizeHtml — XSS payloads', () => {
  it('drops <script> and its contents', () => {
    const out = sanitizeHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toBe('<p>hi</p>');
    expect(out.toLowerCase()).not.toContain('script');
  });

  it('strips on* handler attributes but keeps the element', () => {
    const out = sanitizeHtml('<img src="x" onerror="alert(1)">');
    expect(out.toLowerCase()).not.toContain('onerror');
    expect(out).toContain('<img');
    expect(out).toContain('src="x"');
  });

  it('neutralizes a javascript: href', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain('javascript:');
    expect(out).toBe('<a>x</a>');
  });

  it('neutralizes obfuscated javascript: (embedded whitespace/controls)', () => {
    const out = sanitizeHtml('<a href="java\tscript:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('strips <svg> (and its onload) as a non-allow-listed tag', () => {
    const out = sanitizeHtml('<svg onload="alert(1)"></svg>');
    expect(out.toLowerCase()).not.toContain('onload');
    expect(out.toLowerCase()).not.toContain('svg');
  });

  it('drops data:text/html URLs', () => {
    const out = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(out.toLowerCase()).not.toContain('data:text/html');
    expect(out).toBe('<a>x</a>');
  });

  it('drops a CSS expression() in inline style', () => {
    const out = sanitizeHtml('<p style="width: expression(alert(1)); color: red">x</p>');
    expect(out.toLowerCase()).not.toContain('expression(');
    expect(out).toContain('color: red');
  });

  it('drops url(javascript:) in inline style', () => {
    const out = sanitizeHtml('<p style="background: url(javascript:alert(1))">x</p>');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('strips dangerous structural tags', () => {
    const out = sanitizeHtml(
      '<iframe src="javascript:alert(1)"></iframe><object></object><embed>' +
        '<link rel="x"><meta><base href="//evil"><form></form>',
    );
    for (const tag of ['iframe', 'object', 'embed', 'link', 'meta', 'base', 'form']) {
      expect(out.toLowerCase()).not.toContain(tag);
    }
  });

  it('vbscript: hrefs are removed', () => {
    const out = sanitizeHtml('<a href="vbscript:msgbox(1)">x</a>');
    expect(out.toLowerCase()).not.toContain('vbscript:');
  });
});

describe('sanitizeHtml — legitimate formatting survives', () => {
  it('keeps safe formatting tags', () => {
    const input =
      '<h1>Title</h1><p>Hello <b>bold</b> <i>italic</i> ' +
      '<strong>strong</strong> <em>em</em> <u>u</u></p>' +
      '<ul><li>one</li><li>two</li></ul>' +
      '<blockquote>quote</blockquote><pre><code>code</code></pre>';
    const out = sanitizeHtml(input);
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<b>bold</b>');
    expect(out).toContain('<li>one</li>');
    expect(out).toContain('<blockquote>quote</blockquote>');
    expect(out).toContain('<code>code</code>');
  });

  it('keeps safe links and images with allowed attributes', () => {
    const out = sanitizeHtml('<a href="https://example.com" title="t">link</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('link');

    const img = sanitizeHtml('<img src="https://example.com/a.png" alt="pic">');
    expect(img).toContain('src="https://example.com/a.png"');
    expect(img).toContain('alt="pic"');
  });

  it('keeps a safe data:image/png URL', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    const out = sanitizeHtml(`<img src="${src}" alt="x">`);
    expect(out).toContain(src);
  });

  it('keeps table structure', () => {
    const input =
      '<table><thead><tr><th>H</th></tr></thead>' +
      '<tbody><tr><td colspan="2">C</td></tr></tbody></table>';
    const out = sanitizeHtml(input);
    expect(out).toContain('<table>');
    expect(out).toContain('<th>H</th>');
    expect(out).toContain('colspan="2"');
  });

  it('keeps safe inline style declarations', () => {
    const out = sanitizeHtml('<span style="color: red; font-weight: bold">x</span>');
    expect(out).toContain('color: red');
    expect(out).toContain('font-weight: bold');
  });
});

describe('sanitizeHtml — idempotency', () => {
  const samples = [
    '<p>Hello <b>world</b></p>',
    '<img src="x" onerror="alert(1)"><a href="javascript:alert(1)">x</a>',
    '<svg onload="alert(1)"></svg><script>alert(1)</script>',
    '<p style="width: expression(alert(1)); color: red">x</p>',
    '<ul><li>one</li><li>two</li></ul><blockquote>q</blockquote>',
    '<unknown><b>kept</b></unknown>',
  ];

  for (const sample of samples) {
    it(`sanitizing twice equals sanitizing once: ${sample.slice(0, 32)}`, () => {
      const once = sanitizeHtml(sample);
      const twice = sanitizeHtml(once);
      expect(twice).toBe(once);
    });
  }
});

describe('sanitizeHtml — unknown tags', () => {
  it('unwraps unknown but non-dangerous tags, keeping their text', () => {
    const out = sanitizeHtml('<custom-el><b>kept</b></custom-el>');
    expect(out).toBe('<b>kept</b>');
  });
});
