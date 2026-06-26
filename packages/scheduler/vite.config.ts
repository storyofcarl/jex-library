import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

/**
 * @jects/scheduler — multi-entry library build.
 *
 * The package ships ONE main entry (`.`) plus additive subpath entries that each
 * compile to their own self-contained chunk. Each subpath imports ONLY its own
 * area's code (plus the externalized `@jects/*` peer scope); Rollup hoists any
 * genuinely shared module into a `_shared/` chunk. This proves the subpaths are
 * REAL separate build entries — e.g. `./recurrence` does not pull in `view/` or
 * the rest of the package.
 *
 * ES-only with multiple inputs (UMD cannot express multiple entry points). The
 * legacy single-file UMD for the main entry is produced by the second pass in
 * `vite.umd.config.ts` (chained in the package `build` script), so the `.`
 * `require` field keeps resolving.
 *
 * The `.` ESM output is still emitted as `dist/scheduler.js` (unchanged name) and
 * stays fully tree-shakeable — the deployed gallery imports it.
 */
const root = import.meta.dirname;
const src = resolve(root, 'src');

const entries = {
  // Main entry — name preserved as `scheduler.js` (the gallery imports it).
  scheduler: resolve(src, 'index.ts'),
  // Additive subpath entries (each a real, separable module).
  export: resolve(src, 'export/index.ts'),
  pro: resolve(src, 'pro/index.ts'),
  model: resolve(src, 'model/index.ts'),
  recurrence: resolve(src, 'recurrence.ts'),
} as const;

export default defineConfig({
  build: {
    emptyOutDir: true,
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: entries,
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^@jects\//],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '_shared/[name]-[hash].js',
        assetFileNames: (asset) =>
          asset.names?.some((n) => n.endsWith('.css')) ? 'style.css' : 'assets/[name][extname]',
        exports: 'named',
      },
    },
  },
  plugins: [
    dts({
      entryRoot: src,
      insertTypesEntry: false,
      tsconfigPath: resolve(root, 'tsconfig.json'),
    }),
  ],
});
