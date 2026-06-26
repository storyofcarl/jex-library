/**
 * capacity — group/class bookings: N seats per slot, remaining-seat counting and
 * a WAITLIST that promotes the next entry when a seat frees up. The slot engine
 * (`generateSlots`, `capacity` option) computes per-slot seat counts; this module
 * owns the waitlist side: tracking entries and promoting on cancel. Dependency-free
 * and unit-tested.
 */

import type { ExistingBooking } from './slots.js';
import type { ReservationDetails } from './booking.js';

/** Identifies a unique bookable slot (day + start [+ resource]). */
export interface SlotKey {
  date: string;
  time: string;
  resourceId?: string;
}

/** A person waiting for a seat in a full slot. */
export interface WaitlistEntry extends SlotKey {
  /** Stable id. */
  id: string;
  /** Reservation details captured when joining the waitlist. */
  details: ReservationDetails;
  /** Epoch ms the entry was created (FIFO promotion order). */
  createdAt: number;
}

/** Stable string id for a slot key (resource-scoped). */
export function slotKeyId(k: SlotKey): string {
  return `${k.date}T${k.time}#${k.resourceId ?? ''}`;
}

/** Do two slot keys refer to the same slot? */
export function sameSlot(a: SlotKey, b: SlotKey): boolean {
  return slotKeyId(a) === slotKeyId(b);
}

/** Count existing bookings occupying a slot (resource-scoped when set). */
export function countSeatsBooked(bookings: ExistingBooking[], key: SlotKey): number {
  return bookings.reduce((n, b) => {
    if (b.date !== key.date || b.time !== key.time) return n;
    if (key.resourceId != null && b.resourceId != null && b.resourceId !== key.resourceId) return n;
    return n + 1;
  }, 0);
}

/** Seats remaining for a slot given total capacity and current bookings. */
export function seatsRemaining(capacity: number, bookings: ExistingBooking[], key: SlotKey): number {
  return Math.max(0, capacity - countSeatsBooked(bookings, key));
}

let waitlistSeq = 0;

/**
 * In-memory waitlist. Entries are grouped by slot key; `promoteNext` pops the
 * oldest entry for a slot (FIFO) so a caller can convert it into a booking when a
 * seat opens after a cancel.
 */
export class WaitlistManager {
  private entries: WaitlistEntry[] = [];

  constructor(seed?: WaitlistEntry[]) {
    if (seed) this.entries = [...seed];
  }

  /** Add an entry to the waitlist for a slot; returns the created entry. */
  add(key: SlotKey, details: ReservationDetails): WaitlistEntry {
    const entry: WaitlistEntry = {
      id: `wl-${Date.now()}-${++waitlistSeq}`,
      date: key.date,
      time: key.time,
      ...(key.resourceId != null ? { resourceId: key.resourceId } : {}),
      details,
      createdAt: Date.now(),
    };
    this.entries.push(entry);
    return entry;
  }

  /** Remove an entry by id; returns true when something was removed. */
  remove(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    return this.entries.length < before;
  }

  /** All entries for a slot, oldest first. */
  forSlot(key: SlotKey): WaitlistEntry[] {
    return this.entries
      .filter((e) => sameSlot(e, key))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Number of people waiting for a slot. */
  countForSlot(key: SlotKey): number {
    return this.entries.reduce((n, e) => (sameSlot(e, key) ? n + 1 : n), 0);
  }

  /**
   * Pop and return the oldest waiting entry for a slot (FIFO), or `null` when the
   * waitlist for that slot is empty. The caller turns it into a confirmed booking.
   */
  promoteNext(key: SlotKey): WaitlistEntry | null {
    const queue = this.forSlot(key);
    const next = queue[0];
    if (!next) return null;
    this.remove(next.id);
    return next;
  }

  /** Snapshot of all entries. */
  all(): WaitlistEntry[] {
    return [...this.entries];
  }

  /** Replace all entries. */
  parse(entries: WaitlistEntry[]): void {
    this.entries = [...entries];
  }
}
