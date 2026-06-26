# @jects/chatbot — an LLM-agnostic, framework-free chat UI widget.

## What it is

`@jects/chatbot` provides a single `Chatbot` widget: a complete conversational UI with a message transcript, a composer, suggested-reply chips, per-message avatars/timestamps, copy and clear actions, and safe Markdown rendering for assistant messages. It is provider-agnostic — you supply one `onSend` handler and the widget drives the rest, whether your model returns a single string or streams tokens. Like the rest of the Jects UI suite it is framework-free: it renders into a host element, is driven by an imperative API, and is themed entirely through CSS custom properties.

## Install

```sh
pnpm add @jects/chatbot @jects/core @jects/widgets @jects/theme
```

`@jects/core`, `@jects/widgets`, and `@jects/theme` are peer dependencies. The package ships ESM (with a UMD build), is tree-shakeable, and bundles no model SDK — the transport to any provider lives entirely in your `onSend`.

## CSS

```ts
import '@jects/chatbot/style.css';
```

Import the side-effect stylesheet once, alongside the `@jects/theme` base tokens:

```ts
import '@jects/theme/style.css';   // base design tokens (--jects-*)
import '@jects/chatbot/style.css'; // chat transcript + composer styles
```

## Minimal example

```ts
import '@jects/theme/style.css';
import '@jects/chatbot/style.css';
import { Chatbot } from '@jects/chatbot';

const bot = new Chatbot('#chat', {
  title: 'Assistant',
  placeholder: 'Ask me anything…',
  onSend: (text) => `You said: **${text}**`,
});

// later, when tearing down:
bot.destroy();
```

The constructor accepts a host element or a CSS selector string as its first argument, and a `ChatbotConfig` as its second.

## Subpath exports

- `@jects/chatbot/style.css` — the side-effect stylesheet for the chat transcript and composer.

The package has a single code entry (`.`), which exports `Chatbot`, the helpers `renderMarkdown` and `escapeHtml`, and the types `ChatbotConfig`, `ChatbotEvents`, `ChatMessage`, `ChatRole`, and `ChatSendHandler`. No additional code subpaths; further subpaths are planned.

## Common recipes

### Stream from any provider

`onSend` is the single integration point. Return a `string` (or `Promise<string>`) for a single reply, or an `AsyncIterable<string>` of chunks to stream — the widget appends each chunk live, emits `stream` per chunk, then `reply` at the end. `ctx.signal` aborts when the user calls `stop()`.

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
      yield decoder.decode(value, { stream: true });
    }
  },
});
```

### Seed a conversation with suggestions

```ts
const bot = new Chatbot('#chat', {
  suggestions: ['What can you do?', 'Summarize this page'],
  messages: [
    { role: 'assistant', text: 'Hi! How can I help you today?' },
  ],
  onSend,
});
```

### Validation veto and programmatic control

```ts
// Block empty / over-long sends before they go out (return false to cancel).
bot.on('beforeSend', ({ text }) => text.trim().length > 0 && text.length <= 4000);

await bot.send('Hello there');
bot.addMessage({ role: 'system', text: 'Session resumed.' });
const transcript = bot.getMessages();
```

### Custom Markdown renderer

```ts
const bot = new Chatbot('#chat', {
  onSend,
  // Must return TRUSTED HTML — sanitize if your renderer allows raw HTML.
  renderMarkdown: (src) => myRenderer.render(src),
});
```

The standalone helpers `renderMarkdown(src)` and `escapeHtml(s)` used internally are also exported from the package root.

## Events

Subscribe with `bot.on(name, handler)`. `beforeSend` is vetoable — return `false` to cancel the send. Every payload includes `chatbot`.

| Event | Payload | Fires when |
| --- | --- | --- |
| `beforeSend` | `{ text, chatbot }` | Before a send commits (return `false` to cancel). |
| `send` | `{ text, message, chatbot }` | A user message was submitted. |
| `stream` | `{ chunk, message, chatbot }` | A streaming chunk arrived (per token/chunk). |
| `reply` | `{ message, chatbot }` | A streaming or single assistant reply finished. |
| `copy` | `{ message, chatbot }` | A message was copied to the clipboard. |
| `clear` | `{ chatbot }` | The transcript was cleared. |
| `error` | `{ error, chatbot }` | The `onSend` handler threw or rejected. |

Imperative control: `send()`, `addMessage()`, `getMessages()`, `clear()`, `focus()`, `stop()`, plus the live `store` and the inherited `Widget` methods (`update`, `on`/`once`/`off`, `show`/`hide`, `destroy`).

## Theming

The chatbot is themed entirely via `--jects-*` CSS custom properties (surfaces, accent/focus, type, shape, spacing) — set any of them on the host or an ancestor to retheme; include `@jects/theme` for the base tokens and to switch dark/high-contrast themes. See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

The composer is fully keyboard-driven (Enter to send, Shift+Enter for a newline), and a polite, atomic ARIA status region announces each completed assistant reply once rather than re-reading every streamed token.

## Stability & support

Beta — the widget has a focused API with unit and browser (axe-core) test coverage, but the surface may still evolve. Part of the Jects UI suite. Commercial terms: see LICENSE.md.

---

Repo: <https://github.com/storyofcarl/jex-library> · Live demo: <https://jexlibrary.vercel.app>
