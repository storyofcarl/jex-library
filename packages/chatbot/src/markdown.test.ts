/** Unit tests for the tiny safe Markdown renderer. */
import { describe, it, expect } from 'vitest';
import { renderMarkdown, escapeHtml } from './markdown.js';

describe('renderMarkdown', () => {
  it('escapes HTML in plain text', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script>');
    expect(renderMarkdown('a & b')).toContain('a &amp; b');
  });

  it('renders bold and italic', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
    expect(renderMarkdown('_em_')).toContain('<em>em</em>');
  });

  it('renders inline code without interpreting markup inside', () => {
    const html = renderMarkdown('use `a * b` here');
    expect(html).toContain('<code class="jects-chatbot__code">a * b</code>');
    expect(html).not.toContain('<em>');
  });

  it('renders fenced code blocks and escapes their content', () => {
    const html = renderMarkdown('```js\nconst x = 1 < 2;\n```');
    expect(html).toContain('<pre class="jects-chatbot__pre">');
    expect(html).toContain('1 &lt; 2');
  });

  it('renders headings', () => {
    expect(renderMarkdown('## Title')).toContain('<h2>Title</h2>');
  });

  it('renders unordered and ordered lists', () => {
    expect(renderMarkdown('- one\n- two')).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(renderMarkdown('1. a\n2. b')).toContain('<ol><li>a</li><li>b</li></ol>');
  });

  it('renders blockquotes', () => {
    expect(renderMarkdown('> quoted')).toContain('<blockquote>quoted</blockquote>');
  });

  it('renders safe links and rejects dangerous protocols', () => {
    expect(renderMarkdown('[site](https://example.com)')).toContain(
      '<a class="jects-chatbot__link" href="https://example.com"',
    );
    const bad = renderMarkdown('[x](javascript:alert(1))');
    expect(bad).not.toContain('href="javascript');
    expect(bad).not.toContain('<a ');
  });

  it('separates paragraphs on blank lines and joins single newlines with <br>', () => {
    const html = renderMarkdown('line1\nline2\n\npara2');
    expect(html).toContain('line1<br>line2');
    expect(html).toContain('<p>para2</p>');
  });

  it('escapeHtml handles quotes and apostrophes', () => {
    expect(escapeHtml(`"'`)).toBe('&quot;&#39;');
  });
});
