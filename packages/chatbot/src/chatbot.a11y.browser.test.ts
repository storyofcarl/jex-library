/**
 * axe-core accessibility test for Chatbot (real Chromium via Vitest browser mode).
 * Run with `pnpm --filter @jects/chatbot test:browser`.
 * Asserts zero serious/critical violations (Quality Gate Q2).
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { Chatbot } from './chatbot.js';
import { expectNoA11yViolations } from './test-utils/a11y.js';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  host.style.height = '480px';
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('Chatbot a11y (axe-core)', () => {
  it('empty chatbot has no serious/critical violations', async () => {
    const c = new Chatbot(host, { title: 'Support chat' });
    await expectNoA11yViolations(host);
    c.destroy();
  });

  it('populated chatbot with suggestions is accessible', async () => {
    const c = new Chatbot(host, {
      title: 'Assistant',
      messages: [
        { role: 'user', text: 'How do I reset my password?' },
        { role: 'assistant', text: 'Click **Settings**, then *Security*. See [help](https://example.com).' },
      ],
      suggestions: ['Thanks!', 'Tell me more'],
    });
    await expectNoA11yViolations(host);
    c.destroy();
  });

  it('streaming state is accessible', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    async function* gen(): AsyncIterable<string> {
      await gate;
      yield 'Answer';
    }
    const c = new Chatbot(host, { onSend: () => gen() });
    const p = c.send('hello');
    await new Promise((r) => setTimeout(r, 0));
    await expectNoA11yViolations(host);
    release();
    await p;
    c.destroy();
  });
});
