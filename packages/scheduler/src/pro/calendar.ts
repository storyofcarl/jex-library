/**
 * Scheduler PRO — working-time calendar arithmetic.
 *
 * Wraps timeline-core's `WorkingTimeCalendar` shape with the working-time math
 * the scheduling engine needs: measuring an interval's *working* duration,
 * advancing a start by a working duration (skipping weekends/off-hours/
 * holidays), and the symmetric backward operation. This is what lets a bar that
 * straddles a weekend keep its true working length when the engine reschedules.
 *
 * Multi-level support: a calendar may be constructed with a `parent`; queries
 * that the child does not answer (a holiday it does not list) fall through to
 * the parent, so a project calendar can layer on top of a base calendar.
 *
 * All arithmetic is UTC. A step of one minute keeps the scan exact for the
 * common hour-granular working day without an unbounded loop.
 */

import type { TimeMs, DurationMs, TimeSpan } from '@jects/timeline-core';
import type { WorkingTimeCalendar } from '@jects/timeline-core';

const MS_MINUTE = 60_000;
const MS_HOUR = 3_600_000;

export class WorkingCalendar {
  private readonly weekend: Set<number>;
  private readonly dayStart: number;
  private readonly dayEnd: number;
  private readonly holidays: ReadonlyArray<TimeSpan>;
  private readonly parent: WorkingCalendar | null;
  /** Scan resolution (ms). One minute balances accuracy vs. loop bound. */
  private readonly step: number;

  constructor(cal: WorkingTimeCalendar = {}, parent: WorkingCalendar | null = null) {
    this.weekend = new Set(cal.weekendDays ?? [0, 6]);
    this.dayStart = (cal.dayStartHour ?? 9) * MS_HOUR;
    this.dayEnd = (cal.dayEndHour ?? 17) * MS_HOUR;
    this.holidays = cal.holidays ?? [];
    this.parent = parent;
    this.step = MS_MINUTE;
  }

  /** Whether a time falls inside working hours (and is not a holiday/weekend). */
  isWorking(time: TimeMs): boolean {
    const d = new Date(time);
    if (this.weekend.has(d.getUTCDay())) return false;
    const tod =
      d.getUTCHours() * MS_HOUR +
      d.getUTCMinutes() * MS_MINUTE +
      d.getUTCSeconds() * 1_000;
    if (tod < this.dayStart || tod >= this.dayEnd) return false;
    for (const h of this.holidays) {
      if (time >= h.start && time < h.end) return false;
    }
    if (this.parent) return this.parent.isWorking(time);
    return true;
  }

  /** The next working instant at or after `time`. */
  skipNonWorking(time: TimeMs): TimeMs {
    let t = time;
    let guard = 0;
    while (!this.isWorking(t) && guard++ < 200_000) {
      t = this.advanceToNextBoundary(t);
    }
    return t;
  }

  /** Advance `t` to the next plausible working-window boundary (cheap skip). */
  private advanceToNextBoundary(t: TimeMs): TimeMs {
    const d = new Date(t);
    const tod =
      d.getUTCHours() * MS_HOUR +
      d.getUTCMinutes() * MS_MINUTE +
      d.getUTCSeconds() * 1_000;
    // Before the working day → jump to dayStart same day.
    if (tod < this.dayStart && !this.weekend.has(d.getUTCDay())) {
      return floorDay(t) + this.dayStart;
    }
    // After the working day or weekend/holiday → jump to next day's start.
    return floorDay(t) + 86_400_000 + this.dayStart;
  }

  /** Working-time length (ms) of `[start, end)`. */
  workingDuration(start: TimeMs, end: TimeMs): DurationMs {
    if (end <= start) return 0;
    let t = this.skipNonWorking(start);
    let acc = 0;
    let guard = 0;
    while (t < end && guard++ < 5_000_000) {
      if (this.isWorking(t)) acc += this.step;
      t += this.step;
      if (!this.isWorking(t)) t = this.skipNonWorking(t);
    }
    return acc;
  }

  /** Add a working `duration` to `start`, skipping non-working time. */
  addWorking(start: TimeMs, duration: DurationMs): TimeMs {
    let remaining = duration;
    let t = this.skipNonWorking(start);
    let guard = 0;
    while (remaining > 0 && guard++ < 5_000_000) {
      t = this.skipNonWorking(t);
      t += this.step;
      remaining -= this.step;
    }
    return t;
  }

  /** Subtract a working `duration` from `end` (backward scheduling). */
  subtractWorking(end: TimeMs, duration: DurationMs): TimeMs {
    let remaining = duration;
    let t = end;
    let guard = 0;
    while (remaining > 0 && guard++ < 5_000_000) {
      t -= this.step;
      if (this.isWorking(t)) remaining -= this.step;
    }
    return t;
  }
}

/** Floor a time to UTC midnight of its day. */
function floorDay(time: TimeMs): TimeMs {
  const d = new Date(time);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}
