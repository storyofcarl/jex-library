/**
 * @jects/pivot export barrel — the serialization layer: CSV, real OOXML `.xlsx`,
 * legacy SpreadsheetML `.xls`, and the framework-free ZIP/CRC primitives the
 * `.xlsx` writer is built on.
 *
 * This area imports ONLY its own files (`../engine/export.js`, `../engine/xlsx.js`,
 * `../engine/zip.js`); their sole reference into the rest of the engine is the
 * **type-only** `PivotResult` / `PivotColumnLeaf` import, which is erased at build
 * time. So this subpath chunk carries the export/zip code WITHOUT pulling the
 * aggregation engine, the conditional-format layer, the `PivotTable` widget, or
 * the package hub (`src/index.ts`).
 */

export {
  toExportMatrix,
  toCsv,
  toExcelXml,
  downloadCsv,
  downloadXlsx,
  downloadXls,
  type PivotExportOptions,
} from '../engine/export.js';

export { toXlsx, XLSX_MIME } from '../engine/xlsx.js';

export { zipSync, crc32, utf8, type ZipEntry } from '../engine/zip.js';
