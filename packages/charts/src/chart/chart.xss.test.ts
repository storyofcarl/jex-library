/**
 * XSS hardening suite for @jects/charts (SECURITY.md surface #12 — charts
 * labels / tooltips). Untrusted text reaches the DOM through three paths:
 *
 *   1. Series names           → legend + accessible data table (escaped via textContent)
 *   2. Axis-style category text → data table cells (escaped via textContent)
 *   3. Custom tooltip `format` → tooltipEl.innerHTML (routed through core sanitizeHtml)
 *
 * The standard payloads are injected into each and we assert: a global flag
 * stays false (no onerror/onload/alert ever fires), the rendered DOM carries no
 * <script>, no on*-handler attribute, and no javascript:/data:text/html URL —
 * while legitimate text/markup still renders.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Chart } from './chart.js';
import type { TooltipContext } from './types.js';

const PAYLOADS = [
  '<img src=x onerror="window.__xss=true">',
  '<script>window.__xss=true</script>',
  '<a href="javascript:window.__xss=true">click</a>',
  '<svg onload="window.__xss=true"></svg>',
  '"><iframe src="javascript:window.__xss=true"></iframe>',
  '<a href="data:text/html,<script>window.__xss=true</script>">x</a>',
];

declare global {
  // eslint-disable-next-line no-var
  var __xss: boolean | undefined;
}

let host: HTMLElement;
beforeEach(() => {
  globalThis.__xss = false;
  host = document.createElement('div');
  host.style.width = '400px';
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  globalThis.__xss = undefined;
});

/** Assert an element subtree carries no executable injection vectors. */
function assertClean(el: Element): void {
  expect(el.querySelector('script')).toBeNull();
  expect(el.querySelector('iframe')).toBeNull();
  // Note: charts legitimately render an <svg>, and the sanitizer's allow-list
  // keeps a bare `<img src=x>` (only the onerror handler is stripped — per the
  // contract `<img src=x onerror>` becomes `<img src=x>`), so we don't assert
  // their absence here. The dangerous vectors are caught by the walk below.
  // No event-handler attributes anywhere in the subtree.
  const walk = (node: Element): void => {
    for (const attr of Array.from(node.attributes)) {
      expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
    }
    const href = node.getAttribute('href') ?? '';
    const src = node.getAttribute('src') ?? '';
    for (const url of [href, src]) {
      const v = url.replace(/\s/g, '').toLowerCase();
      expect(v.startsWith('javascript:')).toBe(false);
      expect(v.startsWith('data:text/html')).toBe(false);
      expect(v.startsWith('vbscript:')).toBe(false);
    }
    for (const child of Array.from(node.children)) walk(child);
  };
  walk(el);
}

/**
 * Drive the tooltip open by scanning the renderer's logical coordinate space.
 * In jsdom getBoundingClientRect() is all-zero, so logical coords === client
 * coords; a coarse grid sweep is guaranteed to land on a hit target.
 */
function openTooltip(host: HTMLElement, w: number, h: number): HTMLElement {
  const svg = host.querySelector('svg')!;
  const tip = host.querySelector('.jects-chart__tooltip') as HTMLElement;
  for (let py = 0; py <= h && tip.hidden; py += 4) {
    for (let px = 0; px <= w && tip.hidden; px += 4) {
      // jsdom lacks a PointerEvent constructor; a MouseEvent typed 'pointermove'
      // carries the clientX/clientY the handler reads.
      svg.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: px, clientY: py }),
      );
    }
  }
  return tip;
}

describe('charts XSS — custom tooltip formatter (innerHTML surface)', () => {
  for (const payload of PAYLOADS) {
    it(`sanitizes formatter output: ${payload.slice(0, 24)}`, () => {
      const c = new Chart(host, {
        type: 'scatter',
        width: 400,
        height: 240,
        categories: ['a', 'b', 'c'],
        series: [{ name: 'S', data: [5, 5, 5] }],
        tooltip: { show: true, format: (_ctx: TooltipContext) => payload },
      });
      const tip = openTooltip(host, 400, 240);
      expect(tip.hidden).toBe(false);
      assertClean(tip);
      expect(globalThis.__xss).toBe(false);
      c.destroy();
    });
  }

  it('preserves legitimate markup returned by a formatter', () => {
    const c = new Chart(host, {
      type: 'scatter',
      width: 400,
      height: 240,
      categories: ['a', 'b', 'c'],
      series: [{ name: 'S', data: [5, 5, 5] }],
      tooltip: {
        show: true,
        format: (ctx) => `<b>${ctx.seriesName}</b>: <span>${ctx.value}</span>`,
      },
    });
    const tip = openTooltip(host, 400, 240);
    expect(tip.hidden).toBe(false);
    expect(tip.querySelector('b')).not.toBeNull();
    expect(tip.textContent).toContain('S');
    expect(globalThis.__xss).toBe(false);
    c.destroy();
  });
});

describe('charts XSS — series names + category labels (text surfaces)', () => {
  it('renders an injected series name / category as inert text (legend + data table)', () => {
    const evilName = '<img src=x onerror="window.__xss=true">Series';
    const evilCat = '<script>window.__xss=true</script>Q1';
    const c = new Chart(host, {
      type: 'bar',
      width: 400,
      height: 240,
      categories: [evilCat, 'Q2'],
      series: [{ name: evilName, data: [1, 2] }],
      legend: { show: true },
    });
    // These text surfaces escape via textContent, so the payload never parses
    // into elements at all — not even the allow-listed <img>.
    assertClean(host);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('script')).toBeNull();
    expect(globalThis.__xss).toBe(false);
    // The legend + data table still surface the literal text.
    expect(host.textContent).toContain('Series');
    expect(host.textContent).toContain('Q1');
    c.destroy();
  });
});
