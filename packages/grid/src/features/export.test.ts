/** jsdom unit tests for ExportFeature (CSV / Excel-XML / print). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ColumnDef } from '../contract.js';
import { ExportFeature } from './export.js';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';

interface Row {
  id: number;
  name: string;
  amount: number;
}

const ROWS: Row[] = [
  { id: 1, name: 'Alice', amount: 100 },
  { id: 2, name: 'Bob, Jr', amount: 200 }, // contains a comma → must be quoted
  { id: 3, name: 'Quo"te', amount: 300 }, // contains a quote → must be escaped
];

const COLUMNS: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name' },
  { field: 'amount', header: 'Amount', type: 'number' },
  { field: 'id', header: 'ID', hidden: true }, // hidden → excluded
];

let h: FeatureHarness<Row>;
beforeEach(() => {
  h = makeHarness<Row>({ store: makeStore(ROWS), columns: COLUMNS });
});
afterEach(() => h.destroy());

describe('ExportFeature (jsdom)', () => {
  it('toCsv emits header + rows, excludes hidden columns', () => {
    const f = h.api.use(new ExportFeature<Row>()) as ExportFeature<Row>;
    const csv = f.toCsv();
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Name,Amount');
    expect(lines[1]).toBe('Alice,100');
    expect(lines).toHaveLength(4);
  });

  it('toCsv quotes fields with commas and escapes quotes', () => {
    const f = h.api.use(new ExportFeature<Row>()) as ExportFeature<Row>;
    const csv = f.toCsv();
    expect(csv).toContain('"Bob, Jr",200');
    expect(csv).toContain('"Quo""te",300');
  });

  it('toMatrix returns header + formatted rows', () => {
    const f = h.api.use(new ExportFeature<Row>()) as ExportFeature<Row>;
    const m = f.toMatrix();
    expect(m[0]).toEqual(['Name', 'Amount']);
    expect(m[1]).toEqual(['Alice', '100']);
  });

  it('respects filters / current view', () => {
    const f = h.api.use(new ExportFeature<Row>()) as ExportFeature<Row>;
    h.api.store.filter((r: Row) => r.amount >= 200);
    const csv = f.toCsv();
    expect(csv.split('\r\n')).toHaveLength(3); // header + 2 rows
    expect(csv).not.toContain('Alice');
  });

  it('toExcelXml produces a SpreadsheetML workbook with typed cells', () => {
    const f = h.api.use(new ExportFeature<Row>()) as ExportFeature<Row>;
    const xml = f.toExcelXml();
    expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(xml).toContain('<Workbook');
    expect(xml).toContain('ss:Type="Number">100<');
    expect(xml).toContain('ss:Type="String">Alice<');
    // Comma stays literal inside XML (no CSV quoting), but special chars escape.
    expect(xml).toContain('Quo&quot;te');
  });

  it('downloadCsv creates and clicks an anchor', () => {
    const f = h.api.use(new ExportFeature<Row>({ fileName: 'data' })) as ExportFeature<Row>;
    const created: HTMLAnchorElement[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag) as HTMLElement;
      if (tag === 'a') created.push(el as HTMLAnchorElement);
      return el as never;
    });
    const clickSpy = vi.fn();
    // @ts-expect-error jsdom: provide stub URL APIs
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    // @ts-expect-error jsdom: provide stub URL APIs
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = clickSpy;

    f.downloadCsv();
    expect(created.length).toBe(1);
    expect(created[0]!.download).toBe('data.csv');
    expect(clickSpy).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('custom formatValue is applied', () => {
    const f = h.api.use(
      new ExportFeature<Row>({
        formatValue: (v, col) => (col.field === 'amount' ? `$${v}` : String(v ?? '')),
      }),
    ) as ExportFeature<Row>;
    expect(f.toCsv()).toContain('Alice,$100');
  });

  it('toHtml builds a table', () => {
    const f = h.api.use(new ExportFeature<Row>()) as ExportFeature<Row>;
    const html = f.toHtml();
    expect(html).toContain('<table class="jects-grid-export">');
    expect(html).toContain('<th>Name</th>');
    expect(html).toContain('<td>Alice</td>');
  });

  describe('CSV formula-injection guard (default on)', () => {
    const evilRows: Row[] = [
      { id: 1, name: '=cmd|"/c calc"!A1', amount: 100 },
      { id: 2, name: '+1+1', amount: 200 },
      { id: 3, name: '@SUM(A1:A9)', amount: 300 },
      { id: 4, name: '-2+3+cmd', amount: 400 },
      { id: 5, name: '\tTabbed', amount: 500 },
    ];

    it('prefixes formula-trigger cells with an apostrophe in CSV', () => {
      const hh = makeHarness<Row>({ store: makeStore(evilRows), columns: COLUMNS });
      const f = hh.api.use(new ExportFeature<Row>()) as ExportFeature<Row>;
      const csv = f.toCsv();
      // Each dangerous value is neutralized (and still quoted if it contains a
      // delimiter/quote, but the apostrophe prefix must be present regardless).
      expect(csv).toContain(`'=cmd`);
      expect(csv).toContain(`'+1+1`);
      expect(csv).toContain(`'@SUM(A1:A9)`);
      expect(csv).toContain(`'-2+3+cmd`);
      expect(csv).toContain(`'\tTabbed`);
      // No raw formula remains at a field boundary (start-of-line or after a comma).
      expect(csv).not.toMatch(/(^|,)=cmd/m);
      expect(csv).not.toMatch(/(^|,)@SUM/m);
      hh.destroy();
    });

    it('also guards leading "=" in Excel XML string cells', () => {
      const hh = makeHarness<Row>({ store: makeStore(evilRows), columns: COLUMNS });
      const f = hh.api.use(new ExportFeature<Row>()) as ExportFeature<Row>;
      const xml = f.toExcelXml();
      expect(xml).toContain(`ss:Type="String">&apos;=cmd`);
      // Numeric cells are unaffected (they carry ss:Type="Number").
      expect(xml).toContain('ss:Type="Number">100<');
      hh.destroy();
    });

    it('can be opted out via sanitizeFormulas:false', () => {
      const hh = makeHarness<Row>({ store: makeStore(evilRows), columns: COLUMNS });
      const f = hh.api.use(
        new ExportFeature<Row>({ sanitizeFormulas: false }),
      ) as ExportFeature<Row>;
      const csv = f.toCsv();
      // Verbatim: a leading '=' round-trips when the guard is disabled.
      expect(csv).toMatch(/(^|,)("=cmd|=cmd)/m);
      expect(csv).not.toContain(`'@SUM`);
      hh.destroy();
    });
  });
});
