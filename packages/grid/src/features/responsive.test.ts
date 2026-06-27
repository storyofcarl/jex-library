/**
 * jsdom unit tests for ResponsiveFeature (gap 5: viewport-width column auto-hide).
 *
 * jsdom never fires ResizeObserver and reports 0 for layout, so the tests drive
 * the feature's public `evaluate(width)` to simulate the grid crossing width
 * thresholds, asserting columns hide/show through `GridApi.updateColumn`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { Model } from '@jects/core';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';
import type { ColumnDef } from '../contract.js';
import { type ResponsiveFeature, responsiveFeature } from './responsive.js';

interface Row extends Model {
  id: number;
  name: string;
  age: number;
  city: string;
}

const DATA: Row[] = [
  { id: 1, name: 'Ada', age: 36, city: 'London' },
  { id: 2, name: 'Linus', age: 54, city: 'Helsinki' },
];

let h: FeatureHarness<Row>;
afterEach(() => h?.destroy());

function hiddenIds(api: typeof h.api): string[] {
  return api.columns.filter((c) => c.hidden).map((c) => c.id ?? c.field ?? '');
}

describe('ResponsiveFeature — priority mode', () => {
  const cols = (): ColumnDef<Row>[] => [
    { field: 'name', width: 200 }, // no priority → never auto-hidden
    { field: 'age', width: 100, responsivePriority: 1 }, // dropped first
    { field: 'city', width: 100, responsivePriority: 2 },
  ];

  it('hides the lowest-priority column first when content overflows', () => {
    h = makeHarness<Row>({ store: makeStore(DATA), columns: cols() });
    const f = h.api.use(responsiveFeature<Row>()) as ResponsiveFeature<Row>;
    // Total natural width 400. At 350 we must drop ~50px → drop age (priority 1).
    f.evaluate(350);
    expect(hiddenIds(h.api)).toEqual(['age']);
    expect(f.getHidden()).toEqual(['age']);
  });

  it('drops multiple columns by ascending priority as width shrinks', () => {
    h = makeHarness<Row>({ store: makeStore(DATA), columns: cols() });
    const f = h.api.use(responsiveFeature<Row>()) as ResponsiveFeature<Row>;
    f.evaluate(220); // need to shed 180 → drop age then city
    expect(hiddenIds(h.api).sort()).toEqual(['age', 'city']);
    // name has no priority and is never dropped.
    expect(hiddenIds(h.api)).not.toContain('name');
  });

  it('re-shows columns when the grid widens again', () => {
    h = makeHarness<Row>({ store: makeStore(DATA), columns: cols() });
    const f = h.api.use(responsiveFeature<Row>()) as ResponsiveFeature<Row>;
    f.evaluate(220);
    expect(hiddenIds(h.api).length).toBe(2);
    f.evaluate(800); // everything fits again
    expect(hiddenIds(h.api)).toEqual([]);
    expect(f.getHidden()).toEqual([]);
  });

  it('honors a hard per-column minGridWidth regardless of priority', () => {
    const c: ColumnDef<Row>[] = [
      { field: 'name', width: 100 },
      { field: 'age', width: 100, minGridWidth: 500 },
    ];
    h = makeHarness<Row>({ store: makeStore(DATA), columns: c });
    const f = h.api.use(responsiveFeature<Row>()) as ResponsiveFeature<Row>;
    f.evaluate(450); // below age's minGridWidth even though total fits
    expect(hiddenIds(h.api)).toEqual(['age']);
    f.evaluate(600);
    expect(hiddenIds(h.api)).toEqual([]);
    void f;
  });
});

describe('ResponsiveFeature — explicit breakpoints', () => {
  const cols = (): ColumnDef<Row>[] => [
    { field: 'name', width: 200 },
    { field: 'age', width: 100 },
    { field: 'city', width: 100 },
  ];

  it('hides exactly the listed ids at/below each breakpoint (cumulative)', () => {
    h = makeHarness<Row>({ store: makeStore(DATA), columns: cols() });
    const f = h.api.use(
      responsiveFeature<Row>({
        breakpoints: [
          { maxWidth: 600, hide: ['city'] },
          { maxWidth: 400, hide: ['age'] },
        ],
      }),
    ) as ResponsiveFeature<Row>;

    f.evaluate(700); // above all breakpoints
    expect(hiddenIds(h.api)).toEqual([]);

    f.evaluate(500); // ≤600 → hide city
    expect(hiddenIds(h.api)).toEqual(['city']);

    f.evaluate(300); // ≤600 and ≤400 → hide city + age
    expect(hiddenIds(h.api).sort()).toEqual(['age', 'city']);

    f.evaluate(700); // back above all → show everything
    expect(hiddenIds(h.api)).toEqual([]);
  });
});

describe('ResponsiveFeature — teardown', () => {
  it('restores auto-hidden columns on destroy', () => {
    const cols: ColumnDef<Row>[] = [
      { field: 'name', width: 200 },
      { field: 'age', width: 100, responsivePriority: 1 },
    ];
    h = makeHarness<Row>({ store: makeStore(DATA), columns: cols });
    h.api.use(responsiveFeature<Row>());
    const f = h.api.features.get('responsive') as ResponsiveFeature<Row>;
    f.evaluate(220);
    expect(hiddenIds(h.api)).toEqual(['age']);
    h.api.removeFeature('responsive');
    expect(hiddenIds(h.api)).toEqual([]);
  });
});
