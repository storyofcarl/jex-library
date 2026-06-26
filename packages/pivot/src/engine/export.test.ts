import { describe, it, expect } from 'vitest';
import { PivotEngine } from './engine.js';
import { toCsv, toExcelXml, toExportMatrix } from './export.js';

interface Sale extends Record<string, unknown> {
  region: string;
  quarter: string;
  amount: number;
}

const DATA: Sale[] = [
  { region: 'West', quarter: 'Q1', amount: 100 },
  { region: 'West', quarter: 'Q2', amount: 200 },
  { region: 'East', quarter: 'Q1', amount: 300 },
];

function pivot() {
  return new PivotEngine(DATA).compute({
    rows: ['region'],
    columns: ['quarter'],
    values: [{ field: 'amount', aggregator: 'sum' }],
    mode: 'flat',
    totals: { grand: true, rows: true, columns: true },
  });
}

describe('toExportMatrix', () => {
  it('produces header lines + data rows with row-field labels', () => {
    const m = toExportMatrix(pivot(), { rowFieldLabels: ['Region'] });
    // 1 column-axis header line + 1 value-field line + 2 data rows + grand total.
    expect(m[0]![0]).toBe('Region');
    // The value-field line lists the measure for each leaf.
    const valueLine = m[1]!;
    expect(valueLine.slice(1).every((c) => c === 'Sum of amount')).toBe(true);
    // A West data row contains its region label and numbers.
    const westLine = m.find((line) => line[0] === 'West')!;
    expect(westLine).toBeTruthy();
    expect(westLine.slice(1).map(Number)).toContain(100);
  });
});

describe('toCsv', () => {
  it('serializes with delimiter + CRLF + quoting', () => {
    const csv = toCsv(pivot(), { rowFieldLabels: ['Region'] });
    expect(csv).toContain('\r\n');
    expect(csv.split('\r\n')[0]).toContain('Region');
    expect(csv).toContain('West');
  });

  it('quotes fields containing the delimiter', () => {
    const engine = new PivotEngine([{ region: 'A,B', amount: 5 }]);
    const result = engine.compute({ rows: ['region'], values: ['amount'], totals: false });
    const csv = toCsv(result, { rowFieldLabels: ['Region'] });
    expect(csv).toContain('"A,B"');
  });

  it('guards formula-injection by default', () => {
    const engine = new PivotEngine([{ region: '=cmd', amount: 5 }]);
    const result = engine.compute({ rows: ['region'], values: ['amount'], totals: false });
    expect(toCsv(result)).toContain("'=cmd");
    expect(toCsv(result, { sanitizeFormulas: false })).not.toContain("'=cmd");
  });
});

describe('toExcelXml', () => {
  it('emits SpreadsheetML with Number cells for values', () => {
    const xml = toExcelXml(pivot(), { rowFieldLabels: ['Region'] });
    expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(xml).toContain('ss:Type="Number"');
    expect(xml).toContain('ss:Type="String"');
    expect(xml).toContain('<Worksheet ss:Name="Pivot">');
  });

  it('escapes XML special characters in string cells', () => {
    const engine = new PivotEngine([{ region: 'A & <B>', amount: 1 }]);
    const result = engine.compute({ rows: ['region'], values: ['amount'], totals: false });
    const xml = toExcelXml(result, { rowFieldLabels: ['Region'] });
    expect(xml).toContain('A &amp; &lt;B&gt;');
  });
});
