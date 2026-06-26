/**
 * Minimal UTC date formatting for header cells and aria labels.
 *
 * Supports the tiny subset of moment-style tokens the built-in presets use
 * (`ddd D MMM`, `D`, `HH`, `MMM YYYY`, `MMM`, `YYYY`, `[W]w`, `[Q]Q`) plus a
 * `'datetime'` shorthand for accessible labels. Everything is UTC so output is
 * stable regardless of the host timezone, matching timeline-core's calendar.
 */

import type { TimeMs } from '@jects/timeline-core';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** ISO-week number (UTC), 1..53. */
function isoWeek(time: TimeMs): number {
  const d = new Date(time);
  d.setUTCHours(0, 0, 0, 0);
  // Thursday in current week decides the year.
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const week1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return (
    1 +
    Math.round(
      ((d.getTime() - week1.getTime()) / 86_400_000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7,
    )
  );
}

/** Token matcher; longest tokens first so `YYYY`/`ddd`/`MMM` win over `D`. */
const TOKEN_RE = /\[[^\]]*\]|YYYY|MMM|ddd|HH|Q|D|w/g;

/**
 * Format an epoch-ms time against a moment-ish pattern (UTC). Bracketed literals
 * (`[W]`) are emitted verbatim; any text outside a token passes through
 * unchanged. `'datetime'` / no pattern falls back to a compact date-time string.
 */
export function formatTime(time: TimeMs, pattern?: string): string {
  const d = new Date(time);
  if (pattern === 'datetime' || pattern === undefined) {
    return (
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
    );
  }
  return pattern.replace(TOKEN_RE, (tok) => {
    if (tok.charCodeAt(0) === 91 /* '[' */) return tok.slice(1, -1);
    switch (tok) {
      case 'YYYY':
        return String(d.getUTCFullYear());
      case 'MMM':
        return MONTHS[d.getUTCMonth()]!;
      case 'ddd':
        return DAYS[d.getUTCDay()]!;
      case 'HH':
        return pad(d.getUTCHours());
      case 'Q':
        return String(Math.floor(d.getUTCMonth() / 3) + 1);
      case 'D':
        return String(d.getUTCDate());
      case 'w':
        return String(isoWeek(time));
      default:
        return tok;
    }
  });
}
