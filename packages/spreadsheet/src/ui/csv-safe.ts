/**
 * CSV / TSV formula-injection defence.
 *
 * A spreadsheet field whose first character is `=`, `+`, `-`, `@` (or a leading
 * tab / carriage return that Excel trims back to one of those) is interpreted as
 * a formula when the exported CSV/TSV is reopened in Excel / Google Sheets —
 * the classic CSV-injection vector (e.g. `=cmd|'/C calc'!A0`,
 * `=HYPERLINK("http://evil","click")`). On export we neutralise such fields by
 * prefixing a single apostrophe, per OWASP guidance.
 *
 * Controlled per-export via the `sanitize` option (default ON). Importers strip
 * the leading apostrophe is NOT done here — Excel itself treats the apostrophe
 * as a "text" marker and hides it; round-tripping through our own parser keeps
 * the apostrophe as literal text, which is the safe, expected behaviour.
 */

/** Leading characters that trigger formula evaluation in spreadsheet apps. */
const DANGEROUS_LEADING = /^[=+\-@\t\r]/;

/**
 * Prefix a field with `'` when its first character could trigger formula
 * evaluation on import. Empty fields are returned unchanged.
 */
export function escapeCsvInjection(field: string): string {
  if (field === '') return field;
  return DANGEROUS_LEADING.test(field) ? `'${field}` : field;
}
