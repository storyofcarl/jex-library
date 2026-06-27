/**
 * XSS hardening suite for @jects/todo (docs/SECURITY.md surface #7 —
 * "Todo titles / comments / @mentions / notes").
 *
 * Injects the standard payloads into every caller-supplied text field that
 * reaches the DOM (task title, notes, tags, assignees, comment text + author,
 * resolved @mentions, attachment name + URL, group-by labels) and asserts:
 *   - a global flag never flips (no injected handler / scheme executes),
 *   - the rendered DOM carries no <script>/<iframe>/<object>/<embed>, no inline
 *     on* event-handler attribute, and no javascript:/vbscript:/data:text/html
 *     URL on any href/src, and
 *   - legitimate text + markup still render.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TodoList } from './todo-list.js';
import type { TodoTask, TodoListConfig } from './contract.js';

declare global {
  // eslint-disable-next-line no-var
  var __xss: boolean | undefined;
}

const PAYLOADS: readonly string[] = [
  '<img src=x onerror="globalThis.__xss=true">',
  '<script>globalThis.__xss=true</script>',
  '<svg onload="globalThis.__xss=true"></svg>',
  '"><iframe src="javascript:globalThis.__xss=true"></iframe>',
  '<a href="javascript:globalThis.__xss=true">click</a>',
  '<div style="background:url(javascript:globalThis.__xss=true)">x</div>',
  'data:text/html,<script>globalThis.__xss=true</script>',
];

let host: HTMLElement;

beforeEach(() => {
  globalThis.__xss = false;
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  globalThis.__xss = undefined;
});

/** Every element currently inside `host`, root included. */
function allElements(root: HTMLElement): HTMLElement[] {
  return [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
}

// Control chars / whitespace browsers ignore when resolving a URL scheme.
// eslint-disable-next-line no-control-regex -- intentionally matches C0 control chars used in URL-scheme obfuscation attacks
const URL_NOISE = new RegExp('[\u0000-\u0020]+', 'g');

/** Assert the rendered DOM contains no executable injection vector. */
function assertCleanDom(root: HTMLElement): void {
  // No dangerous elements smuggled in.
  expect(root.querySelectorAll('script, iframe, object, embed').length).toBe(0);

  for (const el of allElements(root)) {
    // No inline event-handler attributes.
    for (const attr of el.getAttributeNames()) {
      expect(attr.toLowerCase().startsWith('on')).toBe(false);
    }
    // No unsafe URL schemes on URL-bearing attributes.
    for (const a of ['href', 'src', 'xlink:href']) {
      const v = (el.getAttribute(a) ?? '').replace(URL_NOISE, '').toLowerCase();
      expect(v.startsWith('javascript:')).toBe(false);
      expect(v.startsWith('vbscript:')).toBe(false);
      expect(v.startsWith('data:text/html')).toBe(false);
    }
  }
}

const poisonTask = (): TodoTask => ({
  id: 't1',
  title: `Buy milk ${PAYLOADS[0]}`,
  notes: PAYLOADS.join('\n'),
  tags: [{ text: PAYLOADS[1]! }, { text: 'real-tag' }],
  assignees: [PAYLOADS[2]!, 'Ada Lovelace'],
  attachments: [
    { id: 'att1', name: PAYLOADS[3]!, url: 'javascript:globalThis.__xss=true' },
    { id: 'att2', name: 'spec.pdf', url: 'https://example.com/spec.pdf' },
  ],
  comments: [
    {
      id: 'c1',
      author: PAYLOADS[4]!,
      text: `Reviewed ${PAYLOADS[0]} cc @evil`,
      createdAt: Date.now(),
      mentions: ['evil<img src=x onerror="globalThis.__xss=true">'],
    },
  ],
});

const mk = (cfg: Partial<TodoListConfig> = {}): TodoList =>
  new TodoList(host, { tasks: [poisonTask()], ...cfg });

describe('@jects/todo — XSS hardening', () => {
  it('does not execute payloads injected into title / tags / assignees (list view)', () => {
    mk();
    assertCleanDom(host);
    expect(globalThis.__xss).toBe(false);
    // Legitimate title text survives (as text, not markup).
    expect(host.textContent).toContain('Buy milk');
    expect(host.textContent).toContain('real-tag');
  });

  it('does not execute payloads injected into comments / @mentions / attachments (detail panel)', () => {
    const todo = mk();
    todo.openDetail('t1');
    assertCleanDom(host);
    expect(globalThis.__xss).toBe(false);
    // Legitimate comment + attachment content survives.
    expect(host.textContent).toContain('Reviewed');
    // The benign https attachment keeps a live (safe) link...
    const safeLink = Array.from(host.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === 'https://example.com/spec.pdf',
    );
    expect(safeLink).toBeTruthy();
    // ...while the javascript: attachment URL is neutralized (no live js link).
    for (const a of host.querySelectorAll('a')) {
      expect((a.getAttribute('href') ?? '').toLowerCase()).not.toContain('javascript:');
    }
  });

  it('does not execute payloads in group-by header labels', () => {
    const todo = mk({ groupBy: 'tag' });
    void todo;
    assertCleanDom(host);
    expect(globalThis.__xss).toBe(false);
  });

  it('keeps the flag false after a microtask flush (deferred handlers)', async () => {
    const todo = mk();
    todo.openDetail('t1');
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    assertCleanDom(host);
    expect(globalThis.__xss).toBe(false);
  });
});
