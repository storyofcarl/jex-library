/**
 * jsdom unit tests for the Gantt PNG/image export (runs in the default
 * `pnpm test`). jsdom has no real 2D-canvas raster path, so these assert the
 * deterministic, browser-independent surface: measuring the export-rendered
 * (full-chart) size, inlining theme tokens, building a self-contained SVG that
 * carries the bars / header / dependency SVG, graceful `null` degradation of the
 * raster path, and the disposable controller contract. The real raster + a11y
 * path is covered by `png.a11y.test.ts` in Chromium.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  measureGanttExport,
  inlineExportTokens,
  serializeGanttToSvg,
  rasterizeGanttSvg,
  ganttToPngBlob,
  ganttToImageDataUrl,
  GanttImageExporter,
  GANTT_EXPORT_TOKENS,
} from './png.js';

/** Build a minimal but representative export-render fragment of a Gantt. */
function buildGanttFragment(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'jects-gantt';

  // Tree pane (left grid) with a scroller.
  const treeScroller = document.createElement('div');
  treeScroller.className = 'jects-gantt__tree-scroller';
  const treeTable = document.createElement('table');
  treeTable.className = 'jects-gantt__tree-table';
  treeTable.innerHTML =
    '<tbody><tr class="jects-gantt__tree-row"><td class="jects-gantt__tree-td">Design</td></tr></tbody>';
  treeScroller.appendChild(treeTable);

  // Timeline pane with header band, bars layer, and the dependency SVG.
  const timelineScroller = document.createElement('div');
  timelineScroller.className = 'jects-gantt__timeline-scroller';

  const header = document.createElement('div');
  header.className = 'jects-gantt__timeline-header';
  header.innerHTML = '<div class="jects-gantt__header-cell">Jan</div>';

  const bars = document.createElement('div');
  bars.className = 'jects-gantt__bars';
  const bar = document.createElement('div');
  bar.className = 'jects-gantt__bar';
  bar.textContent = 'Task A';
  bars.appendChild(bar);

  const deps = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  deps.classList.add('jects-gantt__deps');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.classList.add('jects-gantt__dep-line');
  line.setAttribute('d', 'M0 0 L40 20');
  deps.appendChild(line);

  timelineScroller.append(header, bars, deps);
  root.append(treeScroller, timelineScroller);
  return root;
}

let root: HTMLElement;

beforeEach(() => {
  root = buildGanttFragment();
  document.body.appendChild(root);
});

afterEach(() => {
  root.remove();
});

describe('measureGanttExport', () => {
  it('returns a positive, integer-rounded size', () => {
    const size = measureGanttExport(root);
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(size.width)).toBe(true);
    expect(Number.isInteger(size.height)).toBe(true);
  });

  it('adds padding on all four sides', () => {
    const base = measureGanttExport(root, { padding: 0 });
    const padded = measureGanttExport(root, { padding: 10 });
    expect(padded.width).toBe(base.width + 20);
    expect(padded.height).toBe(base.height + 20);
  });

  it('sums the tree + timeline scroller widths for the full chart', () => {
    const tree = root.querySelector<HTMLElement>('.jects-gantt__tree-scroller')!;
    const timeline = root.querySelector<HTMLElement>('.jects-gantt__timeline-scroller')!;
    // Force distinct content widths jsdom will report via scrollWidth.
    Object.defineProperty(tree, 'scrollWidth', { value: 200, configurable: true });
    Object.defineProperty(timeline, 'scrollWidth', { value: 600, configurable: true });
    Object.defineProperty(tree, 'scrollHeight', { value: 120, configurable: true });
    Object.defineProperty(timeline, 'scrollHeight', { value: 300, configurable: true });
    const size = measureGanttExport(root, { fullChart: true, padding: 0 });
    expect(size.width).toBeGreaterThanOrEqual(800); // 200 + 600
    expect(size.height).toBeGreaterThanOrEqual(300); // max(120, 300)
  });
});

describe('inlineExportTokens', () => {
  it('inlines resolved --jects-* tokens from the host as a declaration string', () => {
    root.style.setProperty('--jects-background', '0.99 0 0');
    root.style.setProperty('--jects-primary', '0.6 0.2 270');
    const decl = inlineExportTokens(root);
    expect(decl).toContain('--jects-background:0.99 0 0;');
    expect(decl).toContain('--jects-primary:0.6 0.2 270;');
  });

  it('skips tokens that do not resolve (jsdom-safe) without throwing', () => {
    expect(() => inlineExportTokens(root)).not.toThrow();
    const decl = inlineExportTokens(null);
    expect(typeof decl).toBe('string');
  });

  it('exposes a broad, deduped token list covering chrome + data ramp + radius', () => {
    expect(GANTT_EXPORT_TOKENS).toContain('--jects-background');
    expect(GANTT_EXPORT_TOKENS).toContain('--jects-primary');
    expect(GANTT_EXPORT_TOKENS).toContain('--jects-data-1');
    expect(GANTT_EXPORT_TOKENS).toContain('--jects-radius');
    expect(new Set(GANTT_EXPORT_TOKENS).size).toBe(GANTT_EXPORT_TOKENS.length);
  });
});

describe('serializeGanttToSvg', () => {
  it('produces a standalone SVG carrying the bars, header, and dependency SVG', () => {
    const out = serializeGanttToSvg(root);
    expect(out.svg).toContain('<svg');
    expect(out.svg).toContain('<foreignObject');
    expect(out.svg).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    // The chart structure is embedded.
    expect(out.svg).toContain('jects-gantt__bar');
    expect(out.svg).toContain('jects-gantt__timeline-header');
    expect(out.svg).toContain('jects-gantt__deps');
    expect(out.svg).toContain('jects-gantt__dep-line');
    // It declares the measured size on the svg element.
    expect(out.svg).toContain(`width="${out.width}"`);
    expect(out.svg).toContain(`height="${out.height}"`);
  });

  it('inlines the theme tokens onto the cloned body', () => {
    root.style.setProperty('--jects-primary', '0.6 0.2 270');
    const out = serializeGanttToSvg(root, {}, root);
    expect(out.svg).toContain('--jects-primary:0.6 0.2 270;');
  });

  it('paints a theme background by default and honors transparent', () => {
    const themed = serializeGanttToSvg(root, { background: 'theme' });
    expect(themed.svg).toContain('background:oklch(var(--jects-background))');
    const transparent = serializeGanttToSvg(root, { background: 'transparent' });
    expect(transparent.svg).toContain('background:transparent');
  });

  it('clamps the pixel ratio into [1, 4]', () => {
    expect(serializeGanttToSvg(root, { pixelRatio: 99 }).pixelRatio).toBe(4);
    expect(serializeGanttToSvg(root, { pixelRatio: 0.1 }).pixelRatio).toBe(1);
    expect(serializeGanttToSvg(root, { pixelRatio: 3 }).pixelRatio).toBe(3);
  });

  it('does not mutate the live root (operates on a clone)', () => {
    const before = root.outerHTML;
    serializeGanttToSvg(root);
    expect(root.outerHTML).toBe(before);
  });
});

describe('raster path degrades gracefully under jsdom', () => {
  it('rasterizeGanttSvg resolves null when no real canvas/Image exists', async () => {
    const out = serializeGanttToSvg(root);
    const canvas = await rasterizeGanttSvg(out);
    // jsdom: no working SVG image loader → null (callers fall back to SVG).
    expect(canvas).toBeNull();
  });

  it('ganttToPngBlob resolves null under jsdom', async () => {
    expect(await ganttToPngBlob(root)).toBeNull();
  });

  it('ganttToImageDataUrl resolves null under jsdom', async () => {
    expect(await ganttToImageDataUrl(root)).toBeNull();
  });
});

describe('GanttImageExporter (disposable controller)', () => {
  it('serialize() and measure() produce a self-contained SVG + size', () => {
    const exporter = new GanttImageExporter(root);
    const svg = exporter.serialize();
    expect(svg.svg).toContain('jects-gantt__bar');
    const size = exporter.measure();
    expect(size.width).toBeGreaterThanOrEqual(1);
    exporter.destroy();
  });

  it('export()/exportDataUrl() resolve null under jsdom and after destroy', async () => {
    const exporter = new GanttImageExporter(root);
    expect(await exporter.export()).toBeNull();
    expect(await exporter.exportDataUrl()).toBeNull();
    expect(exporter.isDestroyed).toBe(false);
    exporter.destroy();
    expect(exporter.isDestroyed).toBe(true);
    // After destroy the controller is inert.
    expect(await exporter.export()).toBeNull();
  });

  it('destroy() is idempotent', () => {
    const exporter = new GanttImageExporter(root);
    exporter.destroy();
    expect(() => exporter.destroy()).not.toThrow();
    expect(exporter.isDestroyed).toBe(true);
  });
});
