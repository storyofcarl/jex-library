/**
 * jsdom unit tests for the parity features added to `@jects/charts`:
 * zoom/pan, numeric/time X + bubble (13th type), crosshair, annotations,
 * data labels, streaming addPoint, PDF export, gradient theming, and wired
 * downsampling. Uses the SVG renderer so we can assert on the produced DOM.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Chart } from './chart.js';
import { pngDataUrlToPdfBytes } from '../renderer/pdf.js';

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 480, configurable: true });
  document.body.appendChild(host);
});
afterEach(() => host.remove());

function svgOf(): SVGSVGElement {
  return host.querySelector('.jects-chart__plot svg.jects-chart__svg') as SVGSVGElement;
}
function overlay(): SVGSVGElement {
  return host.querySelector('.jects-chart__overlay') as SVGSVGElement;
}
function circleCount(): number {
  return svgOf().querySelectorAll('circle').length;
}
function texts(): string[] {
  return [...svgOf().querySelectorAll('text')].map((t) => t.textContent ?? '');
}

// ---- Gap 1: zoom + pan ----------------------------------------------------

describe('Chart — zoom + pan', () => {
  const cats = Array.from({ length: 10 }, (_, i) => `c${i}`);
  const data = Array.from({ length: 10 }, (_, i) => i);

  it('windows the category X domain on zoomTo and reveals a reset affordance', () => {
    const c = new Chart(host, { type: 'line', categories: cats, data, zoom: { type: 'x' } });
    expect(circleCount()).toBe(10);
    const reset = host.querySelector('.jects-chart__zoom-reset') as HTMLButtonElement;
    expect(reset.hidden).toBe(true);

    c.zoomTo({ x: [0, 0.5] });
    // Only the first half of categories remain drawn.
    expect(circleCount()).toBeLessThan(10);
    expect(circleCount()).toBeGreaterThan(0);
    expect(texts()).toContain('c0');
    expect(texts()).not.toContain('c9');
    expect(reset.hidden).toBe(false);

    c.resetZoom();
    expect(circleCount()).toBe(10);
    expect(reset.hidden).toBe(true);
    c.destroy();
  });

  it('panBy shifts the visible window', () => {
    const c = new Chart(host, { type: 'line', categories: cats, data, zoom: { type: 'x' }, pan: {} });
    c.zoomTo({ x: [0, 0.4] });
    expect(texts()).toContain('c0');
    c.panBy({ x: 0.5 });
    // After panning right, an early category leaves and a later one enters view.
    expect(texts()).not.toContain('c0');
    expect(texts().some((t) => /^c[5-9]$/.test(t))).toBe(true);
    c.destroy();
  });

  it('wheel gesture zooms in and windows the domain', () => {
    const c = new Chart(host, { type: 'line', categories: cats, data, zoom: { type: 'x', wheel: true } });
    const node = svgOf();
    const ev = new Event('wheel', { cancelable: true, bubbles: true }) as Event & {
      deltaY: number;
      clientX: number;
      clientY: number;
    };
    ev.deltaY = -200; // zoom in
    ev.clientX = 200;
    ev.clientY = 150;
    node.dispatchEvent(ev);
    expect(circleCount()).toBeLessThan(10);
    const reset = host.querySelector('.jects-chart__zoom-reset') as HTMLButtonElement;
    expect(reset.hidden).toBe(false);
    c.destroy();
  });

  it('windows a numeric Y domain (rendered extent changes)', () => {
    const c = new Chart(host, {
      type: 'line',
      categories: ['a', 'b', 'c'],
      data: [0, 50, 100],
      zoom: { type: 'xy' },
    });
    const yBefore = (svgOf().querySelector('circle') as SVGCircleElement).getAttribute('cy');
    c.zoomTo({ y: [0.5, 1] });
    const yAfter = (svgOf().querySelector('circle') as SVGCircleElement).getAttribute('cy');
    expect(yAfter).not.toBe(yBefore);
    c.destroy();
  });
});

// ---- Gap 2: numeric/time X + bubble (13th type) ---------------------------

describe('Chart — numeric X axis + bubble type', () => {
  it('honors xAxis.type=linear, positioning scatter points by their x value', () => {
    const c = new Chart(host, {
      type: 'scatter',
      xAxis: { type: 'linear' },
      series: [
        {
          name: 'S',
          points: [
            { x: 0, y: 1 },
            { x: 10, y: 2 },
            { x: 100, y: 3 },
          ],
        },
      ],
    });
    const cs = [...svgOf().querySelectorAll('circle')] as SVGCircleElement[];
    expect(cs.length).toBe(3);
    const xs = cs.map((el) => Number(el.getAttribute('cx')));
    // x=0 < x=10 < x=100 -> increasing pixel positions (true numeric X).
    expect(xs[0]!).toBeLessThan(xs[1]!);
    expect(xs[1]!).toBeLessThan(xs[2]!);
    c.destroy();
  });

  it('renders a bubble chart whose marker radius encodes size (13th type)', () => {
    const c = new Chart(host, {
      type: 'bubble',
      xAxis: { type: 'linear' },
      series: [
        {
          name: 'B',
          points: [
            { x: 1, y: 1, size: 1 },
            { x: 2, y: 2, size: 50 },
            { x: 3, y: 3, size: 100 },
          ],
        },
      ],
    });
    const rs = [...svgOf().querySelectorAll('circle')].map((el) => Number(el.getAttribute('r')));
    expect(rs.length).toBe(3);
    // Radius grows with size.
    expect(rs[0]!).toBeLessThan(rs[1]!);
    expect(rs[1]!).toBeLessThan(rs[2]!);
    c.destroy();
  });
});

// ---- Gap 3: crosshair -----------------------------------------------------

describe('Chart — crosshair', () => {
  it('draws crosshair guide lines on hover', () => {
    const c = new Chart(host, {
      type: 'line',
      categories: ['a', 'b', 'c'],
      data: [1, 2, 3],
      crosshair: { x: true, y: true },
    });
    const node = svgOf();
    node.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 200, clientY: 150 }));
    const lines = overlay().querySelectorAll('.jects-chart__crosshair');
    expect(lines.length).toBe(2); // x + y guides
    c.destroy();
  });
});

// ---- Gap 4: annotations / target lines ------------------------------------

describe('Chart — annotations / target lines', () => {
  it('draws a horizontal target line at the right coordinate', () => {
    const c = new Chart(host, {
      type: 'line',
      categories: ['a', 'b'],
      data: [0, 10],
      annotations: [
        { value: 0, axis: 'y', label: 'low' },
        { value: 10, axis: 'y', label: 'high' },
      ],
    });
    const dashed = [...svgOf().querySelectorAll('line')].filter(
      (l) => l.getAttribute('stroke-dasharray') === '4,4',
    ) as SVGLineElement[];
    expect(dashed.length).toBe(2);
    // Each annotation line is horizontal (y1 == y2).
    for (const l of dashed) expect(l.getAttribute('y1')).toBe(l.getAttribute('y2'));
    // Drawn in array order: dashed[0] is value=0 (bottom), dashed[1] is value=10
    // (top) — value=10 must sit ABOVE value=0 (smaller y in screen space).
    const y0 = Number(dashed[0]!.getAttribute('y1'));
    const y10 = Number(dashed[1]!.getAttribute('y1'));
    expect(y10).toBeLessThan(y0);
    expect(texts()).toContain('high');
    c.destroy();
  });
});

// ---- Gap 5: data labels ---------------------------------------------------

describe('Chart — data labels', () => {
  it('renders a formatted value label per point', () => {
    const c = new Chart(host, {
      type: 'bar',
      categories: ['a', 'b'],
      data: [10, 20],
      dataLabels: { show: true, format: (ctx) => `$${ctx.value}` },
    });
    const t = texts();
    expect(t).toContain('$10');
    expect(t).toContain('$20');
    c.destroy();
  });
});

// ---- Gap 6: streaming / real-time -----------------------------------------

describe('Chart — streaming addPoint', () => {
  it('appends a rendered point and extends categories', () => {
    const c = new Chart(host, { type: 'line', categories: ['a', 'b'], data: [1, 2] });
    expect(circleCount()).toBe(2);
    c.addPoint(0, 3);
    expect(circleCount()).toBe(3);
    c.destroy();
  });

  it('shift keeps a fixed window (append + drop oldest)', () => {
    const c = new Chart(host, { type: 'line', categories: ['a', 'b', 'c'], data: [1, 2, 3] });
    c.addPoint(0, 4, { shift: true });
    expect(circleCount()).toBe(3); // still 3
    c.destroy();
  });
});

// ---- Gap 7: export PDF ----------------------------------------------------

describe('Chart — PDF export', () => {
  // 1x1 transparent PNG.
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  it('pngDataUrlToPdfBytes emits a valid PDF document', () => {
    const bytes = pngDataUrlToPdfBytes(png, 100, 80);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 100 80]');
    expect(text).toContain('%%EOF');
  });

  it('chart.pdf() returns an application/pdf Blob beginning with %PDF', async () => {
    const c = new Chart(host, { type: 'bar', categories: ['a'], data: [1] });
    const blob = await c.pdf(png); // supply the raster (jsdom can't rasterize)
    expect(blob.type).toBe('application/pdf');
    if (typeof blob.arrayBuffer === 'function') {
      const text = new TextDecoder().decode(await blob.arrayBuffer());
      expect(text.startsWith('%PDF')).toBe(true);
    }
    c.destroy();
  });
});

// ---- Gap 8: gradient theming ----------------------------------------------

describe('Chart — gradient theming', () => {
  it('emits a <linearGradient> and references it from the bar fill', () => {
    const c = new Chart(host, {
      type: 'bar',
      categories: ['a', 'b'],
      data: [3, 5],
      fillGradient: { from: 'red', to: 'blue' },
    });
    const svg = svgOf();
    const grad = svg.querySelector('linearGradient');
    expect(grad).toBeTruthy();
    expect(grad!.querySelectorAll('stop').length).toBe(2);
    const rect = svg.querySelector('rect') as SVGRectElement;
    expect(rect.getAttribute('fill')!.startsWith('url(#')).toBe(true);
    c.destroy();
  });

  it('supports per-series gradient on an area fill', () => {
    const c = new Chart(host, {
      type: 'area',
      categories: ['a', 'b', 'c'],
      series: [{ name: 'A', data: [1, 2, 3], gradient: { from: 'green', to: 'yellow' } }],
    });
    expect(svgOf().querySelector('linearGradient')).toBeTruthy();
    c.destroy();
  });
});

// ---- Gap 9: wired downsampling --------------------------------------------

describe('Chart — downsampling', () => {
  it('applies the minmax downsample path to markers + hit targets', () => {
    const data = Array.from({ length: 1000 }, (_, i) => (i % 2 === 0 ? i : -i));
    const cats = data.map((_, i) => String(i));
    const c = new Chart(host, {
      type: 'line',
      categories: cats,
      data,
      downsample: 'minmax',
      maxPoints: 40,
    });
    const markers = circleCount();
    // Markers are reduced from 1000 to roughly the bucket count (proves the
    // downsample path drives markers, not just the line geometry).
    expect(markers).toBeGreaterThan(2);
    expect(markers).toBeLessThan(100);
    // Hit targets (and thus the a11y data table) are reduced in lockstep.
    const rows = host.querySelectorAll('.jects-chart__data-table tbody tr').length;
    expect(rows).toBe(markers);
    c.destroy();
  });

  it('average downsampling reduces dense series too', () => {
    const data = Array.from({ length: 500 }, (_, i) => i);
    const c = new Chart(host, {
      type: 'scatter',
      categories: data.map(String),
      data,
      downsample: 'average',
      maxPoints: 30,
    });
    expect(circleCount()).toBeLessThan(60);
    c.destroy();
  });
});
