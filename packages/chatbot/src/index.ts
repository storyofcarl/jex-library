/**
 * @jects/chatbot — Jects UI chatbot / conversation component built on @jects/core.
 *
 * An LLM-agnostic chat UI widget: message list with user/assistant bubbles,
 * avatars, timestamps, Markdown-rendered assistant messages, a multiline
 * composer (Enter to send, Shift+Enter for newline), a streaming/typing
 * indicator, suggested-reply chips, auto-scroll, copy-message and clear.
 *
 * It ships NO LLM or backend code. The host wires it to any provider through a
 * single pluggable async `onSend` handler that returns a string or an
 * `AsyncIterable<string>` (for token streaming).
 *
 * Importing this module registers the widget with the factory (type `chatbot`).
 *
 * Side-effect CSS: `import '@jects/chatbot/style.css'`.
 */

import './styles.css';

export {
  Chatbot,
  type ChatbotConfig,
  type ChatbotEvents,
  type ChatMessage,
  type ChatRole,
  type ChatSendHandler,
} from './chatbot.js';

export { renderMarkdown, escapeHtml } from './markdown.js';
