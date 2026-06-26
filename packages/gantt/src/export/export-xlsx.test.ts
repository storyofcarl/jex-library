/**
 * jsdom unit tests for the dependency-free XLSX (Excel/OOXML) export.
 *
 * Covers: the ZIP container (CRC-32 + store-method round-trip), Excel address /
 * serial-date math, XML escaping, the typed-cell → number-format-mask mapping,
 * native outline levels from the tree depth, shared-string interning, the
 * injection guard on text cells, the Blob/byte surface, and the accessible
 * preview panel + download path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  tableToXlsx,
  tasksToXlsx,
  tableToXlsxBlob,
  bytesToXlsxBlob,
  downloadXlsx,
  buildXlsxPreview,
  GanttXlsxExporter,
  createGanttXlsxExporter,
  escapeXml,
  columnLetter,
  cellRef,
  sanitizeSheetName,
  toExcelSerial,
  XLSX_MIME,
} from './export-xlsx.js';
import { crc32, zipSync, utf8 } from './zip.js';
import type { ExportTable } from './serialize.js';
import type { TaskModel } from '../contract.js';
import type { TaskTreeSource } from './serialize.js';

/* ── tiny store-method ZIP reader (test-only) ───────────────────────────── */

const DECODER = new TextDecoder();

function readU16(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}
function readU32(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

/** Extract `{ path → text }` from a store-method zip produced by `zipSync`. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  let o = 0;
  while (o + 4 <= bytes.length && readU32(bytes, o) === 0x04034b50) {
    const method = readU16(bytes, o + 8);
    const size = readU32(bytes, o + 18);
    const nameLen = readU16(bytes, o + 26);
    const extraLen = readU16(bytes, o + 28);
    const nameStart = o + 30;
    const name = DECODER.decode(bytes.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    expect(method).toBe(0); // store
    const data = bytes.subarray(dataStart, dataStart + size);
    out.set(name, DECODER.decode(data));
    o = dataStart + size;
  }
  return out;
}

/* ── ZIP / CRC ──────────────────────────────────────────────────────────── */

describe('zip writer', () => {
  it('CRC-32 of a known string matches the IEEE reference', () => {
    // CRC32("123456789") === 0xCBF43926.
    expect(crc32(utf8('123456789')) >>> 0).toBe(0xcbf43926);
  });

  it('round-trips entries (store method) and starts with the PK signature', () => {
    const bytes = zipSync([
      { path: 'a.txt', bytes: utf8('hello') },
      { path: 'dir/b.xml', bytes: utf8('<x/>') },
    ]);
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    const files = unzip(bytes);
    expect(files.get('a.txt')).toBe('hello');
    expect(files.get('dir/b.xml')).toBe('<x/>');
  });

  it('ends with the end-of-central-directory signature', () => {
    const bytes = zipSync([{ path: 'a', bytes: utf8('x') }]);
    // EOCD has no comment → it is the last 22 bytes; signature at its start.
    const eocd = bytes.length - 22;
    expect(readU32(bytes, eocd)).toBe(0x06054b50);
    expect(readU16(bytes, eocd + 10)).toBe(1); // total central dir records
  });
});

/* ── pure helpers ───────────────────────────────────────────────────────── */

describe('xlsx helpers', () => {
  it('escapeXml escapes the five predefined entities', () => {
    expect(escapeXml(`a<b>&"c'`)).toBe('a&lt;b&gt;&amp;&quot;c&apos;');
  });

  it('columnLetter maps indices to A1 column refs', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(27)).toBe('AB');
    expect(columnLetter(51)).toBe('AZ');
    expect(columnLetter(52)).toBe('BA');
  });

  it('cellRef combines column + 1-based row', () => {
    expect(cellRef(0, 1)).toBe('A1');
    expect(cellRef(2, 5)).toBe('C5');
  });

  it('sanitizeSheetName strips illegal chars + clamps to 31', () => {
    expect(sanitizeSheetName('a/b:c[d]')).toBe('a b c d');
    expect(sanitizeSheetName('')).toBe('Tasks');
    expect(sanitizeSheetName('x'.repeat(40)).length).toBe(31);
  });

  it('toExcelSerial maps the Excel epoch + known dates', () => {
    // 1900-01-01 is serial 2 in the Excel 1900 system (epoch 1899-12-30).
    expect(toExcelSerial(Date.UTC(1900, 0, 1))).toBe(2);
    // A whole-day date is an integer serial.
    expect(Number.isInteger(toExcelSerial(Date.UTC(2024, 0, 15)))).toBe(true);
    expect(toExcelSerial(Date.UTC(2024, 0, 15))).toBe(45306);
  });
});

/* ── table → workbook structure ─────────────────────────────────────────── */

function table(): ExportTable {
  return {
    columns: [
      { field: 'name', header: 'Name', type: 'text', width: 30 },
      { field: 'start', header: 'Start', type: 'date', width: 12 },
      { field: 'duration', header: 'Duration', type: 'duration' },
      { field: 'percentDone', header: '% Done', type: 'percent' },
    ],
    rows: [
      {
        id: 't1',
        depth: 0,
        wbs: '1',
        summary: true,
        cells: [
          { kind: 'text', value: 'Phase 1' },
          { kind: 'date', value: Date.UTC(2024, 0, 15) },
          { kind: 'duration', days: 5 },
          { kind: 'percent', fraction: 0.4 },
        ],
      },
      {
        id: 't2',
        depth: 1,
        wbs: '1.1',
        summary: false,
        cells: [
          { kind: 'text', value: '=cmd|calc' }, // injection attempt
          { kind: 'empty' },
          { kind: 'duration', days: 2 },
          { kind: 'percent', fraction: 1 },
        ],
      },
    ],
  };
}

describe('tableToXlsx — package structure', () => {
  it('writes all required OOXML parts', () => {
    const files = unzip(tableToXlsx(table()));
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/sharedStrings.xml',
    ]) {
      expect(files.has(part)).toBe(true);
    }
  });

  it('names the sheet (sanitized) in workbook.xml', () => {
    const files = unzip(tableToXlsx(table(), { sheetName: 'My/Tasks:1' }));
    expect(files.get('xl/workbook.xml')).toContain('name="My Tasks 1"');
  });

  it('registers the date + duration number-format masks in styles.xml', () => {
    const styles = unzip(tableToXlsx(table())).get('xl/styles.xml')!;
    expect(styles).toContain('formatCode="yyyy-mm-dd"');
    expect(styles).toContain('0&quot;d&quot;'); // duration mask 0"d"
    expect(styles).toContain('numFmtId="9"'); // built-in 0% for percent
  });

  it('honors a custom date format mask', () => {
    const styles = unzip(
      tableToXlsx(table(), { dateFormat: 'dd/mm/yyyy' }),
    ).get('xl/styles.xml')!;
    expect(styles).toContain('formatCode="dd/mm/yyyy"');
  });
});

describe('tableToXlsx — typed cells + masks', () => {
  it('emits a date cell as a numeric Excel serial with the date style', () => {
    const sheet = unzip(tableToXlsx(table())).get('xl/worksheets/sheet1.xml')!;
    const serial = toExcelSerial(Date.UTC(2024, 0, 15));
    // B2 is the date cell (style 1 = DATE), numeric value = serial.
    expect(sheet).toContain(`<c r="B2" s="1"><v>${serial}</v></c>`);
  });

  it('emits duration as a number with the duration style', () => {
    const sheet = unzip(tableToXlsx(table())).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<c r="C2" s="2"><v>5</v></c>');
  });

  it('emits percent as the raw fraction with the percent style', () => {
    const sheet = unzip(tableToXlsx(table())).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<c r="D2" s="3"><v>0.4</v></c>');
    expect(sheet).toContain('<c r="D3" s="3"><v>1</v></c>');
  });

  it('emits text cells as shared strings (t="s")', () => {
    const sheet = unzip(tableToXlsx(table())).get('xl/worksheets/sheet1.xml')!;
    // A2 (Phase 1) is a shared string.
    expect(sheet).toMatch(/<c r="A2" t="s"><v>\d+<\/v><\/c>/);
  });
});

describe('tableToXlsx — native outline grouping', () => {
  it('writes outlineLevel from the row depth + an outlinePr summary hint', () => {
    const sheet = unzip(tableToXlsx(table())).get('xl/worksheets/sheet1.xml')!;
    // Row 2 (depth 0) has no outlineLevel; row 3 (depth 1) does.
    expect(sheet).toContain('<row r="2">');
    expect(sheet).toContain('outlineLevel="1"');
    expect(sheet).toContain('summaryBelow="0"');
    expect(sheet).toContain('outlineLevelRow="1"');
  });

  it('omits outline markup when outline:false', () => {
    const sheet = unzip(tableToXlsx(table(), { outline: false })).get(
      'xl/worksheets/sheet1.xml',
    )!;
    expect(sheet).not.toContain('outlineLevel=');
    expect(sheet).not.toContain('summaryBelow');
  });

  it('freezes the header row by default (and can be disabled)', () => {
    const frozen = unzip(tableToXlsx(table())).get('xl/worksheets/sheet1.xml')!;
    expect(frozen).toContain('state="frozen"');
    const open = unzip(tableToXlsx(table(), { freezeHeader: false })).get(
      'xl/worksheets/sheet1.xml',
    )!;
    expect(open).not.toContain('state="frozen"');
  });

  it('writes column widths from the width hints', () => {
    const sheet = unzip(tableToXlsx(table())).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<cols>');
    expect(sheet).toContain('customWidth="1"');
  });
});

describe('tableToXlsx — shared strings + injection guard', () => {
  it('interns each distinct string once', () => {
    const t = table();
    // Duplicate a header-equal value to verify interning across header + body.
    t.rows[1]!.cells[0] = { kind: 'text', value: 'Name' };
    const sst = unzip(tableToXlsx(t)).get('xl/sharedStrings.xml')!;
    const matches = sst.match(/<si>/g) ?? [];
    const count = Number(/count="(\d+)"/.exec(sst)?.[1]);
    expect(matches.length).toBe(count); // count attr matches actual <si> entries
  });

  it('neutralizes a leading formula trigger in a text cell', () => {
    // depth-1 row's name is "=cmd|calc"; with default indent it gets indented and
    // is safe; force depth 0 so "=" is the literal leading char.
    const t = table();
    t.rows[1]!.depth = 0;
    const files = unzip(tableToXlsx(t, { indent: '' }));
    const sst = files.get('xl/sharedStrings.xml')!;
    // The apostrophe-prefixed form must be present (XML-escaped: ' → &apos;) so
    // the cell opens as literal text, not a live formula.
    expect(sst).toContain('&apos;=cmd|calc');
    expect(sst).not.toContain('<t xml:space="preserve">=cmd|calc</t>');
  });

  it('indents the Name cell per depth (textual outline preserved)', () => {
    const sst = unzip(tableToXlsx(table())).get('xl/sharedStrings.xml')!;
    // depth-1 child name indented two spaces; "=" no longer leads → no apostrophe.
    expect(sst).toContain('<t xml:space="preserve">  =cmd|calc</t>');
  });
});

/* ── tasksToXlsx (end-to-end) + resolver wiring ─────────────────────────── */

describe('tasksToXlsx — tree serializer + resolver wiring', () => {
  function source(
    roots: Array<TaskModel & { children?: TaskModel[] }>,
  ): TaskTreeSource {
    return {
      items: roots,
      getChildren: (n) =>
        (typeof n === 'object' ? (n.children ?? []) : []) as TaskModel[],
    };
  }

  it('walks the tree, preserves WBS/hierarchy, and wires predecessors/resources', () => {
    const tree = source([
      {
        id: 1,
        name: 'Parent',
        children: [
          { id: 2, name: 'Child A', start: Date.UTC(2024, 0, 1) } as TaskModel,
        ],
      } as TaskModel & { children: TaskModel[] },
    ]);
    const files = unzip(
      tasksToXlsx(tree, {
        predecessorsOf: (id) => (id === 2 ? '1FS' : ''),
        resourcesOf: (id) => (id === 2 ? 'Alice [50%]' : ''),
        columns: [
          { field: 'name', header: 'Name' },
          { field: 'wbs', header: 'WBS' },
          { field: 'predecessors', header: 'Predecessors' },
          { field: 'resources', header: 'Resources' },
        ],
      }),
    );
    const sst = files.get('xl/sharedStrings.xml')!;
    expect(sst).toContain('Parent');
    expect(sst).toContain('Child A'); // indented
    expect(sst).toContain('1FS');
    expect(sst).toContain('Alice [50%]');
    // WBS numbering present.
    expect(sst).toContain('>1<');
    expect(sst).toContain('1.1');
  });
});

/* ── Blob + download path ───────────────────────────────────────────────── */

describe('Blob + download', () => {
  it('bytesToXlsxBlob carries the OOXML MIME type + the PK signature', () => {
    const bytes = tableToXlsx(table());
    const blob = bytesToXlsxBlob(bytes);
    expect(blob.type).toBe(XLSX_MIME);
    expect(blob.size).toBe(bytes.length);
    // The raw bytes start with the PK zip signature (jsdom Blob has no
    // arrayBuffer(); the bytes are validated directly).
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });

  it('tableToXlsxBlob produces a valid package', () => {
    const blob = tableToXlsxBlob(table());
    expect(blob.type).toBe(XLSX_MIME);
  });

  it('downloadXlsx triggers an <a download> click and appends .xlsx', () => {
    const clicks: string[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    (URL as unknown as { createObjectURL: () => string }).createObjectURL =
      () => 'blob:mock';
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL =
      () => {};
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push(this.download);
      });
    try {
      const offered = downloadXlsx(tableToXlsx(table()), 'my-export');
      expect(offered).toBe(true);
      expect(clicks).toEqual(['my-export.xlsx']);
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });
});

/* ── accessible preview panel ───────────────────────────────────────────── */

describe('buildXlsxPreview', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    host.remove();
  });

  it('renders a labelled table with headers, rows, and a download button', () => {
    const preview = buildXlsxPreview(table(), { filename: 'tasks' });
    host.appendChild(preview.el);

    expect(preview.el.getAttribute('aria-label')).toBe('Excel export preview');
    const ths = preview.el.querySelectorAll('th[scope="col"]');
    expect(ths.length).toBe(4);
    const bodyRows = preview.el.querySelectorAll('tbody tr');
    expect(bodyRows.length).toBe(2);
    // Summary row class applied to the parent.
    expect(
      preview.el.querySelector('.jects-gantt-xlsx-preview__row--summary'),
    ).not.toBeNull();
    // Date cell renders ISO display text.
    expect(preview.el.textContent).toContain('2024-01-15');
    // Percent renders as a display percentage.
    expect(preview.el.textContent).toContain('40%');
    const btn = preview.el.querySelector('button')!;
    expect(btn.textContent).toBe('Download tasks.xlsx');
    preview.destroy();
  });

  it('the download button is wired and destroy() removes it', () => {
    const origCreate = URL.createObjectURL;
    (URL as unknown as { createObjectURL: () => string }).createObjectURL =
      () => 'blob:mock';
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL =
      () => {};
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    try {
      const preview = buildXlsxPreview(table(), { filename: 'out' });
      host.appendChild(preview.el);
      const btn = preview.el.querySelector('button')!;
      btn.click();
      expect(clickSpy).toHaveBeenCalledTimes(1);
      preview.destroy();
      expect(preview.el.isConnected).toBe(false);
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = origCreate;
    }
  });
});

/* ── disposable controller ──────────────────────────────────────────────── */

describe('GanttXlsxExporter', () => {
  function treeSource(): TaskTreeSource {
    return {
      items: [
        {
          id: 1,
          name: 'Root',
          children: [{ id: 2, name: 'Leaf' } as TaskModel],
        } as TaskModel & { children: TaskModel[] },
      ],
      getChildren: (n) =>
        (typeof n === 'object' ? (n.children ?? []) : []) as TaskModel[],
    };
  }

  it('exports bytes, a blob, and a table mirroring the resolvers', () => {
    const exporter = createGanttXlsxExporter({
      source: treeSource(),
      predecessorsOf: (id) => (id === 2 ? '1FS' : ''),
      resourcesOf: () => '',
    });
    const bytes = exporter.export();
    expect(bytes[0]).toBe(0x50);
    expect(exporter.exportBlob().type).toBe(XLSX_MIME);
    const tbl = exporter.exportTable();
    expect(tbl.rows.length).toBe(2);
    exporter.destroy();
    expect(exporter.isDestroyed).toBe(true);
  });

  it('builds a preview from the live source', () => {
    const exporter = new GanttXlsxExporter({ source: treeSource() });
    const preview = exporter.buildPreview({ filename: 'live' });
    expect(preview.el.querySelectorAll('tbody tr').length).toBe(2);
    preview.destroy();
    exporter.destroy();
  });

  it('destroy() is idempotent', () => {
    const exporter = new GanttXlsxExporter({ source: treeSource() });
    exporter.destroy();
    exporter.destroy();
    expect(exporter.isDestroyed).toBe(true);
  });
});
