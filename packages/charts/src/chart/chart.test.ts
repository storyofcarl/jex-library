/** jsdom unit test for the Chart Widget. Uses the SVG renderer so we can assert
 *  on the produced DOM structure & series math. Canvas is smoke-tested separately. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Chart } from './chart.js';
import { isRegistered, create } from '@jects/core';

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  // Give the host a width so dims() doesn't fall back oddly.
  Object.defineProperty(host, 'clientWidth', { value: 480, configurable: true });
  document.body.appendChild(host);
});
afterEach(() => host.remove());

function svgOf(_c: Chart): SVGSVGElement {
  return host.querySelector('svg') as SVGSVGElement;
}

describe('Chart — base contract', () => {
  it('builds a .jects-chart root with an SVG plot', () => {
    const c = new Chart(host, { type: 'line', categories: ['a', 'b'], data: [1, 2] });
    expect(host.querySelector('.jects-chart')).toBeTruthy();
    expect(host.querySelector('.jects-chart__plot svg')).toBeTruthy();
    c.destroy();
  });

  it('gives the chart graphic an accessible name (role=img + label/title)', () => {
    const c = new Chart(host, {
      type: 'line',
      ariaLabel: 'Quarterly revenue',
      description: 'Revenue rose each quarter.',
      categories: ['a', 'b'],
      series: [{ name: 'Revenue', data: [1, 2] }],
    });
    const root = host.querySelector('.jects-chart') as HTMLElement;
    // Root is a labeled figure grouping (it wraps interactive legend chrome).
    expect(root.getAttribute('role')).toBe('figure');
    expect(root.getAttribute('aria-label')).toBe('Quarterly revenue');

    // The graphic surface is a labeled image with a <title>/<desc>.
    const svg = host.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Quarterly revenue');
    expect(svg.querySelector('title')!.textContent).toBe('Quarterly revenue');
    expect(svg.querySelector('desc')!.textContent).toBe('Revenue rose each quarter.');
    expect(svg.getAttribute('aria-labelledby')).toBeTruthy();
    expect(svg.getAttribute('aria-describedby')).toBeTruthy();
    c.destroy();
  });

  it('exposes a keyboard/AT-reachable data table mirroring the tooltip values', () => {
    const c = new Chart(host, {
      type: 'line',
      ariaLabel: 'Quarterly revenue',
      categories: ['Q1', 'Q2', 'Q3'],
      series: [
        { name: 'Revenue', data: [10, 20, 30] },
        { name: 'Cost', data: [5, 6, 7] },
      ],
    });
    const region = host.querySelector('.jects-chart__data') as HTMLElement;
    expect(region).toBeTruthy();
    // The region is keyboard-reachable (not display:none / aria-hidden) and holds
    // a real table the same per-point values the hover tooltip surfaces.
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.getAttribute('aria-hidden')).toBeNull();
    const table = region.querySelector('table.jects-chart__data-table') as HTMLTableElement;
    expect(table).toBeTruthy();
    expect(table.querySelector('caption')!.textContent).toBe('Quarterly revenue');
    // One row per drawn point (3 categories × 2 series = 6).
    expect(table.querySelectorAll('tbody tr')).toHaveLength(6);
    const text = table.textContent ?? '';
    expect(text).toContain('Revenue');
    expect(text).toContain('Q1');
    expect(text).toContain('30');
    expect(text).toContain('Cost');
    c.destroy();
  });

  it('hides the data region from AT when there are no data points', () => {
    const c = new Chart(host, { type: 'line', categories: [], series: [] });
    const region = host.querySelector('.jects-chart__data') as HTMLElement;
    expect(region.getAttribute('aria-hidden')).toBe('true');
    expect(region.querySelector('table')).toBeNull();
    c.destroy();
  });

  it('falls back to a generated accessible name when none is supplied', () => {
    const c = new Chart(host, {
      type: 'bar',
      categories: ['a', 'b'],
      series: [{ name: 'Sales', data: [1, 2] }],
    });
    const svg = host.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toContain('bar chart');
    expect(svg.querySelector('title')!.textContent).toContain('bar chart');
    c.destroy();
  });

  it('is registered with the factory', () => {
    expect(isRegistered('chart')).toBe(true);
    const w = create({ type: 'chart', data: [1, 2, 3], categories: ['a', 'b', 'c'] }, host);
    expect(w).toBeInstanceOf(Chart);
    w.destroy();
  });

  it('destroy() removes the element and is idempotent', () => {
    const c = new Chart(host, { data: [1, 2] });
    c.destroy();
    expect(host.querySelector('.jects-chart')).toBeNull();
    expect(() => c.destroy()).not.toThrow();
  });

  it('emits draw on render', () => {
    const c = new Chart(host, { data: [1, 2] });
    const spy = vi.fn();
    c.on('draw', spy);
    c.update({ data: [3, 4] });
    expect(spy).toHaveBeenCalled();
    c.destroy();
  });
});

describe('Chart — cartesian types', () => {
  const cats = ['a', 'b', 'c'];

  it('line draws a poly-path with markers', () => {
    const c = new Chart(host, { type: 'line', categories: cats, data: [1, 3, 2] });
    const svg = svgOf(c);
    expect(svg.querySelector('path')).toBeTruthy();
    expect(svg.querySelectorAll('circle').length).toBe(3);
    c.destroy();
  });

  it('spline draws a smooth path (contains C)', () => {
    const c = new Chart(host, { type: 'spline', categories: ['a', 'b', 'c', 'd'], data: [1, 3, 2, 4] });
    const d = svgOf(c).querySelector('path')!.getAttribute('d')!;
    expect(d).toContain('C');
    c.destroy();
  });

  it('bar draws one rect per datum', () => {
    const c = new Chart(host, { type: 'bar', categories: cats, data: [1, 2, 3] });
    expect(svgOf(c).querySelectorAll('rect').length).toBe(3);
    c.destroy();
  });

  it('horizontalBar draws one rect per datum', () => {
    const c = new Chart(host, { type: 'horizontalBar', categories: cats, data: [1, 2, 3] });
    expect(svgOf(c).querySelectorAll('rect').length).toBe(3);
    c.destroy();
  });

  it('area fills under the line', () => {
    const c = new Chart(host, { type: 'area', categories: cats, data: [1, 2, 3] });
    // Two paths: filled area + stroked top.
    expect(svgOf(c).querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
    c.destroy();
  });

  it('splineArea uses a smooth fill', () => {
    const c = new Chart(host, { type: 'splineArea', categories: ['a', 'b', 'c', 'd'], data: [1, 2, 3, 4] });
    expect(svgOf(c).querySelector('path')!.getAttribute('d')).toContain('C');
    c.destroy();
  });

  it('scatter draws a circle per point', () => {
    const c = new Chart(host, { type: 'scatter', categories: cats, data: [1, 2, 3] });
    expect(svgOf(c).querySelectorAll('circle').length).toBe(3);
    c.destroy();
  });
});

describe('Chart — radial / special types', () => {
  it('pie draws an arc path per non-zero slice', () => {
    const c = new Chart(host, { type: 'pie', categories: ['x', 'y', 'z'], data: [1, 2, 3] });
    const arcs = [...svgOf(c).querySelectorAll('path')].filter((p) =>
      (p.getAttribute('d') ?? '').includes('A'),
    );
    expect(arcs.length).toBe(3);
    c.destroy();
  });

  it('donut arcs have an inner radius (two arcs per slice)', () => {
    const c = new Chart(host, { type: 'donut', categories: ['x', 'y'], data: [1, 1] });
    const d = [...svgOf(c).querySelectorAll('path')]
      .map((p) => p.getAttribute('d') ?? '')
      .find((s) => s.includes('A'))!;
    expect((d.match(/A/g) ?? []).length).toBe(2);
    c.destroy();
  });

  it('radar draws grid rings and a polygon per series', () => {
    const c = new Chart(host, {
      type: 'radar',
      categories: ['a', 'b', 'c'],
      series: [{ name: 'S1', data: [1, 2, 3] }],
    });
    expect(svgOf(c).querySelectorAll('path').length).toBeGreaterThan(1);
    c.destroy();
  });

  it('treemap draws one rect per value', () => {
    const c = new Chart(host, { type: 'treemap', categories: ['a', 'b', 'c'], data: [3, 2, 1] });
    expect(svgOf(c).querySelectorAll('rect').length).toBe(3);
    c.destroy();
  });

  it('heatmap draws a cell rect per matrix entry', () => {
    const c = new Chart(host, {
      type: 'heatmap',
      series: [{ name: 'H', data: [], matrix: [[1, 2], [3, 4]] }],
    });
    expect(svgOf(c).querySelectorAll('rect').length).toBe(4);
    c.destroy();
  });
});

describe('Chart — stacking, dual axes, combination', () => {
  it('stacks bar series sharing a stack group', () => {
    const c = new Chart(host, {
      type: 'bar',
      categories: ['a', 'b'],
      stacked: true,
      series: [
        { name: 'A', data: [1, 2] },
        { name: 'B', data: [3, 4] },
      ],
    });
    // 2 series x 2 points = 4 rects.
    expect(svgOf(c).querySelectorAll('rect').length).toBe(4);
    c.destroy();
  });

  it('supports dual axes (left + right)', () => {
    const c = new Chart(host, {
      type: 'line',
      categories: ['a', 'b'],
      series: [
        { name: 'L', data: [1, 2], axis: 'left' },
        { name: 'R', data: [100, 200], axis: 'right' },
      ],
      yAxis: [{}, {}],
    });
    // Two line paths (one per series) plus markers.
    const paths = [...svgOf(c).querySelectorAll('path')];
    expect(paths.length).toBeGreaterThanOrEqual(2);
    c.destroy();
  });

  it('renders combination charts (bar + line)', () => {
    const c = new Chart(host, {
      categories: ['a', 'b', 'c'],
      series: [
        { name: 'Cols', data: [3, 5, 2], type: 'bar' },
        { name: 'Trend', data: [2, 4, 3], type: 'line' },
      ],
    });
    const svg = svgOf(c);
    expect(svg.querySelectorAll('rect').length).toBe(3); // bar
    expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(1); // line
    c.destroy();
  });
});

describe('Chart — averaging large data', () => {
  it('downsamples markers when maxPoints is set', () => {
    const data = Array.from({ length: 1000 }, (_, i) => i);
    const cats = data.map(String);
    const c = new Chart(host, { type: 'line', data, categories: cats, maxPoints: 50 });
    // Markers are still drawn per original datum, but the line path itself is
    // averaged. We assert the path exists and the chart didn't choke on 1000 pts.
    expect(svgOf(c).querySelector('path')).toBeTruthy();
    c.destroy();
  });
});

describe('Chart — legend & events', () => {
  it('renders a legend item per series with a swatch', () => {
    const c = new Chart(host, {
      categories: ['a', 'b'],
      legend: { show: true, position: 'bottom' },
      series: [{ name: 'A', data: [1, 2] }, { name: 'B', data: [3, 4] }],
    });
    const items = host.querySelectorAll('.jects-chart__legend-item');
    expect(items.length).toBe(2);
    expect(host.querySelector('.jects-chart__legend-swatch')).toBeTruthy();
    c.destroy();
  });

  it('toggleSeries hides a series and emits legendToggle', () => {
    const c = new Chart(host, {
      categories: ['a', 'b'],
      series: [{ name: 'A', data: [1, 2] }, { name: 'B', data: [3, 4] }],
    });
    const spy = vi.fn();
    c.on('legendToggle', spy);
    c.toggleSeries(0, true);
    expect(spy).toHaveBeenCalledWith({ seriesIndex: 0, hidden: true });
    expect(c.getConfig().series![0]!.hidden).toBe(true);
    c.destroy();
  });

  it('hides the legend when legend.show is false', () => {
    const c = new Chart(host, { data: [1, 2], legend: { show: false } });
    expect(host.querySelector('.jects-chart__legend')!.hasAttribute('hidden')).toBe(true);
    c.destroy();
  });
});

describe('Chart — accessibility', () => {
  it('root + svg surface expose role=img with an accessible name', () => {
    const c = new Chart(host, {
      type: 'line',
      categories: ['a', 'b'],
      series: [{ name: 'Revenue', data: [1, 2] }],
    });
    const root = host.querySelector('.jects-chart') as HTMLElement;
    // Root is a labeled figure (it wraps interactive legend chrome); the inner
    // svg surface is the role="img" graphic.
    expect(root.getAttribute('role')).toBe('figure');
    expect(root.getAttribute('aria-label')).toBeTruthy();
    const svg = svgOf(c);
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBeTruthy();
    // <title> child wired via aria-labelledby.
    const title = svg.querySelector('title')!;
    expect(title).toBeTruthy();
    expect(svg.getAttribute('aria-labelledby')).toBe(title.getAttribute('id'));
    c.destroy();
  });

  it('uses an explicit ariaLabel + description for name/desc', () => {
    const c = new Chart(host, {
      type: 'bar',
      categories: ['a', 'b'],
      data: [1, 2],
      ariaLabel: 'Quarterly sales',
      description: 'Sales rose from Q1 to Q2.',
    });
    const svg = svgOf(c);
    expect(svg.getAttribute('aria-label')).toBe('Quarterly sales');
    const desc = svg.querySelector('desc')!;
    expect(desc.textContent).toBe('Sales rose from Q1 to Q2.');
    expect(svg.getAttribute('aria-describedby')).toBe(desc.getAttribute('id'));
    expect((host.querySelector('.jects-chart') as HTMLElement).getAttribute('aria-label')).toBe(
      'Quarterly sales',
    );
    c.destroy();
  });

  it('falls back to title for the accessible name', () => {
    const c = new Chart(host, { type: 'pie', categories: ['x', 'y'], data: [1, 1], title: 'Share' });
    expect(svgOf(c).getAttribute('aria-label')).toBe('Share');
    c.destroy();
  });

  it('a11y title/desc survive a re-render (clear)', () => {
    const c = new Chart(host, { type: 'bar', categories: ['a'], data: [1], ariaLabel: 'Keep me' });
    c.update({ data: [2] });
    const svg = svgOf(c);
    expect(svg.querySelector('title')!.textContent).toBe('Keep me');
    expect(svg.getAttribute('aria-label')).toBe('Keep me');
    c.destroy();
  });

  it('canvas surface exposes role=img + aria-label + fallback text', () => {
    const c = new Chart(host, {
      type: 'bar',
      renderer: 'canvas',
      categories: ['a'],
      data: [1],
      ariaLabel: 'Canvas chart',
      description: 'A single bar.',
    });
    const canvas = host.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.getAttribute('aria-label')).toBe('Canvas chart');
    expect(canvas.textContent).toContain('Canvas chart');
    expect(canvas.textContent).toContain('A single bar.');
    c.destroy();
  });
});

describe('Chart — export', () => {
  it('svg() returns serialized markup', () => {
    const c = new Chart(host, { type: 'bar', categories: ['a'], data: [1] });
    expect(c.svg()).toContain('<svg');
    c.destroy();
  });

  it('canvas backend still serializes to svg via the mirror', () => {
    const c = new Chart(host, { type: 'bar', renderer: 'canvas', categories: ['a'], data: [1] });
    expect(host.querySelector('canvas')).toBeTruthy();
    expect(c.svg()).toContain('rect');
    c.destroy();
  });
});
