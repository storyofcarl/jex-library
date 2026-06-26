/**
 * jsdom unit tests for the ICS (iCalendar) export/import feature.
 *
 * Covers: VEVENT serialization (UID/DTSTART/DTEND/SUMMARY/RRULE/resource),
 * UTC timestamp formatting, TEXT escaping, line folding/unfolding, the
 * round-trip (events → ICS → events), DURATION parsing, importer store merge +
 * skip-existing, and the browser download side effect.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  toIcs,
  parseIcs,
  eventToVEvent,
  formatIcsUtc,
  parseIcsDate,
  escapeIcsText,
  unescapeIcsText,
  foldLine,
  unfoldLines,
  parseIcsDuration,
  normalizeRRuleLine,
  IcsExporter,
  IcsImporter,
  icsExporter,
  icsImporter,
  triggerIcsDownload,
} from './ics.js';
import { createEventStore } from '../stores/stores.js';
import type { EventModel } from '../contract.js';

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0); // 2026-01-05T09:00:00Z
const T1 = Date.UTC(2026, 0, 5, 10, 30, 0); // +90min

function ev(over: Partial<EventModel> = {}): EventModel {
  return {
    id: 'e1',
    resourceId: 'r1',
    name: 'Standup',
    startDate: T0,
    endDate: T1,
    ...over,
  };
}

describe('ICS time + text helpers', () => {
  it('formats epoch ms as a UTC basic-format timestamp', () => {
    expect(formatIcsUtc(T0)).toBe('20260105T090000Z');
    expect(formatIcsUtc(Date.UTC(2026, 11, 31, 23, 59, 59))).toBe('20261231T235959Z');
  });

  it('parses UTC, date-only, and ISO date-times', () => {
    expect(parseIcsDate('20260105T090000Z')).toBe(T0);
    expect(parseIcsDate('20260105')).toBe(Date.UTC(2026, 0, 5));
    expect(parseIcsDate('2026-01-05T09:00:00Z')).toBe(T0);
    expect(parseIcsDate('not-a-date')).toBeNull();
  });

  it('escapes + unescapes TEXT round-trip (RFC-5545 §3.3.11)', () => {
    const raw = 'A; B, C \\ D\nE';
    const esc = escapeIcsText(raw);
    expect(esc).toBe('A\\; B\\, C \\\\ D\\nE');
    expect(unescapeIcsText(esc)).toBe(raw);
  });

  it('folds long lines to <=75 octets with leading-space continuations', () => {
    const long = 'SUMMARY:' + 'x'.repeat(200);
    const folded = foldLine(long);
    const physical = folded.split('\r\n');
    expect(physical[0]!.length).toBe(75);
    for (let i = 1; i < physical.length; i++) {
      expect(physical[i]!.startsWith(' ')).toBe(true);
      expect(physical[i]!.length).toBeLessThanOrEqual(75);
    }
    // Unfolding restores the original.
    expect(unfoldLines(folded)).toEqual([long]);
  });

  it('parses RFC-5545 DURATION values', () => {
    expect(parseIcsDuration('PT1H30M')).toBe(90 * 60 * 1000);
    expect(parseIcsDuration('P1D')).toBe(86_400_000);
    expect(parseIcsDuration('P1W')).toBe(7 * 86_400_000);
    expect(parseIcsDuration('-PT15M')).toBe(-15 * 60 * 1000);
    expect(parseIcsDuration('garbage')).toBeNull();
  });

  it('normalizes an RRULE line (bare or prefixed)', () => {
    expect(normalizeRRuleLine('FREQ=DAILY;INTERVAL=2')).toBe('RRULE:FREQ=DAILY;INTERVAL=2');
    expect(normalizeRRuleLine('RRULE:FREQ=WEEKLY')).toBe('RRULE:FREQ=WEEKLY');
    expect(normalizeRRuleLine('')).toBeNull();
    expect(normalizeRRuleLine(undefined)).toBeNull();
  });
});

describe('eventToVEvent / toIcs serialization', () => {
  it('emits the core VEVENT properties', () => {
    const lines = eventToVEvent(ev(), { now: T0 });
    expect(lines[0]).toBe('BEGIN:VEVENT');
    expect(lines).toContain('UID:e1@jects');
    expect(lines).toContain('DTSTART:20260105T090000Z');
    expect(lines).toContain('DTEND:20260105T103000Z');
    expect(lines).toContain('SUMMARY:Standup');
    expect(lines).toContain('X-JECTS-RESOURCE:r1');
    expect(lines[lines.length - 1]).toBe('END:VEVENT');
  });

  it('includes the RRULE when the event recurs', () => {
    const lines = eventToVEvent(ev({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE' }), { now: T0 });
    expect(lines).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE');
  });

  it('serializes percentDone as PERCENT-COMPLETE 0..100', () => {
    const lines = eventToVEvent(ev({ percentDone: 0.5 }), { now: T0 });
    expect(lines).toContain('PERCENT-COMPLETE:50');
  });

  it('produces a complete VCALENDAR with CRLF endings + trailing CRLF', () => {
    const ics = toIcs([ev()], { now: T0, calendarName: 'My Sched' });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//Jects UI//Scheduler//EN');
    expect(ics).toContain('X-WR-CALNAME:My Sched');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics.endsWith('\r\n')).toBe(true);
  });

  it('honors a custom uid + summary resolver', () => {
    const ics = toIcs([ev()], {
      now: T0,
      uid: (e) => `custom-${e.id}@example.com`,
      summary: () => 'Renamed',
    });
    expect(ics).toContain('UID:custom-e1@example.com');
    expect(ics).toContain('SUMMARY:Renamed');
  });

  it('omits the resource property when includeResource is false', () => {
    const ics = toIcs([ev()], { now: T0, includeResource: false });
    expect(ics).not.toContain('X-JECTS-RESOURCE');
  });
});

describe('parseIcs', () => {
  it('round-trips a serialized event back to an equivalent record', () => {
    const original = ev({ recurrenceRule: 'FREQ=DAILY;COUNT=3', percentDone: 0.25 });
    const ics = toIcs([original], { now: T0 });
    const { events } = parseIcs(ics);
    expect(events).toHaveLength(1);
    const e = events[0]!.event;
    expect(e.id).toBe('e1');
    expect(e.resourceId).toBe('r1');
    expect(e.name).toBe('Standup');
    expect(e.startDate).toBe(T0);
    expect(e.endDate).toBe(T1);
    expect(e.recurrenceRule).toBe('RRULE:FREQ=DAILY;COUNT=3');
    expect(e.percentDone).toBeCloseTo(0.25, 5);
    expect(events[0]!.uid).toBe('e1@jects');
  });

  it('reads the calendar name', () => {
    const ics = toIcs([ev()], { now: T0, calendarName: 'Team' });
    expect(parseIcs(ics).calendarName).toBe('Team');
  });

  it('falls back to DURATION when DTEND is absent', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:x@host',
      'DTSTART:20260105T090000Z',
      'DURATION:PT45M',
      'SUMMARY:Call',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
    const e = parseIcs(ics).events[0]!.event;
    expect(e.startDate).toBe(T0);
    expect(e.endDate).toBe(T0 + 45 * 60 * 1000);
    expect(e.id).toBe('x'); // host stripped from UID
  });

  it('assigns the default resource id when no X-JECTS-RESOURCE is present', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:y',
      'DTSTART:20260105T090000Z',
      'DTEND:20260105T100000Z',
      'SUMMARY:Imported',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const e = parseIcs(ics, { defaultResourceId: 'inbox' }).events[0]!.event;
    expect(e.resourceId).toBe('inbox');
  });

  it('skips a VEVENT missing DTSTART rather than throwing', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:Broken',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcs(ics).events).toHaveLength(0);
  });

  it('unfolds folded SUMMARY lines and unescapes text', () => {
    const summary = 'Quarterly review; planning, budget \\ notes';
    const ics = toIcs([ev({ name: summary })], { now: T0 });
    const e = parseIcs(ics).events[0]!.event;
    expect(e.name).toBe(summary);
  });
});

describe('IcsExporter / IcsImporter (store-bound)', () => {
  it('exports a store to ICS via the exporter', () => {
    const store = createEventStore([ev()]);
    const out = icsExporter(store, { now: T0 }).toIcs();
    expect(out).toContain('SUMMARY:Standup');
    expect(out).toContain('UID:e1@jects');
  });

  it('imports parsed events into a store and returns the added ones', () => {
    const store = createEventStore([]);
    const ics = toIcs([ev({ id: 'a' }), ev({ id: 'b', name: 'Lunch' })], { now: T0 });
    const added = icsImporter(store, { defaultResourceId: 'r9' }).import(ics);
    expect(added.map((e) => e.id)).toEqual(['a', 'b']);
    expect(store.count).toBe(2);
    expect(store.getById('b')!.name).toBe('Lunch');
  });

  it('skips events whose id already exists by default', () => {
    const store = createEventStore([ev({ id: 'a', name: 'Existing' })]);
    const ics = toIcs([ev({ id: 'a', name: 'Incoming' }), ev({ id: 'c' })], { now: T0 });
    const importer = new IcsImporter(store);
    const added = importer.import(ics);
    expect(added.map((e) => e.id)).toEqual(['c']);
    expect(store.getById('a')!.name).toBe('Existing'); // untouched
    expect(store.count).toBe(2);
  });

  it('parse() does not mutate the store', () => {
    const store = createEventStore([]);
    const ics = toIcs([ev()], { now: T0 });
    const parsed = new IcsImporter(store).parse(ics);
    expect(parsed.events).toHaveLength(1);
    expect(store.count).toBe(0);
  });
});

describe('triggerIcsDownload (browser side effect)', () => {
  let createUrl: ReturnType<typeof vi.fn>;
  let revokeUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createUrl = vi.fn(() => 'blob:mock');
    revokeUrl = vi.fn();
    // jsdom lacks createObjectURL.
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createUrl;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeUrl;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an anchor with a .ics download and clicks it', () => {
    const clicks: string[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = realCreate(tag) as HTMLElement;
      if (tag === 'a') {
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {
          clicks.push((el as HTMLAnchorElement).download);
        });
      }
      return el;
    }) as typeof document.createElement);

    triggerIcsDownload('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', 'team');
    expect(createUrl).toHaveBeenCalledOnce();
    expect(clicks).toEqual(['team.ics']);
  });

  it('exporter.download() flows through to a .ics anchor', () => {
    const store = createEventStore([ev()]);
    const clicks: string[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = realCreate(tag) as HTMLElement;
      if (tag === 'a') {
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {
          clicks.push((el as HTMLAnchorElement).download);
        });
      }
      return el;
    }) as typeof document.createElement);

    new IcsExporter(store, { now: T0, fileName: 'sprint' }).download();
    expect(clicks).toEqual(['sprint.ics']);
  });
});
