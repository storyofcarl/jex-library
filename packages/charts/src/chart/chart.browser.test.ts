/**
 * Real-Chromium browser-mode test (Vitest browser mode + Playwright).
 * Run with `pnpm --filter @jects/charts test:browser`.
 *
 * jsdom can't compute layout, resolve custom properties, or rasterize a canvas;
 * a real browser can. This suite verifies token resolution, canvas drawing,
 * PNG/SVG export, and pointer-driven tooltips against a real engine.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import { Chart } from './chart.js';

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '520px';
  document.documentElement.classList.remove('dark');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

describe('Chart (real Chromium)', () => {
  it('renders an SVG line chart with resolved series colors', () => {
    const c = new Chart(host, {
      type: 'line',
      width: 520,
      height: 320,
      categories: ['a', 'b', 'c'],
      series: [{ name: 'S', data: [1, 3, 2] }],
    });
    const svg = host.querySelector('svg')!;
    const path = svg.querySelector('path')!;
    const stroke = path.getAttribute('stroke') ?? '';
    // In a real browser the ramp token resolves to a concrete oklch() triplet.
    expect(stroke.startsWith('oklch(')).toBe(true);
    expect(stroke).not.toContain('var(');
    c.destroy();
  });

  it('draws onto a real canvas backend', () => {
    const c = new Chart(host, {
      type: 'bar',
      renderer: 'canvas',
      width: 400,
      height: 240,
      categories: ['a', 'b', 'c'],
      data: [3, 6, 4],
    });
    const canvas = host.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.width).toBeGreaterThan(0);
    const ctx = canvas.getContext('2d')!;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    // Some pixel must be non-transparent (a bar was painted).
    let painted = false;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i]! > 0) {
        painted = true;
        break;
      }
    }
    expect(painted).toBe(true);
    c.destroy();
  });

  it('exports a PNG data URL (canvas)', async () => {
    const c = new Chart(host, {
      type: 'pie',
      renderer: 'canvas',
      width: 300,
      height: 300,
      categories: ['x', 'y', 'z'],
      data: [1, 2, 3],
    });
    const url = await c.png();
    expect(url.startsWith('data:image/png')).toBe(true);
    c.destroy();
  });

  it('exports a PNG data URL (svg rasterized)', async () => {
    const c = new Chart(host, {
      type: 'bar',
      renderer: 'svg',
      width: 300,
      height: 200,
      categories: ['a', 'b'],
      data: [1, 2],
    });
    const url = await c.png();
    expect(url.startsWith('data:image/png')).toBe(true);
    c.destroy();
  });

  it('shows a tooltip on pointer over a data point', () => {
    const c = new Chart(host, {
      type: 'scatter',
      width: 400,
      height: 240,
      categories: ['a', 'b', 'c'],
      series: [{ name: 'Pts', data: [5, 5, 5] }],
    });
    const svg = host.querySelector('svg')!;
    const circle = svg.querySelector('circle') as SVGCircleElement;
    const box = circle.getBoundingClientRect();
    svg.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      }),
    );
    const tip = host.querySelector('.jects-chart__tooltip') as HTMLElement;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('Pts');
    c.destroy();
  });

  it('does not inject markup from a malicious series color (tooltip XSS guard)', () => {
    // ctx.color comes from user-supplied SeriesConfig.color. A crafted value that
    // tries to break out of the swatch attribute and inject markup must NOT be
    // parsed as HTML — the swatch is built via the DOM API with style.backgroundColor.
    const evil = 'red"></span><img src=x onerror="window.__xss=1">';
    (window as unknown as { __xss?: number }).__xss = undefined;
    const c = new Chart(host, {
      type: 'scatter',
      width: 400,
      height: 240,
      categories: ['a'],
      series: [{ name: 'Evil', data: [5], color: evil }],
    });
    const svg = host.querySelector('svg')!;
    const circle = svg.querySelector('circle') as SVGCircleElement;
    const box = circle.getBoundingClientRect();
    svg.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      }),
    );
    const tip = host.querySelector('.jects-chart__tooltip') as HTMLElement;
    expect(tip.hidden).toBe(false);
    // No injected <img> (would have run the onerror handler if parsed as HTML).
    expect(tip.querySelector('img')).toBeNull();
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
    // The swatch still exists and carries the (string) color as a style value.
    const swatch = tip.querySelector('.jects-chart__tooltip-swatch') as HTMLElement;
    expect(swatch).toBeTruthy();
    c.destroy();
  });

  it('toggles a series via legend click', () => {
    const c = new Chart(host, {
      type: 'bar',
      width: 400,
      height: 240,
      categories: ['a', 'b'],
      series: [{ name: 'A', data: [1, 2] }, { name: 'B', data: [3, 4] }],
    });
    const before = host.querySelectorAll('svg rect').length;
    const item = host.querySelector('.jects-chart__legend-item') as HTMLButtonElement;
    item.click();
    const after = host.querySelectorAll('svg rect').length;
    expect(after).toBeLessThan(before);
    c.destroy();
  });
});
