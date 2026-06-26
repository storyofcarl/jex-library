/**
 * Scheduler export — canvas + raster helpers.
 *
 * Bridges the pure rasterizer to a real raster surface. In the browser this
 * uses `<canvas>` + `toDataURL` / `getImageData`; the functions are written so a
 * test can inject a stub canvas. No hard dependency on a specific canvas
 * implementation beyond the standard 2D context shape.
 */

import type { Canvas2DLike } from './paint-canvas.js';

/** A canvas surface the exporter can draw to + read back from. */
export interface RasterSurface {
  readonly width: number;
  readonly height: number;
  readonly ctx: Canvas2DLike;
  /** RGBA bytes (length width*height*4), row-major. */
  getRgba(): Uint8ClampedArray;
  /** A PNG `image/png` data URL of the current pixels (browser only). */
  toPngDataUrl(): string;
}

/** Factory for raster surfaces (overridable for tests / node-canvas). */
export type CanvasFactory = (width: number, height: number) => RasterSurface;

/** Default factory: real DOM `<canvas>`. Throws if `document` is unavailable. */
export const domCanvasFactory: CanvasFactory = (width, height) => {
  if (typeof document === 'undefined') {
    throw new Error('Scheduler export requires a DOM canvas; provide a canvasFactory for headless use.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable.');
  return {
    width: canvas.width,
    height: canvas.height,
    ctx: ctx as unknown as Canvas2DLike,
    getRgba: () => ctx.getImageData(0, 0, canvas.width, canvas.height).data,
    toPngDataUrl: () => canvas.toDataURL('image/png'),
  };
};

/** Strip alpha → packed RGB bytes for PDF embedding (flattens onto white). */
export function rgbaToRgb(rgba: Uint8ClampedArray, opaqueBackground = true): Uint8Array {
  const px = rgba.length / 4;
  const out = new Uint8Array(px * 3);
  for (let i = 0; i < px; i++) {
    const a = rgba[i * 4 + 3]! / 255;
    if (opaqueBackground && a < 1) {
      // Composite over white.
      out[i * 3] = Math.round(rgba[i * 4]! * a + 255 * (1 - a));
      out[i * 3 + 1] = Math.round(rgba[i * 4 + 1]! * a + 255 * (1 - a));
      out[i * 3 + 2] = Math.round(rgba[i * 4 + 2]! * a + 255 * (1 - a));
    } else {
      out[i * 3] = rgba[i * 4]!;
      out[i * 3 + 1] = rgba[i * 4 + 1]!;
      out[i * 3 + 2] = rgba[i * 4 + 2]!;
    }
  }
  return out;
}

/** Base64-encode bytes (works in browser + node + jsdom). */
export function toBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }
  // Node fallback.
  const g = globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } };
  if (g.Buffer) return g.Buffer.from(bytes).toString('base64');
  throw new Error('No base64 encoder available.');
}
