/**
 * PdfExportFeature — real-Chromium a11y + visual/interaction test.
 *
 * Mounts a real Grid, installs the PdfExportFeature, and:
 *   - renders the print-to-PDF HTML into a live container and asserts axe-core
 *     finds zero serious/critical violations (Q2 bar) — the printed table is a
 *     proper semantic <table> with a <thead> header row,
 *   - verifies the on-theme print document paints the visible columns + current
 *     view across the paginated page sections,
 *   - exercises the real downloadPdf() side effect (anchor click) and asserts a
 *     genuine application/pdf blob is produced,
 *   - verifies the direct PDF builder emits a structurally valid document.
 */
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import '@jects/theme/style.css';
import '@jects/widgets/style.css';
import '../styles.css';
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { PdfExportFeature } from './export-pdf.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

interface Row {
  id: number;
  name: string;
  email: string;
  role: string;
}

const columns: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', id: 'name', width: 160 },
  { field: 'email', header: 'Email', id: 'email', width: 220 },
  { field: 'role', header: 'Role', id: 'role', width: 120 },
  { field: 'id', header: 'ID', id: 'id', hidden: true }, // hidden → excluded
];

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `Name ${i}`,
    email: `user${i}@example.com`,
    role: i % 2 === 0 ? 'admin' : 'user',
  }));
}

let host: HTMLElement;
let preview: HTMLElement;
let grid: Grid<Row>;
let pdf: PdfExportFeature<Row>;

beforeEach(() => {
  host = document.createElement('div');
  host.style.cssText = 'width:700px;height:320px;position:absolute;top:0;left:0';
  document.body.appendChild(host);

  // A live container where we mount the generated print HTML so axe can audit it.
  preview = document.createElement('div');
  document.body.appendChild(preview);

  grid = new Grid<Row>(host, { data: rows(25), columns, rowHeight: 32 });
  pdf = grid.use(new PdfExportFeature<Row>({ rowsPerPage: 10, title: 'Team Roster' })) as PdfExportFeature<Row>;
});

afterEach(() => {
  grid.destroy();
  host.remove();
  preview.remove();
});

describe('PdfExportFeature (Chromium)', () => {
  it('print HTML is an accessible, semantic table (axe clean)', async () => {
    // Render the print document body into the live preview container.
    const html = pdf.toPdfHtml();
    const bodyHtml = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>'));
    preview.innerHTML = bodyHtml.replace(/^<body[^>]*>/, '');

    // Semantic structure: real tables with header rows.
    const tables = preview.querySelectorAll('table.jects-grid-pdf__table');
    expect(tables.length).toBe(3); // 25 rows / 10 per page → 3 pages
    const firstHead = tables[0]!.querySelector('thead tr');
    expect(firstHead).toBeTruthy();
    expect(Array.from(firstHead!.querySelectorAll('th')).map((t) => t.textContent)).toEqual([
      'Name',
      'Email',
      'Role',
    ]);

    await expectNoA11yViolations(preview);
  });

  it('print document reflects visible columns + current (filtered) view', () => {
    grid.store.filter((r: Row) => r.role === 'admin');
    const html = pdf.toPdfHtml();
    // Hidden ID column excluded; admin rows kept, user rows dropped.
    expect(html).not.toContain('<th>ID</th>');
    expect(html).toContain('<th>Name</th>');
    expect(html).toContain('user0@example.com'); // id 0 → admin
    expect(html).not.toContain('user1@example.com'); // id 1 → user → filtered
  });

  it('downloadPdf produces a real application/pdf blob and clicks an anchor', () => {
    const clickSpy = vi.fn();
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = clickSpy;
    const blobs: Blob[] = [];
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:mock';
    }) as typeof URL.createObjectURL;

    pdf.downloadPdf('roster');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(blobs[0]!.type).toBe('application/pdf');
    expect(blobs[0]!.size).toBeGreaterThan(200);

    HTMLAnchorElement.prototype.click = realClick;
    URL.createObjectURL = realCreate;
  });

  it('direct PDF builder emits a valid 3-page document', () => {
    const bytes = pdf.toPdf();
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s).toContain('/Type /Pages /Count 3');
    expect(s).toContain('(Team Roster)');
    expect(s.includes('%%EOF')).toBe(true);
  });
});
