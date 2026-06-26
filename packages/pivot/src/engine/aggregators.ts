/**
 * Aggregation functions for the pivot engine.
 *
 * Each aggregator reduces a list of raw cell values (already extracted from the
 * source rows for one value field) into a single scalar. The built-in set
 * covers the spreadsheet-standard math reducers; consumers can register custom
 * reducers with {@link AggregatorRegistry.add} (`addMathMethod`).
 *
 * Aggregators are pure and framework-free — they live in the engine layer and
 * never touch the DOM, so they are fully unit-testable in jsdom/node.
 */

/** Built-in aggregation kinds. */
export type AggregatorName =
  | 'sum'
  | 'count'
  | 'counta'
  | 'countunique'
  | 'min'
  | 'max'
  | 'average'
  | 'median'
  | 'product'
  | 'stddev'
  | 'variance';

/**
 * A reducer over the raw values collected for one value field within one
 * pivot cell. Receives every value (including `null`/`undefined`); it is the
 * reducer's job to decide which to count. Returns the aggregate scalar, or
 * `null` when there is nothing to aggregate.
 */
export type Aggregator = (values: readonly unknown[]) => number | null;

/** Coerce a value to a finite number, or `null` when it is not numeric. */
export function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Collect only the numeric values from `values`. */
function numbers(values: readonly unknown[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    const n = toNumber(v);
    if (n != null) out.push(n);
  }
  return out;
}

function sum(values: readonly unknown[]): number | null {
  const nums = numbers(values);
  return nums.reduce((a, b) => a + b, 0);
}

function average(values: readonly unknown[]): number | null {
  const nums = numbers(values);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function median(values: readonly unknown[]): number | null {
  const nums = numbers(values).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1]! + nums[mid]!) / 2 : nums[mid]!;
}

function product(values: readonly unknown[]): number | null {
  const nums = numbers(values);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a * b, 1);
}

/** Population variance (divides by N), matching spreadsheet `VARP`/`VAR.P`. */
function variance(values: readonly unknown[]): number | null {
  const nums = numbers(values);
  if (nums.length === 0) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const sq = nums.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  return sq / nums.length;
}

function stddev(values: readonly unknown[]): number | null {
  const v = variance(values);
  return v == null ? null : Math.sqrt(v);
}

/** Built-in reducers. `count` counts numeric values; `counta` counts non-empty. */
const BUILT_INS: Record<AggregatorName, Aggregator> = {
  sum,
  count: (values) => numbers(values).length,
  counta: (values) => values.filter((v) => v != null && v !== '').length,
  countunique: (values) => {
    const set = new Set<unknown>();
    for (const v of values) if (v != null && v !== '') set.add(v);
    return set.size;
  },
  min: (values) => {
    const nums = numbers(values);
    return nums.length ? Math.min(...nums) : null;
  },
  max: (values) => {
    const nums = numbers(values);
    return nums.length ? Math.max(...nums) : null;
  },
  average,
  median,
  product,
  stddev,
  variance,
};

/**
 * A registry of named aggregators. Seeded with the built-ins; consumers add
 * custom math methods with {@link add} (the public `addMathMethod`). The pivot
 * engine resolves value-field aggregators through one of these.
 */
export class AggregatorRegistry {
  private readonly map = new Map<string, Aggregator>();

  constructor() {
    for (const [name, fn] of Object.entries(BUILT_INS)) {
      this.map.set(name, fn);
    }
  }

  /** Register (or override) a named aggregator. */
  add(name: string, fn: Aggregator): this {
    this.map.set(name, fn);
    return this;
  }

  /** Whether a name is registered. */
  has(name: string): boolean {
    return this.map.has(name);
  }

  /** Resolve a named aggregator, or `undefined`. */
  get(name: string): Aggregator | undefined {
    return this.map.get(name);
  }

  /** All registered names. */
  names(): string[] {
    return [...this.map.keys()];
  }
}

/** Default human labels for the built-in aggregators (for headers). */
export const AGGREGATOR_LABELS: Record<AggregatorName, string> = {
  sum: 'Sum',
  count: 'Count',
  counta: 'Count (non-empty)',
  countunique: 'Count (unique)',
  min: 'Min',
  max: 'Max',
  average: 'Average',
  median: 'Median',
  product: 'Product',
  stddev: 'Std Dev',
  variance: 'Variance',
};
