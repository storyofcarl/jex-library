import { describe, it, expect } from 'vitest';
import { parseRRule, expandOccurrences } from './recurrence.js';

const DAY = 86_400_000;

describe('parseRRule', () => {
  it('parses FREQ + INTERVAL + COUNT', () => {
    const r = parseRRule('FREQ=DAILY;INTERVAL=2;COUNT=5');
    expect(r).toMatchObject({ freq: 'DAILY', interval: 2, count: 5 });
  });

  it('accepts an RRULE: prefix', () => {
    expect(parseRRule('RRULE:FREQ=WEEKLY')?.freq).toBe('WEEKLY');
  });

  it('parses BYDAY into weekday numbers', () => {
    const r = parseRRule('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(r?.byDay).toEqual([1, 3, 5]);
  });

  it('parses UNTIL in iCal basic form', () => {
    const r = parseRRule('FREQ=DAILY;UNTIL=20250110T000000Z');
    expect(r?.until).toBe(Date.UTC(2025, 0, 10));
  });

  it('returns null for an unsupported / empty rule', () => {
    expect(parseRRule('')).toBeNull();
    expect(parseRRule('FREQ=SECONDLY')).toBeNull();
    expect(parseRRule('INTERVAL=2')).toBeNull();
  });
});

describe('expandOccurrences', () => {
  const start = Date.UTC(2025, 0, 1); // 2025-01-01
  const master = { start, end: start + DAY };

  it('expands a daily rule within a window', () => {
    const rule = parseRRule('FREQ=DAILY;COUNT=5')!;
    const occ = expandOccurrences(master, rule, { start, end: start + DAY * 10 });
    expect(occ).toHaveLength(5);
    expect(occ[0]!.start).toBe(start);
    expect(occ[1]!.start).toBe(start + DAY);
  });

  it('honours INTERVAL', () => {
    const rule = parseRRule('FREQ=DAILY;INTERVAL=3;COUNT=3')!;
    const occ = expandOccurrences(master, rule, { start, end: start + DAY * 30 });
    expect(occ.map((o) => o.start)).toEqual([start, start + DAY * 3, start + DAY * 6]);
  });

  it('clips to the visible window', () => {
    const rule = parseRRule('FREQ=DAILY')!;
    const occ = expandOccurrences(master, rule, {
      start: start + DAY * 2,
      end: start + DAY * 5,
    });
    // Only occurrences intersecting [day2, day5).
    expect(occ.every((o) => o.end > start + DAY * 2 && o.start < start + DAY * 5)).toBe(true);
    expect(occ.length).toBeGreaterThan(0);
  });

  it('preserves the master duration on every occurrence', () => {
    const wide = { start, end: start + DAY * 2 };
    const rule = parseRRule('FREQ=WEEKLY;COUNT=2')!;
    const occ = expandOccurrences(wide, rule, { start, end: start + DAY * 30 });
    for (const o of occ) expect(o.end - o.start).toBe(DAY * 2);
  });

  it('expands WEEKLY BYDAY occurrences', () => {
    // 2025-01-01 is a Wednesday.
    const rule = parseRRule('FREQ=WEEKLY;BYDAY=WE,FR;COUNT=4')!;
    const occ = expandOccurrences(master, rule, { start, end: start + DAY * 21 });
    expect(occ.length).toBeGreaterThanOrEqual(3);
    // First occurrence is the master Wednesday.
    expect(occ[0]!.start).toBe(start);
  });

  it('stops at UNTIL', () => {
    const rule = parseRRule(`FREQ=DAILY;UNTIL=${start + DAY * 2}`)!;
    const occ = expandOccurrences(master, rule, { start, end: start + DAY * 30 });
    expect(occ.every((o) => o.start <= start + DAY * 2)).toBe(true);
  });

  it('COUNT expansion is idempotent across window widths (no early break)', () => {
    // A COUNT=5 daily series must yield the same occurrence STARTS no matter how
    // narrow the visible window is — the window only clips, it never under-counts.
    const rule = parseRRule('FREQ=DAILY;COUNT=5')!;
    const wide = expandOccurrences(master, rule, { start, end: start + DAY * 30 });
    // Narrow window ending day 2 used to break early after 1–2 occurrences.
    const narrow = expandOccurrences(master, rule, { start: start + DAY * 3, end: start + DAY * 4 });
    expect(wide).toHaveLength(5);
    // The narrow window's occurrence(s) must be a subset of the full sequence —
    // i.e. day-3's occurrence (start+DAY*3) is present, proving counting continued
    // past the window edge rather than stopping at it.
    const wideStarts = new Set(wide.map((o) => o.start));
    expect(narrow.length).toBeGreaterThan(0);
    for (const o of narrow) expect(wideStarts.has(o.start)).toBe(true);
    expect(narrow.some((o) => o.start === start + DAY * 3)).toBe(true);
  });
});
