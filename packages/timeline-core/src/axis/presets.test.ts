import { describe, it, expect } from 'vitest';
import type { ViewPreset } from '../contract.js';
import {
  PRESET_LADDER,
  BUILT_IN_PRESETS,
  HOUR_AND_DAY,
  WEEK_AND_DAY,
  MONTH_AND_WEEK,
  YEAR_AND_QUARTER,
  getPreset,
  finestBand,
  clampZoom,
  zoomInStep,
  zoomOutStep,
  DEFAULT_ZOOM_LEVELS,
} from './presets.js';

describe('presets: built-in catalogue', () => {
  it('exposes presets by id', () => {
    expect(getPreset('weekAndDay')).toBe(WEEK_AND_DAY);
    expect(getPreset('hourAndDay')).toBe(HOUR_AND_DAY);
    expect(getPreset('nope')).toBeUndefined();
    expect(BUILT_IN_PRESETS.size).toBe(PRESET_LADDER.length);
  });

  it('each preset stacks coarse → fine with the tickUnit as the finest band', () => {
    for (const p of PRESET_LADDER) {
      expect(p.headers.length).toBeGreaterThanOrEqual(1);
      const last = p.headers[p.headers.length - 1]!;
      expect(last.unit).toBe(p.tickUnit);
      expect(p.pxPerUnit).toBeGreaterThan(0);
    }
  });

  it('finestBand returns the bottom band', () => {
    const fb = finestBand(WEEK_AND_DAY);
    expect(fb.unit).toBe('day');
    expect(fb.increment).toBe(1);
  });
});

describe('presets: clampZoom', () => {
  it('snaps to the nearest level', () => {
    expect(clampZoom(WEEK_AND_DAY, 1.9)).toBe(2);
    expect(clampZoom(WEEK_AND_DAY, 0.3)).toBe(0.25);
    expect(clampZoom(WEEK_AND_DAY, 100)).toBe(4); // clamp to max
  });

  it('falls back to provided zoom when no levels', () => {
    const p: ViewPreset = { id: 'x', headers: [{ unit: 'day' }], tickUnit: 'day', pxPerUnit: 10 };
    expect(clampZoom(p, 3)).toBe(3);
    expect(clampZoom(p, -5)).toBe(1);
  });
});

describe('presets: zoom ladder stepping', () => {
  it('zoomIn advances along zoomLevels within a preset', () => {
    const step = zoomInStep(WEEK_AND_DAY, 1);
    expect(step.preset.id).toBe('weekAndDay');
    expect(step.zoom).toBe(2);
  });

  it('zoomIn past the max crosses to the finer adjacent preset at its min zoom', () => {
    // WEEK_AND_DAY is index 1; finer is HOUR_AND_DAY (index 0).
    const max = DEFAULT_ZOOM_LEVELS[DEFAULT_ZOOM_LEVELS.length - 1]!;
    const step = zoomInStep(WEEK_AND_DAY, max);
    expect(step.preset.id).toBe('hourAndDay');
    expect(step.zoom).toBe(DEFAULT_ZOOM_LEVELS[0]);
  });

  it('zoomIn at the finest preset max stays put', () => {
    const max = DEFAULT_ZOOM_LEVELS[DEFAULT_ZOOM_LEVELS.length - 1]!;
    const step = zoomInStep(HOUR_AND_DAY, max);
    expect(step.preset.id).toBe('hourAndDay');
    expect(step.zoom).toBe(max);
  });

  it('zoomOut decreases along zoomLevels within a preset', () => {
    const step = zoomOutStep(WEEK_AND_DAY, 2);
    expect(step.preset.id).toBe('weekAndDay');
    expect(step.zoom).toBe(1);
  });

  it('zoomOut past the min crosses to the coarser adjacent preset at its max zoom', () => {
    const min = DEFAULT_ZOOM_LEVELS[0]!;
    const max = DEFAULT_ZOOM_LEVELS[DEFAULT_ZOOM_LEVELS.length - 1]!;
    const step = zoomOutStep(WEEK_AND_DAY, min);
    expect(step.preset.id).toBe('monthAndWeek');
    expect(step.zoom).toBe(max);
  });

  it('zoomOut at the coarsest preset min stays put', () => {
    const min = DEFAULT_ZOOM_LEVELS[0]!;
    const step = zoomOutStep(YEAR_AND_QUARTER, min);
    expect(step.preset.id).toBe('yearAndQuarter');
    expect(step.zoom).toBe(min);
  });

  it('a full zoom-out then zoom-in round-trips across the preset boundary', () => {
    const min = DEFAULT_ZOOM_LEVELS[0]!;
    const out = zoomOutStep(WEEK_AND_DAY, min); // → monthAndWeek @ max
    expect(out.preset.id).toBe('monthAndWeek');
    const back = zoomInStep(out.preset, out.zoom); // → weekAndDay @ min
    expect(back.preset.id).toBe('weekAndDay');
    expect(back.zoom).toBe(min);
    void MONTH_AND_WEEK;
  });
});
