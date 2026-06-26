/**
 * `@jects/gantt` — task-grid CSV export.
 *
 * Serializes the project task tree to RFC-4180 CSV. Built on the shared
 * {@link serializeTasks} core, so the exported columns, order, and formatting
 * exactly match the XLSX export and the on-screen task-tree grid.
 *
 * Behaviour (matching Bryntum/DHTMLX "export to CSV"):
 *   - The first line is the header row (column titles).
 *   - Hierarchy is preserved by indenting the **Name** cell with leading spaces
 *     per outline depth (so a flat CSV still reads as an outline), while the WBS
 *     column carries the machine outline number ("1.2.1").
 *   - Dates are emitted ISO (`YYYY-MM-DD`), durations/effort as `"5d"`, and
 *     percent-done as `"40%"` — i.e. the display formats, not raw epoch ms.
 *   - Every field is escaped per RFC 4180: a field containing the delimiter, a
 *     double-quote, or a newline is wrapped in double-quotes with embedded quotes
 *     doubled. A configurable delimiter (default `,`) and EOL (default `\r\n`)
 *     support locale variants (e.g. `;` for European Excel).
 *   - A leading UTF-8 BOM (default on) makes Excel open UTF-8 CSV correctly.
 *
 * This module is DOM-free: it returns a string. The download/UI wiring lives in
 * the export feature module.
 */

import type { Model } from '@jects/core';
import {
  serializeTasks,
  cellToText,
  type ExportTable,
  type SerializeOptions,
  type TaskTreeSource,
} from './serialize.js';

/** Options for {@link tasksToCsv} / {@link tableToCsv}. */
export interface CsvExportOptions<T extends Model = Model> extends SerializeOptions<T> {
  /** Field delimiter. Default `","` (use `";"` for European Excel). */
  delimiter?: string;
  /** Line terminator. Default `"\r\n"` (RFC 4180). */
  eol?: string;
  /** Emit a leading UTF-8 BOM so Excel detects UTF-8. Default `true`. */
  bom?: boolean;
  /**
   * Indent the Name cell with this string per outline depth (so a flat CSV reads
   * as an outline). Default two spaces; pass `''` to disable indenting.
   */
  indent?: string;
}

const DEFAULT_DELIMITER = ',';
const DEFAULT_EOL = '\r\n';
const DEFAULT_INDENT = '  ';
const BOM = '﻿';

/**
 * Characters that make Excel/LibreOffice treat a cell as a formula when they
 * appear at the START of a field. A task name (or resource/predecessor string)
 * such as `=cmd|'/c calc'!A1`, `+1+1`, `-2+3`, `@SUM(...)`, or a leading
 * tab/CR/LF is otherwise evaluated on open — a CSV-injection vector. Task names
 * are user-controlled and flow straight through to the exported cell.
 */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r', '\n'];

/**
 * Neutralize CSV/formula injection. If a field begins with a formula-trigger
 * character, prefix it with a single apostrophe so spreadsheet apps treat the
 * cell as literal text (the apostrophe is the standard "text" escape and is not
 * displayed as part of the value). Returns the field unchanged otherwise.
 */
export function sanitizeCsvField(value: string): string {
  if (value.length > 0 && FORMULA_TRIGGERS.includes(value[0]!)) {
    return `'${value}`;
  }
  return value;
}

/**
 * Escape one CSV field per RFC 4180. A field is quoted iff it contains the
 * delimiter, a double-quote, CR, or LF; embedded quotes are doubled. (A leading/
 * trailing space is preserved as-is — Excel tolerates it; we only quote when a
 * structural character is present.)
 *
 * Before quoting, the field is run through {@link sanitizeCsvField} to defuse
 * formula-injection payloads, so both CSV writers ({@link tableToCsv} and any
 * future direct caller) are covered.
 */
export function escapeCsvField(value: string, delimiter: string): string {
  const safe = sanitizeCsvField(value);
  const needsQuote =
    safe.includes(delimiter) ||
    safe.includes('"') ||
    safe.includes('\n') ||
    safe.includes('\r');
  if (!needsQuote) return safe;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Serialize an already-resolved {@link ExportTable} to a CSV string. Useful when
 * a caller has its own table; most callers use {@link tasksToCsv}.
 */
export function tableToCsv(table: ExportTable, options: CsvExportOptions = {}): string {
  const delimiter = options.delimiter ?? DEFAULT_DELIMITER;
  const eol = options.eol ?? DEFAULT_EOL;
  const indentUnit = options.indent ?? DEFAULT_INDENT;
  const emitBom = options.bom !== false;

  // Index of the Name column (the one we indent), if present.
  const nameCol = table.columns.findIndex((c) => c.field === 'name');

  const lines: string[] = [];

  // Header row.
  lines.push(
    table.columns
      .map((c) => escapeCsvField(c.header ?? c.field, delimiter))
      .join(delimiter),
  );

  // Data rows.
  for (const row of table.rows) {
    const cells = row.cells.map((cell, i) => {
      const indent =
        i === nameCol && indentUnit && row.depth > 0
          ? indentUnit.repeat(row.depth)
          : undefined;
      const text = cellToText(cell, indent ? { indent } : undefined);
      return escapeCsvField(text, delimiter);
    });
    lines.push(cells.join(delimiter));
  }

  const body = lines.join(eol) + eol;
  return emitBom ? BOM + body : body;
}

/**
 * Serialize a task tree directly to a CSV string. Walks the tree via
 * {@link serializeTasks} (preserving hierarchy/WBS) then renders RFC-4180 CSV.
 *
 * @param source  The task tree (`TreeStore` or compatible shape).
 * @param options Columns, resolvers, and CSV formatting (delimiter/eol/bom/indent).
 */
export function tasksToCsv<T extends Model = Model>(
  source: TaskTreeSource<T>,
  options: CsvExportOptions<T> = {},
): string {
  const table = serializeTasks(source, options);
  return tableToCsv(table, options);
}
