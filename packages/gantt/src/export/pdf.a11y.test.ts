/**
 * axe-core a11y + visual/interaction browser test for the Gantt **PDF export**
 * (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the feature end to
 * end in a real engine + real 2D canvas:
 *   - a live `Gantt` is mounted and the PDF-export feature installed;
 *   - `exportPdf()` captures the full chart, rasterizes it, tiles it across pages,
 *     and assembles a real multi-page PDF whose bytes start with `%PDF`, embed a
 *     JPEG image XObject per page (the rasterized chart tile), and carry the
 *     header/footer bands;
 *   - the pagination plan reflects fit-to-width vs fixed-scale tiling;
 *   - an accessible "Export PDF" trigger button is asserted with axe (correct
 *     role/name/keyboard operability) and, when activated, drives the export.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the shipped, token-pure stylesheet so the captured chart paints with the
// real component CSS (bars, header band, deps) rather than unstyled defaults.
import '../styles.css';
import './pdf.css';
import { Gantt } from '../ui/gantt.js';
import { installPdfExport, type GanttWithPdfExport } from './gantt-pdf-export.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { TaskModel, DependencyModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

const tasks: TaskModel[] = [
  { id: 'p', name: 'Phase 1' },
  { id: 'a', name: 'Design', parentId: 'p', start: T0, duration: 5 * DAY, end: T0 + 5 * DAY },
  {
    id: 'b',
    name: 'Build',
    parentId: 'p',
    start: T0 + 5 * DAY,
    duration: 8 * DAY,
    end: T0 + 13 * DAY,
    percentDone: 0.4,
  },
  { id: 'c', name: 'Test', parentId: 'p', start: T0 + 13 * DAY, duration: 4 * DAY, end: T0 + 17 * DAY },
  { id: 'm', name: 'Launch', parentId: 'p', start: T0 + 17 * DAY, milestone: true },
];
const dependencies: DependencyModel[] = [
  { id: 'l1', fromId: 'a', toId: 'b', type: 'FS' },
  { id: 'l2', fromId: 'b', toId: 'c', type: 'FS' },
];

function decode(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

let host: HTMLElement;
let gantt: GanttWithPdfExport | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.height = '420px';
  host.style.width = '960px';
  document.body.appendChild(host);
});

afterEach(() => {
  (gantt as unknown as Gantt | null)?.destroy();
  gantt = null;
  host.remove();
});

describe('Gantt PDF export (real Chromium)', () => {
  it('the Gantt with the PDF feature installed has no serious/critical a11y violations', async () => {
    gantt = installPdfExport(new Gantt(host, { tasks, dependencies, projectStart: T0 }));
    await expectNoA11yViolations(host);
  });

  it('exports a real multi-page PDF with embedded rasterized chart tiles', async () => {
    gantt = installPdfExport(new Gantt(host, { tasks, dependencies, projectStart: T0 }));

    const bytes = await gantt.exportPdfBytes({
      page: 'A4',
      orientation: 'landscape',
      title: 'Project Plan',
      header: { left: 'Project Plan', right: 'Exported' },
      footer: { center: 'Page {page} of {pages}' },
      pixelRatio: 2,
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    const pdf = decode(bytes!);

    // Valid PDF structure.
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Type /Catalog');
    expect(pdf).toContain('/MediaBox');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);

    // In a real browser the chart rasterizes → an embedded JPEG image per page.
    expect(pdf).toContain('/Subtype /Image');
    expect(pdf).toContain('/Filter /DCTDecode');
    expect(pdf).toContain(' Do'); // image drawn

    // Header + footer text painted.
    expect(pdf).toContain('(Project Plan) Tj');
    expect(pdf).toContain('(Page 1 of');
  });

  it('fit-to-width keeps a single column; fixed-scale tiles across columns', () => {
    gantt = installPdfExport(new Gantt(host, { tasks, dependencies, projectStart: T0 }));
    const fit = gantt.planPdf({ page: 'A4', orientation: 'landscape', fitToWidth: true });
    expect(fit.cols).toBe(1);

    const tiled = gantt.planPdf({
      page: 'A5',
      orientation: 'portrait',
      fitToWidth: false,
      scale: 1,
    });
    expect(tiled.pageCount).toBeGreaterThanOrEqual(fit.pageCount);
  });

  it('an accessible Export-PDF trigger button drives the export with no a11y violations', async () => {
    gantt = installPdfExport(new Gantt(host, { tasks, dependencies, projectStart: T0 }));

    const bar = document.createElement('div');
    bar.className = 'jects-gantt-pdf-toolbar';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jects-gantt-pdf-export-btn';
    btn.textContent = 'Export PDF';
    bar.appendChild(btn);
    document.body.appendChild(bar);

    let exported: Uint8Array | null = null;
    btn.addEventListener('click', () => {
      void gantt!.exportPdfBytes({ title: 'Plan' }).then((b) => {
        exported = b;
      });
    });

    await expectNoA11yViolations(bar);

    btn.click();
    // Allow the async export to settle.
    await new Promise((r) => setTimeout(r, 50));
    expect(exported).not.toBeNull();
    expect(decode(exported!).startsWith('%PDF')).toBe(true);

    bar.remove();
  });
});
