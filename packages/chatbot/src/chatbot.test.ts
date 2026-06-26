/** jsdom unit test — runs in the default `pnpm test`. Browser/a11y suites are separate. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Chatbot } from './chatbot.js';
import type { ChatMessage } from './chatbot.js';
import { getCtor, isRegistered } from '@jects/core';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

/** Flush microtasks/promise chains. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('Chatbot (jsdom)', () => {
  it('renders the root, list (role=log), composer and is registered', () => {
    const c = new Chatbot(host, {});
    const root = host.querySelector('.jects-chatbot')!;
    expect(root).toBeTruthy();
    const list = host.querySelector('.jects-chatbot__list')!;
    expect(list.getAttribute('role')).toBe('log');
    expect(list.getAttribute('aria-live')).toBe('polite');
    expect(host.querySelector('.jects-chatbot__composer')).toBeTruthy();
    expect(host.querySelector('.jects-chatbot__textarea-wrap textarea')).toBeTruthy();
    expect(isRegistered('chatbot')).toBe(true);
    expect(getCtor('chatbot')).toBeTruthy();
    c.destroy();
  });

  it('seeds initial messages into the transcript', () => {
    const messages: ChatMessage[] = [
      { role: 'user', text: 'Hi' },
      { role: 'assistant', text: 'Hello **there**' },
    ];
    const c = new Chatbot(host, { messages });
    const rows = host.querySelectorAll('.jects-chatbot__msg');
    expect(rows.length).toBe(2);
    expect(host.querySelector('.jects-chatbot__msg--user')!.textContent).toContain('Hi');
    // Assistant markdown is rendered to HTML.
    expect(host.querySelector('.jects-chatbot__msg--assistant strong')!.textContent).toBe('there');
    expect(c.getMessages().length).toBe(2);
    c.destroy();
  });

  it('escapes user message HTML (no injection)', () => {
    const c = new Chatbot(host, { messages: [{ role: 'user', text: '<img src=x onerror=1>' }] });
    const bubble = host.querySelector('.jects-chatbot__msg--user .jects-chatbot__bubble')!;
    expect(bubble.querySelector('img')).toBeNull();
    expect(bubble.textContent).toContain('<img');
    c.destroy();
  });

  it('addMessage appends and updates the store', () => {
    const c = new Chatbot(host, {});
    c.addMessage({ role: 'user', text: 'first' });
    c.addMessage({ role: 'assistant', text: 'second' });
    expect(host.querySelectorAll('.jects-chatbot__msg').length).toBe(2);
    expect(c.store.count).toBe(2);
    c.destroy();
  });

  it('send() adds a user message and emits send + beforeSend', async () => {
    const c = new Chatbot(host, {});
    const before = vi.fn();
    const send = vi.fn();
    c.on('beforeSend', before);
    c.on('send', send);
    await c.send('Hello bot');
    expect(before).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].text).toBe('Hello bot');
    expect(host.querySelector('.jects-chatbot__msg--user')!.textContent).toContain('Hello bot');
    c.destroy();
  });

  it('beforeSend veto cancels the send', async () => {
    const c = new Chatbot(host, {});
    const send = vi.fn();
    c.on('beforeSend', () => false);
    c.on('send', send);
    await c.send('nope');
    expect(send).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.jects-chatbot__msg').length).toBe(0);
    c.destroy();
  });

  it('onSend returning a string produces a single assistant reply', async () => {
    const onSend = vi.fn(async (text: string) => `echo: ${text}`);
    const c = new Chatbot(host, { onSend });
    const reply = vi.fn();
    c.on('reply', reply);
    await c.send('ping');
    await tick();
    expect(onSend).toHaveBeenCalledTimes(1);
    const assistant = host.querySelector('.jects-chatbot__msg--assistant .jects-chatbot__bubble')!;
    expect(assistant.textContent).toContain('echo: ping');
    expect(reply).toHaveBeenCalledTimes(1);
    c.destroy();
  });

  it('onSend context history ends with the user turn, not an empty assistant placeholder', async () => {
    let seen: ReadonlyArray<{ role: string; text: string }> | undefined;
    const onSend = vi.fn(async (_text: string, ctx: { messages: ReadonlyArray<ChatMessage> }) => {
      seen = ctx.messages.map((m) => ({ role: m.role, text: m.text }));
      return 'ok';
    });
    const c = new Chatbot(host, { onSend });
    await c.send('What is 2+2?');
    await tick();
    expect(seen).toBeTruthy();
    const last = seen![seen!.length - 1]!;
    // The contract: history handed to the host's LLM ends with the just-added
    // USER turn — never a trailing empty/assistant message.
    expect(last.role).toBe('user');
    expect(last.text).toBe('What is 2+2?');
    // And there must be no empty assistant placeholder anywhere in the context.
    expect(seen!.some((m) => m.role === 'assistant' && m.text === '')).toBe(false);
    c.destroy();
  });

  it('streaming bubble is aria-busy/aria-hidden while streaming, cleared on finish', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    async function* gen(): AsyncIterable<string> {
      yield 'partial';
      await gate;
      yield ' done';
    }
    const c = new Chatbot(host, { onSend: () => gen() });
    const p = c.send('hi');
    await tick();
    const bubble = host.querySelector(
      '.jects-chatbot__msg--assistant .jects-chatbot__bubble',
    ) as HTMLElement;
    // Mid-stream: the growing bubble is hidden from the live region.
    expect(bubble.getAttribute('aria-busy')).toBe('true');
    expect(bubble.getAttribute('aria-hidden')).toBe('true');
    release();
    await p;
    // Finished: flags cleared and the completed reply is exposed.
    expect(bubble.hasAttribute('aria-busy')).toBe(false);
    expect(bubble.hasAttribute('aria-hidden')).toBe(false);
    // The polite status node carries the completed reply for a single announce.
    const status = host.querySelector('.jects-chatbot__status')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toContain('partial done');
    c.destroy();
  });

  it('message log is additions-only (does not re-announce streamed text)', () => {
    const c = new Chatbot(host, {});
    const list = host.querySelector('.jects-chatbot__list')!;
    expect(list.getAttribute('aria-live')).toBe('polite');
    expect(list.getAttribute('aria-relevant')).toBe('additions');
    c.destroy();
  });

  it('onSend returning an AsyncIterable streams chunks and emits stream/reply', async () => {
    async function* gen(): AsyncIterable<string> {
      yield 'Hel';
      yield 'lo ';
      yield 'world';
    }
    const c = new Chatbot(host, { onSend: () => gen() });
    const stream = vi.fn();
    const reply = vi.fn();
    c.on('stream', stream);
    c.on('reply', reply);
    await c.send('hi');
    const assistant = host.querySelector('.jects-chatbot__msg--assistant .jects-chatbot__bubble')!;
    expect(assistant.textContent).toContain('Hello world');
    expect(stream).toHaveBeenCalledTimes(3);
    expect(reply).toHaveBeenCalledTimes(1);
    c.destroy();
  });

  it('onSend rejection emits error and still ends streaming', async () => {
    const c = new Chatbot(host, {
      onSend: () => Promise.reject(new Error('boom')),
    });
    const err = vi.fn();
    c.on('error', err);
    await c.send('x');
    await tick();
    expect(err).toHaveBeenCalledTimes(1);
    // Composer is no longer busy (send button not loading-disabled forever).
    const sendBtn = host.querySelector('.jects-chatbot__send button') as HTMLButtonElement;
    expect(sendBtn.getAttribute('aria-busy')).toBe('false');
    c.destroy();
  });

  it('typing indicator shows for an empty streaming bubble', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    async function* gen(): AsyncIterable<string> {
      await gate;
      yield 'done';
    }
    const c = new Chatbot(host, { onSend: () => gen() });
    const p = c.send('hi');
    await tick();
    // While awaiting the first chunk the assistant bubble is empty + streaming.
    expect(host.querySelector('.jects-chatbot__typing')).toBeTruthy();
    release();
    await p;
    expect(host.querySelector('.jects-chatbot__typing')).toBeNull();
    c.destroy();
  });

  it('suggestion chips render and clicking one sends it', async () => {
    const onSend = vi.fn(async () => 'ok');
    const c = new Chatbot(host, { suggestions: ['Tell me a joke', 'Help'], onSend });
    const chips = host.querySelectorAll('.jects-chatbot__chip');
    expect(chips.length).toBe(2);
    (chips[0] as HTMLButtonElement).click();
    await tick();
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]![0]).toBe('Tell me a joke');
    // Suggestions hide after use.
    expect(host.querySelector('.jects-chatbot__suggestions')!.hasAttribute('hidden')).toBe(true);
    c.destroy();
  });

  it('copy action writes message text to the clipboard and emits copy', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const c = new Chatbot(host, { messages: [{ role: 'assistant', text: 'copy me' }] });
    const copyEvt = vi.fn();
    c.on('copy', copyEvt);
    const copyBtn = host.querySelector('.jects-chatbot__copy') as HTMLButtonElement;
    expect(copyBtn).toBeTruthy();
    copyBtn.click();
    await tick();
    expect(writeText).toHaveBeenCalledWith('copy me');
    expect(copyEvt).toHaveBeenCalledTimes(1);
    c.destroy();
  });

  it('clear empties the transcript and emits clear', () => {
    const c = new Chatbot(host, { messages: [{ role: 'user', text: 'a' }] });
    const cleared = vi.fn();
    c.on('clear', cleared);
    c.clear();
    expect(host.querySelectorAll('.jects-chatbot__msg').length).toBe(0);
    expect(c.store.count).toBe(0);
    expect(cleared).toHaveBeenCalledTimes(1);
    c.destroy();
  });

  it('Clear toolbar button is disabled when empty', () => {
    const c = new Chatbot(host, {});
    const clearBtn = host.querySelector('.jects-chatbot__toolbar button') as HTMLButtonElement;
    expect(clearBtn.disabled).toBe(true);
    c.addMessage({ role: 'user', text: 'x' });
    expect(clearBtn.disabled).toBe(false);
    c.destroy();
  });

  it('update() re-renders title and disabled state', () => {
    const c = new Chatbot(host, { title: 'Old' });
    c.update({ title: 'New', disabled: true });
    expect(host.querySelector('.jects-chatbot__title')!.textContent).toBe('New');
    expect(host.querySelector('.jects-chatbot')!.classList.contains('jects-chatbot--disabled')).toBe(
      true,
    );
    c.destroy();
  });

  it('destroy removes the element and is idempotent', () => {
    const c = new Chatbot(host, { messages: [{ role: 'user', text: 'bye' }] });
    c.destroy();
    expect(host.querySelector('.jects-chatbot')).toBeNull();
    expect(() => c.destroy()).not.toThrow();
    expect(c.isDestroyed).toBe(true);
  });

  it('does not send empty / whitespace-only input', async () => {
    const onSend = vi.fn(async () => 'x');
    const c = new Chatbot(host, { onSend });
    await c.send('   ');
    expect(onSend).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.jects-chatbot__msg').length).toBe(0);
    c.destroy();
  });
});
