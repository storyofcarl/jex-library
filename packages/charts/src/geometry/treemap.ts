/**
 * Treemap geometry — squarified treemap layout (Bruls/Huizing/van Wijk).
 * Produces axis-aligned rectangles whose areas are proportional to values and
 * whose aspect ratios are kept close to 1.
 */

export interface TreemapInput {
  index: number;
  value: number;
}

export interface TreemapRect {
  index: number;
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FreeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Squarified treemap. Inputs with non-positive values are dropped.
 */
export function squarify(
  inputs: readonly TreemapInput[],
  x: number,
  y: number,
  width: number,
  height: number,
): TreemapRect[] {
  const items = inputs
    .filter((d) => Number.isFinite(d.value) && d.value > 0)
    .sort((a, b) => b.value - a.value);
  if (items.length === 0 || width <= 0 || height <= 0) return [];

  const total = items.reduce((s, d) => s + d.value, 0);
  const area = width * height;
  // Normalize values to area units.
  const scaled = items.map((d) => ({ ...d, area: (d.value / total) * area }));

  const out: TreemapRect[] = [];
  let free: FreeRect = { x, y, width, height };
  let row: typeof scaled = [];

  const worst = (r: typeof scaled, side: number): number => {
    if (r.length === 0) return Infinity;
    const sum = r.reduce((s, d) => s + d.area, 0);
    let min = Infinity;
    let max = -Infinity;
    for (const d of r) {
      if (d.area < min) min = d.area;
      if (d.area > max) max = d.area;
    }
    const s2 = sum * sum;
    const side2 = side * side;
    return Math.max((side2 * max) / s2, s2 / (side2 * min));
  };

  let i = 0;
  while (i < scaled.length) {
    const side = Math.min(free.width, free.height);
    const next = scaled[i]!;
    const withNext = [...row, next];
    if (row.length === 0 || worst(withNext, side) <= worst(row, side)) {
      row = withNext;
      i++;
    } else {
      free = layoutRow(row, free, out);
      row = [];
    }
  }
  if (row.length > 0) layoutRow(row, free, out);
  return out;
}

/** Lay a finished row along the shorter side, return the remaining free rect. */
function layoutRow(
  row: Array<TreemapInput & { area: number }>,
  free: FreeRect,
  out: TreemapRect[],
): FreeRect {
  const sum = row.reduce((s, d) => s + d.area, 0);
  const horizontal = free.width >= free.height;

  if (horizontal) {
    // Row stacked vertically in a column of width `colWidth`.
    const colWidth = sum / free.height;
    let cy = free.y;
    for (const d of row) {
      const h = d.area / colWidth;
      out.push({ index: d.index, value: d.value, x: free.x, y: cy, width: colWidth, height: h });
      cy += h;
    }
    return { x: free.x + colWidth, y: free.y, width: free.width - colWidth, height: free.height };
  } else {
    // Row laid horizontally in a band of height `rowHeight`.
    const rowHeight = sum / free.width;
    let cx = free.x;
    for (const d of row) {
      const w = d.area / rowHeight;
      out.push({ index: d.index, value: d.value, x: cx, y: free.y, width: w, height: rowHeight });
      cx += w;
    }
    return { x: free.x, y: free.y + rowHeight, width: free.width, height: free.height - rowHeight };
  }
}
