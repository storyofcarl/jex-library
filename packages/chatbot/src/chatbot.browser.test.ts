/**
 * Real-Chromium browser-mode test (Vitest browser mode + Playwright).
 * Run with `pnpm --filter @jects/chatbot test:browser`.
 * Verifies render, streaming, keyboard send, and auto-scroll against a real layout engine.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Chatbot } from './chatbot.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  host.style.height = '400px';
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('Chatbot (real Chromium)', () => {
  it('renders bubbles with the expected classes', () => {
    const c = new Chatbot(host, {
      messages: [
        { role: 'user', text: 'Hi' },
        { role: 'assistant', text: 'Hello' },
      ],
    });
    expect(host.querySelector('.jects-chatbot__msg--user')).toBeTruthy();
    expect(host.querySelector('.jects-chatbot__msg--assistant')).toBeTruthy();
    expect(host.querySelector('.jects-chatbot__list')!.getAttribute('role')).toBe('log');
    c.destroy();
  });

  it('Enter sends, Shift+Enter does not', async () => {
    const onSend = vi.fn(async () => 'ok');
    const c = new Chatbot(host, { onSend });
    const ta = host.querySelector('.jects-chatbot__textarea-wrap textarea') as HTMLTextAreaElement;
    ta.value = 'hello';
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    // Shift+Enter must NOT send.
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    await tick();
    expect(onSend).not.toHaveBeenCalled();

    // Enter sends.
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    expect(onSend).toHaveBeenCalledTimes(1);
    c.destroy();
  });

  it('streams chunks into the assistant bubble', async () => {
    async function* gen(): AsyncIterable<string> {
      yield 'Strea';
      yield 'ming';
    }
    const c = new Chatbot(host, { onSend: () => gen() });
    await c.send('go');
    const bubble = host.querySelector('.jects-chatbot__msg--assistant .jects-chatbot__bubble')!;
    expect(bubble.textContent).toContain('Streaming');
    c.destroy();
  });

  it('auto-scrolls to the latest message', async () => {
    const c = new Chatbot(host, {});
    for (let i = 0; i < 40; i++) c.addMessage({ role: 'user', text: `message number ${i}` });
    const list = host.querySelector('.jects-chatbot__list') as HTMLElement;
    // After appending many, the list should be scrolled near the bottom.
    expect(list.scrollHeight - list.scrollTop - list.clientHeight).toBeLessThan(64);
    c.destroy();
  });

  it('send button is a real, focusable button', () => {
    const c = new Chatbot(host, {});
    const btn = host.querySelector('.jects-chatbot__send button') as HTMLButtonElement;
    expect(btn.tagName).toBe('BUTTON');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    c.destroy();
  });

  // ---- visual / interaction smoke ----------------------------------------
  // Send a message → a user bubble renders and the input clears; the rendered
  // bubble is laid out inside (not clipped by) the scrollable message list.
  it('smoke: sending a message renders a bubble and clears the input', async () => {
    const onSend = vi.fn(async () => 'pong');
    const c = new Chatbot(host, { onSend });

    const ta = host.querySelector('.jects-chatbot__textarea-wrap textarea') as HTMLTextAreaElement;
    ta.value = 'ping the bot';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ta.value).toBe('ping the bot');

    // Submit via Enter.
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    await tick();

    expect(onSend).toHaveBeenCalledTimes(1);

    // A user bubble rendered with the typed text.
    const userBubble = host.querySelector(
      '.jects-chatbot__msg--user .jects-chatbot__bubble',
    ) as HTMLElement;
    expect(userBubble).toBeTruthy();
    expect(userBubble.textContent).toContain('ping the bot');

    // The input cleared after sending.
    expect(ta.value).toBe('');

    // The assistant reply bubble rendered too.
    const reply = host.querySelector(
      '.jects-chatbot__msg--assistant .jects-chatbot__bubble',
    ) as HTMLElement;
    expect(reply.textContent).toContain('pong');

    // Layout smoke: the rendered user bubble is visible and sits within the
    // scrollable list's box (not collapsed to zero size or clipped outside it).
    const list = host.querySelector('.jects-chatbot__list') as HTMLElement;
    const listBox = list.getBoundingClientRect();
    const bubbleBox = userBubble.getBoundingClientRect();
    expect(bubbleBox.width).toBeGreaterThan(0);
    expect(bubbleBox.height).toBeGreaterThan(0);
    // The bubble's left/right edges fall within the list's content box.
    expect(bubbleBox.left).toBeGreaterThanOrEqual(listBox.left - 1);
    expect(bubbleBox.right).toBeLessThanOrEqual(listBox.right + 1);

    c.destroy();
  });

  // The chatbot reuses @jects/widgets controls (Button/TextArea/Avatar); it
  // mounts no body-level popup/editor. Assert it stays self-contained: every
  // owned node lives under the single root element (no detached/body-level
  // overlay leaked), and the root is the only chatbot in the document.
  it('smoke: no body-level popup/editor leaks; widget stays self-contained', async () => {
    const onSend = vi.fn(async () => 'reply');
    const c = new Chatbot(host, { onSend, suggestions: ['Hi'] });
    await c.send('hello');
    await tick();

    // Exactly one chatbot root, and it is inside our host (not re-parented to body).
    const roots = document.querySelectorAll('.jects-chatbot');
    expect(roots.length).toBe(1);
    expect(host.contains(roots[0]!)).toBe(true);

    // No chatbot-owned element escaped to document.body as a direct child.
    for (const child of Array.from(document.body.children)) {
      if (child === host) continue;
      expect(child.querySelector('.jects-chatbot')).toBeNull();
    }

    c.destroy();
    // After destroy nothing is left behind anywhere in the document.
    expect(document.querySelector('.jects-chatbot')).toBeNull();
  });
});
