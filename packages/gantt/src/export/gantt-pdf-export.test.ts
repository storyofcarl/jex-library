/**
 * jsdom unit tests for the `GanttPdfExportFeature` wiring — that installing the
 * feature grafts `exportPdf()`/`exportPdfBytes()`/`planPdf()`/`pdfExporter` onto a
 * live `Gantt`, that they produce a valid paginated PDF (image-less under jsdom),
 * and that teardown removes the grafted surface + disposes the controller with no
 * leaks. Mirrors the image-export feature's wiring tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from '../ui/gantt.js';
import type { TaskModel } from '../contract.js';
import {
  GanttPdfExportFeature,
  createGanttPdfExport,
  installPdfExport,
  GANTT_PDF_EXPORT_FEATURE,
  type GanttWithPdfExport,
} from './gantt-pdf-export.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

function sampleTasks(): TaskModel[] {
  return [
    { id: 'p', name: 'Phase 1' },
    { id: 'a', name: 'Design', parentId: 'p', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY },
    { id: 'b', name: 'Build', parentId: 'p', start: T0 + 3 * DAY, duration: 3 * DAY, end: T0 + 6 * DAY },
  ];
}

let host: HTMLElement;
let gantt: Gantt | null = null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

describe('GanttPdfExportFeature', () => {
  it('installs and grafts the PDF-export surface onto the Gantt', () => {
    gantt = new Gantt(host, { tasks: sampleTasks(), projectStart: T0 });
    const feature = new GanttPdfExportFeature();
    gantt.use(feature);

    const g = gantt as unknown as GanttWithPdfExport;
    expect(typeof g.exportPdf).toBe('function');
    expect(typeof g.exportPdfBytes).toBe('function');
    expect(typeof g.planPdf).toBe('function');
    expect(g.pdfExporter).toBeTruthy();
    expect(feature.installed).toBe(true);
    expect(gantt.features.get(GANTT_PDF_EXPORT_FEATURE)).toBe(feature);
  });

  it('planPdf() returns a pagination plan over the live chart', () => {
    gantt = installPdfExport(new Gantt(host, { tasks: sampleTasks(), projectStart: T0 }));
    const plan = gantt.planPdf({ page: 'A4', orientation: 'landscape' });
    expect(plan.pageCount).toBeGreaterThanOrEqual(1);
    expect(plan.tiles).toHaveLength(plan.pageCount);
    expect(plan.pageWidth).toBeGreaterThan(plan.pageHeight); // landscape
  });

  it('exportPdf() resolves a valid application/pdf Blob via the grafted method', async () => {
    gantt = installPdfExport(new Gantt(host, { tasks: sampleTasks(), projectStart: T0 }), {
      defaults: { title: 'Wired Plan', page: 'A4' },
    });
    const blob = await gantt.exportPdf();
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe('application/pdf');
    const bytes = await gantt.exportPdfBytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    const text = new TextDecoder('latin1').decode(bytes!);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('(Wired Plan) Tj'); // install-time default header
  });

  it('merges install-time defaults under per-call options', () => {
    gantt = installPdfExport(new Gantt(host, { tasks: sampleTasks(), projectStart: T0 }), {
      defaults: { page: 'A4', orientation: 'portrait' },
    });
    const portrait = gantt.planPdf();
    expect(portrait.pageWidth).toBeLessThan(portrait.pageHeight);
    const landscape = gantt.planPdf({ orientation: 'landscape' }); // per-call wins
    expect(landscape.pageWidth).toBeGreaterThan(landscape.pageHeight);
  });

  it('removeFeature() removes the grafted surface and disposes the controller', () => {
    gantt = new Gantt(host, { tasks: sampleTasks(), projectStart: T0 });
    const feature = createGanttPdfExport();
    gantt.use(feature);
    const controller = feature.controller!;
    expect(controller.isDestroyed).toBe(false);

    gantt.removeFeature(GANTT_PDF_EXPORT_FEATURE);
    const g = gantt as unknown as Partial<GanttWithPdfExport>;
    expect(g.exportPdf).toBeUndefined();
    expect(g.pdfExporter).toBeUndefined();
    expect(controller.isDestroyed).toBe(true);
    expect(feature.installed).toBe(false);
  });

  it('disposing the Gantt tears the feature down (no leaked grafts)', () => {
    gantt = new Gantt(host, { tasks: sampleTasks(), projectStart: T0 });
    const feature = new GanttPdfExportFeature();
    gantt.use(feature);
    gantt.destroy();
    gantt = null;
    expect(feature.installed).toBe(false);
    expect(feature.controller).toBeNull();
  });

  it('can also be installed via the plugins option at construction', () => {
    gantt = new Gantt(host, {
      tasks: sampleTasks(),
      projectStart: T0,
      plugins: [new GanttPdfExportFeature()],
    });
    const g = gantt as unknown as GanttWithPdfExport;
    expect(typeof g.exportPdf).toBe('function');
  });
});
