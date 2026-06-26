import { describe, it, expect, vi } from 'vitest';
import {
  formatConfirmation,
  formatWaitlisted,
  ReminderScheduler,
  type ReminderClock,
} from './notifications.js';
import { defaultMessages } from './i18n.js';

describe('confirmation formatting', () => {
  it('substitutes date/time tokens', () => {
    expect(formatConfirmation({ date: '2030-06-24', time: '09:00' }, defaultMessages)).toBe(
      'Booked for 2030-06-24 at 09:00.',
    );
    expect(formatWaitlisted({ date: '2030-06-24', time: '09:00' }, defaultMessages)).toBe(
      'Added to the waitlist for 2030-06-24 at 09:00.',
    );
  });
});

describe('ReminderScheduler', () => {
  /** A controllable clock that records scheduled timers. */
  function fakeClock(start = 0): ReminderClock & { run(at: number): void } {
    const timers: Array<{ fn: () => void; at: number }> = [];
    let nowMs = start;
    return {
      now: () => nowMs,
      setTimer: (fn, ms) => {
        const handle = { fn, at: nowMs + ms };
        timers.push(handle);
        return handle;
      },
      clearTimer: (h) => {
        const i = timers.indexOf(h as { fn: () => void; at: number });
        if (i >= 0) timers.splice(i, 1);
      },
      run(at: number) {
        nowMs = at;
        for (const t of [...timers]) if (t.at <= at) t.fn();
      },
    };
  }

  it('fires a reminder at the configured lead time', () => {
    const clock = fakeClock(0);
    const scheduler = new ReminderScheduler(clock);
    const spy = vi.fn();
    scheduler.on('reminder', spy);

    const startMs = 60 * 60_000; // appointment 60 min out
    scheduler.schedule(startMs, [15], { id: 'a' }); // remind 15 min before ⇒ at 45 min
    expect(spy).not.toHaveBeenCalled();
    clock.run(45 * 60_000);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].reminder.leadMinutes).toBe(15);
  });

  it('fires immediately when the lead time is already past', () => {
    const clock = fakeClock(0);
    const scheduler = new ReminderScheduler(clock);
    const spy = vi.fn();
    scheduler.on('reminder', spy);
    scheduler.schedule(-1000, [10], {}); // start in the past
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('cancel() prevents a pending reminder', () => {
    const clock = fakeClock(0);
    const scheduler = new ReminderScheduler(clock);
    const spy = vi.fn();
    scheduler.on('reminder', spy);
    const [r] = scheduler.schedule(60 * 60_000, [15], {});
    scheduler.cancel(r!.id);
    clock.run(60 * 60_000);
    expect(spy).not.toHaveBeenCalled();
  });
});
