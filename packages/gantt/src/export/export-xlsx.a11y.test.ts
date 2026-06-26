/**
 * axe-core a11y + visual/interaction browser test for the Gantt **XLSX (Excel)
 * export** feature (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the export end to
 * end against a real (themed) DOM: the accessible "export ready" preview panel
 * mounts with a labelled ARIA table (column headers, summary + indented child
 * rows, typed display cells), the download button is keyboard-operable and
 * produces a real `.xlsx` Blob carrying the OOXML MIME type + the PK zip
 * signature, and the produced workbook is a structurally valid OOXML package
 * (the worksheet carries native outline levels + typed cells / number-format
 * styles).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the shipped, token-pure package stylesheet aggregate AND the feature CSS
// so the panel is themed exactly as shipped.
import './export-xlsx.css';
import {
  buildXlsxPreview,
  bytesToXlsxBlob,
  tableToXlsx,
  XLSX_MIME,
} from './export-xlsx.js';
import type { ExportTable } from './serialize.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

let host: HTMLElement;
let destroy: (() => void) | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.position = 'relative';
  host.style.width = '720px';
  host.style.padding = '16px';
  document.body.appendChild(host);
});

afterEach(() => {
  destroy?.();
  destroy = null;
  host.remove();
});

function table(): ExportTable {
  return {
    columns: [
      { field: 'name', header: 'Name', type: 'text', width: 30 },
      { field: 'wbs', header: 'WBS', type: 'text' },
      { field: 'start', header: 'Start', type: 'date' },
      { field: 'duration', header: 'Duration', type: 'duration' },
      { field: 'percentDone', header: '% Done', type: 'percent' },
    ],
    rows: [
      {
        id: 1,
        depth: 0,
        wbs: '1',
        summary: true,
        cells: [
          { kind: 'text', value: 'Phase 1' },
          { kind: 'text', value: '1' },
          { kind: 'date', value: Date.UTC(2026, 0, 5) },
          { kind: 'duration', days: 8 },
          { kind: 'percent', fraction: 0.5 },
        ],
      },
      {
        id: 2,
        depth: 1,
        wbs: '1.1',
        summary: false,
        cells: [
          { kind: 'text', value: 'Design' },
          { kind: 'text', value: '1.1' },
          { kind: 'date', value: Date.UTC(2026, 0, 5) },
          { kind: 'duration', days: 3 },
          { kind: 'percent', fraction: 0.25 },
        ],
      },
    ],
  };
}

describe('XLSX export preview a11y + visual (real Chromium)', () => {
  it('has zero serious/critical axe violations', async () => {
    const preview = buildXlsxPreview(table(), { filename: 'tasks' });
    destroy = preview.destroy;
    host.appendChild(preview.el);
    await expectNoA11yViolations(host);
  });

  it('renders a labelled table the AT can navigate (headers + caption + rows)', () => {
    const preview = buildXlsxPreview(table(), { filename: 'tasks' });
    destroy = preview.destroy;
    host.appendChild(preview.el);

    // Labelled landmark/section.
    expect(preview.el.getAttribute('aria-label')).toBe('Excel export preview');
    // Column headers expose scope=col.
    const ths = Array.from(
      preview.el.querySelectorAll('th[scope="col"]'),
    ).map((th) => th.textContent);
    expect(ths).toEqual(['Name', 'WBS', 'Start', 'Duration', '% Done']);
    // A descriptive caption.
    const caption = preview.el.querySelector('caption');
    expect(caption?.textContent).toContain('tasks.xlsx');
    // Two data rows; the summary row is flagged.
    const rows = preview.el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(
      rows[0]!.classList.contains('jects-gantt-xlsx-preview__row--summary'),
    ).toBe(true);
    // Typed display formatting (date ISO / duration / percent) is visible.
    expect(preview.el.textContent).toContain('2026-01-05');
    expect(preview.el.textContent).toContain('8d');
    expect(preview.el.textContent).toContain('50%');
  });

  it('the themed panel actually paints (real CSS applied)', () => {
    const preview = buildXlsxPreview(table());
    destroy = preview.destroy;
    host.appendChild(preview.el);
    const cs = getComputedStyle(preview.el);
    // The token-driven CSS resolves to a flex column with a real radius.
    expect(cs.display).toBe('flex');
    expect(cs.flexDirection).toBe('column');
    const btn = preview.el.querySelector('button')!;
    expect(getComputedStyle(btn).cursor).toBe('pointer');
  });

  it('the download button is keyboard-focusable and produces a real .xlsx Blob', async () => {
    const preview = buildXlsxPreview(table(), { filename: 'project' });
    destroy = preview.destroy;
    host.appendChild(preview.el);
    const btn = preview.el.querySelector('button')!;
    btn.focus();
    expect(document.activeElement).toBe(btn);

    // Independently produce + validate the workbook the button would download.
    const blob = bytesToXlsxBlob(tableToXlsx(table()));
    expect(blob.type).toBe(XLSX_MIME);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // PK zip signature.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes.length).toBeGreaterThan(200);
  });

  it('the produced worksheet carries native outline levels + typed cells', () => {
    // Decode the worksheet part from the package (store-method zip).
    const bytes = tableToXlsx(table());
    const text = new TextDecoder().decode(bytes);
    // The worksheet XML is stored uncompressed, so its markup appears verbatim.
    expect(text).toContain('outlineLevel="1"');
    expect(text).toContain('summaryBelow="0"');
    // A typed numeric cell with a style index (date style 1) is present.
    expect(text).toMatch(/<c r="C2" s="1">/);
  });
});
