/**
 * XSS hardening suite for the kanban card surface (docs/SECURITY.md surface #6).
 *
 * Card title / description / tags / links / comments are plain text and must be
 * HTML-escaped; rich `bodyItems[].html` must be routed through the shared
 * `sanitizeHtml`. This spec injects the standard payloads into every untrusted
 * field, renders the card body into a live (jsdom) DOM, and asserts that no
 * script/handler/javascript-url survives and that no handler/alert ever fires —
 * while legitimate text and safe formatting still render.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderCardBody } from './card.js';
import type { KanbanCard } from './types.js';

declare global {
  // eslint-disable-next-line no-var
  var __xss: boolean;
}

const PAYLOADS: readonly string[] = [
  '<img src=x onerror="window.__xss=true">',
  '<script>window.__xss=true</script>',
  '<a href="javascript:window.__xss=true">link</a>',
  '<svg onload="window.__xss=true"></svg>',
  '"><iframe src="javascript:window.__xss=true"></iframe>',
  '<a href="data:text/html,<script>window.__xss=true</script>">d</a>',
  '<div style="background:url(javascript:window.__xss=true)">x</div>',
];

/** Render a card body into a real element and run any synchronous side effects. */
function mount(card: KanbanCard): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderCardBody(card);
  document.body.appendChild(host);
  return host;
}

/** Assert the rendered DOM contains no executable vectors. */
function assertClean(host: HTMLElement): void {
  expect(host.querySelector('script')).toBeNull();
  expect(host.querySelector('iframe')).toBeNull();
  expect(host.querySelector('object')).toBeNull();
  expect(host.querySelector('embed')).toBeNull();
  for (const el of Array.from(host.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      // No inline event handlers.
      expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
      // No javascript:/vbscript:/data:text-html URLs in url-bearing attributes.
      if (attr.name === 'href' || attr.name === 'src') {
        const v = attr.value.toLowerCase().replace(/\s+/g, '');
        expect(v.startsWith('javascript:')).toBe(false);
        expect(v.startsWith('vbscript:')).toBe(false);
        expect(v.startsWith('data:text/html')).toBe(false);
      }
      if (attr.name === 'style') {
        expect(attr.value.toLowerCase()).not.toContain('javascript:');
        expect(attr.value.toLowerCase()).not.toContain('expression(');
      }
    }
  }
}

beforeEach(() => {
  globalThis.__xss = false;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('kanban card XSS hardening', () => {
  for (const payload of PAYLOADS) {
    it(`neutralizes payload in plain-text fields: ${payload.slice(0, 24)}`, () => {
      const card: KanbanCard = {
        id: 1,
        column: 'c',
        title: payload,
        description: payload,
        avatar: payload,
        tags: [{ text: payload, color: 1 }],
        links: [payload],
        comments: [{ author: payload, text: payload }],
        attachments: [{ name: payload, url: payload }],
      };
      const host = mount(card);
      expect(globalThis.__xss).toBe(false);
      assertClean(host);
    });

    it(`sanitizes payload in rich bodyItems.html: ${payload.slice(0, 24)}`, () => {
      const card: KanbanCard = {
        id: 2,
        column: 'c',
        title: 'Safe',
        bodyItems: [{ html: payload }],
      };
      const host = mount(card);
      expect(globalThis.__xss).toBe(false);
      assertClean(host);
    });
  }

  it('keeps the global flag false after rendering all payloads at once', () => {
    const card: KanbanCard = {
      id: 3,
      column: 'c',
      title: PAYLOADS.join(''),
      description: PAYLOADS.join(''),
      bodyItems: PAYLOADS.map((html) => ({ html })),
    };
    mount(card);
    expect(globalThis.__xss).toBe(false);
  });

  it('still renders legitimate text and safe formatting', () => {
    const card: KanbanCard = {
      id: 4,
      column: 'c',
      title: 'Ship the release',
      description: 'Review & merge',
      tags: [{ text: 'urgent', color: 2 }],
      bodyItems: [{ html: '<b>bold</b> and <em>em</em>' }],
    };
    const host = mount(card);
    expect(host.textContent).toContain('Ship the release');
    // Escaped ampersand round-trips to text content.
    expect(host.textContent).toContain('Review & merge');
    expect(host.textContent).toContain('urgent');
    // Safe formatting survives the sanitizer.
    expect(host.querySelector('b')).not.toBeNull();
    expect(host.querySelector('em')).not.toBeNull();
    expect(host.querySelector('b')?.textContent).toBe('bold');
  });
});
