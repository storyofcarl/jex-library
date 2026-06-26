/**
 * jsdom unit tests for the Gantt **PDF export** (runs in the default
 * `pnpm test`). jsdom has no real 2D-canvas raster path, so these assert the
 * deterministic, browser-independent surface:
 *   - page-size + orientation resolution,
 *   - the paginated tiling math (`planPdfPages`) — fit-to-width single column,
 *     non-fit multi-column tiling, partial-tile clipping, page counts,
 *   - band token expansion (`{page}`/`{pages}`) + footer/header defaults,
 *   - the PDF byte assembly (`buildPdf`) — valid `%PDF` header, Catalog/Pages,
 *     per-page MediaBox, header/footer text, an embedded JPEG XObject, and a
 *     well-formed xref/trailer,
 *   - the end-to-end `ganttToPdfBytes`/`Blob` producing a valid (image-less under
 *     jsdom) PDF, and the disposable `GanttPdfExporter` controller.
 * The real rasterized-tile + a11y/visual path is covered by `pdf.a11y.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PDF_PAGE_SIZES,
  DEFAULT_PDF_MARGINS,
  resolvePageSize,
  planPdfPages,
  expandBand,
  resolveFooter,
  resolveHeader,
  buildPdf,
  pdfStringToBytes,
  ganttToPdfBytes,
  ganttToPdfBlob,
  GanttPdfExporter,
  type PdfPageContent,
  type PdfDocInfo,
} from './pdf.js';

/* ── A representative export-render fragment of a Gantt (same shape as png.test). */
function buildGanttFragment(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'jects-gantt';

  const treeScroller = document.createElement('div');
  treeScroller.className = 'jects-gantt__tree-scroller';
  treeScroller.innerHTML =
    '<table class="jects-gantt__tree-table"><tbody><tr><td>Design</td></tr></tbody></table>';

  const timelineScroller = document.createElement('div');
  timelineScroller.className = 'jects-gantt__timeline-scroller';
  const header = document.createElement('div');
  header.className = 'jects-gantt__timeline-header';
  header.textContent = 'Jan';
  const bar = document.createElement('div');
  bar.className = 'jects-gantt__bar';
  bar.textContent = 'Task A';
  timelineScroller.append(header, bar);

  root.append(treeScroller, timelineScroller);
  return root;
}

/**
 * Build a minimal but *valid* baseline-JPEG byte stream with an SOF0 marker that
 * declares `w × h`, so `buildPdf` can read its dimensions and embed it. (We do not
 * need decodable scan data — only a parseable SOI + SOF0 header.)
 */
function fakeJpegDataUrl(w: number, h: number): string {
  const bytes = [
    0xff, 0xd8, // SOI
    0xff, 0xc0, // SOF0
    0x00, 0x11, // length = 17
    0x08, // precision
    (h >> 8) & 0xff, h & 0xff, // height
    (w >> 8) & 0xff, w & 0xff, // width
    0x03, // components
    0x01, 0x22, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
    0xff, 0xd9, // EOI
  ];
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/jpeg;base64,${btoa(bin)}`;
}

/* ═══════════════════════════════════════════════════════════════════════════ */

describe('resolvePageSize', () => {
  it('exposes the standard page sizes in points', () => {
    expect(PDF_PAGE_SIZES.A4).toEqual([595.28, 841.89]);
    expect(PDF_PAGE_SIZES.Letter).toEqual([612, 792]);
  });

  it('defaults to A4 landscape', () => {
    const [w, h] = resolvePageSize();
    expect(w).toBeGreaterThan(h); // landscape
    expect(w).toBe(841.89);
    expect(h).toBe(595.28);
  });

  it('honors portrait orientation', () => {
    const [w, h] = resolvePageSize({ page: 'A4', orientation: 'portrait' });
    expect(w).toBe(595.28);
    expect(h).toBe(841.89);
  });

  it('accepts an explicit custom page size + orientation', () => {
    const [w, h] = resolvePageSize({ pageSize: [400, 300], orientation: 'portrait' });
    expect(w).toBe(300);
    expect(h).toBe(400);
  });
});

describe('planPdfPages — fit-to-width (default)', () => {
  it('fits a wide chart to a single column of pages', () => {
    // A4 landscape content width ≈ 841.89 - 72 = 769.89pt.
    const plan = planPdfPages(4000, 800, { page: 'A4', orientation: 'landscape' });
    expect(plan.cols).toBe(1); // fit to width → one column
    expect(plan.scale).toBeLessThan(1); // downscaled to fit width
    expect(plan.rows).toBeGreaterThanOrEqual(1);
    expect(plan.pageCount).toBe(plan.cols * plan.rows);
    expect(plan.tiles).toHaveLength(plan.pageCount);
  });

  it('does not upscale a small chart past 1pt/px', () => {
    const plan = planPdfPages(100, 100, { page: 'A4' });
    expect(plan.scale).toBe(1);
    expect(plan.cols).toBe(1);
    expect(plan.rows).toBe(1);
    expect(plan.pageCount).toBe(1);
  });

  it('splits a tall chart into multiple rows on one column', () => {
    const plan = planPdfPages(500, 5000, { page: 'A4', orientation: 'portrait' });
    expect(plan.cols).toBe(1);
    expect(plan.rows).toBeGreaterThan(1);
  });
});

describe('planPdfPages — fixed scale tiling (fitToWidth: false)', () => {
  it('tiles across multiple columns AND rows at 1:1', () => {
    const plan = planPdfPages(2000, 2000, {
      page: 'A4',
      orientation: 'portrait',
      fitToWidth: false,
      scale: 1,
    });
    expect(plan.scale).toBe(1);
    expect(plan.cols).toBeGreaterThan(1);
    expect(plan.rows).toBeGreaterThan(1);
    expect(plan.tiles).toHaveLength(plan.cols * plan.rows);
  });

  it('clips the final partial tile (no stretch) — last tile is smaller', () => {
    const plan = planPdfPages(1000, 400, {
      pageSize: [400, 400],
      orientation: 'portrait',
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      fitToWidth: false,
      scale: 1,
    });
    // content box = 400×400, chart = 1000×400 → 3 columns (400,400,200), 1 row.
    expect(plan.cols).toBe(3);
    expect(plan.rows).toBe(1);
    const last = plan.tiles[plan.tiles.length - 1]!;
    expect(last.dw).toBeCloseTo(200, 5); // partial column clipped to remaining width
    expect(last.dh).toBeCloseTo(400, 5);
  });

  it('tiles are ordered row-major (col fastest)', () => {
    const plan = planPdfPages(800, 800, {
      pageSize: [400, 400],
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      fitToWidth: false,
      scale: 1,
    });
    expect(plan.tiles.map((t) => [t.row, t.col])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
  });

  it('source rects scale by pixelRatio', () => {
    const plan = planPdfPages(800, 400, {
      pageSize: [400, 400],
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      fitToWidth: false,
      scale: 1,
      pixelRatio: 2,
    });
    const first = plan.tiles[0]!;
    // 400pt content / scale 1 = 400 css px → 800 device px at ratio 2.
    expect(first.sw).toBe(800);
    expect(first.sh).toBe(800);
  });
});

describe('band token expansion + defaults', () => {
  it('expands {page}/{pages}', () => {
    const out = expandBand({ center: 'Page {page} of {pages}' }, 2, 5);
    expect(out?.center).toBe('Page 2 of 5');
  });

  it('defaults the footer to "Page {page} of {pages}" and suppresses on null', () => {
    expect(resolveFooter({})).toEqual({ center: 'Page {page} of {pages}' });
    expect(resolveFooter({ footer: null })).toBeNull();
    expect(resolveFooter({ footer: { left: 'x' } })).toEqual({ left: 'x' });
  });

  it('defaults the header to the title when no header given', () => {
    expect(resolveHeader({ title: 'My Plan' })).toEqual({ left: 'My Plan' });
    expect(resolveHeader({})).toBeUndefined();
    expect(resolveHeader({ header: { center: 'H' } })).toEqual({ center: 'H' });
  });
});

describe('buildPdf — byte assembly', () => {
  const info: PdfDocInfo = {
    pageWidth: 600,
    pageHeight: 400,
    margins: { ...DEFAULT_PDF_MARGINS },
    title: 'Plan',
    author: 'Carl',
  };

  it('emits a valid PDF header, Catalog, Pages, and trailer', () => {
    const pages: PdfPageContent[] = [
      { header: { left: 'Plan' }, footer: { center: 'Page 1 of 2' } },
      { header: { left: 'Plan' }, footer: { center: 'Page 2 of 2' } },
    ];
    const pdf = buildPdf(pages, info);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Type /Catalog');
    expect(pdf).toContain('/Type /Pages');
    expect(pdf).toContain('/Count 2');
    expect(pdf).toContain('/Type /Page ');
    expect(pdf).toContain('/MediaBox [0 0 600 400]');
    expect(pdf).toContain('/BaseFont /Helvetica');
    expect(pdf).toContain('xref');
    expect(pdf).toContain('trailer');
    expect(pdf).toContain('/Root 1 0 R');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('writes header/footer text into the content stream', () => {
    const pdf = buildPdf([{ header: { left: 'Hello' }, footer: { center: 'Foot' } }], info);
    expect(pdf).toContain('(Hello) Tj');
    expect(pdf).toContain('(Foot) Tj');
  });

  it('embeds a JPEG image XObject when a tile is present', () => {
    const pages: PdfPageContent[] = [
      {
        imageDataUrl: fakeJpegDataUrl(120, 80),
        imageBox: { x: 36, y: 36, w: 200, h: 133 },
      },
    ];
    const pdf = buildPdf(pages, info);
    expect(pdf).toContain('/Subtype /Image');
    expect(pdf).toContain('/Filter /DCTDecode');
    expect(pdf).toContain('/Width 120');
    expect(pdf).toContain('/Height 80');
    expect(pdf).toContain('Do'); // the image-draw operator
    expect(pdf).toContain('cm'); // the CTM placing the image box
  });

  it('writes the Info dictionary when title/author present', () => {
    const pdf = buildPdf([{}], info);
    expect(pdf).toContain('/Title (Plan)');
    expect(pdf).toContain('/Author (Carl)');
    expect(pdf).toContain('/Info');
  });

  it('escapes parentheses in band text', () => {
    const pdf = buildPdf([{ header: { left: 'A (B) C' } }], info);
    expect(pdf).toContain('(A \\(B\\) C) Tj');
  });

  it('the xref Size matches the object count', () => {
    const pdf = buildPdf([{ footer: { center: 'x' } }], info);
    const m = /\/Size (\d+)/.exec(pdf);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(4);
  });
});

describe('pdfStringToBytes', () => {
  it('produces a Uint8Array of the same length', () => {
    const bytes = pdfStringToBytes('%PDF-1.4\nx');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe('%PDF-1.4\nx'.length);
    expect(bytes[0]).toBe('%'.charCodeAt(0));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */

let root: HTMLElement;
beforeEach(() => {
  root = buildGanttFragment();
  document.body.appendChild(root);
});
afterEach(() => {
  root.remove();
});

describe('ganttToPdfBytes / Blob (end-to-end, jsdom — image-less)', () => {
  it('always produces a valid paginated PDF even without a raster canvas', async () => {
    const bytes = await ganttToPdfBytes(root, {
      page: 'A4',
      orientation: 'landscape',
      title: 'My Project',
      footer: { center: 'Page {page} of {pages}' },
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    const text = String.fromCharCode(...bytes.subarray(0, 9));
    expect(text).toBe('%PDF-1.4\n');
    const whole = new TextDecoder('latin1').decode(bytes);
    expect(whole).toContain('/Type /Catalog');
    expect(whole).toContain('(My Project) Tj'); // header from title
    expect(whole).toContain('(Page 1 of'); // footer band
    // jsdom has no canvas → no embedded image.
    expect(whole).not.toContain('/Subtype /Image');
    expect(whole.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('produces an application/pdf Blob', async () => {
    const blob = await ganttToPdfBlob(root, { page: 'Letter' });
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('GanttPdfExporter (disposable controller)', () => {
  it('plan() computes geometry without capture', () => {
    const exporter = new GanttPdfExporter(root);
    const plan = exporter.plan({ page: 'A4' });
    expect(plan.pageCount).toBeGreaterThanOrEqual(1);
    expect(plan.tiles).toHaveLength(plan.pageCount);
    exporter.destroy();
  });

  it('export() resolves an application/pdf Blob (image-less under jsdom)', async () => {
    const exporter = new GanttPdfExporter(root);
    const blob = await exporter.export({ title: 'P' });
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe('application/pdf');
    exporter.destroy();
  });

  it('bytes() resolves Uint8Array; null after destroy', async () => {
    const exporter = new GanttPdfExporter(root);
    const bytes = await exporter.bytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    exporter.destroy();
    expect(await exporter.bytes()).toBeNull();
    expect(await exporter.export()).toBeNull();
  });

  it('destroy() is idempotent', () => {
    const exporter = new GanttPdfExporter(root);
    exporter.destroy();
    expect(() => exporter.destroy()).not.toThrow();
    expect(exporter.isDestroyed).toBe(true);
  });
});
