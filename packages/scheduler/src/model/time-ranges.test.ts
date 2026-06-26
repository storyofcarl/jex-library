import { describe, it, expect } from 'vitest';
import type { TimeAxis, TimeSpan } from '@jects/timeline-core';
import {
  projectTimeRangeConfigs,
  projectResourceTimeRangeConfigs,
  type TimeRangeConfig,
  type ResourceTimeRangeConfig,
} from './time-ranges.js';

/** A trivial linear axis: 1ms = 1px, range [0, 1000). */
function linearAxis(range: TimeSpan = { start: 0, end: 1000 }): TimeAxis {
  return {
    range,
    preset: { id: 'test', headers: [], tickUnit: 'millisecond', pxPerUnit: 1 },
    zoom: 1,
    contentWidth: range.end - range.start,
    toX: (t) => t - range.start,
    toTime: (x) => x + range.start,
    spanToBox: (span: TimeSpan) => ({ x: span.start - range.start, width: span.end - span.start }),
    durationToWidth: (d) => d,
    ticksInRange: () => [],
    snap: (t) => t,
    setView: () => {},
    setRange: () => {},
  };
}

describe('projectTimeRangeConfigs (global)', () => {
  const axis = linearAxis();

  it('projects a band to a pixel box and preserves the source record', () => {
    const range: TimeRangeConfig = { id: 'lunch', startDate: 100, endDate: 300, name: 'Lunch' };
    const boxes = projectTimeRangeConfigs([range], axis);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.x).toBe(100);
    expect(boxes[0]!.width).toBe(200);
    expect(boxes[0]!.marker).toBe(false);
    expect(boxes[0]!.range).toBe(range); // original config, not the core shape
  });

  it('renders a zero-width range as a marker', () => {
    const boxes = projectTimeRangeConfigs(
      [{ id: 'now', startDate: 500, endDate: 500 }],
      axis,
    );
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.marker).toBe(true);
    expect(boxes[0]!.width).toBe(0);
    expect(boxes[0]!.x).toBe(500);
  });

  it('clips a band that overruns the axis range', () => {
    const boxes = projectTimeRangeConfigs(
      [{ id: 'r', startDate: 800, endDate: 5000 }],
      axis,
    );
    expect(boxes[0]!.x).toBe(800);
    expect(boxes[0]!.width).toBe(200); // clipped to range.end = 1000
  });

  it('drops a band entirely outside the axis range', () => {
    const boxes = projectTimeRangeConfigs(
      [{ id: 'r', startDate: 2000, endDate: 3000 }],
      axis,
    );
    expect(boxes).toHaveLength(0);
  });

  it('returns nothing for an empty config', () => {
    expect(projectTimeRangeConfigs([], axis)).toEqual([]);
  });
});

describe('projectResourceTimeRangeConfigs (per-resource)', () => {
  const axis = linearAxis();
  const band = (id: string): { top: number; height: number } | undefined =>
    id === 'r1' ? { top: 0, height: 48 } : id === 'r2' ? { top: 48, height: 48 } : undefined;

  it('projects horizontally and confines vertically to the resource band', () => {
    const ranges: ResourceTimeRangeConfig[] = [
      { id: 'pto', resourceId: 'r2', startDate: 100, endDate: 400, name: 'PTO' },
    ];
    const boxes = projectResourceTimeRangeConfigs(ranges, axis, band);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.x).toBe(100);
    expect(boxes[0]!.width).toBe(300);
    expect(boxes[0]!.top).toBe(48);
    expect(boxes[0]!.height).toBe(48);
    expect(boxes[0]!.range.resourceId).toBe('r2');
  });

  it('drops ranges whose resource is not currently laid out', () => {
    const boxes = projectResourceTimeRangeConfigs(
      [{ id: 'x', resourceId: 'ghost', startDate: 0, endDate: 100 }],
      axis,
      band,
    );
    expect(boxes).toHaveLength(0);
  });

  it('clips horizontally but keeps the row band', () => {
    const boxes = projectResourceTimeRangeConfigs(
      [{ id: 'm', resourceId: 'r1', startDate: 900, endDate: 2000 }],
      axis,
      band,
    );
    expect(boxes[0]!.x).toBe(900);
    expect(boxes[0]!.width).toBe(100);
    expect(boxes[0]!.top).toBe(0);
  });
});
