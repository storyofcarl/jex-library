/**
 * Scheduler export — theme-token → concrete-colour palette resolver.
 *
 * The canvas rasterizer needs concrete CSS colour strings, but the house style
 * is OKLCH channel-triplet tokens (`--jects-primary: L C H`). At export time we
 * read the live computed values off a mounted element and wrap them back into
 * `oklch(...)` strings the canvas understands (modern browsers paint `oklch()`
 * directly). When no theme is mounted (headless jsdom / node), we fall back to
 * {@link DEFAULT_EXPORT_PALETTE} so export still produces a correct, themed-ish
 * raster. This keeps the exporter token-pure: it never hard-codes colours when a
 * theme is present.
 */

import {
  DEFAULT_EXPORT_PALETTE,
  type ExportPalette,
} from './paint-canvas.js';

/** Read one `--jects-*` triplet token and wrap it as an `oklch()` colour. */
function tokenColor(
  styles: CSSStyleDeclaration,
  token: string,
  fallback: string,
): string {
  const raw = styles.getPropertyValue(`--jects-${token}`).trim();
  if (!raw) return fallback;
  // Triplet form ("L C H") → oklch(L C H). Already-wrapped values pass through.
  if (/^oklch\(/i.test(raw) || /^(#|rgb|hsl)/i.test(raw)) return raw;
  return `oklch(${raw})`;
}

/**
 * Resolve a concrete {@link ExportPalette} from the theme tokens in scope at
 * `el`. Returns the default palette when `getComputedStyle` is unavailable or
 * returns nothing (headless), so callers always get a usable palette.
 */
export function resolvePalette(el: Element | null | undefined): ExportPalette {
  if (
    typeof globalThis === 'undefined' ||
    typeof (globalThis as { getComputedStyle?: unknown }).getComputedStyle !==
      'function' ||
    !el
  ) {
    return { ...DEFAULT_EXPORT_PALETTE, ramp: [...DEFAULT_EXPORT_PALETTE.ramp] };
  }
  const s = getComputedStyle(el);
  const d = DEFAULT_EXPORT_PALETTE;
  const ramp: string[] = [];
  for (let i = 1; i <= 8; i++) {
    const raw = s.getPropertyValue(`--jects-data-${i}`).trim();
    if (raw) ramp.push(/^(oklch|#|rgb|hsl)/i.test(raw) ? raw : `oklch(${raw})`);
  }
  return {
    background: tokenColor(s, 'background', d.background),
    foreground: tokenColor(s, 'foreground', d.foreground),
    mutedForeground: tokenColor(s, 'muted-foreground', d.mutedForeground),
    border: tokenColor(s, 'border', d.border),
    card: tokenColor(s, 'card', d.card),
    muted: tokenColor(s, 'muted', d.muted),
    primary: tokenColor(s, 'primary', d.primary),
    primaryForeground: tokenColor(s, 'primary-foreground', d.primaryForeground),
    shade: tokenColor(s, 'muted', d.shade),
    now: tokenColor(s, 'destructive', d.now),
    progress: tokenColor(s, 'success', d.progress),
    dependency: tokenColor(s, 'muted-foreground', d.dependency),
    ramp: ramp.length > 0 ? ramp : [...d.ramp],
  };
}
