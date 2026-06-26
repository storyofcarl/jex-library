/**
 * a11y + visual/interaction SMOKE test for the Gantt **PNG/image export** feature
 * in REAL Chromium. Run with `pnpm --filter @jects/gantt test:browser`.
 *
 * The raster path (serialize → SVG `<foreignObject>` → `Image` → 2D `<canvas>` →
 * PNG `Blob`/data-URL) only works with a real canvas + SVG image loader, so it is
 * verified here, not in jsdom. The jsdom suite (`gantt-image-export.test.ts`)
 * covers the deterministic serialize/measure/graft surface.
 *
 * Asserts:
 *   1. `gantt.exportPng()` produces a real, non-empty `image/png` Blob whose
 *      decoded bitmap is `cssSize * pixelRatio` (the full-chart capture).
 *   2. `exportImageDataUrl()` yields a `data:image/png;base64,` URL.
 *   3. JPEG export honors the requested MIME type.
 *   4. Installing the feature does not introduce serious/critical a11y violations.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from '../ui/gantt.js';
import { installImageExport } from './gantt-image-export.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { TaskModel, DependencyModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

function tasks(): TaskModel[] {
  return [
    { id: 'p', name: 'Phase 1' } as TaskModel,
    {
      id: 'a',
      name: 'Design',
      parentId: 'p',
      start: T0,
      duration: 3 * DAY,
      end: T0 + 3 * DAY,
    } as TaskModel,
    {
      id: 'b',
      name: 'Build',
      parentId: 'p',
      start: T0 + 3 * DAY,
      duration: 3 * DAY,
      end: T0 + 6 * DAY,
    } as TaskModel,
    {
      id: 'c',
      name: 'Ship',
      parentId: 'p',
      start: T0 + 6 * DAY,
      duration: 2 * DAY,
      end: T0 + 8 * DAY,
    } as TaskModel,
  ];
}

function deps(): DependencyModel[] {
  return [
    { id: 'd1', from: 'a', to: 'b', type: 'finish-to-start' } as DependencyModel,
    { id: 'd2', from: 'b', to: 'c', type: 'finish-to-start' } as DependencyModel,
  ];
}

/** Decode a PNG/JPEG Blob into an Image so we can read its real pixel size. */
function decode(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('failed to decode exported image'));
    };
    img.src = url;
  });
}

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '320px';
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

describe('Gantt PNG/image export (real Chromium)', () => {
  it('exportPng() produces a non-empty PNG Blob at cssSize * pixelRatio', async () => {
    gantt = new Gantt(host, { tasks: tasks(), dependencies: deps(), projectStart: T0 });
    const g = installImageExport(gantt);

    const pixelRatio = 2;
    const size = g.measureImage();
    const blob = await g.exportPng({ pixelRatio });

    expect(blob).not.toBeNull();
    expect(blob!.type).toBe('image/png');
    expect(blob!.size).toBeGreaterThan(0);

    const img = await decode(blob!);
    // Full-chart capture rasterized at the requested device-pixel ratio.
    expect(img.naturalWidth).toBe(Math.round(size.width * pixelRatio));
    expect(img.naturalHeight).toBe(Math.round(size.height * pixelRatio));
  });

  it('exportImageDataUrl() returns a base64 PNG data URL', async () => {
    gantt = new Gantt(host, { tasks: tasks(), dependencies: deps(), projectStart: T0 });
    const g = installImageExport(gantt);
    const url = await g.exportImageDataUrl({ pixelRatio: 1 });
    expect(url).not.toBeNull();
    expect(url!.startsWith('data:image/png;base64,')).toBe(true);
    expect(url!.length).toBeGreaterThan('data:image/png;base64,'.length + 64);
  });

  it('exportImage() honors a non-PNG MIME type', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const g = installImageExport(gantt);
    const blob = await g.exportImage({ type: 'image/jpeg', quality: 0.8, pixelRatio: 1 });
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe('image/jpeg');
    expect(blob!.size).toBeGreaterThan(0);
  });

  it('captures the whole chart, not just the viewport', async () => {
    gantt = new Gantt(host, { tasks: tasks(), dependencies: deps(), projectStart: T0 });
    const g = installImageExport(gantt);
    // The export-rendered size sums the tree + timeline panes; it should be at
    // least as wide as the visible host (and typically wider, since the timeline
    // scrolls). This is the parity "full chart" behavior.
    const size = g.measureImage();
    expect(size.width).toBeGreaterThanOrEqual(host.clientWidth - 2);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });

  it('installing the export feature keeps the Gantt a11y-clean', async () => {
    gantt = new Gantt(host, { tasks: tasks(), dependencies: deps(), projectStart: T0 });
    installImageExport(gantt);
    await expectNoA11yViolations(host);
  });
});
