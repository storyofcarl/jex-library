import { describe, it, expect } from 'vitest';
import { DefaultTimeAxis } from './time-axis.js';
import { WEEK_AND_DAY, YEAR_AND_MONTH, HOUR_AND_DAY } from './presets.js';

const utc = (y: number, mo: number, d: number, h = 0): number => Date.UTC(y, mo, d, h, 0, 0, 0);

describe('TimeAxis: linear projection (fixed units)', () => {
  // 10 days, day preset at pxPerUnit=60, zoom 1 → 60px/day, 600px content.
  const range = { start: utc(2026, 5, 1), end: utc(2026, 5, 11) };
  const axis = new DefaultTimeAxis({ range, preset: WEEK_AND_DAY, zoom: 1 });

  it('reports content width = days * pxPerUnit', () => {
    expect(axis.contentWidth).toBe(10 * 60);
  });

  it('maps range start → 0 and range end → contentWidth', () => {
    expect(axis.toX(range.start)).toBe(0);
    expect(axis.toX(range.end)).toBeCloseTo(axis.contentWidth, 5);
  });

  it('maps a mid time linearly', () => {
    // Day 3 (2026-06-04) → 3 days in → 180px.
    expect(axis.toX(utc(2026, 5, 4))).toBeCloseTo(180, 5);
  });

  it('toTime is the inverse of toX', () => {
    const t = utc(2026, 5, 6, 12);
    const x = axis.toX(t);
    expect(axis.toTime(x)).toBeCloseTo(t, -2); // within ~ a few ms
  });

  it('spanToBox returns the projected box', () => {
    const box = axis.spanToBox({ start: utc(2026, 5, 2), end: utc(2026, 5, 5) });
    expect(box.x).toBeCloseTo(60, 5);
    expect(box.width).toBeCloseTo(180, 5);
  });

  it('durationToWidth scales a duration', () => {
    expect(axis.durationToWidth(2 * 86_400_000)).toBeCloseTo(120, 5);
    expect(axis.durationToWidth(0)).toBe(0);
  });

  it('clamps out-of-range inputs', () => {
    expect(axis.toX(range.start - 1_000_000)).toBe(0);
    expect(axis.toX(range.end + 1_000_000)).toBeCloseTo(axis.contentWidth, 5);
  });
});

describe('TimeAxis: variable-length calendar ticks (month preset)', () => {
  // Jan–Apr 2026: Jan 31, Feb 28, Mar 31. Month preset → each month gets EQUAL
  // pixel width even though they span different durations.
  const range = { start: utc(2026, 0, 1), end: utc(2026, 3, 1) };
  const axis = new DefaultTimeAxis({ range, preset: YEAR_AND_MONTH, zoom: 1 });
  const px = YEAR_AND_MONTH.pxPerUnit; // 90

  it('gives every month the same pixel width', () => {
    expect(axis.contentWidth).toBe(3 * px);
    // Feb starts at exactly one month-width in, despite Jan being 31 days.
    expect(axis.toX(utc(2026, 1, 1))).toBeCloseTo(px, 5);
    expect(axis.toX(utc(2026, 2, 1))).toBeCloseTo(2 * px, 5);
  });

  it('interpolates within a month proportionally to its real length', () => {
    // Mid-Feb (day 14 of a 28-day month) → halfway across the Feb cell.
    const midFeb = utc(2026, 1, 15);
    expect(axis.toX(midFeb)).toBeCloseTo(px + 0.5 * px, 0);
  });

  it('toTime inverts within a variable cell', () => {
    const t = utc(2026, 1, 10);
    expect(axis.toTime(axis.toX(t))).toBeCloseTo(t, -4);
  });
});

describe('TimeAxis: tick generation', () => {
  const range = { start: utc(2026, 5, 1), end: utc(2026, 5, 8) };
  const axis = new DefaultTimeAxis({ range, preset: WEEK_AND_DAY, zoom: 1 });

  it('emits one tick per finest unit in the window', () => {
    const ticks = axis.ticksInRange(0, axis.contentWidth);
    expect(ticks.length).toBe(7); // 7 days
    expect(ticks[0]!.x).toBe(0);
    expect(ticks[0]!.width).toBeCloseTo(60, 5);
    expect(ticks[0]!.span.start).toBe(range.start);
  });

  it('flags week boundaries as major', () => {
    const ticks = axis.ticksInRange(0, axis.contentWidth);
    // 2026-06-01 is a Monday → major. Following days minor.
    const monday = ticks.find((t) => t.span.start === utc(2026, 5, 1));
    expect(monday?.major).toBe(true);
    const tuesday = ticks.find((t) => t.span.start === utc(2026, 5, 2));
    expect(tuesday?.major).toBe(false);
  });

  it('clips ticks to the requested pixel window', () => {
    const ticks = axis.ticksInRange(120, 240);
    // window covers days 2..4 area
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks[0]!.x).toBeGreaterThanOrEqual(60);
  });
});

describe('TimeAxis: snapping', () => {
  const range = { start: utc(2026, 5, 1), end: utc(2026, 5, 11) };
  const axis = new DefaultTimeAxis({ range, preset: WEEK_AND_DAY, zoom: 1 });

  it('snaps to the nearest day boundary', () => {
    expect(axis.snap(utc(2026, 5, 3, 2))).toBe(utc(2026, 5, 3)); // near start
    expect(axis.snap(utc(2026, 5, 3, 20))).toBe(utc(2026, 5, 4)); // near end
  });
});

describe('TimeAxis: setView / setRange re-project', () => {
  const range = { start: utc(2026, 5, 1), end: utc(2026, 5, 11) };

  it('zoom doubles the content width', () => {
    const axis = new DefaultTimeAxis({ range, preset: WEEK_AND_DAY, zoom: 1 });
    const before = axis.contentWidth;
    axis.setView({ zoom: 2 });
    expect(axis.zoom).toBe(2);
    expect(axis.contentWidth).toBeCloseTo(before * 2, 5);
  });

  it('switching preset changes the tick lane', () => {
    const axis = new DefaultTimeAxis({ range, preset: WEEK_AND_DAY, zoom: 1 });
    axis.setView({ preset: HOUR_AND_DAY });
    expect(axis.preset.id).toBe('hourAndDay');
    // hours over 10 days → many ticks
    expect(axis.contentWidth).toBeGreaterThan(1000);
  });

  it('setRange widens the covered span', () => {
    const axis = new DefaultTimeAxis({ range, preset: WEEK_AND_DAY, zoom: 1 });
    axis.setRange({ start: utc(2026, 5, 1), end: utc(2026, 5, 21) });
    expect(axis.contentWidth).toBeCloseTo(20 * 60, 5);
  });

  it('fires onChange on view/range changes', () => {
    let calls = 0;
    const axis = new DefaultTimeAxis({
      range,
      preset: WEEK_AND_DAY,
      zoom: 1,
      onChange: () => calls++,
    });
    axis.setView({ zoom: 2 });
    axis.setRange({ start: utc(2026, 5, 1), end: utc(2026, 5, 15) });
    expect(calls).toBe(2);
    // no-op change does not fire
    axis.setView({ zoom: 2 });
    expect(calls).toBe(2);
  });
});

describe('TimeAxis: degenerate ranges', () => {
  it('repairs an inverted range', () => {
    const axis = new DefaultTimeAxis({
      range: { start: utc(2026, 5, 10), end: utc(2026, 5, 1) },
      preset: WEEK_AND_DAY,
    });
    expect(axis.range.start).toBeLessThan(axis.range.end);
    expect(axis.contentWidth).toBeGreaterThan(0);
  });

  it('handles a zero-length range without throwing', () => {
    const t = utc(2026, 5, 1);
    const axis = new DefaultTimeAxis({ range: { start: t, end: t }, preset: WEEK_AND_DAY });
    expect(axis.range.end).toBeGreaterThan(axis.range.start);
    expect(() => axis.ticksInRange(0, axis.contentWidth)).not.toThrow();
  });
});
