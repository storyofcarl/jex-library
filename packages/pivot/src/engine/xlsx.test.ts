import { describe, it, expect } from 'vitest';
import { PivotEngine } from './engine.js';
import { toXlsx } from './xlsx.js';
import { toExcelXml } from './export.js';

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

const td = new TextDecoder();

/** Locate a stored (uncompressed) zip entry's bytes by archive path. */
function readEntry(zip: Uint8Array, path: string): string | undefined {
  let p = 0;
  while (p + 30 <= zip.length) {
    const sig = zip[p]! | (zip[p + 1]! << 8) | (zip[p + 2]! << 16) | (zip[p + 3]! << 24);
    if (sig !== 0x04034b50) break; // first non-local-header → central directory
    const compSize = zip[p + 18]! | (zip[p + 19]! << 8) | (zip[p + 20]! << 16) | (zip[p + 21]! << 24);
    const nameLen = zip[p + 26]! | (zip[p + 27]! << 8);
    const extraLen = zip[p + 28]! | (zip[p + 29]! << 8);
    const nameStart = p + 30;
    const name = td.decode(zip.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    if (name === path) return td.decode(zip.subarray(dataStart, dataStart + compSize));
    p = dataStart + compSize;
  }
  return undefined;
}

describe('toXlsx — real OOXML package', () => {
  it('emits a valid zip with the OOXML local-file signature', () => {
    const bytes = toXlsx(pivot(), { rowFieldLabels: ['Region'] });
    expect(bytes).toBeInstanceOf(Uint8Array);
    // PK\x03\x04 — a ZIP local file header.
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // End-of-central-directory signature PK\x05\x06 appears at the tail.
    let foundEocd = false;
    for (let i = 0; i + 4 <= bytes.length; i++) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
        foundEocd = true;
        break;
      }
    }
    expect(foundEocd).toBe(true);
  });

  it('carries the required OOXML parts', () => {
    const bytes = toXlsx(pivot());
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/styles.xml',
      'xl/sharedStrings.xml',
      'xl/worksheets/sheet1.xml',
    ]) {
      expect(readEntry(bytes, part), `missing ${part}`).toBeTruthy();
    }
  });

  it('the worksheet XML carries the pivot cells (numbers inline, strings shared)', () => {
    const bytes = toXlsx(pivot(), { rowFieldLabels: ['Region'] });
    const sheet = readEntry(bytes, 'xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<worksheet');
    expect(sheet).toContain('<sheetData>');
    // The West row total (100 + 200 = 300 across Q1/Q2 + row total) → numeric <v>.
    expect(sheet).toContain('<v>300</v>');
    expect(sheet).toContain('<v>100</v>');
    // String cells reference the shared-string table.
    expect(sheet).toContain('t="s"');
    const shared = readEntry(bytes, 'xl/sharedStrings.xml')!;
    expect(shared).toContain('West');
    expect(shared).toContain('Region');
  });

  it('still offers the legacy SpreadsheetML string via toExcelXml', () => {
    const xml = toExcelXml(pivot(), { rowFieldLabels: ['Region'] });
    expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(xml).toContain('<Worksheet ss:Name="Pivot">');
  });
});
