import { describe, it, expect } from 'vitest';
import { toIcs, toCsv, eventToVEvent } from './export.js';
import { normalizeEvent } from './event-store.js';

const ev = () =>
  normalizeEvent({
    id: 'a',
    title: 'Standup',
    start: new Date(2026, 5, 24, 9, 0),
    end: new Date(2026, 5, 24, 9, 30),
    location: 'Room A',
    recurrence: { freq: 'daily', count: 5 },
  });

describe('export — ICS', () => {
  it('produces a VCALENDAR with a VEVENT + DTSTART', () => {
    const ics = toIcs([ev()]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(ics).toContain('SUMMARY:Standup');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('serializes the recurrence as an RRULE line', () => {
    const lines = eventToVEvent(ev(), Date.now());
    expect(lines).toContain('RRULE:FREQ=DAILY;COUNT=5');
  });

  it('emits all-day events as DATE values', () => {
    const allDay = normalizeEvent({
      id: 'b',
      title: 'Conf',
      start: new Date(2026, 5, 24),
      end: new Date(2026, 5, 25),
      allDay: true,
    });
    expect(toIcs([allDay])).toMatch(/DTSTART;VALUE=DATE:\d{8}/);
  });
});

describe('export — CSV/Excel', () => {
  it('has a header row + one row per event', () => {
    const csv = toCsv([ev()]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toContain('title');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Standup');
    expect(lines[1]).toContain('FREQ=DAILY;COUNT=5');
  });
});
