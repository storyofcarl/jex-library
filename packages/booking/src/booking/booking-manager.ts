/**
 * booking-manager — manage EXISTING bookings: a status lifecycle
 * (`pending`/`confirmed`/`cancelled`), reschedule, cancel and listing. Backed by
 * a core `Store` and a typed `EventEmitter` so hosts (and the widget's manage UI)
 * can react to changes. Used by the command/history layer and the data provider.
 */

import { Store, EventEmitter, type RecordId } from '@jects/core';
import type { ReservationDetails } from './booking.js';

/** Lifecycle status of a managed booking. */
export type BookingStatus = 'pending' | 'confirmed' | 'cancelled';

/** A managed booking row. */
export interface ManagedBooking {
  /** Stable id. */
  id: RecordId;
  /** `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM` 24h start. */
  time: string;
  /** Duration in minutes. */
  duration: number;
  /** Lifecycle status. */
  status: BookingStatus;
  /** Optional resource/service ids. */
  resourceId?: string;
  serviceId?: string;
  /** Reservation details captured at booking time. */
  details?: ReservationDetails;
  /** Optional UTC instant (ms) when the booking is timezone-anchored. */
  instant?: number;
  /** Display timezone the booking was made in. */
  timeZone?: string;
  /** Index signature so the row satisfies core's `Model` constraint. */
  [key: string]: unknown;
}

/** A patch applied when rescheduling a booking. */
export interface ReschedulePatch {
  date?: string;
  time?: string;
  duration?: number;
  resourceId?: string;
  instant?: number;
}

/** Events emitted by the manager. */
export interface BookingManagerEvents {
  add: { booking: ManagedBooking };
  cancel: { booking: ManagedBooking };
  reschedule: { booking: ManagedBooking; from: ReschedulePatch };
  statusChange: { booking: ManagedBooking; status: BookingStatus };
  change: { reason: 'add' | 'cancel' | 'reschedule' | 'status' | 'remove' | 'load' };
  [key: string]: Record<string, unknown>;
}

/** Manages the set of existing bookings and their lifecycle. */
export class BookingManager extends EventEmitter<BookingManagerEvents> {
  private store: Store<ManagedBooking>;

  constructor(initial?: ManagedBooking[]) {
    super();
    this.store = new Store<ManagedBooking>({
      data: initial ?? [],
      idField: 'id',
    });
  }

  /** All bookings, optionally filtered by status. */
  list(status?: BookingStatus): ManagedBooking[] {
    const all = this.store.toArray();
    return status ? all.filter((b) => b.status === status) : all;
  }

  /** Look up a booking by id. */
  get(id: RecordId): ManagedBooking | undefined {
    return this.store.getById(id);
  }

  /** Add a booking (defaults status to `confirmed`). */
  add(booking: Omit<ManagedBooking, 'status'> & { status?: BookingStatus }): ManagedBooking {
    const row = { status: 'confirmed' as BookingStatus, ...booking } as ManagedBooking;
    this.store.add(row);
    this.emit('add', { booking: row });
    this.emit('change', { reason: 'add' });
    return row;
  }

  /** Remove a booking outright (hard delete). Returns true when removed. */
  remove(id: RecordId): boolean {
    const existing = this.store.getById(id);
    if (!existing) return false;
    this.store.remove(id);
    this.emit('change', { reason: 'remove' });
    return true;
  }

  /** Cancel a booking (soft — sets status to `cancelled`). */
  cancel(id: RecordId): ManagedBooking | undefined {
    const updated = this.store.update(id, { status: 'cancelled' });
    if (!updated) return undefined;
    this.emit('cancel', { booking: updated });
    this.emit('statusChange', { booking: updated, status: 'cancelled' });
    this.emit('change', { reason: 'cancel' });
    return updated;
  }

  /** Set an explicit status. */
  setStatus(id: RecordId, status: BookingStatus): ManagedBooking | undefined {
    const updated = this.store.update(id, { status });
    if (!updated) return undefined;
    this.emit('statusChange', { booking: updated, status });
    this.emit('change', { reason: 'status' });
    return updated;
  }

  /** Reschedule a booking to a new day/time/resource. */
  reschedule(id: RecordId, patch: ReschedulePatch): ManagedBooking | undefined {
    const existing = this.store.getById(id);
    if (!existing) return undefined;
    const from: ReschedulePatch = {
      date: existing.date,
      time: existing.time,
      duration: existing.duration,
      ...(existing.resourceId != null ? { resourceId: existing.resourceId } : {}),
      ...(existing.instant != null ? { instant: existing.instant } : {}),
    };
    const updated = this.store.update(id, patch as Partial<ManagedBooking>);
    if (!updated) return undefined;
    this.emit('reschedule', { booking: updated, from });
    this.emit('change', { reason: 'reschedule' });
    return updated;
  }

  /** Replace all bookings (e.g. after a provider load). */
  parse(bookings: ManagedBooking[]): void {
    this.store.parse(bookings);
    this.emit('change', { reason: 'load' });
  }

  /** Snapshot of all bookings. */
  toArray(): ManagedBooking[] {
    return this.store.toArray();
  }
}
