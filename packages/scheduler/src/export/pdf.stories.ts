/**
 * Usage stories for the Scheduler PDF / PNG export feature.
 *
 * Framework-free example functions (the house "stories" form): each returns a
 * title + a runnable closure demonstrating real wiring, so the docs shell and
 * integrators can copy it. Covers the headless serializer path, the live
 * `SchedulerExporter`, the one-call `installExport` mixin, and the themed
 * accessible toolbar.
 */

import { Scheduler } from '../view/scheduler.js';
import {
  exportSchedulePdf,
  exportSchedulePng,
  SchedulerExporter,
  installExport,
  serializeGeometry,
  type ExportGeometrySource,
} from './index.js';
import { mountRasterExportToolbar } from './raster-toolbar.js';
import type { EventModel, ResourceModel } from '../contract.js';

const DAY = 86_400_000;
const start = Date.UTC(2026, 0, 5);

const resources: ResourceModel[] = [
  { id: 'r1', name: 'Alice' },
  { id: 'r2', name: 'Bob' },
];
const events: EventModel[] = [
  { id: 'e1', resourceId: 'r1', name: 'Kickoff', startDate: start, endDate: start + DAY * 2, percentDone: 0.5 },
  { id: 'e2', resourceId: 'r2', name: 'Build', startDate: start + DAY, endDate: start + DAY * 5, eventColor: 'cyan' },
  { id: 'e3', resourceId: 'r2', name: 'Review', startDate: start + DAY * 5, endDate: start + DAY * 7 },
];

/** Export a live scheduler to a paginated, landscape-A4 PDF. */
export const exportPdf = {
  title: 'Export · scheduler → multi-page PDF',
  run(host: HTMLElement): Scheduler {
    const scheduler = new Scheduler(host, { resources, events });
    const exporter = new SchedulerExporter(scheduler);
    // Wide schedules paginate across columns automatically.
    const result = exporter.exportPdf({ paper: 'a4', orientation: 'landscape', fileName: 'sprint' });
    console.info(`PDF ready: ${result.fileName} (${result.pageCount} page(s))`);
    return scheduler;
  },
};

/** Export the whole schedule to a single high-DPI PNG. */
export const exportPng = {
  title: 'Export · scheduler → PNG (2x)',
  run(host: HTMLElement): Scheduler {
    const scheduler = new Scheduler(host, { resources, events });
    const exporter = new SchedulerExporter(scheduler);
    const result = exporter.exportPng({ scale: 2, fileName: 'sprint', background: 'theme' });
    console.info(`PNG data URL length: ${result.dataUrl().length}`);
    return scheduler;
  },
};

/** Attach `exportPdf`/`exportPng`/`downloadPdf`/`downloadPng` onto the instance. */
export const installMixin = {
  title: 'Export · install methods onto a Scheduler instance',
  run(host: HTMLElement): Scheduler {
    const scheduler = installExport(new Scheduler(host, { resources, events }));
    // Now the public methods live on the scheduler itself:
    scheduler.downloadPdf({ paper: 'letter' });
    return scheduler;
  },
};

/** Drop a themed, accessible PDF/PNG export toolbar next to the scheduler. */
export const toolbar = {
  title: 'Export · themed PDF/PNG toolbar + live preview',
  run(host: HTMLElement): Scheduler {
    const bar = document.createElement('div');
    host.prepend(bar);
    const schedHost = document.createElement('div');
    host.appendChild(schedHost);
    const scheduler = new Scheduler(schedHost, { resources, events });
    mountRasterExportToolbar(bar, scheduler, {
      label: 'Export schedule',
      pdf: { paper: 'a4', orientation: 'landscape' },
      onExport: (r, fmt) => console.info(`Exported ${fmt}: ${r.fileName}`),
    });
    return scheduler;
  },
};

/** Pure path: serialize a framework-free geometry source and render headlessly. */
export const headless = {
  title: 'Export · headless serialize + render (no live widget)',
  run(source: ExportGeometrySource): { pageCount: number; bars: number } {
    const model = serializeGeometry(source);
    // Both exporters accept an injected canvasFactory for node/headless use.
    const pdf = exportSchedulePdf(source, { paper: 'a4' });
    void exportSchedulePng(source);
    return { pageCount: pdf.pageCount, bars: model.bars.length };
  },
};
