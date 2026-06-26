/**
 * Real-browser (Chromium) a11y + visual/interaction test for the Scheduler
 * PDF / PNG export feature.
 *
 * Mounts a live Scheduler plus the themed raster-export toolbar, then:
 *  - asserts the toolbar renders with the correct toolbar role + accessible,
 *    keyboard-focusable buttons painted by token-pure CSS (real layout);
 *  - runs axe-core for zero serious/critical violations (Quality Gate Q2);
 *  - exercises the feature end to end in a real browser with a real `<canvas>`:
 *    clicking "Export PNG" rasterizes the painted schedule and renders a
 *    non-empty PNG into the live preview `<img>`; clicking "Export PDF"
 *    produces a structurally valid, multi-page `application/pdf` and triggers a
 *    download (intercepted).
 */
import { describe, it, afterEach, expect, vi } from 'vitest';
import { WEEK_AND_DAY } from '@jects/timeline-core';
import '@jects/theme/style.css';
import '../styles.css';
import { Scheduler } from '../view/scheduler.js';
import { mountRasterExportToolbar } from './raster-toolbar.js';
import { SchedulerExporter } from './exporter.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { ResourceModel, EventModel } from '../contract.js';

const DAY = 86_400_000;
const start = Date.UTC(2025, 0, 1);

let host: HTMLElement;
const cleanup: Array<{ destroy?(): void }> = [];

afterEach(() => {
  for (const c of cleanup.splice(0)) c.destroy?.();
  host?.remove();
  vi.restoreAllMocks();
});

function resources(): ResourceModel[] {
  return [
    { id: 'r1', name: 'Alice' },
    { id: 'r2', name: 'Bob' },
  ];
}
function events(): EventModel[] {
  return [
    { id: 'e1', resourceId: 'r1', name: 'Kickoff', startDate: start, endDate: start + DAY * 2, percentDone: 0.5 },
    { id: 'e2', resourceId: 'r2', name: 'Build', startDate: start + DAY, endDate: start + DAY * 5, eventColor: 'cyan' },
  ];
}

function build(): { sched: Scheduler; bar: HTMLElement } {
  host = document.createElement('div');
  host.style.width = '1000px';
  document.body.appendChild(host);
  const bar = document.createElement('div');
  host.appendChild(bar);
  const schedHost = document.createElement('div');
  schedHost.style.height = '300px';
  host.appendChild(schedHost);
  const sched = new Scheduler(schedHost, {
    resources: resources(),
    events: events(),
    preset: WEEK_AND_DAY,
    range: { start, end: start + DAY * 90 }, // wide → multi-page PDF
  });
  cleanup.push(sched);
  return { sched, bar };
}

describe('Scheduler PDF/PNG export (browser)', () => {
  it('renders an accessible export toolbar with zero serious axe violations', async () => {
    const { sched, bar } = build();
    const toolbar = mountRasterExportToolbar(bar, sched, { download: false });
    cleanup.push(toolbar);

    const root = toolbar.el.querySelector('[role="toolbar"]') as HTMLElement;
    expect(root.getAttribute('role')).toBe('toolbar');
    expect(root.getAttribute('aria-label')).toBe('Export schedule');

    const pdfBtn = toolbar.el.querySelector('.jects-scheduler-raster__btn--pdf') as HTMLButtonElement;
    const pngBtn = toolbar.el.querySelector('.jects-scheduler-raster__btn--png') as HTMLButtonElement;
    expect(pdfBtn.tagName).toBe('BUTTON');
    expect(pngBtn.tagName).toBe('BUTTON');
    expect(pdfBtn.textContent).toBe('Export PDF');

    // Token-pure CSS actually applied: the primary button has a themed
    // (non-transparent) background painted by the browser.
    const bg = getComputedStyle(pdfBtn).backgroundColor;
    expect(bg).not.toBe('');
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');

    // Keyboard focusable with accessible names.
    pdfBtn.focus();
    expect(document.activeElement).toBe(pdfBtn);

    await expectNoA11yViolations(toolbar.el);
  });

  it('clicking Export PNG rasterizes the schedule into the preview img', () => {
    const { sched, bar } = build();
    const toolbar = mountRasterExportToolbar(bar, sched, { download: false });
    cleanup.push(toolbar);

    const img = toolbar.el.querySelector('.jects-scheduler-raster__preview-img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.alt).toBeTruthy();

    const pngBtn = toolbar.el.querySelector('.jects-scheduler-raster__btn--png') as HTMLButtonElement;
    pngBtn.click();

    // Real Chromium canvas → a real PNG data URL (not the 1x1 fallback).
    expect(img.src.startsWith('data:image/png')).toBe(true);
    expect(img.src.length).toBeGreaterThan(200);

    // The status live region announced the result.
    const status = toolbar.el.querySelector('.jects-scheduler-raster__status') as HTMLElement;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('PNG ready');
  });

  it('clicking Export PDF produces a multi-page PDF and triggers a download', () => {
    const { sched, bar } = build();

    const downloads: string[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {
          downloads.push((el as HTMLAnchorElement).download);
        });
      }
      return el;
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const toolbar = mountRasterExportToolbar(bar, sched, { pdf: { fileName: 'sprint' } });
    cleanup.push(toolbar);

    const pdfBtn = toolbar.el.querySelector('.jects-scheduler-raster__btn--pdf') as HTMLButtonElement;
    const result = toolbar.exportPdf();
    pdfBtn.click();

    expect(result.type).toBe('application/pdf');
    expect(result.pageCount).toBeGreaterThan(1); // 90-day range paginates
    expect(result.bytes.length).toBeGreaterThan(100);

    // The PDF is structurally valid.
    const text = new TextDecoder('latin1').decode(result.bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);

    // The button-driven export triggered a download with the right name.
    expect(downloads).toContain('sprint.pdf');
  });

  it('exports directly through SchedulerExporter against the live widget', () => {
    const { sched } = build();
    const exporter = new SchedulerExporter(sched);
    const model = exporter.model();
    // Both lanes' events were captured into the painted model.
    expect(model.bars.length).toBeGreaterThanOrEqual(2);
    expect(model.rows).toHaveLength(2);
    const png = exporter.exportPng();
    expect(png.type).toBe('image/png');
    expect(png.dataUrl().startsWith('data:image/png')).toBe(true);
  });
});
