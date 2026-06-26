/**
 * jsdom unit tests for the Print feature — the pure pagination math
 * (`paginate`/`clipBarToPage`/`resolvePageSize`/`resourceColumnsWidth`) and the
 * `PrintController` (plan / buildDocument / veto / events / lifecycle).
 *
 * These run in the default `pnpm test` (jsdom). The controller is driven against
 * a real framework-free `DefaultTimeAxis` + lightweight stores so the pagination
 * logic is exercised for real without a browser print dialog; the browser/a11y
 * suite mounts an actual Scheduler and asserts the built document.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter, type RecordId } from '@jects/core';
import { DefaultTimeAxis, HOUR_AND_DAY, type TimeAxis } from '@jects/timeline-core';
import type { EventModel, ResourceModel, SchedulerConfig } from '../contract.js';
import {
  PrintController,
  installPrint,
  paginate,
  clipBarToPage,
  resolvePageSize,
  resourceColumnsWidth,
  type PrintHost,
  type PrintStore,
} from './print.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MON = Date.UTC(2025, 0, 6); // a Monday
const MON_9 = MON + HOUR * 9;

function makeAxis(rangeDays = 7): TimeAxis {
  return new DefaultTimeAxis({
    range: { start: MON, end: MON + DAY * rangeDays },
    preset: HOUR_AND_DAY,
    zoom: 1,
  });
}

/** A minimal array-backed store satisfying the PrintStore surface. */
function store<T>(items: T[]): PrintStore<T> {
  return {
    get count() {
      return items.length;
    },
    getAt: (i) => items[i],
    forEach: (fn) => items.forEach(fn),
  };
}

/** A fake structural Print host backed by real stores + a real axis. */
class FakeHost implements PrintHost {
  readonly emitter = new EventEmitter();
  isDestroyed = false;
  readonly el: HTMLElement;
  constructor(
    private readonly axis: TimeAxis,
    private readonly resources: ResourceModel[],
    private readonly events: EventModel[],
    private readonly cfg: Partial<SchedulerConfig> = {},
  ) {
    this.el = document.createElement('div');
    document.body.appendChild(this.el);
  }
  getAxis(): TimeAxis {
    return this.axis;
  }
  getResourceStore(): PrintStore<ResourceModel> {
    return store(this.resources);
  }
  getEventStore(): PrintStore<EventModel> {
    return store(this.events);
  }
  getConfig(): Readonly<SchedulerConfig> {
    return { resources: this.resources, events: this.events, ...this.cfg } as SchedulerConfig;
  }
  on<E extends string>(event: E, fn: (p: never) => unknown): () => void {
    return this.emitter.on(event as never, fn as never);
  }
  emit<E extends string>(event: E, payload: unknown): boolean {
    return this.emitter.emit(event as never, payload as never);
  }
}

function res(id: RecordId, name: string, rowHeight?: number): ResourceModel {
  return rowHeight == null ? { id, name } : { id, name, rowHeight };
}
function evt(id: string, resourceId: RecordId, startHour: number, hours: number): EventModel {
  return {
    id,
    resourceId,
    name: id.toUpperCase(),
    startDate: MON_9 + startHour * HOUR,
    endDate: MON_9 + (startHour + hours) * HOUR,
  };
}

/* ── pure: resolvePageSize ─────────────────────────────────────────────────── */

describe('resolvePageSize', () => {
  it('swaps width/height for landscape (default)', () => {
    const p = resolvePageSize({});
    expect(p.width).toBeGreaterThan(p.height); // landscape is wider than tall
  });
  it('keeps portrait taller than wide', () => {
    const p = resolvePageSize({ orientation: 'portrait' });
    expect(p.height).toBeGreaterThan(p.width);
  });
  it('honours an explicit pageSize override', () => {
    expect(resolvePageSize({ pageSize: { width: 500, height: 300 } })).toEqual({
      width: 500,
      height: 300,
    });
  });
});

/* ── pure: resourceColumnsWidth ────────────────────────────────────────────── */

describe('resourceColumnsWidth', () => {
  it('falls back to a default when no columns given', () => {
    expect(resourceColumnsWidth(undefined)).toBeGreaterThan(0);
    expect(resourceColumnsWidth([])).toBeGreaterThan(0);
  });
  it('sums explicit column widths', () => {
    expect(
      resourceColumnsWidth([
        { field: 'name', width: 100 },
        { field: 'id', width: 60 },
      ]),
    ).toBe(160);
  });
});

/* ── pure: paginate ────────────────────────────────────────────────────────── */

describe('paginate', () => {
  it('produces at least one time page and one row page', () => {
    const plan = paginate({ axis: makeAxis(1), resourceCount: 1 });
    expect(plan.timePages.length).toBeGreaterThanOrEqual(1);
    expect(plan.rowPages.length).toBeGreaterThanOrEqual(1);
    expect(plan.pages.length).toBe(plan.timePages.length * plan.rowPages.length);
  });

  it('slices a wide range into multiple non-overlapping, contiguous time pages', () => {
    const axis = makeAxis(14); // 14 days at hour/day → very wide content
    const plan = paginate({
      axis,
      resourceCount: 1,
      config: { pageSize: { width: 400, height: 400 } },
    });
    expect(plan.timePages.length).toBeGreaterThan(1);
    // Contiguous + non-overlapping: each page starts where the previous ended.
    for (let i = 1; i < plan.timePages.length; i++) {
      const prev = plan.timePages[i - 1]!;
      const cur = plan.timePages[i]!;
      expect(cur.x).toBeCloseTo(prev.x + prev.width, 5);
      expect(cur.span.start).toBeCloseTo(prev.span.end, -2);
    }
  });

  it('breaks resource lanes into multiple row pages without splitting a lane', () => {
    const axis = makeAxis(1);
    const rowHeight = 50;
    const plan = paginate({
      axis,
      resourceCount: 20,
      rowHeights: () => rowHeight,
      // header 64 → body height 200 → 4 lanes (200/50) per page.
      config: { pageSize: { width: 1000, height: 264 } },
    });
    expect(plan.rowPages.length).toBeGreaterThan(1);
    // Pages are contiguous in row index and cover every row exactly once.
    let covered = 0;
    for (let i = 0; i < plan.rowPages.length; i++) {
      const rp = plan.rowPages[i]!;
      expect(rp.startRow).toBe(covered);
      expect(rp.endRow).toBeGreaterThan(rp.startRow); // never empty
      // No page packs taller than the body height (whole lanes only).
      expect(rp.height).toBeLessThanOrEqual(plan.bodyHeight);
      covered = rp.endRow;
    }
    expect(covered).toBe(20);
  });

  it('gives a lane taller than a full page its own page (cannot shrink)', () => {
    const plan = paginate({
      axis: makeAxis(1),
      resourceCount: 3,
      rowHeights: () => 500, // each lane is taller than the 200px body
      config: { pageSize: { width: 1000, height: 264 } },
    });
    expect(plan.rowPages.length).toBe(3);
    for (const rp of plan.rowPages) {
      expect(rp.endRow - rp.startRow).toBe(1);
    }
  });

  it('honours a custom print range (clamped to the axis)', () => {
    const axis = makeAxis(7);
    const plan = paginate({
      axis,
      resourceCount: 1,
      config: { range: { start: MON + DAY, end: MON + DAY * 2 } },
    });
    expect(plan.timePages[0]!.span.start).toBeGreaterThanOrEqual(MON + DAY - HOUR);
    const last = plan.timePages[plan.timePages.length - 1]!;
    expect(last.span.end).toBeLessThanOrEqual(MON + DAY * 2 + HOUR);
  });

  it('drops the reserved column + header when repeats are disabled (wider/taller body)', () => {
    const axis = makeAxis(2);
    const withRepeat = paginate({ axis, resourceCount: 1, config: { pageSize: { width: 500, height: 500 } } });
    const noRepeat = paginate({
      axis,
      resourceCount: 1,
      config: { pageSize: { width: 500, height: 500 }, repeatHeader: false, repeatResourceColumn: false },
    });
    expect(noRepeat.bodyWidth).toBeGreaterThan(withRepeat.bodyWidth);
    expect(noRepeat.bodyHeight).toBeGreaterThan(withRepeat.bodyHeight);
  });
});

/* ── pure: clipBarToPage ───────────────────────────────────────────────────── */

describe('clipBarToPage', () => {
  const axis = makeAxis(7);

  it('returns null for an event entirely outside the page', () => {
    const page = { index: 0, x: 0, width: 50, span: { start: MON, end: MON } };
    const far = { startDate: MON + DAY * 6, endDate: MON + DAY * 6 + HOUR };
    expect(clipBarToPage(axis, far, page)).toBeNull();
  });

  it('clips a bar that straddles the page start and flags clippedStart', () => {
    const x = axis.toX(MON_9);
    const page = { index: 1, x: x + 20, width: 200, span: { start: 0, end: 0 } };
    const box = clipBarToPage(axis, { startDate: MON_9, endDate: MON_9 + HOUR * 6 }, page);
    expect(box).not.toBeNull();
    expect(box!.clippedStart).toBe(true);
    expect(box!.x).toBe(0); // clamped to the page's left edge
  });

  it('clips a bar that overflows the page end and flags clippedEnd', () => {
    const x0 = axis.toX(MON_9);
    const page = { index: 0, x: x0, width: 40, span: { start: 0, end: 0 } };
    const box = clipBarToPage(axis, { startDate: MON_9, endDate: MON_9 + HOUR * 10 }, page);
    expect(box).not.toBeNull();
    expect(box!.clippedEnd).toBe(true);
    expect(box!.width).toBeLessThanOrEqual(40);
  });
});

/* ── PrintController ───────────────────────────────────────────────────────── */

describe('PrintController', () => {
  it('plan() reflects the live scheduler resources + axis', () => {
    const host = new FakeHost(makeAxis(2), [res('r1', 'A'), res('r2', 'B')], [], {});
    const printer = new PrintController(host);
    const plan = printer.plan({ pageSize: { width: 600, height: 400 } });
    expect(plan.pages.length).toBe(plan.timePages.length * plan.rowPages.length);
    printer.destroy();
  });

  it('buildDocument() builds one page section per sheet, each with a header band', () => {
    const host = new FakeHost(
      makeAxis(3),
      [res('r1', 'Alice'), res('r2', 'Bob')],
      [evt('a', 'r1', 0, 3), evt('b', 'r2', 1, 2)],
      {},
    );
    const printer = new PrintController(host);
    const { root, plan } = printer.buildDocument({ pageSize: { width: 500, height: 400 } });
    const pages = root.querySelectorAll('.jects-scheduler-print__page');
    expect(pages.length).toBe(plan.pages.length);
    // Each page has a repeated header band and a body.
    for (const p of Array.from(pages)) {
      expect(p.querySelector('.jects-scheduler-print__header-band')).toBeTruthy();
      expect(p.querySelector('.jects-scheduler-print__body')).toBeTruthy();
    }
    printer.destroy();
  });

  it('renders the repeated resource column on every page when enabled', () => {
    const host = new FakeHost(
      makeAxis(6), // wide → multiple time pages → repeated column on each
      [res('r1', 'Alice')],
      [],
      { columns: [{ field: 'name', text: 'Resource', width: 140 }] },
    );
    const printer = new PrintController(host);
    const { root, plan } = printer.buildDocument({ pageSize: { width: 360, height: 500 } });
    expect(plan.timePages.length).toBeGreaterThan(1);
    const cols = root.querySelectorAll('.jects-scheduler-print__resources');
    expect(cols.length).toBe(plan.pages.length);
    // The resource name appears in the column cells.
    expect(root.textContent).toContain('Alice');
    printer.destroy();
  });

  it('omits the resource column when repeatResourceColumn is false', () => {
    const host = new FakeHost(makeAxis(2), [res('r1', 'Alice')], [], {});
    const printer = new PrintController(host);
    const { root } = printer.buildDocument({
      pageSize: { width: 500, height: 400 },
      repeatResourceColumn: false,
    });
    expect(root.querySelector('.jects-scheduler-print__resources')).toBeNull();
    printer.destroy();
  });

  it('places event bars on their lanes and clips wide bars across pages', () => {
    const host = new FakeHost(
      makeAxis(7),
      [res('r1', 'Alice')],
      // A long event spanning several days → must appear on more than one page.
      [
        {
          id: 'long',
          resourceId: 'r1',
          name: 'Sprint',
          startDate: MON_9,
          endDate: MON_9 + DAY * 4,
        },
      ],
      {},
    );
    const printer = new PrintController(host);
    const { root, plan } = printer.buildDocument({ pageSize: { width: 300, height: 500 } });
    expect(plan.timePages.length).toBeGreaterThan(1);
    const bars = root.querySelectorAll('.jects-scheduler-print__bar');
    expect(bars.length).toBeGreaterThan(1); // one fragment per intersecting page
    // At least one fragment is flagged as continuing onto an adjacent page.
    const clipped = root.querySelectorAll(
      '.jects-scheduler-print__bar--clip-end, .jects-scheduler-print__bar--clip-start',
    );
    expect(clipped.length).toBeGreaterThan(0);
    printer.destroy();
  });

  it('print() emits beforePrint then print, returning the result', () => {
    const host = new FakeHost(makeAxis(2), [res('r1', 'Alice')], [evt('a', 'r1', 0, 2)], {});
    const printer = new PrintController(host);
    const before = vi.fn();
    const after = vi.fn();
    printer.on('beforePrint', before);
    printer.on('print', after);

    const result = printer.print({ pageSize: { width: 500, height: 400 } });

    expect(result).not.toBeNull();
    expect(before).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(after.mock.calls[0]![0].plan).toBe(result!.plan);
    printer.destroy();
  });

  it('a beforePrint veto (controller) cancels the print and returns null', () => {
    const host = new FakeHost(makeAxis(2), [res('r1', 'Alice')], [], {});
    const printer = new PrintController(host);
    printer.on('beforePrint', () => false);
    const after = vi.fn();
    printer.on('print', after);

    expect(printer.print({ pageSize: { width: 500, height: 400 } })).toBeNull();
    expect(after).not.toHaveBeenCalled();
    printer.destroy();
  });

  it('a host-level beforePrint veto also cancels', () => {
    const host = new FakeHost(makeAxis(2), [res('r1', 'Alice')], [], {});
    const printer = new PrintController(host);
    host.on('beforePrint', () => false);
    const after = vi.fn();
    printer.on('print', after);

    expect(printer.print({ pageSize: { width: 500, height: 400 } })).toBeNull();
    expect(after).not.toHaveBeenCalled();
    printer.destroy();
  });

  it('print() injects a hidden iframe and tears it down on destroy', () => {
    const host = new FakeHost(makeAxis(2), [res('r1', 'Alice')], [], {});
    const printer = new PrintController(host);
    printer.print({ pageSize: { width: 500, height: 400 } });
    expect(document.querySelector('.jects-scheduler-print__frame')).toBeTruthy();
    printer.destroy();
    expect(document.querySelector('.jects-scheduler-print__frame')).toBeNull();
  });

  it('installPrint auto-disposes when the host emits destroy', () => {
    const host = new FakeHost(makeAxis(2), [res('r1', 'Alice')], [], {});
    const printer = installPrint(host);
    host.emit('destroy', { widget: host });
    host.isDestroyed = true;
    // Now a print is a no-op (returns null) because the controller is destroyed.
    expect(printer.print()).toBeNull();
  });

  it('destroy() is idempotent and a no-op print after destroy returns null', () => {
    const host = new FakeHost(makeAxis(2), [res('r1', 'Alice')], [], {});
    const printer = new PrintController(host);
    printer.destroy();
    printer.destroy();
    expect(printer.print()).toBeNull();
  });

  it('respects per-resource rowHeight when paginating lanes', () => {
    const host = new FakeHost(
      makeAxis(1),
      [res('r1', 'A', 200), res('r2', 'B', 200), res('r3', 'C', 200)],
      [],
      {},
    );
    const printer = new PrintController(host);
    const plan = printer.plan({ pageSize: { width: 1000, height: 264 } }); // body 200
    // Each 200px lane needs its own page (200 + 200 > 200 body).
    expect(plan.rowPages.length).toBe(3);
    printer.destroy();
  });
});
