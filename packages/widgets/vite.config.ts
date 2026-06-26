import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// Multi-entry ESM build for @jects/widgets.
//
// The MAIN entry `index` still emits `dist/widgets.js` (the file the deployed
// gallery's importmap resolves `@jects/widgets` to) and stays fully
// tree-shakeable. ON TOP of that we emit one ESM chunk per additive family
// subpath (`forms`, `overlays`, `rich-text`, `fields`, `nav`, `layout`,
// `datetime`, `pickers`, `data-views`). Each subpath chunk imports ONLY its own
// family's code; any leaf shared between a subpath and the main entry (e.g. the
// Button leaf used by `nav`, or the `anchored-panel` positioner used by
// `datetime`/`pickers`) is hoisted by Rollup into a `_shared/` chunk that both
// reference — never the whole package.
//
// UMD cannot express multiple entry points, so this build is ES-only and the
// single-entry UMD output (`dist/widgets.umd.cjs`, kept for the `.` `require`
// condition) is produced by the companion `vite.config.umd.ts` pass.
const root = import.meta.dirname;
const src = resolve(root, 'src');

const entries = {
  // Main entry — MUST keep emitting `dist/widgets.js`.
  widgets: resolve(src, 'index.ts'),
  // Additive family subpaths.
  forms: resolve(src, 'forms.ts'),
  overlays: resolve(src, 'overlays.ts'),
  'rich-text': resolve(src, 'rich-text.ts'),
  fields: resolve(src, 'fields.ts'),
  nav: resolve(src, 'nav.ts'),
  layout: resolve(src, 'layout.ts'),
  datetime: resolve(src, 'datetime.ts'),
  pickers: resolve(src, 'pickers.ts'),
  'data-views': resolve(src, 'data-views.ts'),
} as const;

export default defineConfig({
  build: {
    // The UMD pass runs first and writes `widgets.umd.cjs`; do not wipe it.
    emptyOutDir: false,
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
