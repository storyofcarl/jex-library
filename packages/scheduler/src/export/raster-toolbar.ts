/**
 * Scheduler export — themed, accessible PDF / PNG export toolbar.
 *
 * A standalone, framework-free UI surface that wraps {@link SchedulerExporter}'s
 * `exportPdf` / `exportPng` and renders an accessible toolbar (two buttons +
 * an optional live PNG preview) for the docs shell, the customizer, and the
 * browser a11y/visual smoke test. It is purely additive — it never touches the
 * main `Scheduler` class; it reads only the public {@link ExportableScheduler}
 * seam and triggers downloads through {@link triggerDownload}.
 *
 * Token-pure: all styling lives in `raster-toolbar.css` (`@layer
 * jects.components`, only `--jects-*` tokens).
 */

import { SchedulerExporter, triggerDownload, type ExportableScheduler } from './exporter.js';
import type { ExportResult, PdfExportConfig, PngExportConfig } from './config.js';

/** Options for {@link mountRasterExportToolbar}. */
export interface RasterToolbarOptions {
  /** Accessible label for the toolbar landmark. Default 'Export schedule'. */
  label?: string;
  /** Default PDF export config applied when the PDF button is pressed. */
  pdf?: PdfExportConfig;
  /** Default PNG export config applied when the PNG button is pressed. */
  png?: PngExportConfig;
  /** Render a live PNG preview `<img>` under the toolbar. Default true. */
  preview?: boolean;
  /** Fired after either export completes (post-download). */
  onExport?: (result: ExportResult, format: 'pdf' | 'png') => void;
  /**
   * Trigger a browser download when a button is pressed. Default true. When
   * false the toolbar still produces the {@link ExportResult} (and the preview)
   * but does not initiate a download — handy for embedding.
   */
  download?: boolean;
}

/** The mounted toolbar handle (call `destroy()` to remove + unbind). */
export interface RasterExportToolbar {
  /** The toolbar root element. */
  readonly el: HTMLElement;
  /** The exporter the toolbar drives (exposed for custom wiring). */
  readonly exporter: SchedulerExporter;
  /** Programmatically run the PDF export (same path as the button). */
  exportPdf(config?: PdfExportConfig): ExportResult;
  /** Programmatically run the PNG export (same path as the button). */
  exportPng(config?: PngExportConfig): ExportResult;
  /** Remove the toolbar from the DOM and dispose listeners. */
  destroy(): void;
}

const ROOT_CLASS = 'jects-scheduler-export';
const BLOCK = 'jects-scheduler-raster';

/**
 * Mount an accessible PDF/PNG export toolbar into `host`, driving the given
 * scheduler's exporter. Returns a handle whose `destroy()` cleans everything up.
 */
export function mountRasterExportToolbar(
  host: HTMLElement,
  scheduler: ExportableScheduler,
  options: RasterToolbarOptions = {},
): RasterExportToolbar {
  const exporter = new SchedulerExporter(scheduler);
  const wantDownload = options.download !== false;
  const wantPreview = options.preview !== false;

  const root = document.createElement('div');
  root.className = `${ROOT_CLASS} ${BLOCK}`;

  const toolbar = document.createElement('div');
  toolbar.className = `${ROOT_CLASS}__toolbar ${BLOCK}__toolbar`;
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', options.label ?? 'Export schedule');

  const pdfBtn = makeButton('Export PDF', `${BLOCK}__btn--pdf`);
  const pngBtn = makeButton('Export PNG', `${BLOCK}__btn--png`);
  toolbar.append(pdfBtn, pngBtn);

  // A live region announces the result (page count / file name) to AT.
  const status = document.createElement('p');
  status.className = `${BLOCK}__status`;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  root.append(toolbar, status);

  let previewImg: HTMLImageElement | undefined;
  if (wantPreview) {
    const region = document.createElement('figure');
    region.className = `${BLOCK}__preview`;
    region.setAttribute('role', 'group');
    region.setAttribute('aria-label', 'Export preview');
    previewImg = document.createElement('img');
    previewImg.className = `${BLOCK}__preview-img`;
    previewImg.alt = 'PNG preview of the exported schedule';
    region.appendChild(previewImg);
    root.appendChild(region);
  }

  function runPdf(config?: PdfExportConfig): ExportResult {
    const result = exporter.exportPdf({ ...options.pdf, ...config });
    announce(status, result, 'PDF');
    if (wantDownload && result.bytes.length > 0) triggerDownload(result);
    options.onExport?.(result, 'pdf');
    return result;
  }

  function runPng(config?: PngExportConfig): ExportResult {
    const result = exporter.exportPng({ ...options.png, ...config });
    announce(status, result, 'PNG');
    if (previewImg && result.bytes.length > 0) previewImg.src = result.dataUrl();
    if (wantDownload && result.bytes.length > 0) triggerDownload(result);
    options.onExport?.(result, 'png');
    return result;
  }

  const onPdf = (): void => void runPdf();
  const onPng = (): void => void runPng();
  pdfBtn.addEventListener('click', onPdf);
  pngBtn.addEventListener('click', onPng);

  host.appendChild(root);

  return {
    el: root,
    exporter,
    exportPdf: runPdf,
    exportPng: runPng,
    destroy() {
      pdfBtn.removeEventListener('click', onPdf);
      pngBtn.removeEventListener('click', onPng);
      root.remove();
    },
  };
}

function makeButton(label: string, modifier: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `${ROOT_CLASS}__btn ${BLOCK}__btn ${modifier}`;
  btn.textContent = label;
  return btn;
}

function announce(el: HTMLElement, result: ExportResult, kind: string): void {
  if (result.bytes.length === 0) {
    el.textContent = `${kind} export cancelled.`;
    return;
  }
  const pages = result.pageCount === 1 ? '1 page' : `${result.pageCount} pages`;
  el.textContent = `${kind} ready: ${result.fileName} (${pages}).`;
}
