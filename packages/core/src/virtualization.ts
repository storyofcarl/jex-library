/**
 * Virtualization math — pure, DOM-free. Used by List, Grid, Scheduler, etc.
 *
 * `computeWindow` handles the fixed-size case in O(1). `OffsetIndex` (a Fenwick /
 * binary-indexed tree over prefix sums) handles variable row heights with
 * O(log n) updates and lookups.
 */

export interface WindowInput {
  /** Current scroll offset in px. */
  scrollTop: number;
  /** Visible viewport size in px. */
  viewportHeight: number;
  /** Fixed item size in px. */
  itemSize: number;
  /** Total number of items. */
  count: number;
  /** Extra items to render beyond the viewport on each side. Default 3. */
  overscan?: number;
}

export interface WindowResult {
  /** First item index to render (inclusive). */
  startIndex: number;
  /** Last item index to render (inclusive). */
  endIndex: number;
  /** Pixel offset (translateY) of the first rendered item. */
  offset: number;
  /** Total scrollable height in px. */
  totalSize: number;
}

/** Compute the visible window for fixed-size items, including overscan. */
export function computeWindow(input: WindowInput): WindowResult {
  const { scrollTop, viewportHeight, itemSize, count } = input;
  const overscan = input.overscan ?? 3;
  if (count <= 0 || itemSize <= 0) {
    return { startIndex: 0, endIndex: -1, offset: 0, totalSize: 0 };
  }
  const totalSize = itemSize * count;
  const clampedTop = Math.max(0, Math.min(scrollTop, Math.max(0, totalSize - viewportHeight)));
  const firstVisible = Math.floor(clampedTop / itemSize);
  const visibleCount = Math.ceil(viewportHeight / itemSize);

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(count - 1, firstVisible + visibleCount + overscan);
  const offset = startIndex * itemSize;
  return { startIndex, endIndex, offset, totalSize };
}

/**
 * Variable-size offset index backed by a Fenwick tree (binary indexed tree).
 *
 * - `setSize(i, h)` — set item i's size; O(log n).
 * - `offsetOf(i)` — sum of sizes before i (prefix sum); O(log n).
 * - `indexAt(px)` — index whose row spans pixel `px`; O(log n).
 * - `total()` — sum of all sizes; O(1).
 */
export class OffsetIndex {
  private readonly tree: number[];
  private readonly sizes: number[];
  private _total = 0;
  private readonly _count: number;

  constructor(count: number, defaultSize = 0) {
    this._count = count;
    this.tree = new Array<number>(count + 1).fill(0);
    this.sizes = new Array<number>(count).fill(0);
    if (defaultSize > 0) {
      for (let i = 0; i < count; i++) this.setSize(i, defaultSize);
    }
  }

  get count(): number {
    return this._count;
  }

  /** Set the size of item `i`, updating prefix sums. */
  setSize(i: number, size: number): void {
    if (i < 0 || i >= this._count) throw new RangeError(`OffsetIndex: index ${i} out of range`);
    const delta = size - (this.sizes[i] ?? 0);
    if (delta === 0) return;
    this.sizes[i] = size;
    this._total += delta;
    for (let n = i + 1; n <= this._count; n += n & -n) {
      this.tree[n]! += delta;
    }
  }

  /** Size of item `i`. */
  sizeOf(i: number): number {
    return this.sizes[i] ?? 0;
  }

  /** Sum of sizes of items [0, i) — i.e. the top offset of item `i`. */
  offsetOf(i: number): number {
    if (i <= 0) return 0;
    let sum = 0;
    for (let n = Math.min(i, this._count); n > 0; n -= n & -n) {
      sum += this.tree[n]!;
    }
    return sum;
  }

  /** Total of all sizes. */
  total(): number {
    return this._total;
  }

  /**
   * Index of the item whose span contains pixel `px` (0-based). Clamped to
   * `[0, count-1]`. For `px` past the end, returns `count - 1`.
   */
  indexAt(px: number): number {
    if (px <= 0 || this._count === 0) return 0;
    if (px >= this._total) return this._count - 1;
    // Binary lifting over the Fenwick tree to find the largest prefix <= px.
    let pos = 0;
    let remaining = px;
    let logn = 1;
    while (logn * 2 <= this._count) logn *= 2;
    for (let k = logn; k > 0; k >>= 1) {
      const next = pos + k;
      if (next <= this._count && this.tree[next]! <= remaining) {
        pos = next;
        remaining -= this.tree[next]!;
      }
    }
    // `pos` is the count of full rows before `px`; that is the target index.
    return Math.min(pos, this._count - 1);
  }
}
