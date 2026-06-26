/**
 * @jects/calendar — EventStore.
 *
 * A thin, calendar-aware specialization of the core `Store`. It normalizes raw
 * event input (coercing string dates to `Date`, defaulting `end`), exposes
 * recurrence-aware occurrence queries, and adds calendar mutations (move/resize)
 * that respect the house veto convention through the owning Calendar.
 */

import { Store, type StoreConfig, type RecordId } from '@jects/core';
import type { CalendarEvent, EventOccurrence } from './contract.js';
import { expandEvents, parseRRule } from './recurrence.js';
import { addMinutes, MS_PER_HOUR } from './date-utils.js';

let autoId = 0;

/** Coerce a raw value to a Date (accepts Date, ISO string, or epoch ms). */
function toDate(v: unknown, fallback: () => Date): Date {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  if (typeof v === 'number') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return fallback();
}

/** Normalize a partial raw event into a well-formed `CalendarEvent`. */
export function normalizeEvent(raw: Partial<CalendarEvent>): CalendarEvent {
  const start = toDate(raw.start, () => new Date());
  let end = toDate(raw.end, () => new Date(start.getTime() + MS_PER_HOUR));
  if (end.getTime() < start.getTime()) end = new Date(start.getTime() + MS_PER_HOUR);

  // Events may carry either a structured `recurrence` object or an `rrule`
  // string; when only the string is present, parse it into the object shape so
  // the rest of the engine sees a single representation.
  const rawRec = raw.recurrence ?? (raw.rrule ? parseRRule(raw.rrule) ?? undefined : undefined);
  const rec = rawRec
    ? {
        ...rawRec,
        until: rawRec.until ? toDate(rawRec.until, () => new Date()) : undefined,
        exDates: rawRec.exDates?.map((d) => toDate(d, () => new Date())),
      }
    : undefined;

  return {
    ...raw,
    id: raw.id ?? `evt-${++autoId}`,
    title: raw.title ?? '(no title)',
    start,
    end,
    allDay: raw.allDay ?? false,
    recurrence: rec,
  } as CalendarEvent;
}

export class EventStore extends Store<CalendarEvent> {
  constructor(config?: Omit<StoreConfig<CalendarEvent>, 'model'>) {
    super({ ...config, model: normalizeEvent });
  }

  /** All occurrences (recurrence-expanded) overlapping `[start, end)`, time-sorted. */
  occurrencesInRange(start: Date, end: Date): EventOccurrence[] {
    return expandEvents(this.toArray(), start, end);
  }

  /**
   * Move an event by a (start,end) delta, preserving duration unless `end` is
   * given explicitly. Returns the updated record.
   */
  moveEvent(id: RecordId, start: Date, end?: Date): CalendarEvent | undefined {
    const ev = this.getById(id);
    if (!ev) return undefined;
    const duration = ev.end.getTime() - ev.start.getTime();
    const newEnd = end ?? new Date(start.getTime() + duration);
    return this.update(id, { start, end: newEnd });
  }

  /** Resize an event's end (keeping start). */
  resizeEvent(id: RecordId, end: Date): CalendarEvent | undefined {
    const ev = this.getById(id);
    if (!ev) return undefined;
    const safeEnd = end.getTime() <= ev.start.getTime() ? addMinutes(ev.start, 15) : end;
    return this.update(id, { end: safeEnd });
  }

  /** Convenience: add a fully-normalized event and return it. */
  addEvent(raw: Partial<CalendarEvent>): CalendarEvent {
    const event = normalizeEvent(raw);
    this.add(event);
    return event;
  }
}
