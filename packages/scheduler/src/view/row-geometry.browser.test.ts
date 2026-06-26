/**
 * Variable row height — real Chromium (axe + layout) test.
 *
 * Runs under `vitest --config vitest.browser.config.ts`. Because the host
 * Scheduler wiring of `RowGeometry` is an integrator step (concurrency: the main
 * class is owned by another agent), this test exercises the feature directly: it
 * paints resource lanes + stacked event bars positioned BY `RowGeometry` into the
 * real DOM, then asserts (a) dense lanes grow, (b) lanes never visually overlap
 * and stay aligned with their bars, (c) the variable-height markup is accessible
 * (zero serious/critical axe violations). This is the visual/interaction smoke
 * that proves the offset-index geometry produces a correct, token-pure layout.
 */
import { describe, it, afterEach, expect } from 'vitest';
import type { TimeAxis, TimeSpan, TimelineEvent } from '@jects/timeline-core';
import '@jects/theme/style.css';
import '../styles.css';
import { RowGeometry } from './row-geometry.js';
import { layoutLane } from '../model/event-layout.js';
import type { ResourceModel, EventModel } from '../contract.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

function linearAxis(): TimeAxis {
  return {
    range: { start: 0, end: 1000 },
    preset: { id: 'test', headers: [], tickUnit: 'millisecond', pxPerUnit: 1 },
    zoom: 1,
    contentWidth: 1000,
    toX: (t) => t,
    toTime: (x) => x,
    spanToBox: (span: TimeSpan) => ({ x: span.start, width: span.end - span.start }),
    durationToWidth: (d) => d,
    ticksInRange: () => [],
    snap: (t) => t,
    setView: () => {},
    setRange: () => {},
  };
}

function tev(id: string, rowId: string, start: number, end: number): TimelineEvent<EventModel> {
  return {
    id,
    rowId,
    span: { start, end },
    record: { id, resourceId: rowId, name: id, startDate: start, endDate: end },
  };
}

const axis = linearAxis();
let host: HTMLElement;

afterEach(() => host?.remove());

/**
 * Render a minimal variable-height scheduler body: a locked resource column +
 * a bars layer, both positioned from the SAME `RowGeometry`. Returns refs.
 */
function paint(
  resources: ResourceModel[],
  eventsByRow: Record<string, TimelineEvent<EventModel>[]>,
): { root: HTMLElement; geom: RowGeometry; rows: HTMLElement[]; bars: HTMLElement[] } {
  host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '400px';
  document.body.appendChild(host);

  const geom = new RowGeometry({ rowHeight: 40, strategy: 'stack' });
  geom.measure(resources, axis, (r) => eventsByRow[String(r.id)] ?? []);

  // NOTE: we deliberately do NOT put the `.jects-scheduler` grid class on the
  // root here — that class is `display:grid` with a fixed header row, which would
  // place children in grid tracks and defeat the absolute, geometry-driven
  // positioning we are testing. We use a plain positioned container and apply the
  // token-bearing part classes (for styling + a11y) to the rows/bars only.
  const root = document.createElement('div');
  root.classList.add('jects-scheduler--horizontal');
  root.setAttribute('role', 'application');
  root.setAttribute('aria-label', 'Resource scheduler');
  root.style.position = 'relative';
  root.style.height = `${geom.total()}px`;

  // Locked resource column.
  const panel = document.createElement('div');
  panel.setAttribute('role', 'list');
  panel.setAttribute('aria-label', 'Resources');
  panel.style.position = 'absolute';
  panel.style.left = '0';
  panel.style.top = '0';
  panel.style.width = '160px';
  panel.style.height = `${geom.total()}px`;

  // Bars layer.
  const barsLayer = document.createElement('div');
  barsLayer.setAttribute('role', 'group');
  barsLayer.setAttribute('aria-label', 'Scheduled events');
  barsLayer.style.position = 'absolute';
  barsLayer.style.left = '160px';
  barsLayer.style.top = '0';
  barsLayer.style.height = `${geom.total()}px`;

  const rows: HTMLElement[] = [];
  const bars: HTMLElement[] = [];

  for (let i = 0; i < resources.length; i++) {
    const r = resources[i]!;
    const top = geom.rowTop(i);
    const h = geom.heightOf(i);

    const row = document.createElement('div');
    row.className = 'jects-scheduler__resource-row';
    row.setAttribute('role', 'listitem');
    row.setAttribute('aria-label', r.name);
    row.style.position = 'absolute';
    row.style.top = `${top}px`;
    row.style.height = `${h}px`;
    row.dataset.resourceId = String(r.id);
    const cell = document.createElement('div');
    cell.className = 'jects-scheduler__resource-cell';
    cell.textContent = r.name;
    row.appendChild(cell);
    panel.appendChild(row);
    rows.push(row);

    // Lay out + paint this lane's bars at the lane's intrinsic height.
    const { bars: laidOut } = layoutLane<EventModel>({
      rowId: r.id,
      events: eventsByRow[String(r.id)] ?? [],
      axis,
      rowHeight: h,
      strategy: 'stack',
    });
    for (const bar of laidOut) {
      const el = document.createElement('div');
      el.className = 'jects-scheduler__bar';
      el.setAttribute('role', 'button');
      el.tabIndex = -1;
      el.setAttribute('aria-label', bar.event.record.name ?? 'Event');
      el.dataset.eventId = String(bar.event.id);
      el.style.position = 'absolute';
      el.style.left = `${bar.x}px`;
      el.style.top = `${top + bar.y}px`;
      el.style.width = `${Math.max(2, bar.width)}px`;
      el.style.height = `${bar.height}px`;
      barsLayer.appendChild(el);
      bars.push(el);
    }
  }

  root.append(panel, barsLayer);
  host.appendChild(root);
  return { root, geom, rows, bars };
}

describe('Scheduler variable row height (browser)', () => {
  it('grows a dense lane and stacks its bars within the taller row', () => {
    const resources: ResourceModel[] = [
      { id: 'r1', name: 'Alice' },
      { id: 'r2', name: 'Bob' },
    ];
    const dense = [tev('a', 'r1', 0, 300), tev('b', 'r1', 80, 380), tev('c', 'r1', 150, 450)];
    const { geom, rows, bars } = paint(resources, { r1: dense });

    // Dense lane (r1) is taller than the floor; sparse lane (r2) is at the floor.
    expect(geom.heightOf(0)).toBeGreaterThan(40);
    expect(geom.heightOf(1)).toBe(40);

    // Rows do not visually overlap: r2's measured top equals r1's bottom.
    const r1 = rows[0]!.getBoundingClientRect();
    const r2 = rows[1]!.getBoundingClientRect();
    expect(Math.round(r2.top)).toBeGreaterThanOrEqual(Math.round(r1.bottom) - 1);

    // The three overlapping bars in r1 occupy distinct vertical bands (stacked),
    // and all sit within r1's row box (not bleeding into r2).
    const r1Bars = bars.filter((b) => ['a', 'b', 'c'].includes(b.dataset.eventId!));
    expect(r1Bars).toHaveLength(3);
    const tops = new Set(r1Bars.map((b) => Math.round(b.getBoundingClientRect().top)));
    expect(tops.size).toBe(3); // three distinct sub-lane tops
    for (const b of r1Bars) {
      const box = b.getBoundingClientRect();
      expect(box.top).toBeGreaterThanOrEqual(r1.top - 1);
      expect(box.bottom).toBeLessThanOrEqual(r1.bottom + 1);
    }
  });

  it('keeps locked columns and bars vertically aligned per lane', () => {
    const resources: ResourceModel[] = [
      { id: 'r1', name: 'Alice' },
      { id: 'r2', name: 'Bob' },
      { id: 'r3', name: 'Carol' },
    ];
    const eventsByRow = {
      r1: [tev('a', 'r1', 0, 200), tev('b', 'r1', 50, 250)], // 2 stacked → tall
      r3: [tev('d', 'r3', 0, 100)],
    };
    const { rows, bars } = paint(resources, eventsByRow);

    // The bar on r3 starts within r3's row box (alignment held despite r1 growth).
    const r3 = rows[2]!.getBoundingClientRect();
    const dBar = bars.find((b) => b.dataset.eventId === 'd')!.getBoundingClientRect();
    expect(dBar.top).toBeGreaterThanOrEqual(r3.top - 1);
    expect(dBar.bottom).toBeLessThanOrEqual(r3.bottom + 1);
  });

  it('has no serious/critical accessibility violations', async () => {
    const resources: ResourceModel[] = [
      { id: 'r1', name: 'Alice' },
      { id: 'r2', name: 'Bob' },
    ];
    const { root } = paint(resources, {
      r1: [tev('a', 'r1', 0, 300), tev('b', 'r1', 80, 380)],
    });
    await expectNoA11yViolations(root);
  });
});
