import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Drop every emitted CSS asset from THIS build's output. The package's full
 * stylesheet (`dist/style.css`) is produced by the main `vite.config.ts` build
 * and referenced by the `.`/`./style.css` exports; the subpath sources pull the
 * same CSS in only as a side-effect import, so re-emitting (a partial) `style.css`
 * here would clobber the canonical one. We keep the JS chunks and discard the CSS.
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
      for (const rel of ['assets/kanban.css', 'assets/style.css']) {
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
 * Additive **subpath** build for `@jects/kanban`.
 *
 * This is a SECOND build (run after the main `vite.config.ts` UMD+ES build, with
 * `emptyOutDir: false`) that emits one ES chunk per cleanly-separable area of the
 * package, so consumers can `import { … } from '@jects/kanban/editor'` (or
 * `/data-provider`) and pull ONLY that area's code.
 *
 * Each entry points at the area's barrel and — verified against the source import
 * graph — imports only its own area:
 *  - `editor`  → `../editor.ts` (+ `../card.ts` for `escapeHtml`, + type-only
 *    `../types.ts`). It does NOT import `../board.ts` or `../data-provider.ts`.
 *  - `data-provider` → `../data-provider.ts` (+ type-only `../types.ts`). It
 *    imports nothing else local.
 *
 * Neither area imports the `TaskBoard` widget (`board.ts`), so the chunks stay
 * small and do NOT re-bundle the whole package. (`./board` and `./export` are
 * intentionally NOT exposed here: the board IS the package hub — it imports card,
 * editor, data-provider and types — and `export` is a method on that class, not a
 * separable module. They are documented as deferred; the tree-shakeable main `.`
 * entry remains the way to reach them.)
 *
 * The main `.` entry (`dist/kanban.js` ES + `dist/kanban.umd.cjs` UMD) is produced
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
  editor: resolve(src, 'editor/index.ts'),
  'data-provider': resolve(src, 'data-provider/index.ts'),
} as const;

export default defineConfig({
  build: {
    // Append to the main build's output — never wipe `kanban.js`/`kanban.umd.cjs`.
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
        // One file per entry; shared code (e.g. card/types) lands in a stable chunk.
        entryFileNames: '[name].js',
        chunkFileNames: '_shared/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
        exports: 'named',
      },
    },
  },
  // `dropCssAssets`: keep the canonical `dist/style.css` from the main build.
  // No dts plugin here: the main build already emits per-directory `.d.ts`
  // (dist/editor/index.d.ts, dist/data-provider/index.d.ts) that the `exports`
  // map points each subpath's `types` at.
  plugins: [dropCssAssets(resolve(root, 'dist'))],
});
