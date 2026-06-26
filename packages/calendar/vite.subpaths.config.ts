import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Drop every emitted CSS asset from THIS build's output. The package's full
 * stylesheet (`dist/style.css`) is produced by the main `vite.config.ts` build
 * and referenced by the `.`/`./style.css` exports; the subpath sources pull no
 * CSS of their own, but Vite can still emit an (empty/partial) `style.css` for a
 * lib build, which would clobber the canonical one. We keep the JS chunks and
 * discard any CSS this pass produces.
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
      // NOTE: never touch the root `dist/style.css` — that is the canonical
      // stylesheet from the MAIN build. `generateBundle` above already strips any
      // CSS from THIS pass's bundle map; here we only sweep stray asset-dir CSS.
      for (const rel of ['assets/style.css', 'assets/calendar.css', 'assets/editor.css']) {
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
 * Additive **subpath** build for `@jects/calendar`.
 *
 * This is a SECOND build (run after the main `vite.config.ts` UMD+ES build, with
 * `emptyOutDir: false`) that emits one ES chunk per cleanly-separable area of the
 * package, so consumers can `import { … } from '@jects/calendar/recurrence'`
 * (or `/timezone`, `/export`, `/editor`) and pull ONLY that area's code.
 *
 * Each entry points at a thin per-area barrel that re-exports the corresponding
 * existing flat module. Verified against the source import graph:
 *
 *  - `recurrence` → `src/recurrence.ts` (imports only type-only `contract` +
 *    pure `date-utils`).
 *  - `timezone`   → `src/tz.ts` (no internal imports at all).
 *  - `export`     → `src/export.ts` (type-only `contract` + `recurrence`'s
 *    `toRRule`, which pulls only `date-utils`).
 *  - `editor`     → `src/editor.ts` (externalized peers `@jects/core` +
 *    `@jects/widgets`, plus pure `date-utils` + type-only `contract`).
 *
 * NONE of these import the `Calendar` widget (`calendar.ts`) or the package hub
 * (`index.ts`), so the chunks stay small and do NOT re-bundle the whole package.
 * The shared pure leaf (`date-utils`) is hoisted by Rollup into a `_shared/`
 * chunk that the relevant entries reference.
 *
 * The main `.` entry (`dist/calendar.js` ES + `dist/calendar.umd.cjs` UMD) is
 * produced by `vite.config.ts` and is left completely intact + tree-shakeable;
 * this build only ADDS the subpath chunks (and reuses the per-area `.d.ts`
 * already emitted by the main build's vite-plugin-dts at
 * `dist/<area>/index.d.ts`).
 *
 * ES-only with multiple inputs (UMD cannot express multiple entry points) — the
 * same proven shape as `packages/gantt/vite.subpaths.config.ts`.
 */
const root = import.meta.dirname;
const src = resolve(root, 'src');

const entries = {
  recurrence: resolve(src, 'recurrence/index.ts'),
  timezone: resolve(src, 'timezone/index.ts'),
  export: resolve(src, 'export/index.ts'),
  editor: resolve(src, 'editor/index.ts'),
} as const;

export default defineConfig({
  build: {
    // Append to the main build's output — never wipe `calendar.js`/`calendar.umd.cjs`.
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
        // One file per entry; shared code (date-utils) lands in a stable chunk.
        entryFileNames: '[name].js',
        chunkFileNames: '_shared/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
        exports: 'named',
      },
    },
  },
  // `dropCssAssets`: keep the canonical `dist/style.css` from the main build.
  // No dts plugin here: the main build already emits per-area `.d.ts`
  // (dist/recurrence/index.d.ts, dist/timezone/index.d.ts, …) that the `exports`
  // map points each subpath's `types` at.
  plugins: [dropCssAssets(resolve(root, 'dist'))],
});
