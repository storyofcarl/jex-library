import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import dts from 'vite-plugin-dts';

/**
 * Drop every emitted CSS asset from THIS build's output. The package's full
 * stylesheet (`dist/style.css`) is produced by the main `vite.config.ts` build
 * and referenced by the `.`/`./style.css` exports. The subpath source pulls no
 * CSS (it is a pure, DOM-free area), but the side-effect-import safety net here
 * guarantees a partial `style.css` from this pass can never clobber the canonical
 * one. We keep the JS chunks and discard any stray CSS.
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
      // Only sweep CSS this subpath pass may have left inside its own `assets/`
      // dir. NEVER touch the root `dist/style.css` — that is the canonical
      // stylesheet emitted by the main build and referenced by `./style.css`.
      for (const rel of ['assets/todo.css', 'assets/style.css']) {
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
 * Additive **subpath** build for `@jects/todo`.
 *
 * This is a SECOND build (run after the main `vite.config.ts` UMD+ES build, with
 * `emptyOutDir: false`) that emits one ES chunk per cleanly-separable area of the
 * package, so consumers can `import { tasksToCsv } from '@jects/todo/export'` and
 * pull ONLY that area's code.
 *
 * Only ONE area in this package is cleanly separable today: the import/export
 * helpers in `src/todo-utils.ts`, which import nothing but the type-only
 * `src/contract.ts`. The `./export` barrel (`src/export/index.ts`) re-exports just
 * those serializers, so its chunk contains the pure helper area and NOT the
 * `TodoList` widget (`src/todo-list.ts`), `@jects/widgets`, or the package hub
 * (`src/index.ts`).
 *
 * The Board / Timeline / Table *views* are NOT separable: they are rendering
 * methods baked into the single `TodoList` class in `src/todo-list.ts`, so any
 * `./board` / `./timeline` / `./table` subpath would re-bundle the whole widget +
 * hub. They are intentionally deferred (the main `.` entry stays tree-shakeable).
 *
 * The main `.` entry (`dist/todo.js` ES + `dist/todo.umd.cjs` UMD) is produced by
 * `vite.config.ts` and is left completely intact + tree-shakeable; this build only
 * ADDS the `./export` chunk and its `.d.ts`.
 *
 * ES-only with a multi-entry shape (UMD cannot express multiple entry points) —
 * the same proven pattern as `packages/gantt/vite.subpaths.config.ts`.
 */
const root = import.meta.dirname;
const src = resolve(root, 'src');

const entries = {
  export: resolve(src, 'export/index.ts'),
} as const;

export default defineConfig({
  build: {
    // Append to the main build's output — never wipe `todo.js`/`todo.umd.cjs`.
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
        // One file per entry; shared code lands in a stable `_shared/` chunk.
        entryFileNames: '[name].js',
        chunkFileNames: '_shared/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
        exports: 'named',
      },
    },
  },
  plugins: [
    // The main build's dts only follows the import graph from `src/index.ts`,
    // which does not reach the new `src/export/index.ts` barrel — so this pass
    // emits `dist/export/index.d.ts` itself. `insertTypesEntry: false` keeps it
    // from touching the canonical `dist/index.d.ts` written by the main build.
    dts({
      entryRoot: src,
      insertTypesEntry: false,
      tsconfigPath: resolve(root, 'tsconfig.json'),
      include: ['src/export/**', 'src/todo-utils.ts', 'src/contract.ts'],
    }),
    // `dropCssAssets`: keep the canonical `dist/style.css` from the main build.
    dropCssAssets(resolve(root, 'dist')),
  ],
});
