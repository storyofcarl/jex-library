/**
 * Scheduler export — the `SchedulerExporter` plugin.
 *
 * Adapts a live {@link Scheduler} into the framework-free
 * {@link ExportGeometrySource} the PDF/PNG layer consumes, and exposes the
 * public `exportPng` / `exportPdf` surface plus a `downloadPdf`/`downloadPng`
 * convenience that triggers a browser download. This is the integration seam:
 * the main `Scheduler` class is owned by another agent, so rather than editing
 * it, the exporter is a standalone plugin that reads only the Scheduler's stable
 * public view API (`getAxis`, `getResourceStore`, `getEventStore`,
 * `getDependencyStore`) + its config. The integrator wires it in one of two ways
 * (see wireNotes):
 *
 *   const exporter = new SchedulerExporter(scheduler);
 *   await exporter.exportPdf({ paper: 'a4', orientation: 'landscape' });
 *
 * or attach the methods onto the instance via {@link installExport}.
 */

import type { RecordId } from '@jects/core';
import type { TimeAxis, EventBar, TimeSpan, TimelineEvent } from '@jects/timeline-core';
import {
  computeNonWorkingSpans,
  projectNonWorkingSpans,
} from '@jects/timeline-core';
import type {
  SchedulerConfig,
  EventModel,
  ResourceModel,
  DependencyModel,
} from '../contract.js';
import { layoutLane } from '../model/event-layout.js';
import { parseRRule, expandOccurrences } from '../model/recurrence.js';
import {
  serializeGeometry,
  type ExportGeometrySource,
  type ExportColumnDescriptor,
  type ExportShade,
  type SchedulerExportModel,
} from './geometry.js';
import { exportSchedulePng, type PngExportContext } from './png.js';
import { exportSchedulePdf, type PdfExportContext } from './pdf.js';
import type {
  ExportResult,
  PngExportConfig,
  PdfExportConfig,
} from './config.js';

/** The minimal slice of a live Scheduler the exporter reads (its public API). */
export interface ExportableScheduler {
  readonly el: HTMLElement;
  getConfig(): Readonly<SchedulerConfig>;
  getAxis(): TimeAxis;
  getResourceStore(): { toArray(): ResourceModel[]; count: number };
  getEventStore(): { toArray(): EventModel[]; forEach(fn: (e: EventModel) => void): void };
  getDependencyStore(): { toArray(): DependencyModel[] };
  emit?(event: string, payload: unknown): boolean;
}

export class SchedulerExporter {
  constructor(private readonly scheduler: ExportableScheduler) {}

  /** Build the framework-free geometry source from the live scheduler. */
  geometrySource(): ExportGeometrySource {
    const s = this.scheduler;
    const cfg = s.getConfig();
    const axis = s.getAxis();
    const resources = s.getResourceStore().toArray();
    const events = s.getEventStore().toArray();
    const dependencies = s.getDependencyStore().toArray();
    const rowHeight = cfg.rowHeight ?? 48;
    const strategy = cfg.overlap ?? 'stack';

    const columns: ExportColumnDescriptor[] = (
      cfg.columns ?? [{ field: 'name', text: 'Resource', width: 160 }]
    ).map((c) => ({
      field: c.field,
      text: c.text ?? String(c.field),
      width: c.width ?? 140,
      renderer: c.renderer,
    }));

    const shades: ExportShade[] = this.computeShades(axis, cfg);

    const eventsByResource = groupEventsByResource(events);

    const source: ExportGeometrySource = {
      axis,
      resources,
      events,
      dependencies,
      columns,
      rowHeight,
      shades,
      showNowMarker: cfg.showNowMarker !== false,
      title: readTitle(cfg),
      barsFor: (resourceId: RecordId): EventBar<EventModel>[] => {
        const recs = eventsByResource.get(resourceId) ?? [];
        const height =
          resources.find((r) => r.id === resourceId)?.rowHeight ?? rowHeight;
        const tlEvents = this.resolveLaneEvents(resourceId, recs, axis);
        const { bars } = layoutLane<EventModel>({
          rowId: resourceId,
          events: tlEvents,
          axis,
          rowHeight: height,
          strategy,
        });
        return bars;
      },
    };
    return source;
  }

  /** The serialized model (handy for tests / custom rendering). */
  model(): SchedulerExportModel {
    return serializeGeometry(this.geometrySource());
  }

  /** Export a PNG of the whole schedule. */
  exportPng(config: PngExportConfig & Partial<PngExportContext> = {}): ExportResult {
    if (this.veto('png', config)) {
      return emptyResult('image/png', `${config.fileName ?? 'schedule'}.png`);
    }
    const result = exportSchedulePng(this.geometrySource(), {
      ...config,
      themeEl: config.themeEl ?? this.scheduler.el,
    });
    this.scheduler.emit?.('export', { format: 'png', result });
    return result;
  }

  /** Export a paginated PDF of the whole schedule. */
  exportPdf(config: PdfExportConfig & Partial<PdfExportContext> = {}): ExportResult {
    if (this.veto('pdf', config)) {
      return emptyResult('application/pdf', `${config.fileName ?? 'schedule'}.pdf`);
    }
    const result = exportSchedulePdf(this.geometrySource(), {
      ...config,
      themeEl: config.themeEl ?? this.scheduler.el,
    });
    this.scheduler.emit?.('export', { format: 'pdf', result });
    return result;
  }

  /** Export + trigger a browser download (PNG). */
  downloadPng(config?: PngExportConfig): ExportResult {
    const r = this.exportPng(config);
    triggerDownload(r);
    return r;
  }

  /** Export + trigger a browser download (PDF). */
  downloadPdf(config?: PdfExportConfig): ExportResult {
    const r = this.exportPdf(config);
    triggerDownload(r);
    return r;
  }

  /* ── internals ────────────────────────────────────────────────────────── */

  private veto(format: 'pdf' | 'png', config: object): boolean {
    return this.scheduler.emit?.('beforeExport', { format, config }) === false;
  }

  /** Resolve a lane's events into timeline events, expanding recurrence over
   *  the WHOLE axis range so the export captures every occurrence. */
  private resolveLaneEvents(
    resourceId: RecordId,
    recs: EventModel[],
    axis: TimeAxis,
  ): TimelineEvent<EventModel>[] {
    const window: TimeSpan = { start: axis.range.start, end: axis.range.end };
    const out: TimelineEvent<EventModel>[] = [];
    for (const record of recs) {
      const masterSpan: TimeSpan = { start: record.startDate, end: record.endDate };
      if (record.recurrenceRule) {
        const rule = parseRRule(record.recurrenceRule);
        if (rule) {
          const occs = expandOccurrences(masterSpan, rule, window);
          occs.forEach((span, idx) => {
            out.push({
              id: idx === 0 ? record.id : `${record.id}::${span.start}`,
              rowId: resourceId,
              span,
              record,
              editable: idx === 0,
              ...(record.percentDone !== undefined ? { progress: record.percentDone } : {}),
              ...(record.eventColor !== undefined ? { styleKey: record.eventColor } : {}),
            });
          });
          continue;
        }
      }
      if (masterSpan.end > window.start && masterSpan.start < window.end) {
        out.push({
          id: record.id,
          rowId: resourceId,
          span: masterSpan,
          record,
          editable: record.draggable !== false,
          ...(record.percentDone !== undefined ? { progress: record.percentDone } : {}),
          ...(record.eventColor !== undefined ? { styleKey: record.eventColor } : {}),
        });
      }
    }
    return out;
  }

  private computeShades(axis: TimeAxis, cfg: Readonly<SchedulerConfig>): ExportShade[] {
    if (cfg.showNonWorkingTime === false) return [];
    try {
      const spans = computeNonWorkingSpans(axis, cfg.calendar ?? {}, 'day');
      return projectNonWorkingSpans(spans, axis).map((b) => ({ x: b.x, width: b.width }));
    } catch {
      return [];
    }
  }
}

/**
 * Read the optional document title from the scheduler config. Declared on
 * `SchedulerConfig` and forwarded to the export model / PDF info dict.
 */
function readTitle(cfg: Readonly<SchedulerConfig>): string | undefined {
  return cfg.title;
}

/** Group events by their resourceId for fast per-lane resolution. */
function groupEventsByResource(events: EventModel[]): Map<RecordId, EventModel[]> {
  const map = new Map<RecordId, EventModel[]>();
  for (const e of events) {
    let list = map.get(e.resourceId);
    if (!list) map.set(e.resourceId, (list = []));
    list.push(e);
  }
  return map;
}

/** An empty (vetoed) result placeholder. */
function emptyResult(type: string, fileName: string): ExportResult {
  const bytes = new Uint8Array(0);
  const result: ExportResult = {
    type,
    fileName,
    bytes,
    pageCount: 0,
    dataUrl: () => `data:${type};base64,`,
  };
  return result;
}

/** Trigger a browser download for a result (no-op in non-DOM environments). */
export function triggerDownload(result: ExportResult): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = result.blob ?? new Blob([new Uint8Array(result.bytes)], { type: result.type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the navigation/download has grabbed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Attach `exportPng` / `exportPdf` / `downloadPng` / `downloadPdf` onto a live
 * Scheduler instance. Additive — does not modify the class prototype, only the
 * instance — so it composes safely with the concurrently-built main class.
 */
export interface ExportApi {
  exportPng(config?: PngExportConfig): ExportResult;
  exportPdf(config?: PdfExportConfig): ExportResult;
  downloadPng(config?: PngExportConfig): ExportResult;
  downloadPdf(config?: PdfExportConfig): ExportResult;
  exporter: SchedulerExporter;
}

export function installExport<T extends ExportableScheduler>(scheduler: T): T & ExportApi {
  const exporter = new SchedulerExporter(scheduler);
  const target = scheduler as T & ExportApi;
  target.exporter = exporter;
  target.exportPng = (config) => exporter.exportPng(config);
  target.exportPdf = (config) => exporter.exportPdf(config);
  target.downloadPng = (config) => exporter.downloadPng(config);
  target.downloadPdf = (config) => exporter.downloadPdf(config);
  return target;
}
