/**
 * Clipboard block (de)serialization. Spreadsheets exchange a rectangular block
 * as TSV (tab-separated rows, newline-separated lines) — the de-facto format
 * Excel/Sheets read and write. Pure string transforms.
 */

import type { CellValue } from '../contract.js';
import { escapeCsvInjection } from './csv-safe.js';
import { formatValue, isCellError } from './format.js';

/** Options for clipboard/TSV serialization. */
export interface BlockToTsvOptions {
  /**
   * Neutralise CSV/TSV formula injection by prefixing fields that begin with a
   * dangerous character (`=`/`+`/`-`/`@`) with an apostrophe. Default `true`.
   */
  sanitizeInjection?: boolean;
}

/** A copied rectangular block: raw display text + the source values. */
export interface ClipboardBlock {
  /** Row-major grid of display text. */
  text: string[][];
  /** Row-major grid of source values (for internal paste fidelity). */
  values: CellValue[][];
}

/** Convert a value to its clipboard text form. */
function toText(v: CellValue): string {
  if (v === null || v === undefined) return '';
  if (isCellError(v)) return v.code;
  return formatValue(v);
}

/** Serialize a block to TSV (what lands on the OS clipboard). */
export function blockToTsv(values: CellValue[][], opts?: BlockToTsvOptions): string {
  const guard = opts?.sanitizeInjection !== false;
  return values
    .map((row) =>
      row
        .map((v) => {
          const text = sanitize(toText(v));
          return guard ? escapeCsvInjection(text) : text;
        })
        .join('\t'),
    )
    .join('\n');
}

/** Tabs/newlines inside a field would corrupt the grid — collapse them. */
function sanitize(s: string): string {
  return s.replace(/[\t\n\r]+/g, ' ');
}

/** Parse pasted TSV (or CSV fallback) text into a 2D string grid. */
export function parsePastedText(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Strip a single trailing newline so we don't synthesize a blank row.
  const body = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  const lines = body.split('\n');
  const delimiter = body.includes('\t') ? '\t' : ',';
  return lines.map((line) => line.split(delimiter));
}

/** Infer a typed value from pasted raw text (numbers/booleans). */
export function inferPasted(raw: string): CellValue {
  if (raw === '') return null;
  if (/^(true|false)$/i.test(raw)) return /^true$/i.test(raw);
  if (/^-?\d+(\.\d+)?$/.test(raw)) return parseFloat(raw);
  return raw;
}
