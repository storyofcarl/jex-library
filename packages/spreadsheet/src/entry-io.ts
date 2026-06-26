/**
 * `@jects/spreadsheet/io` — additive subpath for the pure import/export layer:
 * CSV, JSON, and XLSX (OOXML + SpreadsheetML) read/write, plus the dependency-free
 * ZIP codec the XLSX packaging is built on.
 *
 * This entry imports ONLY the pure transform modules — `ui/io.ts`, `ui/xlsx.ts`,
 * `ui/zip.ts`, `ui/csv-safe.ts`, `ui/format.ts`, `ui/a1.ts` — plus the type-only
 * frozen `contract.ts`. None of these touch the DOM, the grid, widgets, or
 * charts, so a consumer who only needs to parse/serialize workbooks (server
 * import jobs, file-conversion utilities) ships none of the rendering layer.
 *
 *   import { workbookToXlsxBytes, xlsxBytesToWorkbook } from '@jects/spreadsheet/io';
 *
 * The package main entry (`@jects/spreadsheet`) re-exports this same surface and
 * stays tree-shakeable; this subpath is a real separate build chunk.
 */

export {
  exportWorkbook,
  importWorkbook,
  sheetToCsv,
  parseCsv,
  csvToSheet,
  workbookToJson,
  jsonToWorkbook,
  workbookToXlsxXml,
  xlsxXmlToWorkbook,
  workbookToXlsxBytes,
  xlsxBytesToWorkbook,
  workbookToXlsxBlob,
  XLSX_MIME,
  type IoFormat,
} from './ui/io.js';

export { zipSync, unzipSync, crc32, type ZipEntry } from './ui/zip.js';

/* Re-export the IO-relevant frozen contract types for ergonomic typing. */
export type {
  CellValue,
  SheetModel,
  WorkbookModel,
} from './contract.js';
