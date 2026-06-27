/**
 * Chatbot — an LLM-agnostic chat UI widget.
 *
 * This component is pure UI. It contains NO LLM client, network code, or
 * provider SDK. The host wires it to any backend through a single pluggable
 * async `onSend` handler that returns either:
 *
 *   - a `string` / `Promise<string>`        → shown as a single assistant reply, or
 *   - an `AsyncIterable<string>`            → streamed token-by-token into the bubble.
 *
 * Mirrors the Button reference pattern: typed `Config`/`Events`, `defaults()`,
 * `buildEl()` (listeners wired with bound methods so field-init order is safe),
 * idempotent `render()`, factory registration, and `destroy()` that disposes
 * everything via the protected helpers.
 *
 * Reuses @jects/widgets controls: TextArea (input), Button (send / copy / clear),
 * Avatar (per-message avatars). Messages are held in a @jects/core Store.
 *
 * Accessibility: the message list is a `role="log"` live region (polite,
 * additions-only) so newly-added bubbles are announced but streaming tokens are
 * not re-announced; a streaming bubble is marked `aria-busy`/`aria-hidden` while
 * tokens arrive and the COMPLETED reply is announced once via a dedicated polite
 * `role="status"` node. The input is a labeled multiline textbox; Enter sends,
 * Shift+Enter inserts a newline; suggested replies and copy/clear are real buttons.
 */

import {
  Widget,
  Store,
  createEl,
  register,
  escapeHtml,
  setHtml,
  safeHtml,
  staticHtml,
  trustedHtml,
  type WidgetConfig,
  type WidgetEvents,
  type RecordId,
} from '@jects/core';
import { Button, TextArea, Avatar, type AvatarConfig } from '@jects/widgets';
import { renderMarkdown as defaultRenderMarkdown } from './markdown.js';

export type ChatRole = 'user' | 'assistant' | 'system';

/** A message as held in the Store (id is always present; index signature for the Model constraint). */
export type StoredMessage = ChatMessage & { id: RecordId } & Record<string, unknown>;

export interface ChatMessage {
  /** Stable id. Auto-generated when omitted. */
  id?: RecordId;
  /** Who authored the message. */
  role: ChatRole;
  /** Raw message text (Markdown for assistant messages). */
  text: string;
  /** Authored-at epoch ms. Defaults to now. */
  ts?: number;
  /** True while an assistant message is still streaming. */
  streaming?: boolean;
  /** Optional per-message author display name (overrides role defaults). */
  name?: string;
  /** Optional per-message avatar image URL. */
  avatar?: string;
}

/**
 * The pluggable send handler. The host returns the assistant's reply as a
 * string (single shot) or an AsyncIterable of string chunks (streaming).
 * `text` is the user's submitted message; `messages` is the full history
 * (including the just-added user turn) for context.
 */
export type ChatSendHandler = (
  text: string,
  ctx: { messages: ReadonlyArray<ChatMessage>; signal: AbortSignal },
) => string | Promise<string> | AsyncIterable<string> | Promise<AsyncIterable<string>>;

export interface ChatbotConfig extends WidgetConfig {
  /** Initial messages. */
  messages?: ChatMessage[];
  /** The pluggable async send handler. Without it, sending only echoes locally. */
  onSend?: ChatSendHandler;
  /** Input placeholder text. */
  placeholder?: string;
  /** Suggested-reply chips shown above the input (hidden once a chip/send fires). */
  suggestions?: string[];
  /** Accessible title/heading for the conversation. Default "Chat". */
  title?: string;
  /** Display name for user messages. Default "You". */
  userName?: string;
  /** Display name for assistant messages. Default "Assistant". */
  assistantName?: string;
  /** Avatar image URL for the user. */
  userAvatar?: string;
  /** Avatar image URL for the assistant. */
  assistantAvatar?: string;
  /** Show per-message timestamps. Default true. */
  showTimestamps?: boolean;
  /** Show the avatars column. Default true. */
  showAvatars?: boolean;
  /** Show the copy-message action on hover/focus. Default true. */
  copyable?: boolean;
  /** Show the "Clear" toolbar action. Default true. */
  clearable?: boolean;
  /** Disable the whole composer. */
  disabled?: boolean;
  /** Custom Markdown renderer for assistant messages (must return TRUSTED html). */
  renderMarkdown?: (src: string) => string;
}

export interface ChatbotEvents extends WidgetEvents {
  /** Vetoable: return `false` to cancel a send (e.g. validation). */
  beforeSend: { text: string; chatbot: Chatbot };
  /** A user message was submitted. */
  send: { text: string; message: ChatMessage; chatbot: Chatbot };
  /** A streaming/single assistant reply finished. */
  reply: { message: ChatMessage; chatbot: Chatbot };
  /** A streaming chunk arrived (per token/chunk). */
  stream: { chunk: string; message: ChatMessage; chatbot: Chatbot };
  /** A message was copied to the clipboard. */
  copy: { message: ChatMessage; chatbot: Chatbot };
  /** The transcript was cleared. */
  clear: { chatbot: Chatbot };
  /** The onSend handler threw / rejected. */
  error: { error: unknown; chatbot: Chatbot };
}

let msgSeq = 0;

const ROLE_LABELS: Record<ChatRole, string> = {
  user: 'You',
  assistant: 'Assistant',
  system: 'System',
};

/**
 * Per-instance mutable state. Under `useDefineForClassFields`, subclass field
 * initializers run AFTER `super()` — and `super()` already calls `render()`.
 * Any work render()/buildEl() store in instance FIELDS would be wiped by that
 * later field (re)definition. We therefore keep ALL mutable state in this
 * module-level WeakMap, which is not an instance field and so survives intact.
 */
interface Internals {
  store: Store<StoredMessage>;
  avatars: Map<RecordId, Avatar>;
  input?: TextArea;
  sendBtn?: Button;
  clearBtn?: Button;
  busy: boolean;
  suggestionsDismissed: boolean;
  abort: AbortController | null;
}

const STATE = new WeakMap<Chatbot, Internals>();

export class Chatbot extends Widget<ChatbotConfig, ChatbotEvents> {
  /** Resolve (lazily create) this instance's persistent state. */
  private get s(): Internals {
    let st = STATE.get(this);
    if (!st) {
      st = {
        store: new Store<StoredMessage>({ idField: 'id' }),
        avatars: new Map<RecordId, Avatar>(),
        busy: false,
        suggestionsDismissed: false,
        abort: null,
      };
      STATE.set(this, st);
    }
    return st;
  }

  /** Message store (single source of truth for the transcript). */
  get store(): Store<StoredMessage> {
    return this.s.store;
  }

  // ---- lazy element refs (never cache as class fields: field-init order) ----
  private get listEl(): HTMLElement {
    return this.el.querySelector('.jects-chatbot__list')!;
  }
  private get composerEl(): HTMLElement {
    return this.el.querySelector('.jects-chatbot__composer')!;
  }
  private get suggestEl(): HTMLElement {
    return this.el.querySelector('.jects-chatbot__suggestions')!;
  }
  private get toolbarEl(): HTMLElement {
    return this.el.querySelector('.jects-chatbot__toolbar')!;
  }
  private get statusEl(): HTMLElement {
    return this.el.querySelector('.jects-chatbot__status')!;
  }

  protected override defaults(): Partial<ChatbotConfig> {
    return {
      placeholder: 'Type a message…',
      title: 'Chat',
      userName: 'You',
      assistantName: 'Assistant',
      showTimestamps: true,
      showAvatars: true,
      copyable: true,
      clearable: true,
    };
  }

  protected buildEl(): HTMLElement {
    const root = createEl('div', {
      className: 'jects-chatbot',
      attrs: { role: 'group' },
    });

    const header = createEl('div', { className: 'jects-chatbot__header' });
    const heading = createEl('div', { className: 'jects-chatbot__title' });
    const toolbar = createEl('div', { className: 'jects-chatbot__toolbar' });
    header.append(heading, toolbar);

    // The message log announces *additions* only (new bubbles). It deliberately
    // does NOT use `aria-relevant="text"`: while an assistant reply streams,
    // each token rewrites the bubble's text, and a text-relevant live region
    // would re-announce the whole growing message on every chunk (garbled /
    // interrupting). Streaming bubbles are marked `aria-busy` and their partial
    // text is suppressed; the completed reply is announced once via the
    // dedicated polite status node below.
    const list = createEl('div', {
      className: 'jects-chatbot__list',
      attrs: {
        role: 'log',
        'aria-live': 'polite',
        'aria-relevant': 'additions',
        tabindex: '0',
      },
    });

    const suggestions = createEl('div', {
      className: 'jects-chatbot__suggestions',
      attrs: { role: 'group', 'aria-label': 'Suggested replies' },
    });

    const composer = createEl('div', { className: 'jects-chatbot__composer' });

    // Separate polite status node (visually hidden). The COMPLETED assistant
    // reply text is written here exactly once on finish, so screen readers
    // announce the final answer a single time instead of re-reading each token.
    const status = createEl('div', {
      className: 'jects-chatbot__status jects-chatbot__sr-only',
      attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
    });

    root.append(header, list, suggestions, composer, status);

    // Delegated click handling for copy actions + suggestion chips. We attach
    // directly to `root` (not via `this.on2`) because `buildEl()` runs inside
    // the constructor BEFORE `this.el` is assigned, so the protected helpers
    // that read `this.el` are not yet usable.
    const onClick = (e: Event): void => {
      const target = e.target as Element | null;
      if (!target) return;
      const copy = target.closest('.jects-chatbot__copy');
      if (copy) {
        const id = copy.getAttribute('data-msg-id');
        if (id != null) void this.copyMessage(id);
        return;
      }
      const chip = target.closest('.jects-chatbot__chip');
      if (chip) {
        const text = chip.getAttribute('data-text') ?? '';
        this.s.suggestionsDismissed = true;
        this.renderSuggestions();
        void this.submit(text);
      }
    };
    root.addEventListener('click', onClick);
    this.track(() => root.removeEventListener('click', onClick));

    return root;
  }

  protected override render(): void {
    const { title = 'Chat', disabled = false } = this.config;

    this.el.className = ['jects-chatbot', disabled ? 'jects-chatbot--disabled' : '', this.config.cls ?? '']
      .filter(Boolean)
      .join(' ');
    this.el.setAttribute('aria-label', title);

    const heading = this.el.querySelector('.jects-chatbot__title')!;
    heading.textContent = title;

    this.ensureComposer();
    this.ensureToolbar();
    this.renderToolbar();

    // First render: seed the store from config (only once).
    if (!this.el.dataset.seeded) {
      this.el.dataset.seeded = '1';
      for (const m of this.config.messages ?? []) this.appendMessage(m, false);
    }

    this.renderSuggestions();
    this.renderComposerState();
  }

  // ---- composer (TextArea + send Button) ----------------------------------

  private ensureComposer(): void {
    if (this.s.input) return;
    const composer = this.composerEl;

    const inputHost = createEl('div', { className: 'jects-chatbot__input' });
    const sendHost = createEl('div', { className: 'jects-chatbot__send' });
    composer.append(inputHost, sendHost);

    this.s.input = new TextArea(inputHost, {
      placeholder: this.config.placeholder ?? '',
      rows: 1,
      autoGrow: true,
      label: 'Message',
      // `jects-chatbot__textarea-wrap` visually hides the label (kept for SRs).
      // Pass via `cls` so TextArea's own render() keeps it on re-render.
      cls: 'jects-chatbot__textarea jects-chatbot__textarea-wrap',
    });

    this.s.sendBtn = new Button(sendHost, {
      text: 'Send',
      icon: 'arrow-up',
      iconAlign: 'end',
      variant: 'primary',
      size: 'md',
    });
    this.s.sendBtn.on('click', () => void this.submitFromInput());

    // Enter sends; Shift+Enter inserts a newline. Bound listener on the textarea.
    const ta = this.s.input.el.querySelector('textarea')!;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void this.submitFromInput();
      }
    };
    ta.addEventListener('keydown', onKey);
    this.track(() => ta.removeEventListener('keydown', onKey));
  }

  private renderComposerState(): void {
    const disabled = this.config.disabled || this.s.busy;
    this.s.input?.update({ placeholder: this.config.placeholder ?? '', disabled });
    this.s.sendBtn?.update({ disabled, loading: this.s.busy });
  }

  // ---- toolbar (Clear) ----------------------------------------------------

  private ensureToolbar(): void {
    if (this.s.clearBtn || !this.config.clearable) return;
    this.s.clearBtn = new Button(this.toolbarEl, {
      text: 'Clear',
      variant: 'ghost',
      size: 'sm',
    });
    this.s.clearBtn.on('click', () => this.clear());
  }

  private renderToolbar(): void {
    if (this.config.clearable) {
      this.ensureToolbar();
      this.s.clearBtn?.update({ disabled: this.config.disabled || this.store.count === 0 });
      this.toolbarEl.hidden = false;
    } else if (this.s.clearBtn) {
      this.s.clearBtn.destroy();
      delete this.s.clearBtn;
      this.toolbarEl.hidden = true;
    }
  }

  // ---- suggestions --------------------------------------------------------

  private renderSuggestions(): void {
    const wrap = this.suggestEl;
    const list = this.config.suggestions ?? [];
    const show = list.length > 0 && !this.s.suggestionsDismissed && !this.s.busy;
    wrap.hidden = !show;
    if (!show) {
      wrap.replaceChildren();
      return;
    }
    setHtml(
      wrap,
      trustedHtml(
        list
          .map(
            (s) =>
              `<button type="button" class="jects-chatbot__chip" data-text="${escapeAttr(s)}">${escapeHtml(
                s,
              )}</button>`,
          )
          .join(''),
      ),
    );
  }

  // ---- public API ---------------------------------------------------------

  /** Programmatically add a message to the transcript. Returns the stored record. */
  addMessage(message: ChatMessage): ChatMessage {
    return this.appendMessage(message, true);
  }

  /** Clear the entire transcript. */
  clear(): this {
    for (const av of this.s.avatars.values()) av.destroy();
    this.s.avatars.clear();
    this.store.parse([]);
    this.listEl.replaceChildren();
    this.statusEl.textContent = '';
    this.s.suggestionsDismissed = false;
    this.renderSuggestions();
    this.renderToolbar();
    this.emit('clear', { chatbot: this });
    return this;
  }

  /** Send a message as if typed by the user (drives the onSend handler). */
  send(text: string): Promise<void> {
    return this.submit(text);
  }

  /** Programmatically focus the composer. */
  focus(): this {
    this.s.input?.focus();
    return this;
  }

  /** Cancel an in-flight streaming reply, if any. */
  stop(): this {
    this.s.abort?.abort();
    return this;
  }

  /** Full transcript snapshot. */
  getMessages(): ChatMessage[] {
    return this.store.toArray().map((m) => ({ ...m }));
  }

  // ---- internals: submit / streaming --------------------------------------

  private submitFromInput(): Promise<void> {
    const text = this.s.input?.getValue().trim() ?? '';
    if (!text) return Promise.resolve();
    return this.submit(text);
  }

  private async submit(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text || this.s.busy || this.config.disabled) return;

    if (this.emit('beforeSend', { text, chatbot: this }) === false) return;

    // Add the user's turn and clear the input.
    const userMsg = this.appendMessage({ role: 'user', text }, true);
    this.s.input?.update({ value: '' });
    this.s.suggestionsDismissed = true;
    this.renderSuggestions();
    this.emit('send', { text, message: userMsg, chatbot: this });

    const handler = this.config.onSend;
    if (!handler) {
      this.renderToolbar();
      return;
    }

    // Capture the context handed to the handler BEFORE we append the empty
    // streaming assistant placeholder. The doc contract (and chat completion
    // APIs like Anthropic/OpenAI) require the history to end with the just-added
    // user turn — never a trailing empty assistant turn.
    const ctxMessages = this.getMessages();

    this.s.busy = true;
    this.renderComposerState();
    this.renderSuggestions();

    // Assistant placeholder bubble that we stream into.
    const assistant = this.appendMessage({ role: 'assistant', text: '', streaming: true }, true);
    this.s.abort = new AbortController();

    try {
      const result = await handler(text, {
        messages: ctxMessages,
        signal: this.s.abort.signal,
      });

      if (isAsyncIterable(result)) {
        let acc = '';
        for await (const chunk of result) {
          if (this.isDestroyed || this.s.abort.signal.aborted) break;
          acc += chunk;
          assistant.text = acc;
          this.updateMessageBody(assistant);
          this.emit('stream', { chunk, message: assistant, chatbot: this });
          this.maybeAutoScroll();
        }
      } else {
        assistant.text = String(result);
      }
    } catch (error) {
      assistant.text = assistant.text || 'Something went wrong.';
      assistant.role = 'assistant';
      this.emit('error', { error, chatbot: this });
    } finally {
      assistant.streaming = false;
      this.store.update(assistant.id as RecordId, {
        text: assistant.text,
        streaming: false,
      });
      this.updateMessageBody(assistant);
      // Announce the COMPLETED reply once via the dedicated polite status node.
      // The streaming bubble itself was aria-hidden/aria-busy during streaming,
      // so this is the single point at which the final answer reaches SR users.
      this.announceReply(assistant.text);
      this.s.busy = false;
      this.s.abort = null;
      this.renderComposerState();
      this.renderToolbar();
      this.maybeAutoScroll();
      this.emit('reply', { message: assistant, chatbot: this });
    }
  }

  // ---- message rendering --------------------------------------------------

  private appendMessage(message: ChatMessage, scroll: boolean): StoredMessage {
    const stored: StoredMessage = {
      ...message,
      id: message.id ?? `m${++msgSeq}`,
      ts: message.ts ?? Date.now(),
    };
    this.store.add(stored);

    const wasNearBottom = this.isNearBottom();
    this.listEl.append(this.buildMessageEl(stored));
    this.renderToolbar();
    if (scroll && wasNearBottom) this.scrollToBottom();
    return stored;
  }

  private buildMessageEl(m: StoredMessage): HTMLElement {
    const isUser = m.role === 'user';
    const row = createEl('div', {
      className: `jects-chatbot__msg jects-chatbot__msg--${m.role}`,
      attrs: { 'data-msg-id': String(m.id) },
    });

    if (this.config.showAvatars && m.role !== 'system') {
      const avHost = createEl('div', { className: 'jects-chatbot__avatar' });
      row.append(avHost);
      const name = m.name ?? (isUser ? this.config.userName : this.config.assistantName) ?? ROLE_LABELS[m.role];
      const src = m.avatar ?? (isUser ? this.config.userAvatar : this.config.assistantAvatar);
      const avConfig: AvatarConfig = { name, size: 'sm', alt: name };
      if (src) avConfig.src = src;
      const av = new Avatar(avHost, avConfig);
      this.s.avatars.set(m.id, av);
    }

    const bubbleWrap = createEl('div', { className: 'jects-chatbot__bubble-wrap' });

    const meta = createEl('div', { className: 'jects-chatbot__meta' });
    const author = createEl('span', { className: 'jects-chatbot__author' });
    author.textContent =
      m.name ?? (isUser ? this.config.userName : this.config.assistantName) ?? ROLE_LABELS[m.role];
    meta.append(author);
    if (this.config.showTimestamps && m.ts) {
      const time = createEl('time', {
        className: 'jects-chatbot__time',
        attrs: { datetime: new Date(m.ts).toISOString() },
        text: formatTime(m.ts),
      });
      meta.append(time);
    }

    const bubble = createEl('div', { className: 'jects-chatbot__bubble' });
    this.fillBubble(bubble, m);

    bubbleWrap.append(meta, bubble);

    if (this.config.copyable && m.role !== 'system') {
      const copy = createEl('button', {
        className: 'jects-chatbot__copy',
        attrs: { type: 'button', 'aria-label': 'Copy message', 'data-msg-id': String(m.id) },
        html: staticHtml`<span aria-hidden="true">Copy</span>`,
      });
      bubbleWrap.append(copy);
    }

    row.append(bubbleWrap);
    return row;
  }

  private fillBubble(bubble: HTMLElement, m: ChatMessage): void {
    if (m.role === 'assistant') {
      const render = this.config.renderMarkdown ?? defaultRenderMarkdown;
      setHtml(bubble, safeHtml(render(m.text) || (m.streaming ? '' : '')));
      bubble.classList.toggle('jects-chatbot__bubble--streaming', !!m.streaming);
      if (m.streaming && !m.text) {
        setHtml(bubble, trustedHtml(typingIndicatorHtml()));
      }
      // While streaming, mark the bubble busy and hide its partial/growing text
      // from assistive tech so the polite log doesn't re-announce each token.
      // The completed reply is announced once via `statusEl` (see submit()).
      if (m.streaming) {
        bubble.setAttribute('aria-busy', 'true');
        bubble.setAttribute('aria-hidden', 'true');
      } else {
        bubble.removeAttribute('aria-busy');
        bubble.removeAttribute('aria-hidden');
      }
    } else {
      // User/system text is escaped, with line breaks preserved.
      setHtml(bubble, trustedHtml(escapeHtml(m.text).replace(/\n/g, '<br>')));
    }
  }

  private updateMessageBody(m: StoredMessage): void {
    const row = this.listEl.querySelector(`[data-msg-id="${cssEscape(String(m.id))}"]`);
    const bubble = row?.querySelector('.jects-chatbot__bubble') as HTMLElement | null;
    if (bubble) this.fillBubble(bubble, m);
  }

  /**
   * Announce a completed assistant reply exactly once via the polite status
   * node. The node is `aria-atomic`, so writing its text content produces a
   * single announcement of the final answer (vs. re-reading every token while
   * the bubble streamed). Markdown is reduced to plain text for the SR string.
   */
  private announceReply(text: string): void {
    const status = this.statusEl;
    if (!status) return;
    const plain = text.replace(/\s+/g, ' ').trim();
    // Clear then set so identical consecutive replies still re-announce.
    status.textContent = '';
    status.textContent = plain;
  }

  // ---- copy ---------------------------------------------------------------

  private async copyMessage(id: string): Promise<void> {
    const msg = this.store.getById(id) ?? this.store.getById(Number(id));
    if (!msg) return;
    try {
      await navigator.clipboard?.writeText(msg.text);
    } catch {
      /* clipboard unavailable (e.g. insecure context) — still emit the event */
    }
    this.emit('copy', { message: msg, chatbot: this });
  }

  // ---- scrolling ----------------------------------------------------------

  private isNearBottom(): boolean {
    const el = this.listEl;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 64;
  }

  private maybeAutoScroll(): void {
    if (this.isNearBottom()) this.scrollToBottom();
  }

  private scrollToBottom(): void {
    const el = this.listEl;
    el.scrollTop = el.scrollHeight;
  }

  // ---- teardown -----------------------------------------------------------

  override destroy(): void {
    if (this.isDestroyed) return;
    this.s.abort?.abort();
    this.s.input?.destroy();
    this.s.sendBtn?.destroy();
    this.s.clearBtn?.destroy();
    for (const av of this.s.avatars.values()) av.destroy();
    this.s.avatars.clear();
    super.destroy();
  }
}

// ---- helpers --------------------------------------------------------------

function isAsyncIterable(x: unknown): x is AsyncIterable<string> {
  return x != null && typeof (x as AsyncIterable<string>)[Symbol.asyncIterator] === 'function';
}

function typingIndicatorHtml(): string {
  return (
    '<span class="jects-chatbot__typing" role="status" aria-label="Assistant is typing">' +
    '<span class="jects-chatbot__dot" aria-hidden="true"></span>' +
    '<span class="jects-chatbot__dot" aria-hidden="true"></span>' +
    '<span class="jects-chatbot__dot" aria-hidden="true"></span>' +
    '</span>'
  );
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

/** Minimal CSS attribute-selector value escaper (CSS.escape may be unavailable in jsdom). */
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

register(
  'chatbot',
  Chatbot as unknown as new (host: HTMLElement | string, config?: Record<string, unknown>) => Chatbot,
);
