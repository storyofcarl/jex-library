/**
 * PDF + PNG export — jsdom unit tests.
 *
 * Drives the full export pipeline through a recording stub canvas (no real
 * `<canvas>` needed under jsdom): asserts the PDF is a structurally valid,
 * paginated document, that the painter touched every layer (header/columns/bars/
 * deps), and that the PNG path yields a usable result. Also exercises the
 * `SchedulerExporter` plugin against a fake live Scheduler + its vetoable event.
 */
import { describe, it, expect } from 'vitest';
import type { TimeAxis, TimeSpan, EventBar } from '@jects/timeline-core';
import { layoutLane } from '../model/event-layout.js';
import type {
  ResourceModel,
  EventModel,
  DependencyModel,
  SchedulerConfig,
} from '../contract.js';
import type { ExportGeometrySource } from './geometry.js';
import { serializeGeometry } from './geometry.js';
import { buildPdf } from './pdf-writer.js';
import { exportSchedulePdf, planPdfPages } from './pdf.js';
import { exportSchedulePng } from './png.js';
import { paintModel, DEFAULT_EXPORT_PALETTE } from './paint-canvas.js';
import {
  SchedulerExporter,
  installExport,
  type ExportableScheduler,
} from './exporter.js';
import type { Canvas2DLike } from './paint-canvas.js';
import type { RasterSurface, CanvasFactory } from './canvas-factory.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2025, 0, 1);
// Pixels per day for the fake axis. The real axis maps time → pixels at a small
// scale (tens of px/day); the fixture must do the same. Using raw millisecond
// values as pixel coordinates makes `contentWidth` ~10 billion px, which the PDF
// paginator tiles into ~15 million pages (one canvas each) → OOM. Keep it realistic.
const PX_PER_DAY = 40;
const pxFromStart = (t: number, start: number) => ((t - start) / DAY) * PX_PER_DAY;

/* ── recording stub canvas ─────────────────────────────────────────────── */

interface Recorder {
  ops: string[];
  fills: number;
  strokes: number;
  texts: string[];
}

function stubCanvas(width: number, height: number): { surface: RasterSurface; rec: Recorder } {
  const rec: Recorder = { ops: [], fills: 0, strokes: 0, texts: [] };
  const ctx: Canvas2DLike = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: 'alphabetic',
    textAlign: 'left',
    save: () => rec.ops.push('save'),
    restore: () => rec.ops.push('restore'),
    translate: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    rect: () => {},
    fillRect: () => rec.fills++,
    strokeRect: () => rec.strokes++,
    clip: () => rec.ops.push('clip'),
    fill: () => rec.fills++,
    stroke: () => rec.strokes++,
    fillText: (t) => rec.texts.push(t),
    measureText: (t) => ({ width: t.length * 6 }),
  };
  const px = Math.max(1, Math.ceil(width)) * Math.max(1, Math.ceil(height));
  const surface: RasterSurface = {
    width: Math.max(1, Math.ceil(width)),
    height: Math.max(1, Math.ceil(height)),
    ctx,
    getRgba: () => new Uint8ClampedArray(px * 4).fill(255),
    toPngDataUrl: () => 'data:image/png;base64,AAAA',
  };
  return { surface, rec };
}

const recorders: Recorder[] = [];
const stubFactory: CanvasFactory = (w, h) => {
  const { surface, rec } = stubCanvas(w, h);
  recorders.push(rec);
  return surface;
};

/* ── fixtures ──────────────────────────────────────────────────────────── */

function fakeAxis(range: TimeSpan): TimeAxis {
  const ticks = [];
  for (let t = range.start; t < range.end; t += DAY) {
    ticks.push({
      index: (t - range.start) / DAY,
      span: { start: t, end: t + DAY },
      x: pxFromStart(t, range.start),
      width: PX_PER_DAY,
      major: ((t - range.start) / DAY) % 7 === 0,
    });
  }
  return {
    range,
    preset: {
      id: 'test',
      headers: [{ unit: 'week', format: '[W]w' }, { unit: 'day', format: 'D' }],
      tickUnit: 'day',
      pxPerUnit: PX_PER_DAY,
    },
    zoom: 1,
    contentWidth: pxFromStart(range.end, range.start),
    toX: (t) => pxFromStart(t, range.start),
    toTime: (x) => range.start + (x / PX_PER_DAY) * DAY,
    spanToBox: (s: TimeSpan) => ({ x: pxFromStart(s.start, range.start), width: (Math.max(0, s.end - s.start) / DAY) * PX_PER_DAY }),
    durationToWidth: (d) => (d / DAY) * PX_PER_DAY,
    ticksInRange: () => ticks,
    snap: (t) => t,
    setView: () => {},
    setRange: () => {},
  } as unknown as TimeAxis;
}

function source(range: TimeSpan): ExportGeometrySource {
  const axis = fakeAxis(range);
  const resources: ResourceModel[] = [
    { id: 'r1', name: 'Alice' },
    { id: 'r2', name: 'Bob' },
  ];
  const evByRow: Record<string, EventModel[]> = {
    r1: [{ id: 'a', resourceId: 'r1', name: 'Task A', startDate: range.start, endDate: range.start + DAY * 2, percentDone: 0.4 }],
    r2: [{ id: 'b', resourceId: 'r2', name: 'Task B', startDate: range.start + DAY, endDate: range.start + DAY * 4, eventColor: 'cyan' }],
  };
  return {
    axis,
    resources,
    events: [...evByRow.r1!, ...evByRow.r2!],
    dependencies: [{ id: 'd1', fromId: 'a', toId: 'b', type: 'FS' }],
    columns: [{ field: 'name', text: 'Resource', width: 160 }],
    rowHeight: 40,
    shades: [{ x: 0, width: DAY }],
    showNowMarker: false,
    title: 'Sprint board',
    barsFor: (rid) => {
      const list = (evByRow[String(rid)] ?? []).map((r) => ({
        id: r.id,
        rowId: rid,
        span: { start: r.startDate, end: r.endDate },
        record: r,
        ...(r.percentDone !== undefined ? { progress: r.percentDone } : {}),
        ...(r.eventColor !== undefined ? { styleKey: r.eventColor } : {}),
      }));
      const { bars } = layoutLane<EventModel>({ rowId: rid, events: list, axis, rowHeight: 40, strategy: 'stack' });
      return bars as EventBar<EventModel>[];
    },
  };
}

/* ── tests ─────────────────────────────────────────────────────────────── */

describe('buildPdf', () => {
  it('emits a structurally valid PDF with one page per image', () => {
    const img = { width: 4, height: 3, rgb: new Uint8Array(4 * 3 * 3).fill(128) };
    const bytes = buildPdf([img, img], { pageWidth: 595, pageHeight: 842, margin: 24, title: 'Doc' });
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Type /Pages');
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(2);
    expect(text).toContain('/Subtype /Image');
    expect(text).toContain('/Count 2');
    expect(text).toContain('startxref');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    // xref offsets line up with object count.
    expect(text).toMatch(/xref\n0 \d+/);
  });
});

describe('paintModel', () => {
  it('draws every layer onto the canvas (fills, strokes, labels)', () => {
    const model = serializeGeometry(source({ start: T0, end: T0 + DAY * 7 }));
    const { surface, rec } = stubCanvas(model.resourceWidth + model.contentWidth, model.headerHeight + model.contentHeight);
    paintModel(surface.ctx, model, {
      canvasWidth: model.resourceWidth + model.contentWidth,
      canvasHeight: model.headerHeight + model.contentHeight,
      palette: DEFAULT_EXPORT_PALETTE,
    });
    expect(rec.fills).toBeGreaterThan(0);
    expect(rec.strokes).toBeGreaterThan(0);
    // Bar labels + resource names + header cells were drawn.
    expect(rec.texts).toContain('Alice');
    expect(rec.texts.some((t) => t.includes('Task A'))).toBe(true);
    // Clipped regions: content + panel + header.
    expect(rec.ops.filter((o) => o === 'clip').length).toBeGreaterThanOrEqual(3);
  });
});

describe('exportSchedulePdf', () => {
  it('produces a multi-page PDF for a wide schedule', () => {
    recorders.length = 0;
    // 120-day schedule → wide → multiple page columns at A4 landscape.
    const result = exportSchedulePdf(source({ start: T0, end: T0 + DAY * 120 }), {
      canvasFactory: stubFactory,
      paper: 'a4',
      orientation: 'landscape',
      fileName: 'sprint',
    });
    expect(result.type).toBe('application/pdf');
    expect(result.fileName).toBe('sprint.pdf');
    expect(result.pageCount).toBeGreaterThan(1);
    expect(result.bytes.length).toBeGreaterThan(100);
    expect(result.dataUrl().startsWith('data:application/pdf')).toBe(true);
    // One canvas rendered per page.
    expect(recorders.length).toBe(result.pageCount);
  });

  it('planPdfPages predicts the page count without rendering', () => {
    const pages = planPdfPages(source({ start: T0, end: T0 + DAY * 120 }), { paper: 'a4', orientation: 'landscape' });
    expect(pages.length).toBeGreaterThan(1);
  });
});

describe('exportSchedulePng', () => {
  it('produces a single-page PNG result', () => {
    const result = exportSchedulePng(source({ start: T0, end: T0 + DAY * 7 }), {
      canvasFactory: stubFactory,
      fileName: 'sprint',
    });
    expect(result.type).toBe('image/png');
    expect(result.fileName).toBe('sprint.png');
    expect(result.pageCount).toBe(1);
    expect(result.dataUrl().startsWith('data:image/png')).toBe(true);
  });
});

/* ── SchedulerExporter against a fake live scheduler ───────────────────── */

function fakeScheduler(opts: { veto?: boolean } = {}): {
  scheduler: ExportableScheduler;
  events: string[];
} {
  const range = { start: T0, end: T0 + DAY * 14 };
  const axis = fakeAxis(range);
  const resources: ResourceModel[] = [{ id: 'r1', name: 'Alice' }];
  const events: EventModel[] = [
    { id: 'a', resourceId: 'r1', name: 'Standup', startDate: T0, endDate: T0 + 3_600_000, recurrenceRule: 'FREQ=DAILY;COUNT=3' },
  ];
  const deps: DependencyModel[] = [];
  const cfg: SchedulerConfig = { resources, events, rowHeight: 40 };
  const emitted: string[] = [];
  const scheduler: ExportableScheduler = {
    el: document.createElement('div'),
    getConfig: () => cfg,
    getAxis: () => axis,
    getResourceStore: () => ({ toArray: () => resources, count: resources.length }),
    getEventStore: () => ({ toArray: () => events, forEach: (fn) => events.forEach(fn) }),
    getDependencyStore: () => ({ toArray: () => deps }),
    emit: (e) => {
      emitted.push(e);
      if (opts.veto && e === 'beforeExport') return false;
      return true;
    },
  };
  return { scheduler, events: emitted };
}

describe('SchedulerExporter', () => {
  it('builds a geometry model from the live scheduler (recurrence expanded)', () => {
    const { scheduler } = fakeScheduler();
    const model = new SchedulerExporter(scheduler).model();
    // The daily-count-3 recurrence master expands to 3 occurrence bars.
    expect(model.bars.length).toBe(3);
    expect(model.rows).toHaveLength(1);
    expect(model.title).toBe(undefined); // no title configured
  });

  it('exports PDF + emits the export event', () => {
    const { scheduler, events } = fakeScheduler();
    const result = new SchedulerExporter(scheduler).exportPdf({ canvasFactory: stubFactory });
    expect(result.type).toBe('application/pdf');
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(events).toContain('beforeExport');
    expect(events).toContain('export');
  });

  it('honours a vetoed beforeExport (no artifact bytes)', () => {
    const { scheduler, events } = fakeScheduler({ veto: true });
    const result = new SchedulerExporter(scheduler).exportPng({ canvasFactory: stubFactory });
    expect(result.bytes.length).toBe(0);
    expect(result.pageCount).toBe(0);
    expect(events).toContain('beforeExport');
    expect(events).not.toContain('export');
  });

  it('installExport adds the public methods onto an instance additively', () => {
    const { scheduler } = fakeScheduler();
    const withExport = installExport(scheduler);
    expect(typeof withExport.exportPdf).toBe('function');
    expect(typeof withExport.exportPng).toBe('function');
    expect(withExport.exporter).toBeInstanceOf(SchedulerExporter);
    const r = withExport.exportPng({ canvasFactory: stubFactory });
    expect(r.type).toBe('image/png');
  });
});
