/**
 * jsdom unit tests for the vertical orientation renderer.
 *
 * Builds a {@link VerticalHostContext} over real DOM parts + a real
 * `DefaultTimeAxis` + real stores (the same seam the host Scheduler exposes) and
 * asserts the vertical geometry: time projected on Y, resources as columns on X,
 * bars positioned by `(column left, time top)`, horizontal gridlines, vertical
 * column separators, a horizontal now-marker, and Y-axis drag/resize commits.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DefaultTimeAxis, HOUR_AND_DAY, type TimeSpan } from '@jects/timeline-core';
import { resolveOrientation } from './orientation.js';
import {
  VerticalSchedulerView,
  type VerticalHostContext,
} from './vertical-view.js';
import { coerceResourceStore, coerceEventStore } from '../stores/stores.js';
import type { SchedulerConfig, EventModel } from '../contract.js';

const DAY = 86_400_000;
const start = Date.UTC(2025, 0, 1);

/**
 * Synthesize a pointer event for jsdom (which does not ship a `PointerEvent`
 * constructor here). Builds a `MouseEvent` and forces the `clientX`/`clientY`/
 * `pointerId`/`button` fields the gesture controllers read. Vertical-mode drags
 * track `clientY`, so unlike timeline-core's harness this sets BOTH axes.
 */
function pe(
  type: string,
  init: { clientX?: number; clientY?: number; pointerId?: number; button?: number } = {},
): PointerEvent {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clientX', { value: init.clientX ?? 0, configurable: true });
  Object.defineProperty(ev, 'clientY', { value: init.clientY ?? 0, configurable: true });
  Object.defineProperty(ev, 'pointerId', { value: init.pointerId ?? 1, configurable: true });
  Object.defineProperty(ev, 'button', { value: init.button ?? 0, configurable: true });
  Object.defineProperty(ev, 'pointerType', { value: 'mouse', configurable: true });
  // jsdom elements lack pointer-capture; the controllers guard with try/catch.
  return ev as unknown as PointerEvent;
}

interface Harness {
  ctx: VerticalHostContext;
  view: VerticalSchedulerView;
  parts: ReturnType<typeof buildParts>;
  commits: Array<{ record: EventModel; from: TimeSpan; to: TimeSpan }>;
  creates: Array<{ resourceId: string | number; span: TimeSpan }>;
  announcements: string[];
}

function buildParts() {
  const root = document.createElement('div');
  root.className = 'jects-scheduler jects-scheduler--vertical';
  const elHeader = document.createElement('div');
  const elResourceHeader = document.createElement('div');
  const elResourcePanel = document.createElement('div');
  const elScroller = document.createElement('div');
  const elContent = document.createElement('div');
  const elBackdrop = document.createElement('div');
  const elBars = document.createElement('div');
  const elDeps = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  elContent.append(elBackdrop, elDeps, elBars);
  elScroller.appendChild(elContent);
  root.append(elHeader, elResourceHeader, elResourcePanel, elScroller);
  document.body.appendChild(root);
  return {
    root,
    elHeader,
    elResourceHeader,
    elResourcePanel,
    elScroller,
    elContent,
    elBackdrop,
    elBars,
    elDeps,
  };
}

function makeHarness(extra: Partial<SchedulerConfig> = {}): Harness {
  const parts = buildParts();
  const resourceStore = coerceResourceStore([
    { id: 'r1', name: 'Alice' },
    { id: 'r2', name: 'Bob' },
    { id: 'r3', name: 'Carol' },
  ]);
  const eventStore = coerceEventStore([
    { id: 'e1', resourceId: 'r1', name: 'Task A', startDate: start, endDate: start + DAY },
    { id: 'e2', resourceId: 'r2', name: 'Task B', startDate: start + DAY, endDate: start + DAY * 2 },
  ]);
  const axis = new DefaultTimeAxis({
    range: extra.range ?? { start: start - DAY, end: start + DAY * 5 },
    preset: HOUR_AND_DAY,
    zoom: 1,
  });
  const config: SchedulerConfig = {
    resources: [],
    events: [],
    orientation: 'vertical',
    rowHeight: 120,
    preset: HOUR_AND_DAY,
    snap: false,
    showNonWorkingTime: false,
    ...extra,
  };
  const commits: Harness['commits'] = [];
  const creates: Harness['creates'] = [];
  const announcements: string[] = [];

  const ctx: VerticalHostContext = {
    config,
    axis,
    resourceStore,
    eventStore,
    rowHeight: 120,
    elHeader: parts.elHeader,
    elResourceHeader: parts.elResourceHeader,
    elResourcePanel: parts.elResourcePanel,
    elScroller: parts.elScroller,
    elContent: parts.elContent,
    elBackdrop: parts.elBackdrop,
    elBars: parts.elBars,
    elDeps: parts.elDeps,
    scrollTop: 0,
    scrollLeft: 0,
    commitEventChange(record, from, to) {
      commits.push({ record, from, to });
      eventStore.update(record.id, { startDate: to.start, endDate: to.end });
    },
    createEvent(resourceId, span) {
      creates.push({ resourceId, span });
    },
    announce(msg) {
      announcements.push(msg);
    },
  };
  const view = new VerticalSchedulerView(ctx);
  return { ctx, view, parts, commits, creates, announcements };
}

describe('VerticalSchedulerView', () => {
  let h: Harness;
  afterEach(() => {
    h?.view.dispose();
    h?.parts.root.remove();
  });

  it('orientation strategy: vertical maps time to the Y dimension', () => {
    const o = resolveOrientation('vertical');
    expect(o.kind).toBe('vertical');
    expect(o.timeIsVertical).toBe(true);
    // A pointer's screen Y becomes the main (time) coordinate.
    const p = o.toAxisPoint(40, 200);
    expect(p.main).toBe(200);
    expect(p.cross).toBe(40);
    expect(o.mainClient({ clientX: 5, clientY: 99 })).toBe(99);
  });

  it('sizes the content box with time on Y (height) and resources on X (width)', () => {
    h = makeHarness();
    h.view.paint();
    const content = h.parts.elContent;
    // height = full time extent (axis.contentWidth); width = 3 columns * 120px.
    expect(parseFloat(content.style.height)).toBeGreaterThan(0);
    expect(parseFloat(content.style.height)).toBe(h.ctx.axis.contentWidth);
    expect(parseFloat(content.style.width)).toBe(3 * 120);
  });

  it('renders one resource COLUMN header per resource, laid out across X', () => {
    h = makeHarness();
    h.view.paint();
    const cols = h.parts.elResourceHeader.querySelectorAll('.jects-scheduler__col-header');
    expect(cols.length).toBe(3);
    const first = cols[0] as HTMLElement;
    const second = cols[1] as HTMLElement;
    expect(first.textContent).toBe('Alice');
    // Columns advance along X by the column width.
    expect(parseFloat(first.style.left)).toBe(0);
    expect(parseFloat(second.style.left)).toBe(120);
    expect(parseFloat(first.style.width)).toBe(120);
  });

  it('renders the time axis as bands running DOWN the left rail', () => {
    h = makeHarness();
    h.view.paint();
    const bands = h.parts.elHeader.querySelectorAll('.jects-scheduler__time-band');
    expect(bands.length).toBe(HOUR_AND_DAY.headers.length);
    const cells = h.parts.elHeader.querySelectorAll('.jects-scheduler__time-cell');
    expect(cells.length).toBeGreaterThan(0);
    // Finest time cells are positioned by `top` (the main/time axis), not left.
    const cell = cells[cells.length - 1] as HTMLElement;
    expect(cell.style.top).not.toBe('');
    expect(cell.style.height).not.toBe('');
  });

  it('positions event bars by (column left, time top)', () => {
    h = makeHarness();
    h.view.paint();
    const e1 = h.parts.elBars.querySelector('[data-event-id="e1"]') as HTMLElement;
    const e2 = h.parts.elBars.querySelector('[data-event-id="e2"]') as HTMLElement;
    expect(e1).toBeTruthy();
    expect(e2).toBeTruthy();
    // Time → top/height (main axis): a non-empty span has a positive height.
    expect(parseFloat(e1.style.height)).toBeGreaterThan(0);
    expect(e1.style.top).not.toBe('');
    // e1 is on r1 (column 0) → its left sits within column 0's band [0,120).
    const e1Left = parseFloat(e1.style.left);
    expect(e1Left).toBeGreaterThanOrEqual(0);
    expect(e1Left).toBeLessThan(120);
    // e2 is on r2 (column 1) → its left sits within column 1's band [120,240).
    const e2Left = parseFloat(e2.style.left);
    expect(e2Left).toBeGreaterThanOrEqual(120);
    expect(e2Left).toBeLessThan(240);
    // e2 starts a day later than e1 → it sits lower (greater top) on the time axis.
    expect(parseFloat(e2.style.top)).toBeGreaterThan(parseFloat(e1.style.top));
    // Bars are interactive buttons (a11y parity with horizontal mode).
    expect(e1.getAttribute('role')).toBe('button');
    expect(e1.getAttribute('aria-label')).toContain('Task A');
  });

  it('paints horizontal time gridlines, vertical column separators, and a backdrop now-marker line', () => {
    h = makeHarness({
      // place "now" inside the range so the marker renders
      range: { start: Date.now() - DAY, end: Date.now() + DAY },
      showNowMarker: true,
    });
    h.view.paint();
    const gridlines = h.parts.elBackdrop.querySelectorAll('.jects-scheduler__gridline');
    expect(gridlines.length).toBeGreaterThan(0);
    // Gridlines run across → positioned by `top`, not `left`.
    const line = gridlines[0] as HTMLElement;
    expect(line.style.top).not.toBe('');
    expect(line.style.left).toBe('');
    // Column separators run down → positioned by `left`.
    const seps = h.parts.elBackdrop.querySelectorAll('.jects-scheduler__col-sep');
    expect(seps.length).toBeGreaterThanOrEqual(4); // 3 columns => 4 boundaries in window
    expect((seps[1] as HTMLElement).style.left).not.toBe('');
    // Now-marker is a horizontal line (top set, left unset).
    const now = h.parts.elBackdrop.querySelector('.jects-scheduler__now') as HTMLElement;
    expect(now).toBeTruthy();
    expect(now.style.top).not.toBe('');
  });

  it('virtualizes columns: only resources within the X window are painted', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, name: `R${i}` }));
    h = makeHarness();
    h.ctx.resourceStore.parse(many);
    // Narrow viewport so only a handful of columns fall in the X window.
    Object.defineProperty(h.parts.elScroller, 'clientWidth', { value: 360, configurable: true });
    Object.defineProperty(h.parts.elScroller, 'clientHeight', { value: 400, configurable: true });
    h.view.paint();
    const cols = h.parts.elResourceHeader.querySelectorAll('.jects-scheduler__col-header');
    // 360px / 120px = 3 columns + overscan, far fewer than 200.
    expect(cols.length).toBeGreaterThan(0);
    expect(cols.length).toBeLessThan(40);
  });

  /** Dispatch a pointerdown on `el` and route it through `view.onPointerDown`
   *  (mirrors how the host wires the content `pointerdown` listener), returning
   *  whether the view started a gesture. Dispatching gives the event a real
   *  `target` so the bar hit-test resolves. */
  function downOn(
    view: VerticalSchedulerView,
    el: HTMLElement,
    opts: { clientX?: number; clientY?: number; pointerId?: number; button?: number },
  ): boolean {
    let handled = false;
    const onDown = (e: Event): void => {
      handled = view.onPointerDown(e as PointerEvent);
    };
    el.addEventListener('pointerdown', onDown);
    el.dispatchEvent(pe('pointerdown', opts));
    el.removeEventListener('pointerdown', onDown);
    return handled;
  }

  it('drag-moves a bar along the Y (time) axis and commits the new span', () => {
    h = makeHarness({ snap: false, draggable: true });
    h.view.paint();
    const bar = h.parts.elBars.querySelector('[data-event-id="e1"]') as HTMLElement;
    // The content box reports zero rect in jsdom; the gesture reads clientY deltas
    // relative to the start, so absolute rect offset cancels out.
    const downY = 200;
    const handled = downOn(h.view, bar, { button: 0, clientX: 30, clientY: downY, pointerId: 1 });
    // The view starts a gesture on a bar pointerdown.
    expect(handled).toBe(true);
    // Move DOWN by a large delta (later in time) and release.
    window.dispatchEvent(pe('pointermove', { clientX: 30, clientY: downY + 400, pointerId: 1 }));
    window.dispatchEvent(pe('pointerup', { clientX: 30, clientY: downY + 400, pointerId: 1 }));
    expect(h.commits.length).toBe(1);
    const c = h.commits[0]!;
    // Dragging downward (positive Y) shifts the event LATER in time.
    expect(c.to.start).toBeGreaterThan(c.from.start);
    expect(c.to.end - c.to.start).toBe(c.from.end - c.from.start); // duration preserved
  });

  it('refuses to drag a recurrence occurrence (announces instead)', () => {
    h = makeHarness();
    h.ctx.eventStore.parse([
      {
        id: 'rec',
        resourceId: 'r1',
        name: 'Daily',
        startDate: start,
        endDate: start + 3_600_000,
        recurrenceRule: 'FREQ=DAILY;COUNT=4',
      },
    ]);
    h.view.paint();
    const occ = h.parts.elBars.querySelector('.jects-scheduler__bar[data-occurrence="true"]') as HTMLElement;
    expect(occ).toBeTruthy();
    expect(occ.getAttribute('aria-readonly')).toBe('true');
    downOn(h.view, occ, { button: 0, clientX: 30, clientY: 50, pointerId: 2 });
    expect(h.commits.length).toBe(0);
    expect(h.announcements.some((m) => /occurrence/i.test(m))).toBe(true);
  });

  it('drag-creates a new event in the column under the pointer when creatable', () => {
    h = makeHarness({ creatable: true, snap: false });
    h.view.paint();
    // Pointer down on empty space in column 1 (x within [120,240)).
    const handled = h.view.onPointerDown(
      pe('pointerdown', { button: 0, clientX: 160, clientY: 100, pointerId: 3 }),
    );
    expect(handled).toBe(true);
    window.dispatchEvent(pe('pointermove', { clientX: 160, clientY: 500, pointerId: 3 }));
    window.dispatchEvent(pe('pointerup', { clientX: 160, clientY: 500, pointerId: 3 }));
    expect(h.creates.length).toBe(1);
    // Column 1 → resource r2.
    expect(h.creates[0]!.resourceId).toBe('r2');
    expect(h.creates[0]!.span.end).toBeGreaterThan(h.creates[0]!.span.start);
  });

  it('renders an empty body when there are no resources', () => {
    h = makeHarness();
    h.ctx.resourceStore.parse([]);
    h.view.paint();
    expect(h.parts.elBars.children.length).toBe(0);
    expect(h.parts.elResourceHeader.children.length).toBe(0);
  });

  it('tears down an in-flight gesture on dispose (no leaked window listeners)', () => {
    h = makeHarness({ draggable: true, snap: false });
    h.view.paint();
    const bar = h.parts.elBars.querySelector('[data-event-id="e1"]') as HTMLElement;
    const started = downOn(h.view, bar, { button: 0, clientX: 30, clientY: 100, pointerId: 9 });
    expect(started).toBe(true);
    const spy = vi.spyOn(window, 'dispatchEvent');
    h.view.dispose();
    // After dispose, a stray pointermove must not commit anything.
    window.dispatchEvent(pe('pointermove', { clientX: 30, clientY: 800, pointerId: 9 }));
    window.dispatchEvent(pe('pointerup', { clientX: 30, clientY: 800, pointerId: 9 }));
    expect(h.commits.length).toBe(0);
    spy.mockRestore();
  });
});
