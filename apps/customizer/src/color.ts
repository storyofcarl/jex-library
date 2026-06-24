/**
 * Minimal OKLCH <-> sRGB hex conversion for the customizer color pickers.
 * OKLCH triplet here is `L C H` with L in [0,1], C ~[0,0.4], H in degrees.
 */

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** OKLCH triplet "L C H" -> #rrggbb (gamut-clipped). */
export function oklchToHex(triplet: string): string {
  const [L, C, Hdeg] = triplet.trim().split(/\s+/).map(Number) as [number, number, number];
  const h = ((Hdeg || 0) * Math.PI) / 180;
  const a = (C || 0) * Math.cos(h);
  const b = (C || 0) * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const toByte = (v: number): number => Math.round(clamp01(linearToSrgb(v)) * 255);
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${hex(toByte(r))}${hex(toByte(g))}${hex(toByte(bl))}`;
}

/** #rrggbb -> OKLCH triplet "L C H" (rounded). */
export function hexToOklch(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '0 0 0';
  const int = parseInt(m[1]!, 16);
  const r = srgbToLinear(((int >> 16) & 255) / 255);
  const g = srgbToLinear(((int >> 8) & 255) / 255);
  const b = srgbToLinear((int & 255) / 255);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m2 = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m2);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const C = Math.sqrt(a * a + bb * bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  const round = (x: number, p: number): number => Math.round(x * 10 ** p) / 10 ** p;
  return `${round(L, 3)} ${round(C, 3)} ${round(H, 1)}`;
}
