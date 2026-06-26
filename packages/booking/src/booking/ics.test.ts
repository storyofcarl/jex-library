import { describe, it, expect } from 'vitest';
import {
  bookingToIcs,
  eventToVEvent,
  escapeIcsText,
  formatIcsUtc,
  foldLine,
  type IcsEvent,
} from './ics.js';

const ev: IcsEvent = {
  uid: 'bk-1@jects',
  start: new Date('2030-06-24T13:00:00Z'),
  end: new Date('2030-06-24T13:30:00Z'),
  summary: 'Haircut; with Ada, Lovelace',
  email: 'ada@example.com',
};

describe('escape / format helpers', () => {
  it('escapes ICS special characters', () => {
    expect(escapeIcsText('a; b, c\\d\ne')).toBe('a\\; b\\, c\\\\d\\ne');
  });
  it('formats a UTC stamp', () => {
    expect(formatIcsUtc(new Date('2030-06-24T13:05:09Z'))).toBe('20300624T130509Z');
  });
  it('folds long lines to <=75 octets with continuation', () => {
    const folded = foldLine('X'.repeat(80));
    const lines = folded.split('\r\n');
    expect(lines[0]!.length).toBe(75);
    expect(lines[1]!.startsWith(' ')).toBe(true);
  });
});

describe('eventToVEvent', () => {
  it('emits the core VEVENT properties', () => {
    const lines = eventToVEvent(ev, Date.parse('2030-06-01T00:00:00Z'));
    expect(lines[0]).toBe('BEGIN:VEVENT');
    expect(lines).toContain('UID:bk-1@jects');
    expect(lines).toContain('DTSTART:20300624T130000Z');
    expect(lines).toContain('DTEND:20300624T133000Z');
    expect(lines).toContain('SUMMARY:Haircut\\; with Ada\\, Lovelace');
    expect(lines).toContain('ORGANIZER:mailto:ada@example.com');
    expect(lines[lines.length - 1]).toBe('END:VEVENT');
  });
});

describe('bookingToIcs', () => {
  it('wraps events in a VCALENDAR', () => {
    const ics = bookingToIcs(ev);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//Jects UI//Booking//EN');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
  it('accepts an array of events', () => {
    const ics = bookingToIcs([ev, { ...ev, uid: 'bk-2@jects' }]);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
  });
});
