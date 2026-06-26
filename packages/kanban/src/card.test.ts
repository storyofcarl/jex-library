/** jsdom unit tests for card rendering helpers. */

import { describe, expect, it } from 'vitest';
import { cardAccessibleLabel, escapeHtml, renderCardBody } from './card.js';
import type { KanbanCard } from './types.js';

describe('escapeHtml', () => {
  it('escapes HTML-significant chars', () => {
    expect(escapeHtml('<b>"&"</b>')).toBe('&lt;b&gt;&quot;&amp;&quot;&lt;/b&gt;');
  });
  it('renders nullish as empty', () => {
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(null)).toBe('');
  });
});

describe('renderCardBody', () => {
  const base: KanbanCard = { id: 1, column: 'c', title: 'Hi', description: 'There' };

  it('renders title + description', () => {
    const html = renderCardBody(base);
    expect(html).toContain('Hi');
    expect(html).toContain('There');
  });

  it('escapes user content (no XSS)', () => {
    const html = renderCardBody({ ...base, title: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('clamps progress to 0..100', () => {
    expect(renderCardBody({ ...base, progress: 150 })).toContain('width:100%');
    expect(renderCardBody({ ...base, progress: -5 })).toContain('width:0%');
  });

  it('renders avatar initials for non-url avatar', () => {
    const html = renderCardBody({ ...base, avatar: 'Jane Doe' });
    expect(html).toContain('jects-kanban-card__avatar--initials');
    expect(html).toContain('JA');
  });

  it('renders an <img> for url avatar', () => {
    const html = renderCardBody({ ...base, avatar: 'https://x/a.png' });
    expect(html).toContain('jects-kanban-card__avatar-img');
  });

  it('renders custom bodyItems', () => {
    const html = renderCardBody({ ...base, bodyItems: [{ text: 'extra' }] });
    expect(html).toContain('extra');
    expect(html).toContain('jects-kanban-card__body-item');
  });

  it('uses a custom renderer when provided', () => {
    const html = renderCardBody(base, (c) => `<x>${c.id}</x>`);
    expect(html).toBe('<x>1</x>');
  });

  it('renders a cover image', () => {
    const html = renderCardBody({ ...base, cover: 'https://x/cover.png' });
    expect(html).toContain('jects-kanban-card__cover');
    expect(html).toContain('https://x/cover.png');
  });

  it('renders attachment + comment count badges', () => {
    const html = renderCardBody({
      ...base,
      attachments: [{ name: 'a.pdf' }, { name: 'b.png', url: 'https://x/b' }],
      comments: [{ author: 'Jo', text: 'hi' }],
    });
    expect(html).toContain('jects-kanban-card__attachments');
    expect(html).toContain('jects-kanban-card__comments');
    // Counts.
    expect(html).toMatch(/jects-kanban-card__attachments[^>]*>📎 2/);
    expect(html).toMatch(/jects-kanban-card__comments[^>]*>💬 1/);
  });

  it('renders a toggleable vote button reflecting voted state', () => {
    const off = renderCardBody({ ...base, votes: { count: 3 } });
    expect(off).toContain('data-vote="1"');
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('👍 3');
    const on = renderCardBody({ ...base, votes: { count: 4, voted: true } });
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('jects-kanban-card__votes--on');
  });

  it('renders link chips for related card ids', () => {
    const html = renderCardBody({ ...base, links: [2, 'x9'] });
    expect(html).toContain('jects-kanban-card__link');
    expect(html).toContain('data-link="2"');
    expect(html).toContain('data-link="x9"');
  });
});

describe('cardAccessibleLabel', () => {
  it('uses the title', () => {
    expect(cardAccessibleLabel({ id: 1, column: 'c', title: 'Task' })).toBe('Task');
  });
  it('falls back to the id', () => {
    expect(cardAccessibleLabel({ id: 7, column: 'c' })).toBe('Card 7');
  });
});
