import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Drop every emitted CSS asset from THIS build's output. The package's full
 * stylesheet (`dist/style.css`) is produced by the main `vite.config.ts` build
 * and referenced by the `.`/`./style.css` exports; the subpath sources pull the
 * same CSS in only as a side-effect import (the `table` area imports
 * `pivot-table.css`), so re-emitting (a partial) `style.css` here would clobber
 * the canonical one. We keep the JS chunks and discard the CSS.
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
      for (const rel of ['style.css', 'assets/style.css', 'assets/pivot.css']) {
        const p = resolve(outDir, rel);
        // Never delete the canonical top-level dist/style.css here — only sweep
        // stray copies the subpath pass may have emitted under assets/. The
        // generateBundle hook above already strips style.css from this pass's
        // own output, and emptyOutDir:false preserves the main build's file.
        if (rel !== 'style.css' && existsSync(p)) rmSync(p);
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
 * Additive **subpath** build for `@jects/pivot`.
 *
 * This is a SECOND build (run after the main `vite.config.ts` ES+UMD build, with
 * `emptyOutDir: false`) that emits one ES chunk per cleanly-separable area of the
 * package, so consumers can `import { … } from '@jects/pivot/engine'` (or
 * `/table`, `/export`) and pull ONLY that area's code.
 *
 * Verified against the source import graph:
 * - `engine`  → the framework-free aggregation/format/conditional/export layer;
 *   imports only its own files (no widget, no hub).
 * - `table`   → the `PivotTable` widget + projection helpers; imports its own
 *   files plus the `engine` area (its real dependency, shared via a `_shared/`
 *   chunk) and the `@jects/*` peers — but NOT the hub `src/index.ts`.
 * - `export`  → CSV/XLSX/XLS + ZIP primitives; imports only `engine/export.ts`,
 *   `engine/xlsx.ts`, `engine/zip.ts`. Their reference into the rest of the
 *   engine is the type-only `PivotResult` import (erased at build), so this chunk
 *   carries NO aggregation engine, conditional layer, widget, or hub.
 *
 * The main `.` entry (`dist/pivot.js` ES + `dist/pivot.umd.cjs` UMD) is produced
 * by `vite.config.ts` and left completely intact + tree-shakeable; this build
 * only ADDS the subpath chunks (and reuses the per-directory `.d.ts` already
 * emitted by the main build's vite-plugin-dts).
 *
 * ES-only with multiple inputs (UMD cannot express multiple entry points) — the
 * same proven shape as `packages/gantt/vite.subpaths.config.ts`.
 */
const root = import.meta.dirname;
const src = resolve(root, 'src');

const entries = {
  engine: resolve(src, 'engine/index.ts'),
  table: resolve(src, 'table/index.ts'),
  export: resolve(src, 'export/index.ts'),
} as const;

export default defineConfig({
  build: {
    // Append to the main build's output — never wipe `pivot.js`/`pivot.umd.cjs`.
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
        // One file per entry; shared code (the engine pulled by table) lands in a
        // stable `_shared/` chunk both the table and engine entries reference.
        entryFileNames: '[name].js',
        chunkFileNames: '_shared/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
        exports: 'named',
      },
    },
  },
  // `dropCssAssets`: keep the canonical `dist/style.css` from the main build.
  // No dts plugin here: the main build already emits per-directory `.d.ts`
  // (dist/engine/index.d.ts, dist/table/index.d.ts, dist/export/index.d.ts)
  // that the `exports` map points each subpath's `types` at.
  plugins: [dropCssAssets(resolve(root, 'dist'))],
});
