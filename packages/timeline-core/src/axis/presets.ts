/**
 * Built-in {@link ViewPreset}s and the zoom ladder — hour/day/week/month/year
 * multi-row headers with sensible neutral scales.
 *
 * A preset stacks header bands coarse (top) → fine (bottom); the bottom band's
 * unit is the `tickUnit` that fixes horizontal scale via `pxPerUnit`. Zooming
 * either scales `pxPerUnit` along `zoomLevels` (continuous-ish, same preset) or
 * swaps to an adjacent preset on the {@link PRESET_LADDER} (coarse↔fine).
 *
 * Pure data + lookup helpers — no DOM, no axis state.
 */

import type { ViewPreset, TimeUnit } from '../contract.js';

/** Default discrete zoom multipliers every built-in preset offers (1 = neutral). */
export const DEFAULT_ZOOM_LEVELS: readonly number[] = [0.25, 0.5, 1, 2, 4];

/* ── Built-in presets, fine → coarse ─────────────────────────────────────── */

/** Hour grid under a day band — intraday scheduling. */
export const HOUR_AND_DAY: ViewPreset = {
  id: 'hourAndDay',
  label: 'Hour',
  headers: [
    { unit: 'day', format: 'ddd D MMM', align: 'start' },
    { unit: 'hour', format: 'HH', align: 'center' },
  ],
  tickUnit: 'hour',
  tickIncrement: 1,
  pxPerUnit: 40,
  zoomLevels: [...DEFAULT_ZOOM_LEVELS],
};

/** Day grid under a week band — the default working view. */
export const WEEK_AND_DAY: ViewPreset = {
  id: 'weekAndDay',
  label: 'Day',
  headers: [
    { unit: 'week', format: "[W]w", align: 'start' },
    { unit: 'day', format: 'D', align: 'center' },
  ],
  tickUnit: 'day',
  tickIncrement: 1,
  pxPerUnit: 60,
  zoomLevels: [...DEFAULT_ZOOM_LEVELS],
};

/** Week grid under a month band — multi-week planning. */
export const MONTH_AND_WEEK: ViewPreset = {
  id: 'monthAndWeek',
  label: 'Week',
  headers: [
    { unit: 'month', format: 'MMM YYYY', align: 'start' },
    { unit: 'week', format: "[W]w", align: 'center' },
  ],
  tickUnit: 'week',
  tickIncrement: 1,
  pxPerUnit: 70,
  zoomLevels: [...DEFAULT_ZOOM_LEVELS],
};

/** Month grid under a year band — quarter/roadmap planning. */
export const YEAR_AND_MONTH: ViewPreset = {
  id: 'yearAndMonth',
  label: 'Month',
  headers: [
    { unit: 'year', format: 'YYYY', align: 'start' },
    { unit: 'month', format: 'MMM', align: 'center' },
  ],
  tickUnit: 'month',
  tickIncrement: 1,
  pxPerUnit: 90,
  zoomLevels: [...DEFAULT_ZOOM_LEVELS],
};

/** Quarter grid under a year band — long-horizon portfolio view. */
export const YEAR_AND_QUARTER: ViewPreset = {
  id: 'yearAndQuarter',
  label: 'Quarter',
  headers: [
    { unit: 'year', format: 'YYYY', align: 'start' },
    { unit: 'quarter', format: '[Q]Q', align: 'center' },
  ],
  tickUnit: 'quarter',
  tickIncrement: 1,
  pxPerUnit: 110,
  zoomLevels: [...DEFAULT_ZOOM_LEVELS],
};

/**
 * The ordered preset ladder, finest → coarsest. Crossing a preset's zoom
 * extremes steps onto the adjacent preset (zoom-in past the finest level moves
 * toward intraday; zoom-out past the coarsest moves toward years).
 */
export const PRESET_LADDER: readonly ViewPreset[] = [
  HOUR_AND_DAY,
  WEEK_AND_DAY,
  MONTH_AND_WEEK,
  YEAR_AND_MONTH,
  YEAR_AND_QUARTER,
];

/** Map of built-in presets by id, for quick lookup / pickers. */
export const BUILT_IN_PRESETS: ReadonlyMap<string, ViewPreset> = new Map(
  PRESET_LADDER.map((p) => [p.id, p]),
);

/** Look up a built-in preset by id. */
export function getPreset(id: string): ViewPreset | undefined {
  return BUILT_IN_PRESETS.get(id);
}

/**
 * The finest (bottom) header band of a preset — the band whose unit is the
 * `tickUnit`. Presets list headers coarse→fine, so the finest is the last.
 */
export function finestBand(preset: ViewPreset): { unit: TimeUnit; increment: number } {
  const band = preset.headers[preset.headers.length - 1];
  return {
    unit: band?.unit ?? preset.tickUnit,
    increment: band?.increment ?? 1,
  };
}

/**
 * Normalize a preset's zoom multiplier to the nearest selectable level, clamped
 * to the preset's range. Falls back to `1` (neutral) when no levels are defined.
 */
export function clampZoom(preset: ViewPreset, zoom: number): number {
  const levels = preset.zoomLevels;
  if (!levels || levels.length === 0) return zoom > 0 ? zoom : 1;
  let best = levels[0]!;
  let bestDelta = Math.abs(zoom - best);
  for (const lvl of levels) {
    const delta = Math.abs(zoom - lvl);
    if (delta < bestDelta) {
      best = lvl;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * Result of a single zoom step: which preset to show and at what multiplier.
 * When a step stays inside the current preset, `preset` is unchanged and only
 * `zoom` advances along `zoomLevels`. When it runs off either end, it crosses to
 * the adjacent ladder preset (re-entering at that preset's matching extreme).
 */
export interface ZoomStep {
  preset: ViewPreset;
  zoom: number;
}

/** Index of a preset on the supplied (or built-in) ladder, or -1. */
function ladderIndex(preset: ViewPreset, ladder: readonly ViewPreset[]): number {
  return ladder.findIndex((p) => p.id === preset.id);
}

/**
 * Compute the next view one zoom step *in* (toward finer granularity). Advances
 * to the next-higher `zoomLevels` entry; if already at the max, steps to the
 * finer adjacent preset at its lowest zoom (so the visible scale keeps growing).
 */
export function zoomInStep(
  preset: ViewPreset,
  zoom: number,
  ladder: readonly ViewPreset[] = PRESET_LADDER,
): ZoomStep {
  const levels = preset.zoomLevels ?? DEFAULT_ZOOM_LEVELS;
  const cur = clampZoom(preset, zoom);
  const i = levels.indexOf(cur);
  if (i >= 0 && i < levels.length - 1) {
    return { preset, zoom: levels[i + 1]! };
  }
  // At max zoom for this preset → move to the finer preset (lower ladder index).
  const li = ladderIndex(preset, ladder);
  if (li > 0) {
    const finer = ladder[li - 1]!;
    const fl = finer.zoomLevels ?? DEFAULT_ZOOM_LEVELS;
    return { preset: finer, zoom: fl[0]! };
  }
  // Already finest preset at max zoom — stay put.
  return { preset, zoom: cur };
}

/**
 * Compute the next view one zoom step *out* (toward coarser granularity).
 * Symmetric to {@link zoomInStep}.
 */
export function zoomOutStep(
  preset: ViewPreset,
  zoom: number,
  ladder: readonly ViewPreset[] = PRESET_LADDER,
): ZoomStep {
  const levels = preset.zoomLevels ?? DEFAULT_ZOOM_LEVELS;
  const cur = clampZoom(preset, zoom);
  const i = levels.indexOf(cur);
  if (i > 0) {
    return { preset, zoom: levels[i - 1]! };
  }
  // At min zoom for this preset → move to the coarser preset (higher index).
  const li = ladderIndex(preset, ladder);
  if (li >= 0 && li < ladder.length - 1) {
    const coarser = ladder[li + 1]!;
    const cl = coarser.zoomLevels ?? DEFAULT_ZOOM_LEVELS;
    return { preset: coarser, zoom: cl[cl.length - 1]! };
  }
  // Already coarsest preset at min zoom — stay put.
  return { preset, zoom: cur };
}
