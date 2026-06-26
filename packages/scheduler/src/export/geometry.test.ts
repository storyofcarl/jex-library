/**
 * Export geometry serialization — jsdom unit tests (pure math, no canvas).
 *
 * Asserts that `serializeGeometry` captures the WHOLE painted schedule (header
 * bands, locked columns, every row, every bar incl. recurrence occurrences,
 * gridlines, shades, dependencies, now marker) into the typed export model, and
 * that `paginate` tiles the content into a correct page grid.
 */
import { describe, it, expect } from 'vitest';
import type { TimeAxis, TimeSpan, EventBar, TimelineEvent } from '@jects/timeline-core';
import {
  serializeGeometry,
  paginate,
  type ExportGeometrySource,
} from './geometry.js';
import { layoutLane } from '../model/event-layout.js';
import type { ResourceModel, EventModel, DependencyModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2025, 0, 1);

/** A simple 1px-per-ms linear axis with a 2-band header that ticks per "day". */
function fakeAxis(range: TimeSpan): TimeAxis {
  const ticks = [];
  for (let t = range.start; t < range.end; t += DAY) {
    ticks.push({
      index: (t - range.start) / DAY,
      span: { start: t, end: t + DAY },
      x: (t - range.start) / 1, // 1px per ms keeps numbers exact-ish
      width: DAY,
      major: ((t - range.start) / DAY) % 7 === 0,
    });
  }
  return {
    range,
    preset: {
      id: 'test',
      headers: [
        { unit: 'week', format: '[W]w' },
        { unit: 'day', format: 'D' },
      ],
      tickUnit: 'day',
      pxPerUnit: DAY,
    },
    zoom: 1,
    contentWidth: range.end - range.start,
    toX: (t) => t - range.start,
    toTime: (x) => range.start + x,
    spanToBox: (s: TimeSpan) => ({ x: s.start - range.start, width: s.end - s.start }),
    durationToWidth: (d) => d,
    ticksInRange: (xs, xe) => ticks.filter((t) => t.x + t.width >= xs && t.x <= xe),
    snap: (t) => t,
    setView: () => {},
    setRange: () => {},
  } as unknown as TimeAxis;
}

function tev(
  id: string,
  rowId: string,
  start: number,
  end: number,
  extra: Partial<EventModel> = {},
): TimelineEvent<EventModel> {
  return {
    id,
    rowId,
    span: { start, end },
    record: { id, resourceId: rowId, name: id, startDate: start, endDate: end, ...extra },
  };
}

function buildSource(opts: {
  resources: ResourceModel[];
  eventsByRow: Record<string, TimelineEvent<EventModel>[]>;
  dependencies?: DependencyModel[];
  rowHeight?: number;
  range?: TimeSpan;
}): ExportGeometrySource {
  const range = opts.range ?? { start: T0, end: T0 + DAY * 14 };
  const axis = fakeAxis(range);
  const rowHeight = opts.rowHeight ?? 40;
  const events: EventModel[] = [];
  for (const list of Object.values(opts.eventsByRow)) for (const e of list) events.push(e.record);
  return {
    axis,
    resources: opts.resources,
    events,
    dependencies: opts.dependencies ?? [],
    columns: [
      { field: 'name', text: 'Resource', width: 160 },
      { field: 'id', text: 'Id', width: 80 },
    ],
    rowHeight,
    shades: [{ x: 100, width: 50 }],
    showNowMarker: false,
    barsFor: (resourceId) => {
      const list = opts.eventsByRow[String(resourceId)] ?? [];
      const { bars } = layoutLane<EventModel>({
        rowId: resourceId,
        events: list,
        axis,
        rowHeight,
        strategy: 'stack',
      });
      return bars as EventBar<EventModel>[];
    },
  };
}

describe('serializeGeometry', () => {
  it('serializes header bands, columns, rows and bars across the whole schedule', () => {
    const resources: ResourceModel[] = [
      { id: 'r1', name: 'Alice' },
      { id: 'r2', name: 'Bob' },
    ];
    const eventsByRow = {
      r1: [tev('a', 'r1', T0, T0 + DAY * 2)],
      r2: [tev('b', 'r2', T0 + DAY, T0 + DAY * 3, { percentDone: 0.5, eventColor: 'cyan' })],
    };
    const model = serializeGeometry(buildSource({ resources, eventsByRow }));

    // Two header bands (week + day) → finest band has one cell per visible tick.
    expect(model.headerCells.some((c) => c.band === 0)).toBe(true);
    expect(model.headerCells.some((c) => c.band === 1)).toBe(true);
    expect(model.headerHeight).toBeGreaterThan(0);

    // Locked columns serialized with cumulative x offsets.
    expect(model.resourceColumns).toHaveLength(2);
    expect(model.resourceColumns[0]!.x).toBe(0);
    expect(model.resourceColumns[1]!.x).toBe(160);
    expect(model.resourceWidth).toBe(240);

    // Every resource row present, stacked top to bottom.
    expect(model.rows).toHaveLength(2);
    expect(model.rows[0]!.y).toBe(0);
    expect(model.rows[1]!.y).toBe(40);
    expect(model.rows[0]!.cells).toEqual(['Alice', 'r1']);
    expect(model.contentHeight).toBe(80);

    // Bars carry absolute content-space positions + progress + colour.
    const barB = model.bars.find((b) => b.id === 'b')!;
    expect(barB.y).toBeGreaterThanOrEqual(40); // on the second row
    expect(barB.progress).toBe(0.5);
    expect(barB.colorKey).toBe('cyan');
    expect(barB.x).toBe(DAY); // starts one day in
  });

  it('captures recurrence occurrences via barsFor (every repeat exported)', () => {
    // The source's barsFor returns however many bars the lane lays out; here we
    // simulate an expanded recurring master with 3 occurrence bars.
    const resources: ResourceModel[] = [{ id: 'r1', name: 'Daily standup' }];
    const occ = [
      tev('m', 'r1', T0, T0 + 3_600_000),
      tev('m::1', 'r1', T0 + DAY, T0 + DAY + 3_600_000),
      tev('m::2', 'r1', T0 + DAY * 2, T0 + DAY * 2 + 3_600_000),
    ];
    const model = serializeGeometry(buildSource({ resources, eventsByRow: { r1: occ } }));
    expect(model.bars).toHaveLength(3);
    expect(model.bars.map((b) => b.id)).toEqual(['m', 'm::1', 'm::2']);
  });

  it('routes dependencies across the full (non-virtualized) bar set', () => {
    const resources: ResourceModel[] = [
      { id: 'r1', name: 'Alice' },
      { id: 'r2', name: 'Bob' },
    ];
    const eventsByRow = {
      r1: [tev('a', 'r1', T0, T0 + DAY)],
      r2: [tev('b', 'r2', T0 + DAY * 2, T0 + DAY * 3)],
    };
    const deps: DependencyModel[] = [{ id: 'd1', fromId: 'a', toId: 'b', type: 'FS' }];
    const model = serializeGeometry(buildSource({ resources, eventsByRow, dependencies: deps }));
    expect(model.dependencies).toHaveLength(1);
    expect(model.dependencies[0]!.id).toBe('d1');
    expect(model.dependencies[0]!.path).toMatch(/^M/); // a real SVG path
    expect(model.dependencies[0]!.arrow.length).toBeGreaterThan(0);
  });

  it('carries non-working shades + omits the now marker when disabled', () => {
    const model = serializeGeometry(
      buildSource({ resources: [{ id: 'r1', name: 'A' }], eventsByRow: { r1: [] } }),
    );
    expect(model.shades).toEqual([{ x: 100, width: 50 }]);
    expect(model.nowX).toBeUndefined();
  });
});

describe('paginate', () => {
  it('tiles content into a row-major page grid sized to the page box', () => {
    const model = serializeGeometry(
      buildSource({
        resources: [{ id: 'r1', name: 'A' }],
        eventsByRow: { r1: [] },
        range: { start: 0, end: 1000 },
      }),
    );
    // Force a known content size for deterministic pagination.
    model.contentWidth = 1000;
    model.contentHeight = 400;
    const pages = paginate({ model, pageContentWidth: 400, pageContentHeight: 150 });
    // ceil(1000/400)=3 cols, ceil(400/150)=3 rows → 9 pages.
    expect(pages).toHaveLength(9);
    // First page covers the top-left.
    expect(pages[0]).toMatchObject({ col: 0, row: 0, contentX: 0, contentY: 0, width: 400, height: 150 });
    // Last column on the first row is the remainder (1000 - 800 = 200).
    const topRight = pages.find((p) => p.col === 2 && p.row === 0)!;
    expect(topRight.width).toBe(200);
    // Bottom row remainder height (400 - 300 = 100).
    const bottom = pages.find((p) => p.col === 0 && p.row === 2)!;
    expect(bottom.height).toBe(100);
  });

  it('always produces at least one page', () => {
    const model = serializeGeometry(
      buildSource({ resources: [{ id: 'r1', name: 'A' }], eventsByRow: { r1: [] } }),
    );
    model.contentWidth = 0;
    model.contentHeight = 0;
    expect(paginate({ model, pageContentWidth: 100, pageContentHeight: 100 })).toHaveLength(1);
  });
});
