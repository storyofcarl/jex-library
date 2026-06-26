/**
 * Real-browser (Chromium) interaction + visual smoke tests for
 * `@jects/timeline-core`. Unlike the jsdom unit suites, these run against real
 * layout and a real `PointerEvent` implementation, so the pointer-driven bar
 * drag commits through real captured-pointer geometry, the dependency router's
 * `path` strings actually render as visible SVG geometry, and the tooltip's
 * token-pure CSS positioning is exercised end-to-end.
 *
 * Picked up by `vitest.browser.config.ts` (include: *.browser.test.ts).
 */
import { describe, it, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import {
  TimelineTooltip,
  OrthogonalDependencyRouter,
  toPath,
  arrowheadPath,
  startBarDrag,
  type DragState,
} from './index.js';
import { TestAxis, makeBar } from './test-harness.js';
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
  host.style.width = '600px';
  host.style.height = '200px';
  document.body.appendChild(host);
  return host;
}

describe('timeline-core tooltip (browser)', () => {
  it('SMOKE: shows a positioned, visible role=tooltip and hides again', () => {
    const h = mount();
    const tip = new TimelineTooltip({ host: h, placement: 'top', offset: 8 });
    cleanup.push(tip);

    tip.showAt({ text: 'Task A', x: 120, y: 40 });
    const el = tip.element;

    // It is in the live DOM, exposes the tooltip role, and is actually visible.
    expect(h.contains(el)).toBe(true);
    expect(el.getAttribute('role')).toBe('tooltip');
    expect(el.hidden).toBe(false);
    expect(tip.isVisible).toBe(true);
    expect(el.textContent).toBe('Task A');
    // Real layout: the revealed tooltip has a non-zero on-screen box.
    const box = el.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    // CSS custom props drive position (top placement subtracts the offset).
    expect(el.style.getPropertyValue('--_tt-x')).toBe('120px');
    expect(el.style.getPropertyValue('--_tt-y')).toBe('32px');

    tip.hide();
    expect(el.hidden).toBe(true);
    expect(tip.isVisible).toBe(false);
  });
});

describe('timeline-core dependency lines (browser)', () => {
  it('SMOKE: a routed FS link paints a visible SVG connector + arrowhead', () => {
    const h = mount();
    const axis = new TestAxis(0.1, 1000, 0, 6000);
    // Two bars on separate rows so the connector has a real vertical jog.
    const a = makeBar(axis, 'a', 'r1', { start: 500, end: 1500 }, 10, 24);
    const b = makeBar(axis, 'b', 'r2', { start: 3000, end: 4000 }, 60, 24);
    const bars = new Map<string, EventBar<TestRecord>>([
      ['a', a],
      ['b', b],
    ]);
    const link: DependencyLink = { id: 'd1', fromId: 'a', toId: 'b', type: 'FS' };

    const router = new OrthogonalDependencyRouter<TestRecord>();
    const [line] = router.route({ links: [link], bars, axis });
    expect(line).toBeDefined();
    expect(line!.path).toMatch(/^M /);

    // Render the routed geometry into a real SVG layer and confirm the browser
    // measures a non-degenerate connector + a filled arrowhead triangle.
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'jects-timeline-deps');
    svg.setAttribute('width', '600');
    svg.setAttribute('height', '200');
    const pathEl = document.createElementNS(SVG_NS, 'path');
    pathEl.setAttribute('class', 'jects-timeline-dep__line');
    pathEl.setAttribute('d', line!.path);
    const arrowEl = document.createElementNS(SVG_NS, 'path');
    arrowEl.setAttribute('class', 'jects-timeline-dep__arrow');
    arrowEl.setAttribute('d', router.arrowFor(line!));
    svg.append(pathEl, arrowEl);
    h.appendChild(svg);

    const lineBox = pathEl.getBBox();
    // The connector spans real horizontal AND vertical distance (cross-row jog).
    expect(lineBox.width).toBeGreaterThan(0);
    expect(lineBox.height).toBeGreaterThan(0);
    // The arrowhead is a non-degenerate triangle.
    const arrowBox = arrowEl.getBBox();
    expect(arrowBox.width).toBeGreaterThan(0);
    expect(arrowBox.height).toBeGreaterThan(0);
  });

  it('SMOKE: toPath / arrowheadPath emit usable SVG d-strings', () => {
    const d = toPath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
    ]);
    expect(d).toBe('M 0 0 L 10 0 L 10 20');
    const arrow = arrowheadPath({ x: 100, y: 50 }, -1, 7);
    expect(arrow).toMatch(/^M 100 50 L .* Z$/);
  });
});

describe('timeline-core bar drag (browser)', () => {
  it('SMOKE: a real pointer drag shifts the span by the snapped delta', () => {
    const h = mount();
    const axis = new TestAxis(0.1, 1000, 0, 10_000); // 0.1px/ms, snap 1000ms
    const bar = document.createElement('div');
    bar.className = 'jects-timeline-bar--movable';
    bar.style.position = 'absolute';
    bar.style.left = '50px';
    bar.style.top = '40px';
    bar.style.width = '100px';
    bar.style.height = '24px';
    h.appendChild(bar);

    let committed: DragState | undefined;
    const previews: DragState[] = [];
    const origin = { start: 1000, end: 3000 };

    const down = new PointerEvent('pointerdown', {
      clientX: 100,
      clientY: 52,
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      button: 0,
    });
    bar.dispatchEvent(down);
    const controller = startBarDrag(down, {
      eventId: 'e1',
      mode: 'move',
      origin,
      axis,
      onPreview: (s) => previews.push(s),
      onCommit: (s) => (committed = s),
    });
    expect(controller.isActive).toBe(true);

    // +30px at 0.1px/ms = +300ms; start 1000+300=1300 snaps to 1000 (no change),
    // so push far enough to cross a snap boundary: +80px = +800ms → 1800 → 2000.
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 180, clientY: 52, bubbles: true, pointerId: 1 }),
    );
    expect(previews.length).toBeGreaterThan(0);
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 180, clientY: 52, bubbles: true, pointerId: 1 }),
    );

    expect(controller.isActive).toBe(false);
    expect(committed).toBeDefined();
    // Duration preserved; start advanced by a snapped multiple of 1000ms.
    expect(committed!.span.end - committed!.span.start).toBe(2000);
    expect(committed!.span.start).toBeGreaterThan(origin.start);
    expect(committed!.span.start % 1000).toBe(0);
  });
});
