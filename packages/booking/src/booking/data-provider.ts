/**
 * data-provider — async availability + bookings fetching on demand, so the widget
 * need not pre-load everything. Mirrors the `AjaxDataProvider` shape used in
 * `@jects/kanban`: a small interface (load/create/cancel + optional WS subscribe)
 * plus a REST implementation with an optional WebSocket for live changes.
 */

import type { RecordId } from '@jects/core';
import type { ManagedBooking } from './booking-manager.js';
import type { AvailabilityRules } from './availability-rules.js';
import type { ReservationDetails } from './booking.js';

/** An inclusive `YYYY-MM-DD` day range. */
export interface DateRange {
  start: string;
  end: string;
}

/** A request to create a booking. */
export interface CreateBookingInput {
  date: string;
  time: string;
  duration: number;
  resourceId?: string;
  serviceId?: string;
  details: ReservationDetails;
  instant?: number;
  timeZone?: string;
}

/** A remote mutation pushed over the subscription channel. */
export interface BookingSyncOp {
  action: 'add' | 'update' | 'remove';
  id: RecordId;
  booking?: Partial<ManagedBooking>;
}

/**
 * Provider contract: load availability + bookings for a window on demand, create
 * and cancel bookings, and (optionally) subscribe to remote changes.
 */
export interface BookingDataProvider {
  /** Load availability rules for a window (e.g. `GET availability?from&to`). */
  loadAvailability(range: DateRange, resourceId?: string): Promise<AvailabilityRules>;
  /** Load existing bookings for a window. */
  loadBookings(range: DateRange, resourceId?: string): Promise<ManagedBooking[]>;
  /** Persist a new booking; resolves with the created row. */
  createBooking(input: CreateBookingInput): Promise<ManagedBooking>;
  /** Cancel a booking by id. */
  cancelBooking(id: RecordId): Promise<void>;
  /**
   * Subscribe to remote changes (e.g. a WebSocket). The callback applies the op
   * to the live widget. Returns an unsubscribe function. Optional.
   */
  subscribe?(onRemote: (op: BookingSyncOp) => void): () => void;
}

/** Config for the REST/WS provider. */
export interface AjaxBookingDataProviderConfig {
  /** Base REST endpoint (no trailing slash). */
  url: string;
  /** Optional WebSocket URL for live changes. */
  wsUrl?: string;
  /** Extra headers (auth, etc.). */
  headers?: Record<string, string>;
  /** Injected fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Injected WebSocket ctor (tests). */
  webSocketImpl?: typeof WebSocket;
}

/** Build a `?from=…&to=…[&resource=…]` query string. */
function rangeQuery(range: DateRange, resourceId?: string): string {
  const q = new URLSearchParams({ from: range.start, to: range.end });
  if (resourceId != null) q.set('resource', resourceId);
  return q.toString();
}

/**
 * REST booking provider with an optional WebSocket. GET loads availability and
 * bookings; POST creates; DELETE cancels; WS messages are decoded into
 * `BookingSyncOp` and handed to the subscriber.
 */
export class AjaxBookingDataProvider implements BookingDataProvider {
  private readonly url: string;
  private readonly wsUrl?: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly webSocketImpl?: typeof WebSocket;

  constructor(config: AjaxBookingDataProviderConfig) {
    this.url = config.url.replace(/\/$/, '');
    if (config.wsUrl !== undefined) this.wsUrl = config.wsUrl;
    this.headers = { 'Content-Type': 'application/json', ...config.headers };
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    if (config.webSocketImpl !== undefined) this.webSocketImpl = config.webSocketImpl;
  }

  async loadAvailability(range: DateRange, resourceId?: string): Promise<AvailabilityRules> {
    const res = await this.fetchImpl(`${this.url}/availability?${rangeQuery(range, resourceId)}`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`loadAvailability failed: ${res.status}`);
    return (await res.json()) as AvailabilityRules;
  }

  async loadBookings(range: DateRange, resourceId?: string): Promise<ManagedBooking[]> {
    const res = await this.fetchImpl(`${this.url}/bookings?${rangeQuery(range, resourceId)}`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`loadBookings failed: ${res.status}`);
    const json = (await res.json()) as ManagedBooking[] | { data: ManagedBooking[] };
    return Array.isArray(json) ? json : json.data;
  }

  async createBooking(input: CreateBookingInput): Promise<ManagedBooking> {
    const res = await this.fetchImpl(`${this.url}/bookings`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`createBooking failed: ${res.status}`);
    return (await res.json()) as ManagedBooking;
  }

  async cancelBooking(id: RecordId): Promise<void> {
    const res = await this.fetchImpl(`${this.url}/bookings/${encodeURIComponent(String(id))}`, {
      method: 'DELETE',
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`cancelBooking failed: ${res.status}`);
  }

  subscribe(onRemote: (op: BookingSyncOp) => void): () => void {
    const Ctor = this.webSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!this.wsUrl || !Ctor) return () => {};
    const ws = new Ctor(this.wsUrl);
    const onMessage = (ev: MessageEvent): void => {
      const op = decodeOp(ev.data);
      if (op) onRemote(op);
    };
    ws.addEventListener('message', onMessage);
    return () => {
      ws.removeEventListener('message', onMessage);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }
}

/** Decode a WS payload into a `BookingSyncOp`, or `null` when malformed. */
function decodeOp(data: unknown): BookingSyncOp | null {
  try {
    const raw = typeof data === 'string' ? JSON.parse(data) : data;
    if (raw && typeof raw === 'object' && 'action' in raw && 'id' in raw) {
      return raw as BookingSyncOp;
    }
  } catch {
    /* ignore */
  }
  return null;
}
