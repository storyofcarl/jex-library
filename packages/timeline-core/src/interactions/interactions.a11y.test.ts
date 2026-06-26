/**
 * Accessibility (axe-core) test for `@jects/timeline-core` — real Chromium via
 * `vitest --config vitest.browser.config.ts`. Asserts zero serious/critical
 * violations (Quality Gate Q2) for the DOM the engine's primitives produce and
 * the canonical accessible scaffold consumers (Scheduler / Gantt) render around
 * them: an accessible event-bar grid, the decorative SVG dependency layer the
 * router paints into, and the live `role=tooltip` the tooltip controller owns.
 *
 * Picked up by `vitest.browser.config.ts` (include: *.a11y.test.ts).
 */
import { describe, it, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import {
  TimelineTooltip,
  OrthogonalDependencyRouter,
} from './index.js';
import { TestAxis, makeBar } from './test-harness.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { DependencyLink, EventBar } from '../contract.js';
import type { TestRecord } from './test-harness.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

let host: HTMLElement;
const cleanup: Array<{ destroy(): void }> = [];

afterEach(() => {
  for (const c of cleanup.splice(0)) c.destroy();
  host?.remove();
});

function mount(): HTMLElement {
  host = document.createElement('div');
  host.style.position = 'relative';
  host.style.width = '800px';
  host.style.height = '240px';
  document.body.appendChild(host);
  return host;
}

/**
 * Build a representative, accessible timeline scaffold around the engine's
 * geometry: a labelled grid of rows, each holding focusable, named event bars,
 * with the router's SVG connectors painted into a decorative (aria-hidden)
 * dependency layer. This mirrors how Scheduler/Gantt mount the primitives.
 */
function buildTimeline(h: HTMLElement): {
  router: OrthogonalDependencyRouter<TestRecord>;
} {
  const axis = new TestAxis(0.1, 1000, 0, 8000);

  const grid = document.createElement('div');
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', 'Project timeline');
  grid.style.position = 'relative';
  grid.style.width = '100%';
  grid.style.height = '100%';

  const rowData: Array<{ id: string; label: string; span: { start: number; end: number } }> = [
    { id: 'r1', label: 'Design', span: { start: 500, end: 2000 } },
    { id: 'r2', label: 'Build', span: { start: 3000, end: 5000 } },
  ];

  const bars = new Map<string, EventBar<TestRecord>>();
  rowData.forEach((row, i) => {
    const rowEl = document.createElement('div');
    rowEl.setAttribute('role', 'row');
    rowEl.style.position = 'relative';
    rowEl.style.height = '60px';

    const bar = makeBar(axis, row.id, row.id, row.span, 10, 24);
    bars.set(row.id, bar);

    const barEl = document.createElement('button');
    barEl.type = 'button';
    barEl.setAttribute('role', 'gridcell');
    barEl.className = 'jects-timeline-bar--movable';
    barEl.dataset.eventId = row.id;
    barEl.tabIndex = i === 0 ? 0 : -1;
    barEl.textContent = row.label;
    // Accessible name describing the task and its placement (text, not color).
    barEl.setAttribute('aria-label', `${row.label}: task bar`);
    barEl.style.position = 'absolute';
    barEl.style.left = `${bar.x}px`;
    barEl.style.top = `${bar.y}px`;
    barEl.style.width = `${Math.max(8, bar.width)}px`;
    barEl.style.height = `${bar.height}px`;

    rowEl.appendChild(barEl);
    grid.appendChild(rowEl);
  });

  // Decorative dependency layer: SVG connectors are presentational; the
  // information is conveyed by the bars themselves, so the layer is hidden from
  // the a11y tree (aria-hidden) to avoid noise.
  const router = new OrthogonalDependencyRouter<TestRecord>();
  const link: DependencyLink = { id: 'd1', fromId: 'r1', toId: 'r2', type: 'FS' };
  const [line] = router.route({ links: [link], bars, axis });

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'jects-timeline-deps');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '800');
  svg.setAttribute('height', '240');
  if (line) {
    const pathEl = document.createElementNS(SVG_NS, 'path');
    pathEl.setAttribute('class', 'jects-timeline-dep__line');
    pathEl.setAttribute('d', line.path);
    const arrowEl = document.createElementNS(SVG_NS, 'path');
    arrowEl.setAttribute('class', 'jects-timeline-dep__arrow');
    arrowEl.setAttribute('d', router.arrowFor(line));
    svg.append(pathEl, arrowEl);
  }

  h.append(grid, svg);
  return { router };
}

describe('timeline-core a11y', () => {
  it('the bar grid + dependency layer have no serious/critical violations', async () => {
    const h = mount();
    buildTimeline(h);
    await expectNoA11yViolations(h);

    // Roving tabindex: exactly one focusable bar.
    const bars = Array.from(h.querySelectorAll<HTMLElement>('[data-event-id]'));
    expect(bars.length).toBe(2);
    expect(bars.filter((b) => b.tabIndex === 0).length).toBe(1);
    // The decorative SVG layer is hidden from assistive tech.
    expect(h.querySelector('.jects-timeline-deps')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('the tooltip controller produces no serious/critical violations', async () => {
    const h = mount();
    buildTimeline(h);
    const tip = new TimelineTooltip({ host: h, placement: 'top' });
    cleanup.push(tip);
    tip.showAt({ text: 'Design: 1d 12h', x: 120, y: 30 });

    expect(tip.element.getAttribute('role')).toBe('tooltip');
    await expectNoA11yViolations(h);
  });
});
