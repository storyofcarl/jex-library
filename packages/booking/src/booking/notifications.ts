/**
 * notifications — confirmation messaging after a booking, plus reminder hooks that
 * fire events at configured lead times before the appointment. Pure formatting +
 * a timer-based scheduler; ICS export lives in `ics.ts`. Unit-tested with fake
 * timers (the scheduler accepts an injectable clock + timer fns for determinism).
 */

import { EventEmitter } from '@jects/core';
import { formatMessage, type BookingMessages } from './i18n.js';
import type { BookingResult } from './booking.js';

/**
 * Build the human confirmation string for a result, using the message catalog.
 * Falls back to a plain template when no messages are supplied.
 */
export function formatConfirmation(
  result: Pick<BookingResult, 'date' | 'time'>,
  messages?: Pick<BookingMessages, 'confirmationMessage'>,
): string {
  const tpl = messages?.confirmationMessage ?? 'Booked for {date} at {time}.';
  return formatMessage(tpl, { date: result.date, time: result.time });
}

/** Build the waitlist-confirmation string. */
export function formatWaitlisted(
  result: Pick<BookingResult, 'date' | 'time'>,
  messages?: Pick<BookingMessages, 'waitlistedMessage'>,
): string {
  const tpl = messages?.waitlistedMessage ?? 'Added to the waitlist for {date} at {time}.';
  return formatMessage(tpl, { date: result.date, time: result.time });
}

/** A scheduled reminder for one appointment. */
export interface Reminder {
  /** Stable id. */
  id: string;
  /** Appointment start instant (epoch ms). */
  startMs: number;
  /** Lead time before the start, in minutes. */
  leadMinutes: number;
  /** Opaque payload echoed back when the reminder fires. */
  payload: unknown;
}

/** Events emitted by the reminder scheduler. */
export interface ReminderEvents {
  reminder: { reminder: Reminder };
  [key: string]: Record<string, unknown>;
}

/** Injectable timer surface (defaults to global timers; overridable for tests). */
export interface ReminderClock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const defaultClock: ReminderClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

let reminderSeq = 0;

/**
 * Schedules reminders and emits `reminder` at each lead time. Reminders whose
 * fire-time is already in the past are emitted immediately on `schedule`.
 */
export class ReminderScheduler extends EventEmitter<ReminderEvents> {
  private readonly clock: ReminderClock;
  private readonly timers = new Map<string, unknown>();

  constructor(clock: ReminderClock = defaultClock) {
    super();
    this.clock = clock;
  }

  /**
   * Schedule reminders for an appointment at each of `leadMinutes`. Returns the
   * created reminder descriptors.
   */
  schedule(startMs: number, leadMinutes: number[], payload: unknown): Reminder[] {
    const out: Reminder[] = [];
    for (const lead of leadMinutes) {
      const reminder: Reminder = {
        id: `rem-${++reminderSeq}`,
        startMs,
        leadMinutes: lead,
        payload,
      };
      const fireAt = startMs - lead * 60_000;
      const delay = fireAt - this.clock.now();
      const fire = (): void => {
        this.timers.delete(reminder.id);
        this.emit('reminder', { reminder });
      };
      if (delay <= 0) {
        fire();
      } else {
        this.timers.set(reminder.id, this.clock.setTimer(fire, delay));
      }
      out.push(reminder);
    }
    return out;
  }

  /** Cancel a pending reminder by id. */
  cancel(id: string): void {
    const handle = this.timers.get(id);
    if (handle !== undefined) {
      this.clock.clearTimer(handle);
      this.timers.delete(id);
    }
  }

  /** Cancel all pending reminders. */
  dispose(): void {
    for (const handle of this.timers.values()) this.clock.clearTimer(handle);
    this.timers.clear();
  }
}
