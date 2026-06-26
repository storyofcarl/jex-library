/**
 * AjaxDataProvider — a REST + WebSocket {@link TaskBoardDataProvider}.
 *
 * Loads cards over `fetch` (GET `url`), persists each optimistic mutation back
 * with a JSON POST (move/edit/add/remove all flow through `sync`), and — when a
 * `wsUrl` is configured — opens a WebSocket whose messages are decoded into
 * {@link CardSyncOp}s and applied to the live board. This is the AjaxStore-class
 * remote source; the board keeps the in-memory `Store` as its live view.
 *
 * Kept dependency-free: it only touches the platform `fetch`/`WebSocket` globals
 * so it works in jsdom tests (with mocks) and the browser alike.
 */

import type { CardSyncOp, KanbanCard, TaskBoardDataProvider } from './types.js';

export interface AjaxDataProviderConfig {
  /** REST endpoint. `GET` loads cards; `POST` persists each mutation. */
  url: string;
  /** Optional WebSocket URL for live remote changes. */
  wsUrl?: string;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** `fetch` override (injected for tests). Defaults to the global. */
  fetchImpl?: typeof fetch;
  /** `WebSocket` constructor override (injected for tests). Defaults to the global. */
  webSocketImpl?: typeof WebSocket;
}

/** A `fetch`-backed REST/WS provider. */
export class AjaxDataProvider implements TaskBoardDataProvider {
  private readonly url: string;
  private readonly wsUrl: string | undefined;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly webSocketImpl: typeof WebSocket | undefined;
  private socket: WebSocket | undefined;

  constructor(config: AjaxDataProviderConfig) {
    this.url = config.url;
    this.wsUrl = config.wsUrl;
    this.headers = { 'Content-Type': 'application/json', ...(config.headers ?? {}) };
    this.fetchImpl =
      config.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : unavailableFetch);
    this.webSocketImpl =
      config.webSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : undefined);
  }

  /** `GET url` → an array of cards (or `{ data: [...] }`). */
  async load(): Promise<KanbanCard[]> {
    const res = await this.fetchImpl(this.url, { method: 'GET', headers: this.headers });
    if (!res.ok) {
      throw new Error(`Jects AjaxDataProvider.load: ${res.status} ${res.statusText}`);
    }
    const json: unknown = await res.json();
    const data = Array.isArray(json) ? json : ((json as { data?: KanbanCard[] }).data ?? []);
    return data as KanbanCard[];
  }

  /** `POST url` with the op as the JSON body. */
  async sync(op: CardSyncOp): Promise<void> {
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(op),
    });
    if (!res.ok) {
      throw new Error(`Jects AjaxDataProvider.sync: ${res.status} ${res.statusText}`);
    }
  }

  /**
   * Open the WebSocket (if `wsUrl` + a `WebSocket` impl are available) and route
   * decoded {@link CardSyncOp} messages to `onRemote`. Returns an unsubscribe
   * that closes the socket. A no-op (returning a no-op disposer) when no WS is
   * configured.
   */
  subscribe(onRemote: (op: CardSyncOp) => void): () => void {
    if (!this.wsUrl || !this.webSocketImpl) return () => {};
    const socket = new this.webSocketImpl(this.wsUrl);
    this.socket = socket;
    const onMessage = (ev: MessageEvent): void => {
      const op = decodeOp(ev.data);
      if (op) onRemote(op);
    };
    socket.addEventListener('message', onMessage);
    return () => {
      socket.removeEventListener('message', onMessage);
      try {
        socket.close();
      } catch {
        /* socket may already be closing */
      }
      if (this.socket === socket) this.socket = undefined;
    };
  }
}

/** Decode a raw WS payload (string JSON or already-parsed object) into a CardSyncOp. */
function decodeOp(data: unknown): CardSyncOp | undefined {
  let parsed: unknown = data;
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  if (parsed == null || typeof parsed !== 'object') return undefined;
  const obj = parsed as Partial<CardSyncOp>;
  if (obj.action !== 'add' && obj.action !== 'update' && obj.action !== 'remove') return undefined;
  if (obj.id == null) return undefined;
  const op: CardSyncOp = { action: obj.action, id: obj.id };
  if (obj.card != null) op.card = obj.card;
  return op;
}

/** Fallback when no `fetch` is available; surfaces a clear error if `load` is called. */
function unavailableFetch(): Promise<Response> {
  return Promise.reject(
    new Error('Jects AjaxDataProvider: no `fetch` available; pass `fetchImpl` in config.'),
  );
}
