/**
 * Tiny, dependency-free, safe-by-default Markdown renderer for assistant
 * messages. It is intentionally small: it covers the subset of Markdown chat
 * assistants commonly emit (headings, bold/italic, inline + fenced code,
 * links, lists, blockquotes, paragraphs, line breaks) and **escapes all input
 * first**, so no raw user/assistant HTML is ever injected.
 *
 * This keeps `@jects/chatbot` LLM-agnostic and zero-dependency: the host can
 * swap in a richer renderer via `ChatbotConfig.renderMarkdown` if desired.
 */

import { escape } from '@jects/core';

/**
 * Escape the five HTML-significant characters so text is never interpreted as
 * markup. Re-exported alias of the shared `@jects/core` `escape` helper (see
 * `docs/SECURITY.md` §1) — kept under this name for the existing public API.
 */
export const escapeHtml = escape;

/**
 * Sentinel wrapping a stashed code-span index while emphasis/link passes run.
 * Built at runtime from a Unicode private-use code point (U+E000) so the source
 * stays pure ASCII, the sentinel is a valid non-control character, and it can
 * never collide with HTML-escaped message text.
 */
const SENTINEL = String.fromCharCode(0xe000);
const RESTORE_RE = new RegExp(SENTINEL + '([0-9]+)' + SENTINEL, 'g');

/** Render inline spans (code, bold, italic, links) within an already-escaped line. */
function renderInline(escaped: string): string {
  let out = escaped;

  // Inline code `code` — render before emphasis so * / _ inside code are literal.
  // We stash code spans, run emphasis/link passes, then restore them.
  const codeSpans: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => {
    const idx = codeSpans.push(`<code class="jects-chatbot__code">${code}</code>`) - 1;
    return `${SENTINEL}${idx}${SENTINEL}`;
  });

  // Links [text](url) — only http(s)/mailto/relative; reject javascript: etc.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    if (!isSafeUrl(url)) return `${text} (${url})`;
    return `<a class="jects-chatbot__link" href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Bold **x** / __x__
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic *x* / _x_
  out = out.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_])_([^_\s][^_]*?)_/g, '$1<em>$2</em>');

  // Restore code spans
  out = out.replace(RESTORE_RE, (_m, i: string) => codeSpans[Number(i)] ?? '');

  return out;
}

/** Only allow protocols that cannot execute script. The URL is already escaped. */
function isSafeUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('mailto:')) return true;
  // Relative / anchor links are safe; reject anything with a scheme we didn't allow.
  return !/^[a-z][a-z0-9+.-]*:/.test(u);
}

/**
 * Render a Markdown string to a trusted HTML string. The input is HTML-escaped
 * up-front, so the output never contains caller-supplied tags — only the tags
 * this function emits.
 */
export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];

  let i = 0;
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length === 0) return;
    const joined = para.map((l) => renderInline(escapeHtml(l))).join('<br>');
    html.push(`<p>${joined}</p>`);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Fenced code block ```lang
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i++;
      }
      i++; // consume closing fence (if present)
      html.push(
        `<pre class="jects-chatbot__pre"><code>${escapeHtml(body.join('\n'))}</code></pre>`,
      );
      continue;
    }

    // Blank line — paragraph break
    if (/^\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }

    // Heading # .. ######
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      const level = heading[1]!.length;
      html.push(`<h${level}>${renderInline(escapeHtml(heading[2]!))}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote >
    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*>\s?/, ''));
        i++;
      }
      const inner = items.map((l) => renderInline(escapeHtml(l))).join('<br>');
      html.push(`<blockquote>${inner}</blockquote>`);
      continue;
    }

    // Unordered list - * +
    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      html.push(`<ul>${items.map((t) => `<li>${renderInline(escapeHtml(t))}</li>`).join('')}</ul>`);
      continue;
    }

    // Ordered list 1. 2.
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      html.push(`<ol>${items.map((t) => `<li>${renderInline(escapeHtml(t))}</li>`).join('')}</ol>`);
      continue;
    }

    // Otherwise accumulate into a paragraph.
    para.push(line);
    i++;
  }

  flushPara();
  return html.join('');
}
