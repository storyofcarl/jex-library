/**
 * `@jects/charts/export` — rasterize/export helpers (SVG→PNG, PNG→PDF).
 *
 * A standalone re-export barrel for the export primitives the Chart widget's
 * `png()`/`pdf()` methods rely on. Consumers that only need to turn an SVG string
 * into a PNG data URL, or wrap a PNG into a single-page PDF, can
 * `import { … } from '@jects/charts/export'` and pull ONLY this area:
 *
 * - `pdf.ts` is a zero-dependency, zero-import PDF writer.
 * - `svgStringToPng` lives in `svg-renderer.ts`, which imports only the type-only
 *   `renderer.ts` (erased at runtime).
 *
 * The emitted chunk therefore does not bundle the Chart widget or the package hub.
 */
export { svgStringToPng } from '../renderer/svg-renderer.js';
export { pngDataUrlToPdf, pngDataUrlToPdfBytes } from '../renderer/pdf.js';
