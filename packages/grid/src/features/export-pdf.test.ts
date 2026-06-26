/** jsdom unit tests for PdfExportFeature (direct PDF builder + print HTML). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ColumnDef } from '../contract.js';
import { PdfExportFeature, pdfExportFeature } from './export-pdf.js';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';

interface Row {
  id: number;
  name: string;
  amount: number;
  joined: Date;
}

const ROWS: Row[] = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  name: `Person ${i + 1}`,
  amount: (i + 1) * 10,
  joined: new Date(2020, 0, i + 1),
}));

const COLUMNS: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', width: 160 },
  { field: 'amount', header: 'Amount', type: 'number', width: 80 },
  { field: 'joined', header: 'Joined', type: 'date', width: 120 },
  { field: 'id', header: 'ID', hidden: true }, // hidden → excluded
];

/** Decode the PDF bytes back to a Latin-1 string for assertions. */
function decode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

let h: FeatureHarness<Row>;
beforeEach(() => {
  h = makeHarness<Row>({ store: makeStore(ROWS), columns: COLUMNS });
});
afterEach(() => h.destroy());

function install(opts?: ConstructorParameters<typeof PdfExportFeature<Row>>[0]): PdfExportFeature<Row> {
  return h.api.use(new PdfExportFeature<Row>(opts)) as PdfExportFeature<Row>;
}

describe('PdfExportFeature — direct PDF builder (jsdom)', () => {
  it('emits a structurally valid PDF document', () => {
    const f = install();
    const bytes = f.toPdf();
    expect(bytes).toBeInstanceOf(Uint8Array);
    const pdf = decode(bytes);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.includes('%%EOF')).toBe(true);
    expect(pdf).toContain('/Type /Catalog');
    expect(pdf).toContain('/Type /Pages');
    expect(pdf).toContain('xref');
    expect(pdf).toContain('startxref');
    expect(pdf).toContain('/BaseFont /Helvetica');
  });

  it('xref offsets and Length values are byte-accurate', () => {
    const f = install();
    const pdf = decode(f.toPdf());

    // The startxref pointer must point exactly at the "xref" keyword.
    const m = pdf.match(/startxref\n(\d+)\n%%EOF/);
    expect(m).toBeTruthy();
    const xrefOffset = Number(m![1]);
    expect(pdf.slice(xrefOffset, xrefOffset + 4)).toBe('xref');

    // Every /Length must equal the real byte count of its stream payload.
    const re = /\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g;
    let mm: RegExpExecArray | null;
    let count = 0;
    while ((mm = re.exec(pdf)) !== null) {
      expect(mm[2]!.length).toBe(Number(mm[1]));
      count++;
    }
    expect(count).toBeGreaterThan(0);
  });

  it('includes header labels and cell text in the content stream', () => {
    const f = install();
    const pdf = decode(f.toPdf());
    expect(pdf).toContain('(Name)');
    expect(pdf).toContain('(Amount)');
    // First data row value.
    expect(pdf).toContain('(Person 1)');
    // Hidden column header must NOT appear.
    expect(pdf).not.toContain('(ID)');
  });

  it('paginates by rowsPerPage and renders "Page N of M"', () => {
    const f = install({ rowsPerPage: 10 });
    const pdf = decode(f.toPdf());
    // 25 rows / 10 per page → 3 pages.
    expect(pdf).toContain('(Page 1 of 3)');
    expect(pdf).toContain('(Page 2 of 3)');
    expect(pdf).toContain('(Page 3 of 3)');
    expect((pdf.match(/\/Type \/Page[^s]/g) ?? []).length).toBe(3);
    // Pages dictionary reports the same count.
    expect(pdf).toContain('/Type /Pages /Count 3');
  });

  it('repeats the header row on every page', () => {
    const f = install({ rowsPerPage: 10, title: 'Roster' });
    const pdf = decode(f.toPdf());
    // Header label "Name" appears once per page (3×).
    expect((pdf.match(/\(Name\)/g) ?? []).length).toBe(3);
  });

  it('honours the current (filtered) view', () => {
    const f = install();
    h.api.store.filter((r: Row) => r.amount >= 200);
    const pdf = decode(f.toPdf());
    expect(pdf).not.toContain('(Person 1)'); // amount 10 → filtered out
    expect(pdf).toContain('(Person 20)'); // amount 200 → kept
  });

  it('applies a custom formatValue', () => {
    const f = install({
      formatValue: (v, col) => (col.field === 'amount' ? `USD ${v}` : String(v ?? '')),
    });
    const pdf = decode(f.toPdf());
    expect(pdf).toContain('(USD 10)');
  });

  it('produces a valid single page for an empty view', () => {
    const empty = makeHarness<Row>({ store: makeStore<Row>([]), columns: COLUMNS });
    const f = empty.api.use(new PdfExportFeature<Row>()) as PdfExportFeature<Row>;
    const pdf = decode(f.toPdf());
    expect(pdf).toContain('/Type /Pages /Count 1');
    expect(pdf.includes('%%EOF')).toBe(true);
    empty.destroy();
  });

  it('respects orientation + paper size in the MediaBox', () => {
    const portrait = install({ orientation: 'portrait', paperSize: 'a4' });
    const land = install({ orientation: 'landscape', paperSize: 'a4' });
    // A4 portrait ≈ 595×841; landscape swaps to 841×595.
    expect(decode(portrait.toPdf())).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(decode(land.toPdf())).toContain('/MediaBox [0 0 841.89 595.28]');
  });

  it('escapes parentheses/backslashes safely in cell text', () => {
    const tricky: Row[] = [
      { id: 1, name: 'Acme (Pty) \\ Ltd', amount: 5, joined: new Date(2021, 1, 1) },
    ];
    const hh = makeHarness<Row>({ store: makeStore(tricky), columns: COLUMNS });
    const f = hh.api.use(new PdfExportFeature<Row>()) as PdfExportFeature<Row>;
    const pdf = decode(f.toPdf());
    expect(pdf).toContain('Acme \\(Pty\\) \\\\ Ltd');
    // Still byte-accurate after escaping.
    const re = /\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(pdf)) !== null) {
      expect(mm[2]!.length).toBe(Number(mm[1]));
    }
    hh.destroy();
  });

  it('toPdfBlob yields an application/pdf blob', () => {
    const f = install();
    const blob = f.toPdfBlob();
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('downloadPdf creates and clicks a .pdf anchor', () => {
    const f = install({ fileName: 'roster' });
    const created: HTMLAnchorElement[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag) as HTMLElement;
      if (tag === 'a') created.push(el as HTMLAnchorElement);
      return el as never;
    });
    const clickSpy = vi.fn();
    // @ts-expect-error jsdom stub
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    // @ts-expect-error jsdom stub
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = clickSpy;

    f.downloadPdf();
    expect(created.length).toBe(1);
    expect(created[0]!.download).toBe('roster.pdf');
    expect(clickSpy).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('PdfExportFeature — print-to-PDF HTML (jsdom)', () => {
  it('builds a paginated print document with @page + repeating thead', () => {
    const f = install({ rowsPerPage: 10, title: 'Roster' });
    const html = f.toPdfHtml();
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('@page');
    expect(html).toContain('jects-grid-pdf__table');
    // thead repeats on each printed page section (3 pages).
    expect((html.match(/<thead>/g) ?? []).length).toBe(3);
    expect((html.match(/jects-grid-pdf__page/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // Page breaks between pages (2 between 3 pages) — count the applied class on
    // <section> elements, not the CSS rule definition in <style>.
    const body = html.slice(html.indexOf('</style>'));
    expect((body.match(/jects-grid-pdf__page--break/g) ?? []).length).toBe(2);
    expect(html).toContain('Page 1 of 3');
  });

  it('escapes HTML in headers and cells', () => {
    const evil: Row[] = [
      { id: 1, name: '<script>x</script>', amount: 1, joined: new Date(2021, 0, 1) },
    ];
    const hh = makeHarness<Row>({ store: makeStore(evil), columns: COLUMNS });
    const f = hh.api.use(new PdfExportFeature<Row>()) as PdfExportFeature<Row>;
    const html = f.toPdfHtml();
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>x</script>');
    hh.destroy();
  });

  it('print HTML CSS references only --jects-* tokens (token-pure)', () => {
    const f = install();
    const html = f.toPdfHtml();
    const style = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
    // Every oklch(...) in the print style must read a --jects-* token.
    const oklchCalls = style.match(/oklch\([^)]*\)/g) ?? [];
    expect(oklchCalls.length).toBeGreaterThan(0);
    for (const call of oklchCalls) {
      expect(call).toContain('var(--jects-');
    }
    // No hex / rgb / hsl color literals.
    expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(style).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
  });

  it('printPdf returns null when popups are blocked', () => {
    const f = install();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(f.printPdf()).toBeNull();
    openSpy.mockRestore();
  });
});

describe('PdfExportFeature — lifecycle', () => {
  it('factory builds an installable feature with the right name', () => {
    const f = pdfExportFeature<Row>();
    expect(f.name).toBe('exportPdf');
  });

  it('destroy is idempotent', () => {
    const f = install();
    expect(() => {
      f.destroy();
      f.destroy();
    }).not.toThrow();
  });
});
