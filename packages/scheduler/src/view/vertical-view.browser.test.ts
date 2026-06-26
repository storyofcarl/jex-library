/**
 * Real-browser (Chromium) a11y + visual/interaction test for the vertical
 * orientation renderer. Unlike the jsdom suite this has real layout, so the
 * Y-axis drag gesture runs against actual `getBoundingClientRect` geometry and
 * axe-core can evaluate contrast / roles / names on the rendered vertical
 * scheduler.
 */
import { describe, it, afterEach, expect } from 'vitest';
import { DefaultTimeAxis, HOUR_AND_DAY, type TimeSpan } from '@jects/timeline-core';
import '@jects/theme/style.css';
import '../styles.css';
import { VerticalSchedulerView, type VerticalHostContext } from './vertical-view.js';
import { coerceResourceStore, coerceEventStore } from '../stores/stores.js';
import type { SchedulerConfig, EventModel } from '../contract.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const start = Date.UTC(2025, 0, 1);

let root: HTMLElement;
let view: VerticalSchedulerView | undefined;

afterEach(() => {
  view?.dispose();
  view = undefined;
  root?.remove();
});

/**
 * Build the full vertical scheduler shell (a real `.jects-scheduler--vertical`
 * grid) + a `VerticalHostContext`, attach it to the document with real size, and
 * paint. Returns the shell + context + collected commits.
 */
function mount(extra: Partial<SchedulerConfig> = {}) {
  root = document.createElement('div');
  root.className = 'jects-scheduler jects-scheduler--vertical';
  root.style.width = '720px';
  root.style.height = '480px';
  root.setAttribute('role', 'application');
  root.setAttribute('aria-label', 'Resource scheduler');

  const corner = document.createElement('div');
  corner.className = 'jects-scheduler__corner';
  const elResourceHeader = document.createElement('div');
  elResourceHeader.className = 'jects-scheduler__resource-header';
  corner.appendChild(elResourceHeader);

  const elHeader = document.createElement('div');
  elHeader.className = 'jects-scheduler__time-header';

  const elResourcePanel = document.createElement('div');
  elResourcePanel.className = 'jects-scheduler__resources';

  const elScroller = document.createElement('div');
  elScroller.className = 'jects-scheduler__scroller';
  const elContent = document.createElement('div');
  elContent.className = 'jects-scheduler__content';
  const elBackdrop = document.createElement('div');
  elBackdrop.className = 'jects-scheduler__backdrop';
  const elDeps = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  elDeps.setAttribute('class', 'jects-scheduler__deps');
  const elBars = document.createElement('div');
  elBars.className = 'jects-scheduler__bars';
  elBars.setAttribute('role', 'group');
  elBars.setAttribute('aria-label', 'Scheduled events');
  elContent.append(elBackdrop, elDeps, elBars);
  elScroller.appendChild(elContent);

  root.append(corner, elHeader, elResourcePanel, elScroller);
  document.body.appendChild(root);

  const resourceStore = coerceResourceStore([
    { id: 'r1', name: 'Alice' },
    { id: 'r2', name: 'Bob' },
    { id: 'r3', name: 'Carol' },
  ]);
  const eventStore = coerceEventStore([
    { id: 'e1', resourceId: 'r1', name: 'Task A', startDate: start + HOUR * 4, endDate: start + HOUR * 8 },
    { id: 'e2', resourceId: 'r2', name: 'Task B', startDate: start + HOUR * 10, endDate: start + HOUR * 14 },
  ]);
  const axis = new DefaultTimeAxis({ range: { start, end: start + DAY }, preset: HOUR_AND_DAY, zoom: 1 });
  const config: SchedulerConfig = {
    resources: [],
    events: [],
    orientation: 'vertical',
    rowHeight: 160,
    preset: HOUR_AND_DAY,
    snap: false,
    ...extra,
  };
  const commits: Array<{ record: EventModel; from: TimeSpan; to: TimeSpan }> = [];

  const ctx: VerticalHostContext = {
    config,
    axis,
    resourceStore,
    eventStore,
    rowHeight: 160,
    elHeader,
    elResourceHeader,
    elResourcePanel,
    elScroller,
    elContent,
    elBackdrop,
    elBars,
    elDeps,
    scrollTop: 0,
    scrollLeft: 0,
    commitEventChange(record, from, to) {
      commits.push({ record, from, to });
      eventStore.update(record.id, { startDate: to.start, endDate: to.end });
    },
    createEvent() {},
    announce() {},
  };
  view = new VerticalSchedulerView(ctx);
  view.paint();
  return { ctx, commits, parts: { root, elHeader, elResourceHeader, elBars, elBackdrop } };
}

function pointer(type: string, target: EventTarget, x: number, y: number): void {
  target.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0 }),
  );
}

describe('VerticalSchedulerView (browser)', () => {
  it('has no serious/critical accessibility violations', async () => {
    const { parts } = mount();
    await expectNoA11yViolations(parts.root);
    // Resource columns + event bars are present and labelled.
    expect(parts.elResourceHeader.querySelectorAll('.jects-scheduler__col-header').length).toBe(3);
    const bar = parts.elBars.querySelector('[data-event-id="e1"]') as HTMLElement;
    expect(bar.getAttribute('role')).toBe('button');
    expect(bar.getAttribute('aria-label')).toContain('Task A');
  });

  it('lays bars out vertically: later events sit lower; same-time events sit in different columns', () => {
    const { parts } = mount();
    const e1 = parts.elBars.querySelector('[data-event-id="e1"]') as HTMLElement;
    const e2 = parts.elBars.querySelector('[data-event-id="e2"]') as HTMLElement;
    const r1 = e1.getBoundingClientRect();
    const r2 = e2.getBoundingClientRect();
    // e2 is later in the day → lower on screen (greater top).
    expect(r2.top).toBeGreaterThan(r1.top);
    // e1 (col 0) is left of e2 (col 1).
    expect(r2.left).toBeGreaterThan(r1.left);
    // Each bar has real vertical extent (time → height).
    expect(r1.height).toBeGreaterThan(0);
  });

  it('drag-moves a bar DOWN the time axis and commits a later span', () => {
    const { commits, parts } = mount({ snap: false, draggable: true });
    const bar = parts.elBars.querySelector('[data-event-id="e1"]') as HTMLElement;
    const r = bar.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;

    // Route the pointerdown through the view (host wires content pointerdown).
    bar.addEventListener('pointerdown', (e) => view!.onPointerDown(e as PointerEvent), { once: true });
    pointer('pointerdown', bar, cx, cy);
    // Drag down by ~80px (later in time), then release.
    pointer('pointermove', window, cx, cy + 80);
    pointer('pointerup', window, cx, cy + 80);

    expect(commits.length).toBe(1);
    const c = commits[0]!;
    expect(c.to.start).toBeGreaterThan(c.from.start);
    expect(c.to.end - c.to.start).toBe(c.from.end - c.from.start);
  });

  it('renders horizontal time gridlines across the full resource width', () => {
    const { parts } = mount();
    const lines = parts.elBackdrop.querySelectorAll('.jects-scheduler__gridline');
    expect(lines.length).toBeGreaterThan(0);
    const line = lines[0] as HTMLElement;
    const rect = line.getBoundingClientRect();
    // A horizontal gridline is wide and short (spans the cross axis).
    expect(rect.width).toBeGreaterThan(rect.height);
  });
});
