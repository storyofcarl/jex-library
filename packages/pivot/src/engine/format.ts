/**
 * Locale-aware number formatting for pivot cells.
 *
 * A thin wrapper over `Intl.NumberFormat` that caches formatters by (locale,
 * options) key. Null/non-finite values render as a configurable blank.
 */

export interface NumberFormatOptions extends Intl.NumberFormatOptions {
  /** BCP-47 locale. Default: the host default. */
  locale?: string;
  /** Text rendered for null/NaN cells. Default `''`. */
  blank?: string;
}

const cache = new Map<string, Intl.NumberFormat>();

function formatterFor(locale: string | undefined, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`;
  let fmt = cache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, options);
    cache.set(key, fmt);
  }
  return fmt;
}

/** Format a numeric pivot value with locale options. */
export function formatNumber(value: number | null | undefined, options: NumberFormatOptions = {}): string {
  const { locale, blank = '', ...intl } = options;
  if (value == null || !Number.isFinite(value)) return blank;
  return formatterFor(locale, intl).format(value);
}

/** A bound formatter function (for passing to value fields). */
export function makeNumberFormat(options: NumberFormatOptions = {}): (value: number | null) => string {
  return (value) => formatNumber(value, options);
}
