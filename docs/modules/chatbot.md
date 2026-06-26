# @jects/chatbot
> A framework-free, LLM-agnostic chat UI (`Chatbot`) — streaming replies, Markdown rendering and suggestions, built on `@jects/core`.

## Overview
`@jects/chatbot` provides a single `Chatbot` widget: a complete conversational chat UI with a message transcript, composer, suggested-reply chips, per-message avatars/timestamps, copy and clear actions, and safe Markdown rendering for assistant messages. It is provider-agnostic in the spirit of the Vercel AI SDK UI — you supply one `onSend` handler and the widget drives the rest, whether your model returns a single string or streams tokens.

Like the rest of Jects UI it is framework-free: it renders into a host element in the light DOM, is driven by an imperative API (`new Chatbot(host, config)` plus methods/events), and is themed through CSS custom properties (`--jects-*`). It has zero runtime model dependencies — the transport to OpenAI / Anthropic / a local model lives entirely in your `onSend`.

## Installation
```sh
pnpm add @jects/chatbot @jects/core @jects/widgets @jects/theme
```
`@jects/core`, `@jects/widgets` and `@jects/theme` are peer dependencies. The package ships ESM, is tree-shakeable, and has no framework dependency.

## Integration
Import the side-effect stylesheet once, alongside the `@jects/theme` base tokens:

```ts
import '@jects/theme/style.css';   // base design tokens (--jects-*)
import '@jects/chatbot/style.css'; // chat transcript + composer styles
import { Chatbot } from '@jects/chatbot';
```

**Vanilla TS** — construct against a host element (or a CSS selector string):

```ts
const bot = new Chatbot('#chat', { onSend });
```

**Framework wrappers (React / Angular / Vue)** — create the instance in a mount effect, keep it in a ref, and call `.destroy()` on unmount. React example:

```tsx
import { useEffect, useRef } from 'react';
import { Chatbot, type ChatbotConfig } from '@jects/chatbot';
import '@jects/theme/style.css';
import '@jects/chatbot/style.css';

export function Chat(props: { config: ChatbotConfig }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bot = new Chatbot(host.current!, props.config);
    return () => bot.destroy();
  }, []);
  return <div ref={host} style={{ height: 600 }} />;
}
```

### Wiring `onSend` to a streaming provider
`onSend` is the single integration point and is fully provider-agnostic. Its signature is:

```ts
type ChatSendHandler = (
  text: string,
  ctx: { messages: ReadonlyArray<ChatMessage>; signal: AbortSignal },
) =>
  | string                       // single-shot reply
  | Promise<string>              // async single-shot
  | AsyncIterable<string>        // streamed chunks
  | Promise<AsyncIterable<string>>;
```

- `text` is the user's submitted message; `ctx.messages` is the full history (including the just-added user turn) for context; `ctx.signal` aborts when the user calls `stop()`.
- Return a **string** (or a promise of one) for a single reply, or an **async iterable of string chunks** to stream — the widget appends each chunk live and emits `stream` per chunk, then `reply` at the end.

Stream from any token source. For example, with the Anthropic SDK:

```ts
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();

const onSend: ChatSendHandler = async function* (text, { messages, signal }) {
  const stream = client.messages.stream(
    {
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.text,
      })),
    },
    { signal },
  );
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text; // yield each token chunk
    }
  }
};
```

Any provider works the same way — yield string chunks from its stream (OpenAI deltas, a local model's tokens, an SSE/fetch body reader, etc.).

**Theming** is done entirely via `--jects-*` custom properties; see [Theming](#theming).

## Features
- **Provider-agnostic sends** — one `onSend` handler accepts a string, a promise, or an async iterable of chunks; no model SDK is bundled.
- **Streaming responses** — token/chunk streaming with live bubble updates, a `stream` event per chunk, and an `AbortSignal` for cancellation via `stop()`.
- **Markdown rendering** — assistant messages render through a tiny, safe-by-default Markdown renderer (headings, bold/italic, inline + fenced code, links, lists, blockquotes); input is HTML-escaped first. Swap in your own via `renderMarkdown`.
- **Message roles** — `user`, `assistant`, `system`, with per-message author name and avatar overrides.
- **Suggestions** — suggested-reply chips above the input that send on click (hidden once used).
- **Composer** — multi-line input (Enter to send, Shift+Enter for newline), placeholder, and a `disabled` state.
- **Per-message chrome** — optional avatars, timestamps, and a copy-to-clipboard action; a "Clear" toolbar action.
- **Imperative control** — `send()`, `addMessage()`, `clear()`, `focus()`, `stop()`, `getMessages()`, plus a live `store`.
- **Accessibility** — a polite, atomic status region announces each completed assistant reply once (rather than re-reading every streamed token).

## Quick start
A seeded conversation with a mock streaming provider (adapted from the gallery demo):

```ts
import '@jects/theme/style.css';
import '@jects/chatbot/style.css';
import { Chatbot } from '@jects/chatbot';

async function* mockStream(text: string) {
  const reply = `You said: **${text}**. This is a mock, LLM-agnostic reply — wire ` +
    '`onSend` to any provider. It:\n\n- streams token by token\n- renders `markdown`\n- supports suggestions';
  for (const word of reply.split(/(\s+)/)) {
    await new Promise((r) => setTimeout(r, 25));
    yield word;
  }
}

const bot = new Chatbot('#chat', {
  title: 'Assistant',
  placeholder: 'Ask me anything…',
  suggestions: ['What can you do?', 'Summarize this page'],
  messages: [
    { role: 'assistant', text: 'Hi! I am a demo bot. How can I help you today?' },
    { role: 'user', text: 'What is this gallery?' },
    { role: 'assistant', text: "It's a live showcase of the **Jects UI** library." },
  ],
  onSend: (text) => mockStream(text),
});

bot.on('reply', ({ message }) => console.log('assistant said:', message.text));
```

## Configuration
`ChatbotConfig` (extends the base `WidgetConfig`, so `cls` / `style` / `hidden` / `disabled` are also available).

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `messages` | `ChatMessage[]` | — | Initial transcript. |
| `onSend` | `ChatSendHandler` | — | The pluggable async send handler. Without it, sends only echo locally. |
| `placeholder` | `string` | — | Composer input placeholder. |
| `suggestions` | `string[]` | — | Suggested-reply chips above the input (hidden once a chip/send fires). |
| `title` | `string` | `'Chat'` | Accessible title/heading for the conversation. |
| `userName` | `string` | `'You'` | Display name for user messages. |
| `assistantName` | `string` | `'Assistant'` | Display name for assistant messages. |
| `userAvatar` | `string` | — | Avatar image URL for the user. |
| `assistantAvatar` | `string` | — | Avatar image URL for the assistant. |
| `showTimestamps` | `boolean` | `true` | Show per-message timestamps. |
| `showAvatars` | `boolean` | `true` | Show the avatars column. |
| `copyable` | `boolean` | `true` | Show the copy-message action on hover/focus. |
| `clearable` | `boolean` | `true` | Show the "Clear" toolbar action. |
| `disabled` | `boolean` | `false` | Disable the whole composer. |
| `renderMarkdown` | `(src: string) => string` | built-in | Custom Markdown renderer for assistant messages (must return TRUSTED HTML). |

**`ChatMessage`**: `id?` (auto-generated when omitted), `role: 'user' \| 'assistant' \| 'system'`, `text` (Markdown for assistant messages), `ts?` (epoch ms, defaults to now), `streaming?`, `name?` (per-message author override), `avatar?` (per-message avatar URL).

## Methods
Inherited from `Widget`: `update(patch)`, `getConfig()`, `show()`, `hide()`, `on(event, fn)`, `once()`, `off()`, `destroy()`, `isDestroyed`.

| Method | Description |
| --- | --- |
| `send(text)` | Send a message as if typed by the user (drives `onSend`). Returns `Promise<void>`. |
| `addMessage(message)` | Programmatically add a message to the transcript; returns the stored record. |
| `getMessages()` | Full transcript snapshot (`ChatMessage[]`). |
| `clear()` | Clear the entire transcript. |
| `focus()` | Focus the composer. |
| `stop()` | Cancel an in-flight streaming reply (aborts the `onSend` `signal`). |
| `store` | The live message `Store` (single source of truth for the transcript). |
| `destroy()` | Tear down the widget and its listeners. |

`clear()`, `focus()` and `stop()` return `this` for chaining.

### Helper exports
The module also exports the standalone Markdown helpers used internally:

- `renderMarkdown(src: string): string` — render a Markdown string to trusted HTML (input is HTML-escaped first).
- `escapeHtml(s: string): string` — escape the five HTML-significant characters.

## Events
Subscribe with `bot.on(name, handler)`. `beforeSend` is **vetoable**: return `false` from the handler to cancel the send. Every payload includes `chatbot`.

| Event | Payload | Fires when |
| --- | --- | --- |
| `beforeSend` | `{ text, chatbot }` | Before a send commits (return `false` to cancel, e.g. validation). |
| `send` | `{ text, message, chatbot }` | A user message was submitted. |
| `stream` | `{ chunk, message, chatbot }` | A streaming chunk arrived (per token/chunk). |
| `reply` | `{ message, chatbot }` | A streaming or single assistant reply finished. |
| `copy` | `{ message, chatbot }` | A message was copied to the clipboard. |
| `clear` | `{ chatbot }` | The transcript was cleared. |
| `error` | `{ error, chatbot }` | The `onSend` handler threw or rejected. |

## Examples

### Wiring `onSend` to a streamed fetch / SSE endpoint
```ts
const bot = new Chatbot('#chat', {
  title: 'Support',
  onSend: async function* (text, { messages, signal }) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal, // aborted by bot.stop()
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true }); // forward each chunk
    }
  },
});

bot.on('error', ({ error }) => console.error('chat failed', error));
```

### Validation veto + programmatic control
```ts
const bot = new Chatbot('#chat', { onSend });

// Block empty/over-long sends before they go out.
bot.on('beforeSend', ({ text }) => text.trim().length > 0 && text.length <= 4000);

// Drive it programmatically:
await bot.send('Hello there');
bot.addMessage({ role: 'system', text: 'Session resumed.' });
const transcript = bot.getMessages();
```

### Custom Markdown renderer
```ts
import { Chatbot } from '@jects/chatbot';
import { renderMarkdown } from '@jects/chatbot'; // or your own renderer

const bot = new Chatbot('#chat', {
  onSend,
  // Must return TRUSTED HTML — sanitize if your renderer allows raw HTML.
  renderMarkdown: (src) => myMarkdownIt.render(src),
});
```

## Theming
The chatbot consumes the standard Jects design tokens — set any `--jects-*` custom property on the host or an ancestor to retheme. Commonly used tokens:

- **Surfaces / text** — `--jects-background`, `--jects-foreground`, `--jects-card`, `--jects-card-foreground`, `--jects-muted`, `--jects-muted-foreground`, `--jects-border`.
- **Accent / focus** — `--jects-primary`, `--jects-primary-foreground`, `--jects-accent`, `--jects-accent-foreground`, `--jects-ring`.
- **Code / type** — `--jects-font-family`, `--jects-font-family-mono` (fenced/inline code), `--jects-font-size-{xs,sm,md}`, `--jects-font-weight-{medium,semibold}`.
- **Shape / motion / spacing** — `--jects-radius-{sm,md,lg,xl}`, `--jects-space-{1..6}`, `--jects-duration-fast`.

```css
#chat {
  --jects-primary: oklch(0.62 0.19 255);
  --jects-radius-lg: 14px;
}
```

Dark / high-contrast themes apply automatically when you switch the `@jects/theme` theme (e.g. via its `setTheme()` helper), which sets the token values on `<html>`.
