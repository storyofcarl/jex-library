/**
 * @jects/calendar — time-grid overlap layout.
 *
 * Given the timed occurrences of a single day, assign each a column index and a
 * column count so overlapping events share the horizontal space side-by-side
 * (the classic day/week calendar packing). Pure + framework-free.
 */

import type { EventOccurrence } from './contract.js';
import { minutesIntoDay, isSameDay } from './date-utils.js';

/** A laid-out occurrence positioned within a day's time grid. */
export interface LaidOutOccurrence {
  occurrence: EventOccurrence;
  /** Top offset as a fraction (0..1) of the visible day. */
  top: number;
  /** Height as a fraction (0..1) of the visible day. */
  height: number;
  /** 0-based column within its overlap cluster. */
  column: number;
  /** Number of columns in this occurrence's cluster. */
  columns: number;
}

/**
 * Clamp an occurrence's start/end minutes to the visible window of a given day.
 * Returns null when the occurrence does not intersect the day at all.
 */
function dayBounds(
  occ: EventOccurrence,
  day: Date,
  startMin: number,
  endMin: number,
): { startMin: number; endMin: number } | null {
  // Project onto this calendar day.
  let s = isSameDay(occ.start, day) ? minutesIntoDay(occ.start) : 0;
  let e = isSameDay(occ.end, day) ? minutesIntoDay(occ.end) : 24 * 60;
  // Multi-day events that pass through the whole day:
  if (occ.start.getTime() < startOfDayMs(day)) s = 0;
  if (occ.end.getTime() > endOfDayMs(day)) e = 24 * 60;
  s = Math.max(s, startMin);
  e = Math.min(e, endMin);
  if (e <= s) {
    // Zero-length or out of window — give it a minimal slice if it starts in window.
    if (s >= startMin && s < endMin) e = Math.min(s + 15, endMin);
    else return null;
  }
  return { startMin: s, endMin: e };
}

function startOfDayMs(day: Date): number {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function endOfDayMs(day: Date): number {
  const d = new Date(day);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * Lay out timed occurrences for one day. `startMin`/`endMin` are the visible
 * window in minutes-since-midnight (e.g. 0..1440 or 8*60..20*60).
 */
export function layoutDay(
  occurrences: EventOccurrence[],
  day: Date,
  startMin: number,
  endMin: number,
): LaidOutOccurrence[] {
  const windowSpan = Math.max(1, endMin - startMin);

  interface Item {
    occ: EventOccurrence;
    s: number;
    e: number;
    column: number;
    columns: number;
  }

  const items: Item[] = [];
  for (const occ of occurrences) {
    if (occ.event.allDay) continue;
    const b = dayBounds(occ, day, startMin, endMin);
    if (!b) continue;
    items.push({ occ, s: b.startMin, e: b.endMin, column: 0, columns: 1 });
  }

  // Sort by start, then longer first for stable packing.
  items.sort((a, b) => a.s - b.s || b.e - a.e);

  // Greedy cluster + column assignment.
  let cluster: Item[] = [];
  let clusterEnd = -Infinity;

  const flush = (): void => {
    if (cluster.length === 0) return;
    // Assign columns within the cluster.
    const columnsEnd: number[] = []; // last end per column
    for (const it of cluster) {
      let placed = -1;
      for (let c = 0; c < columnsEnd.length; c++) {
        if (it.s >= (columnsEnd[c] ?? -Infinity)) {
          placed = c;
          break;
        }
      }
      if (placed === -1) {
        placed = columnsEnd.length;
        columnsEnd.push(it.e);
      } else {
        columnsEnd[placed] = it.e;
      }
      it.column = placed;
    }
    const total = columnsEnd.length;
    for (const it of cluster) it.columns = total;
    cluster = [];
  };

  for (const it of items) {
    if (cluster.length > 0 && it.s >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  flush();

  return items.map((it) => ({
    occurrence: it.occ,
    top: (it.s - startMin) / windowSpan,
    height: Math.max((it.e - it.s) / windowSpan, 1 / windowSpan),
    column: it.column,
    columns: it.columns,
  }));
}
