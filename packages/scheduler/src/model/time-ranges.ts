/**
 * Time ranges + resource time ranges — pure pixel projection for the named,
 * styleable bands the scheduler paints behind its event bars. No DOM.
 *
 * Two flavours, mirroring Bryntum/DHTMLX:
 *   1. {@link TimeRangeConfig} — GLOBAL named spans shaded/lined across the WHOLE
 *      timeline, independent of any resource ("lunch", "now", a highlighted
 *      window). Projected to full-height `{ x, width }` boxes via the axis.
 *   2. {@link ResourceTimeRangeConfig} — the same idea SCOPED to one resource
 *      row, shaded only within that resource's row band (a person's PTO, a
 *      machine's maintenance window). Projected to `{ x, width }` plus the row's
 *      vertical band `{ top, height }`.
 *
 * The horizontal math reuses timeline-core's `projectTimeRanges` (clip-to-range,
 * marker handling) so a zero-width marker (`endDate === startDate`) renders as a
 * line rather than a band, exactly like the core today-marker. Time is epoch ms
 * (UTC) throughout, matching the rest of the package.
 */

import type { RecordId } from '@jects/core';
import {
  projectTimeRanges,
  type TimeAxis,
  type TimeRange,
  type TimeMs,
} from '@jects/timeline-core';

/* ═══════════════════════════════════════════════════════════════════════════
   1. CONFIG MODELS
   ═══════════════════════════════════════════════════════════════════════════ */

/** A global named time range shaded/lined across the whole timeline. */
export interface TimeRangeConfig {
  /** Stable id. */
  id: RecordId;
  /** Inclusive start (epoch ms, UTC). For a zero-width marker set `endDate === startDate`. */
  startDate: TimeMs;
  /** Exclusive end (epoch ms, UTC). */
  endDate: TimeMs;
  /** Optional label the renderer may show inside the band / next to the marker. */
  name?: string;
  /** Extra CSS class(es) added to the rendered element. */
  cls?: string;
  /** Inline CSS applied to the rendered element (e.g. a custom background). */
  style?: string;
}

/** A named time range scoped to a single resource row. */
export interface ResourceTimeRangeConfig {
  /** Stable id. */
  id: RecordId;
  /** The resource row this range is confined to. */
  resourceId: RecordId;
  /** Inclusive start (epoch ms, UTC). */
  startDate: TimeMs;
  /** Exclusive end (epoch ms, UTC). */
  endDate: TimeMs;
  /** Optional label the renderer may show inside the band. */
  name?: string;
  /** Extra CSS class(es) added to the rendered element. */
  cls?: string;
  /** Inline CSS applied to the rendered element. */
  style?: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. PROJECTED PIXEL BOXES (what the renderer paints)
   ═══════════════════════════════════════════════════════════════════════════ */

/** The projected pixel box of a {@link TimeRangeConfig}, ready to paint. */
export interface TimeRangeBox {
  /** The source config. */
  range: TimeRangeConfig;
  /** Left px within axis content. */
  x: number;
  /** Width px (0 for a marker). */
  width: number;
  /** True when this is a zero-duration marker line rather than a shaded band. */
  marker: boolean;
}

/** The projected pixel box of a {@link ResourceTimeRangeConfig}, ready to paint. */
export interface ResourceTimeRangeBox {
  /** The source config. */
  range: ResourceTimeRangeConfig;
  /** Left px within axis content. */
  x: number;
  /** Width px (0 for a marker). */
  width: number;
  /** Top px of the resource's row band within axis content. */
  top: number;
  /** Height px of the resource's row band. */
  height: number;
  /** True when this is a zero-duration marker line rather than a shaded band. */
  marker: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. PROJECTION
   ═══════════════════════════════════════════════════════════════════════════ */

/** Adapt a {@link TimeRangeConfig} to the core {@link TimeRange} shape. */
function toCoreRange(cfg: TimeRangeConfig | ResourceTimeRangeConfig): TimeRange {
  return {
    id: String(cfg.id),
    span: { start: cfg.startDate, end: cfg.endDate },
    ...(cfg.name !== undefined ? { label: cfg.name } : {}),
  };
}

/**
 * Project global time ranges to pixel boxes against the axis. Ranges fully
 * outside the axis range are dropped; partial ranges are clipped. Markers
 * (`endDate <= startDate`) keep `width: 0` and `marker: true`. Reuses
 * timeline-core's `projectTimeRanges` for the shared clip/marker semantics so the
 * scheduler bands align pixel-perfectly with the rest of the time grid.
 */
export function projectTimeRangeConfigs(
  ranges: ReadonlyArray<TimeRangeConfig>,
  axis: TimeAxis,
): TimeRangeBox[] {
  if (ranges.length === 0) return [];
  // Index the source configs by their stringified id so we can re-attach the
  // original record (not the adapted core shape) to each projected box.
  const byId = new Map<string, TimeRangeConfig>();
  const core: TimeRange[] = [];
  for (const cfg of ranges) {
    const id = String(cfg.id);
    byId.set(id, cfg);
    core.push(toCoreRange(cfg));
  }
  const out: TimeRangeBox[] = [];
  for (const box of projectTimeRanges(core, axis)) {
    const cfg = byId.get(box.range.id);
    if (!cfg) continue;
    out.push({ range: cfg, x: box.x, width: box.width, marker: box.marker });
  }
  return out;
}

/**
 * Project resource-scoped time ranges to pixel boxes. The horizontal box is
 * derived exactly as for global ranges (clip + marker), then the vertical band is
 * supplied by `rowBand(resourceId)` — a `{ top, height }` for the resource's row,
 * or `undefined` when the resource is not currently laid out (off-screen /
 * unknown), in which case the range is dropped.
 */
export function projectResourceTimeRangeConfigs(
  ranges: ReadonlyArray<ResourceTimeRangeConfig>,
  axis: TimeAxis,
  rowBand: (resourceId: RecordId) => { top: number; height: number } | undefined,
): ResourceTimeRangeBox[] {
  if (ranges.length === 0) return [];
  const out: ResourceTimeRangeBox[] = [];
  for (const cfg of ranges) {
    const band = rowBand(cfg.resourceId);
    if (!band) continue;
    // Reuse the core projection for one range at a time to keep clip/marker
    // semantics identical to the global path.
    const [box] = projectTimeRanges([toCoreRange(cfg)], axis);
    if (!box) continue;
    out.push({
      range: cfg,
      x: box.x,
      width: box.width,
      top: band.top,
      height: band.height,
      marker: box.marker,
    });
  }
  return out;
}
