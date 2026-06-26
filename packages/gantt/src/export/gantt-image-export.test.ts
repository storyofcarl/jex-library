/**
 * jsdom unit tests for the **image-export wiring** (`GanttImageExportFeature` +
 * `installImageExport`) — the additive bridge that exposes the orphaned PNG
 * export module on a live `Gantt`.
 *
 * jsdom has no real 2D-canvas raster path, so the actual PNG bytes are exercised
 * by the Chromium a11y/visual test (`gantt-image-export.browser.test.ts`). Here
 * we assert the deterministic, browser-independent surface:
 *   - the feature grafts `exportPng()`/`exportImage()`/`imageExporter` etc. onto
 *     the Gantt and they delegate to the underlying exporter,
 *   - `serializeImage()`/`measureImage()` work over the real widget DOM (the
 *     `.jects-gantt__timeline-scroller`/`__tree-scroller` selectors resolve),
 *   - `exportPng()` resolves `null` under jsdom (callers fall back),
 *   - teardown (`removeFeature` / `gantt.destroy()`) removes the grafted surface
 *     and disposes the controller with no leaks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from '../ui/gantt.js';
import {
  GanttImageExportFeature,
  createGanttImageExport,
  installImageExport,
  GANTT_IMAGE_EXPORT_FEATURE,
  type GanttWithImageExport,
} from './gantt-image-export.js';
import { GanttImageExporter } from './png.js';
import type { TaskModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

function tasks(): TaskModel[] {
  return [
    { id: 'a', name: 'Design', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY } as TaskModel,
    {
      id: 'b',
      name: 'Build',
      start: T0 + 4 * DAY,
      duration: 3 * DAY,
      end: T0 + 7 * DAY,
    } as TaskModel,
  ];
}

let host: HTMLElement;
let gantt: Gantt | null = null;

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

describe('GanttImageExportFeature install/graft', () => {
  it('grafts exportPng/exportImage/imageExporter onto the Gantt', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttImageExportFeature();
    gantt.use(feature);

    const g = gantt as unknown as GanttWithImageExport;
    expect(typeof g.exportPng).toBe('function');
    expect(typeof g.exportImage).toBe('function');
    expect(typeof g.exportImageDataUrl).toBe('function');
    expect(typeof g.serializeImage).toBe('function');
    expect(typeof g.measureImage).toBe('function');
    expect(g.imageExporter).toBeInstanceOf(GanttImageExporter);
    expect(feature.installed).toBe(true);
    expect(feature.controller).toBeInstanceOf(GanttImageExporter);
  });

  it('registers under the feature name and is reachable via features.get', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttImageExportFeature());
    expect(gantt.features.get(GANTT_IMAGE_EXPORT_FEATURE)).toBeInstanceOf(
      GanttImageExportFeature,
    );
  });

  it('grafted props are non-enumerable (do not pollute the widget)', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttImageExportFeature());
    const keys = Object.keys(gantt as object);
    expect(keys).not.toContain('exportPng');
    expect(keys).not.toContain('imageExporter');
    // …but still own-readable.
    expect((gantt as unknown as Record<string, unknown>).exportPng).toBeTypeOf('function');
  });
});

describe('GanttImageExportFeature over the real widget DOM', () => {
  it('serializeImage() builds a standalone SVG carrying the widget panes', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const g = installImageExport(gantt);
    const out = g.serializeImage();
    expect(out.svg).toContain('<svg');
    expect(out.svg).toContain('<foreignObject');
    // The widget really renders these scroller class names.
    expect(host.querySelector('.jects-gantt__timeline-scroller')).not.toBeNull();
    expect(host.querySelector('.jects-gantt__tree-scroller')).not.toBeNull();
    expect(out.svg).toContain('jects-gantt__timeline-scroller');
    expect(out.svg).toContain('jects-gantt__tree-scroller');
    expect(out.width).toBeGreaterThanOrEqual(1);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });

  it('measureImage() reports a positive, integer size', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const g = installImageExport(gantt);
    const size = g.measureImage();
    expect(Number.isInteger(size.width)).toBe(true);
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });

  it('exportPng()/exportImage()/exportImageDataUrl() resolve null under jsdom', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const g = installImageExport(gantt);
    expect(await g.exportPng()).toBeNull();
    expect(await g.exportImage({ type: 'image/jpeg', quality: 0.8 })).toBeNull();
    expect(await g.exportImageDataUrl()).toBeNull();
  });

  it('merges install-time defaults into per-call options', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttImageExportFeature({ defaults: { padding: 24, pixelRatio: 3 } }));
    const g = gantt as unknown as GanttWithImageExport;
    // padding flows into the serialized size; per-call pixelRatio overrides.
    const base = g.serializeImage({ padding: 0 });
    const padded = g.serializeImage(); // uses default padding 24
    expect(padded.width).toBe(base.width + 48);
    expect(g.serializeImage().pixelRatio).toBe(3);
    expect(g.serializeImage({ pixelRatio: 1 }).pixelRatio).toBe(1);
  });
});

describe('createGanttImageExport factory + installImageExport', () => {
  it('createGanttImageExport returns an installable feature', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = createGanttImageExport({ defaults: { background: 'transparent' } });
    expect(feature).toBeInstanceOf(GanttImageExportFeature);
    gantt.use(feature);
    const g = gantt as unknown as GanttWithImageExport;
    expect(g.serializeImage().svg).toContain('background:transparent');
  });

  it('installImageExport returns the same instance, narrowed', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const g = installImageExport(gantt);
    expect(g).toBe(gantt);
    expect(typeof g.exportPng).toBe('function');
  });
});

describe('teardown', () => {
  it('removeFeature() removes the grafted surface and disposes the controller', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttImageExportFeature();
    gantt.use(feature);
    const exporter = feature.controller!;
    expect(exporter.isDestroyed).toBe(false);

    gantt.removeFeature(GANTT_IMAGE_EXPORT_FEATURE);

    const g = gantt as unknown as Record<string, unknown>;
    expect('exportPng' in g).toBe(false);
    expect('imageExporter' in g).toBe(false);
    expect(exporter.isDestroyed).toBe(true);
    expect(feature.installed).toBe(false);
  });

  it('gantt.destroy() disposes the feature (no leaked controller)', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttImageExportFeature();
    gantt.use(feature);
    const exporter = feature.controller!;
    gantt.destroy();
    gantt = null;
    expect(exporter.isDestroyed).toBe(true);
  });

  it('destroy() is idempotent', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttImageExportFeature();
    gantt.use(feature);
    gantt.removeFeature(GANTT_IMAGE_EXPORT_FEATURE);
    expect(() => feature.destroy()).not.toThrow();
  });
});
