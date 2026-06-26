import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Drop every emitted CSS asset from THIS build's output. The package's full
 * stylesheet (`dist/style.css`) is produced by the main `vite.config.ts` build
 * and referenced by the `.`/`./style.css` exports; the subpath sources pull no
 * CSS (they are headless / DOM-light), but should any side-effect import drag a
 * stylesheet in, re-emitting (a partial) `style.css` here would clobber the
 * canonical one. We keep the JS chunks and discard the CSS.
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
      for (const rel of ['assets/diagram.css', 'assets/style.css']) {
        const p = resolve(outDir, rel);
        if (existsSync(p)) rmSync(p);
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
 * Additive **subpath** build for `@jects/diagram`.
 *
 * This is a SECOND build (run after the main `vite.config.ts` UMD+ES build, with
 * `emptyOutDir: false`) that emits one ES chunk per cleanly-separable area of the
 * package, so consumers can `import { … } from '@jects/diagram/engine'` (or
 * `/export`, `/layout`, `/shapes`) and pull ONLY that area's code.
 *
 * Each entry points at an existing, already-separable module:
 *   - `engine` → `src/engine/index.ts` — the headless DiagramEngine + every pure
 *     algorithm (geometry, shapes, routing, layout, hit-test, swimlanes,
 *     serialization). DOM-free; imports only its own siblings + `@jects/core`
 *     (external) + the type-only `contract.ts` (erased at build).
 *   - `export` → `src/ui/export.ts` — DOM-light SVG/PNG/PDF/JSON export helpers.
 *     Imports ONLY the type-only `contract.ts` (erased) → a tiny standalone chunk.
 *   - `layout` → `src/engine/layout.ts` — pure auto-layout passes. Imports only
 *     `engine/geometry.ts` (hoisted to a shared chunk) + type-only contract.
 *   - `shapes` → `src/engine/shapes.ts` — the DOM-free built-in shape catalog
 *     (ports / outline / cardinal-port geometry). Imports only type-only contract.
 *
 * Verified against the source import graph: NONE of these areas import the
 * `Diagram` widget (`src/ui/diagram.ts`) or the package `index.ts` hub, so the
 * chunks stay small and do NOT re-bundle the whole package. (The `./ui` barrel is
 * intentionally NOT exposed — `src/ui/index.ts` re-exports `Diagram`, which is the
 * package hub, so a `./ui` subpath would pull the whole bundle; it is deferred.)
 *
 * The main `.` entry (`dist/diagram.js` ES + `dist/diagram.umd.cjs` UMD) is
 * produced by `vite.config.ts` and is left completely intact + tree-shakeable;
 * this build only ADDS the subpath chunks (and reuses the per-directory `.d.ts`
 * already emitted by the main build's vite-plugin-dts).
 *
 * ES-only with multiple inputs (UMD cannot express multiple entry points).
 */
const root = import.meta.dirname;
const src = resolve(root, 'src');

const entries = {
  engine: resolve(src, 'engine/index.ts'),
  export: resolve(src, 'ui/export.ts'),
  layout: resolve(src, 'engine/layout.ts'),
  shapes: resolve(src, 'engine/shapes.ts'),
} as const;

export default defineConfig({
  build: {
    // Append to the main build's output — never wipe `diagram.js`/`diagram.umd.cjs`.
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
        // One file per entry; shared code (e.g. engine geometry) lands in a
        // stable shared chunk that the relevant entries reference.
        entryFileNames: '[name].js',
        chunkFileNames: '_shared/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
        exports: 'named',
      },
    },
  },
  // `dropCssAssets`: keep the canonical `dist/style.css` from the main build.
  // No dts plugin here: the main build already emits per-module `.d.ts`
  // (dist/engine/index.d.ts, dist/ui/export.d.ts, dist/engine/layout.d.ts,
  // dist/engine/shapes.d.ts) that the `exports` map points each subpath's
  // `types` at.
  plugins: [dropCssAssets(resolve(root, 'dist'))],
});
