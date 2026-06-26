import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Drop every emitted CSS asset from THIS build's output. The package's full
 * stylesheet (`dist/style.css`) is produced by the main `vite.config.ts` build
 * and referenced by the `.`/`./style.css` exports; the subpath sources pull no
 * CSS at all (they re-export pure math / DOM-light helpers), but this guard makes
 * the second pass defensively never clobber the canonical `dist/style.css`.
 */
function dropCssAssets(outDir: string): Plugin {
  return {
    name: 'jects-drop-css-assets',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'asset' && fileName.endsWith('.css')) {
          delete bundle[fileName];
        }
      }
    },
    // Vite's CSS post-plugin can write style assets to disk outside the Rollup
    // bundle map; sweep any CSS this subpath build left behind so the main
    // build's canonical `dist/style.css` is the only stylesheet that survives.
    closeBundle() {
      for (const rel of ['assets/charts.css', 'assets/style.css', 'style.css']) {
        const p = resolve(outDir, rel);
        // Never delete a pre-existing canonical style.css from the main pass: only
        // sweep CSS this pass would have just (re)written into the assets dir.
        if (rel.startsWith('assets/') && existsSync(p)) rmSync(p);
      }
      const assetsDir = resolve(outDir, 'assets');
      if (existsSync(assetsDir)) {
        try {
          rmSync(assetsDir, { recursive: false });
        } catch {
          /* non-empty (real assets present) — leave it */
        }
      }
    },
  };
}

/**
 * Additive **subpath** build for `@jects/charts`.
 *
 * This is a SECOND build (run after the main `vite.config.ts` ES+UMD build, with
 * `emptyOutDir: false`) that emits one ES chunk per cleanly-separable area of the
 * package, so consumers can `import { … } from '@jects/charts/renderer'` (or
 * `/scales`, `/series`, `/export`) and pull ONLY that area's code.
 *
 * Each entry points at the area's existing barrel and — verified against the
 * source import graph — imports only its own area:
 *   - renderer/index.ts: the SVG/Canvas renderers + factory + pdf (self-contained).
 *   - scale/index.ts:     linear/log/category/time scales + tick math (self-contained).
 *   - series/index.ts:    series-math (depends only on the type-only chart/types).
 *   - export/index.ts:    svgStringToPng + PDF writer (DOM-light, no widget).
 * None of these import the `Chart` widget (`chart/chart.ts`) or the package hub
 * (`src/index.ts`), so the chunks stay small and do NOT re-bundle the whole package.
 *
 * The main `.` entry (`dist/charts.js` ES + `dist/charts.umd.cjs` UMD) is produced
 * by `vite.config.ts` and is left completely intact + tree-shakeable; this build
 * only ADDS the subpath chunks (and reuses the per-directory `.d.ts` already
 * emitted by the main build's vite-plugin-dts).
 *
 * ES-only with multiple inputs (UMD cannot express multiple entry points) — the
 * same proven shape as `packages/gantt/vite.subpaths.config.ts`.
 */
const root = import.meta.dirname;
const src = resolve(root, 'src');

const entries = {
  renderer: resolve(src, 'renderer/index.ts'),
  scales: resolve(src, 'scale/index.ts'),
  series: resolve(src, 'series/index.ts'),
  export: resolve(src, 'export/index.ts'),
} as const;

export default defineConfig({
  build: {
    // Append to the main build's output — never wipe `charts.js`/`charts.umd.cjs`.
    emptyOutDir: false,
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: entries,
      formats: ['es'],
    },
    rollupOptions: {
      // The whole `@jects/*` peer scope stays external so consumers ship core once.
      external: [/^@jects\//],
      output: {
        // One file per entry; shared code lands in a stable chunk.
        entryFileNames: '[name].js',
        chunkFileNames: '_shared/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
        exports: 'named',
      },
    },
  },
  // `dropCssAssets`: keep the canonical `dist/style.css` from the main build.
  // No dts plugin here: the main build already emits per-directory `.d.ts`
  // (dist/renderer/index.d.ts, dist/scale/index.d.ts, dist/series/index.d.ts,
  // dist/export/index.d.ts) that the `exports` map points each subpath's
  // `types` at.
  plugins: [dropCssAssets(resolve(root, 'dist'))],
});
