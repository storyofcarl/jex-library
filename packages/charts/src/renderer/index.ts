export type { Renderer, StrokeStyle, FillStyle, TextStyle, GradientSpec } from './renderer.js';
export { SvgRenderer, svgStringToPng } from './svg-renderer.js';
export { CanvasRenderer } from './canvas-renderer.js';
export { pngDataUrlToPdf, pngDataUrlToPdfBytes } from './pdf.js';

import type { Renderer } from './renderer.js';
import { SvgRenderer } from './svg-renderer.js';
import { CanvasRenderer } from './canvas-renderer.js';

/** Create a renderer for the requested backend. */
export function createRenderer(kind: 'svg' | 'canvas', width: number, height: number): Renderer {
  return kind === 'canvas' ? new CanvasRenderer(width, height) : new SvgRenderer(width, height);
}
