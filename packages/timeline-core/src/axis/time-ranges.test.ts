import { describe, it, expect } from 'vitest';
import { DefaultTimeAxis } from './time-axis.js';
import { WEEK_AND_DAY } from './presets.js';
import {
  projectTimeRanges,
  computeNonWorkingSpans,
  projectNonWorkingSpans,
  mergeSpans,
  computeColumnLines,
  type TimeRange,
} from './time-ranges.js';

const utc = (y: number, mo: number, d: number, h = 0): number => Date.UTC(y, mo, d, h, 0, 0, 0);

function dayAxis(startD: number, endD: number) {
  return new DefaultTimeAxis({
    range: { start: utc(2026, 5, startD), end: utc(2026, 5, endD) },
    preset: WEEK_AND_DAY,
    zoom: 1,
  });
}

describe('time-ranges: projectTimeRanges', () => {
  const axis = dayAxis(1, 11); // 10 days @ 60px

  it('projects a band range to a clipped box', () => {
    const ranges: TimeRange[] = [
      { id: 'r1', span: { start: utc(2026, 5, 2), end: utc(2026, 5, 4) }, kind: 'highlight' },
    ];
    const [box] = projectTimeRanges(ranges, axis);
    expect(box!.x).toBeCloseTo(60, 5);
    expect(box!.width).toBeCloseTo(120, 5);
    expect(box!.marker).toBe(false);
  });

  it('treats a zero-duration range as a marker', () => {
    const ranges: TimeRange[] = [
      { id: 'now', span: { start: utc(2026, 5, 5), end: utc(2026, 5, 5) }, kind: 'marker' },
    ];
    const [box] = projectTimeRanges(ranges, axis);
    expect(box!.marker).toBe(true);
    expect(box!.width).toBe(0);
    expect(box!.x).toBeCloseTo(240, 5);
  });

  it('clips a range overflowing the axis to the visible portion', () => {
    const ranges: TimeRange[] = [
      { id: 'big', span: { start: utc(2026, 4, 1), end: utc(2026, 6, 1) } },
    ];
    const [box] = projectTimeRanges(ranges, axis);
    expect(box!.x).toBe(0);
    expect(box!.width).toBeCloseTo(axis.contentWidth, 5);
  });

  it('drops ranges fully outside the axis', () => {
    const ranges: TimeRange[] = [
      { id: 'out', span: { start: utc(2025, 0, 1), end: utc(2025, 0, 2) } },
    ];
    expect(projectTimeRanges(ranges, axis)).toEqual([]);
  });
});

describe('time-ranges: mergeSpans', () => {
  it('merges overlapping and adjacent spans', () => {
    const merged = mergeSpans([
      { start: 0, end: 10 },
      { start: 10, end: 20 }, // adjacent
      { start: 15, end: 18 }, // overlapping
      { start: 30, end: 40 }, // disjoint
    ]);
    expect(merged).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 40 },
    ]);
  });

  it('returns empty for empty input', () => {
    expect(mergeSpans([])).toEqual([]);
  });
});

describe('time-ranges: non-working-time shading', () => {
  it('shades whole weekend days (day granularity)', () => {
    // June 2026: 6/6 Sat, 6/7 Sun are a weekend.
    const axis = dayAxis(1, 15);
    const spans = computeNonWorkingSpans(axis, {}, 'day');
    // Expect the Sat+Sun pair merged into one 6/6..6/8 span, plus 6/13..6/14 weekend.
    const weekend1 = spans.find((s) => s.start === utc(2026, 5, 6));
    expect(weekend1).toBeDefined();
    expect(weekend1!.end).toBe(utc(2026, 5, 8)); // Sat+Sun merged
  });

  it('shades daily off-hours at hour granularity', () => {
    // A single working Monday: off-hours [00:00,09:00) and [17:00,24:00).
    const axis = new DefaultTimeAxis({
      range: { start: utc(2026, 5, 1), end: utc(2026, 5, 2) }, // Mon
      preset: WEEK_AND_DAY,
      zoom: 1,
    });
    const spans = computeNonWorkingSpans(axis, { dayStartHour: 9, dayEndHour: 17 }, 'hour');
    expect(spans).toContainEqual({ start: utc(2026, 5, 1, 0), end: utc(2026, 5, 1, 9) });
    expect(spans).toContainEqual({ start: utc(2026, 5, 1, 17), end: utc(2026, 5, 2, 0) });
  });

  it('honours explicit holidays and custom weekend days', () => {
    const axis = dayAxis(1, 8);
    const spans = computeNonWorkingSpans(
      axis,
      {
        weekendDays: [5], // Fridays only
        holidays: [{ start: utc(2026, 5, 3), end: utc(2026, 5, 4) }],
      },
      'day',
    );
    // 6/5 is a Friday → non-working; 6/3 is a holiday.
    expect(spans.some((s) => s.start <= utc(2026, 5, 5) && s.end >= utc(2026, 5, 6))).toBe(true);
    expect(spans.some((s) => s.start <= utc(2026, 5, 3) && s.end >= utc(2026, 5, 4))).toBe(true);
  });

  it('projects non-working spans to pixel boxes', () => {
    const axis = dayAxis(1, 15);
    const spans = computeNonWorkingSpans(axis, {}, 'day');
    const boxes = projectNonWorkingSpans(spans, axis);
    expect(boxes.length).toBe(spans.length);
    for (const b of boxes) {
      expect(b.width).toBeGreaterThan(0);
      expect(b.x).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('time-ranges: column lines', () => {
  it('emits one column line per tick, flagging majors', () => {
    const axis = dayAxis(1, 8); // 7 days
    const lines = computeColumnLines(axis, 0, axis.contentWidth);
    expect(lines.length).toBe(7);
    // 6/1 is Monday → major.
    const monday = lines.find((l) => l.time === utc(2026, 5, 1));
    expect(monday?.major).toBe(true);
    expect(lines[1]!.x).toBeCloseTo(60, 5);
  });

  it('aligns column lines with axis ticks pixel-for-pixel', () => {
    const axis = dayAxis(1, 11);
    const lines = computeColumnLines(axis, 0, axis.contentWidth);
    const ticks = axis.ticksInRange(0, axis.contentWidth);
    expect(lines.map((l) => l.x)).toEqual(ticks.map((t) => t.x));
  });
});
