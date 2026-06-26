/**
 * Chatbot stories — framework-free usage examples for the docs app and as a
 * canonical reference. Each story returns a host-mounting function.
 *
 * The handlers here are MOCK providers (no real LLM) that demonstrate the two
 * shapes the host's `onSend` may return: a single string, or a streaming
 * AsyncIterable. Swap them for any provider (OpenAI, Anthropic, local, …).
 */
import { Chatbot, type ChatbotConfig } from './chatbot.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Chatbot;
}

const story = (name: string, config: ChatbotConfig): Story => ({
  name,
  render: (host) => new Chatbot(host, config),
});

/** A mock streaming provider: echoes the prompt word-by-word with a small delay. */
async function* mockStream(text: string): AsyncIterable<string> {
  const reply = `You said: "${text}". Here's a **streamed** reply with a list:\n\n- point one\n- point two\n\nAnd some \`inline code\`.`;
  for (const word of reply.split(/(\s+)/)) {
    await new Promise((r) => setTimeout(r, 30));
    yield word;
  }
}

export const stories: Story[] = [
  story('Empty (single-shot reply)', {
    title: 'Assistant',
    placeholder: 'Ask me anything…',
    suggestions: ['What can you do?', 'Tell me a joke', 'Summarize this page'],
    onSend: async (text) => `You said: **${text}**. (This is a non-streaming mock reply.)`,
  }),

  story('Streaming', {
    title: 'Streaming bot',
    suggestions: ['Stream a demo', 'Explain markdown'],
    onSend: (text) => mockStream(text),
  }),

  story('Seeded conversation', {
    title: 'Support',
    messages: [
      { role: 'assistant', text: 'Hi! How can I help you today?' },
      { role: 'user', text: 'My order is late.' },
      {
        role: 'assistant',
        text: "Sorry to hear that. Could you share your **order number**? Meanwhile, see our [shipping policy](https://example.com/shipping).",
      },
    ],
    onSend: (text) => mockStream(text),
  }),

  story('With avatars + names', {
    title: 'Pairing',
    userName: 'Carl',
    assistantName: 'Ada',
    userAvatar: 'https://i.pravatar.cc/64?img=11',
    assistantAvatar: 'https://i.pravatar.cc/64?img=5',
    messages: [
      { role: 'user', text: 'Ready when you are.' },
      { role: 'assistant', text: 'Great — let us begin.' },
    ],
    onSend: async (text) => `Got it: ${text}`,
  }),

  story('No timestamps, no avatars', {
    title: 'Minimal',
    showTimestamps: false,
    showAvatars: false,
    messages: [
      { role: 'user', text: 'Compact mode' },
      { role: 'assistant', text: 'A leaner layout.' },
    ],
    onSend: async () => 'ok',
  }),

  story('Disabled', {
    title: 'Read-only',
    disabled: true,
    messages: [{ role: 'assistant', text: 'This conversation is closed.' }],
  }),
];
