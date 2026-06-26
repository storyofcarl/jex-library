/**
 * Series colors — the house "Calm CMYK" categorical ramp.
 *
 * Chrome CSS (axes/legend/tooltip) is token-pure via `.css`. But data-series
 * FILLS are applied in JS, where we still go through tokens: each series color
 * is `oklch(var(--jects-data-N))`, cycling the eight-stop ramp the theme exposes
 * (`--jects-data-1 … --jects-data-8`, themselves derived from the CMYK tokens).
 *
 * Returning a CSS string that references a custom property keeps fills live-
 * theming (recolor on theme switch) and avoids hardcoding any color literal.
 */

/** Number of stops in the house categorical ramp. */
export const RAMP_SIZE = 8;

/** The token names of the house categorical ramp, in order. */
export const RAMP_TOKENS: readonly string[] = Array.from(
  { length: RAMP_SIZE },
  (_, i) => `--jects-data-${i + 1}`,
);

/**
 * Resolve a series index to a CSS color that references a ramp token.
 * Cycles modulo {@link RAMP_SIZE}.
 *
 * @param index zero-based series index
 * @param alpha optional alpha 0..1
 */
export function seriesColor(index: number, alpha?: number): string {
  const token = RAMP_TOKENS[((index % RAMP_SIZE) + RAMP_SIZE) % RAMP_SIZE]!;
  return alpha === undefined || alpha >= 1
    ? `oklch(var(${token}))`
    : `oklch(var(${token}) / ${clamp01(alpha)})`;
}

/** A CSS color referencing a specific ramp token name (1-based stop). */
export function rampColor(stop: number, alpha?: number): string {
  return seriesColor(stop - 1, alpha);
}

/** Wrap an arbitrary semantic token (e.g. 'foreground') as an oklch() color. */
export function tokenColor(token: string, alpha?: number): string {
  const name = token.startsWith('--jects-') ? token : `--jects-${token}`;
  return alpha === undefined || alpha >= 1
    ? `oklch(var(${name}))`
    : `oklch(var(${name}) / ${clamp01(alpha)})`;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * In a non-CSS rendering target (e.g. Canvas) custom properties don't apply
 * to `ctx.fillStyle`. We resolve the *computed* value of a series color by
 * reading the custom property off a reference element, then build the oklch()
 * string from the resolved triplet. Falls back to the raw `oklch(var(...))`
 * string when resolution isn't possible (jsdom / detached).
 */
export function resolveSeriesColor(
  index: number,
  refEl: Element | null,
  alpha?: number,
): string {
  const token = RAMP_TOKENS[((index % RAMP_SIZE) + RAMP_SIZE) % RAMP_SIZE]!;
  return resolveTokenColor(token, refEl, alpha);
}

/** Resolve any `--jects-*` token to a concrete oklch() string via computed style. */
export function resolveTokenColor(
  token: string,
  refEl: Element | null,
  alpha?: number,
): string {
  const name = token.startsWith('--jects-') ? token : `--jects-${token}`;
  let triplet = '';
  if (refEl && typeof getComputedStyle === 'function') {
    try {
      triplet = getComputedStyle(refEl).getPropertyValue(name).trim();
    } catch {
      triplet = '';
    }
  }
  if (!triplet) {
    // Can't resolve (jsdom/detached) — return the live token reference. Canvas
    // will treat an unknown color as transparent/black, but SVG keeps theming.
    return alpha === undefined || alpha >= 1
      ? `oklch(var(${name}))`
      : `oklch(var(${name}) / ${clamp01(alpha)})`;
  }
  return alpha === undefined || alpha >= 1
    ? `oklch(${triplet})`
    : `oklch(${triplet} / ${clamp01(alpha)})`;
}
