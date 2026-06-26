import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// Multi-entry ESM build for @jects/grid.
//
// The MAIN entry (`grid` -> dist/grid.js, built from src/index.ts) stays the
// keystone published artifact (the deployed gallery importmap points here) and
// is tree-shakeable: features/columns/engine symbols are plain named re-exports.
//
// ADDITIVE subpath entries each compile to their OWN `dist/<area>.js` chunk that
// imports only its own source area (plus the externalized `@jects/*` peer scope
// and any genuinely shared engine seam). They let consumers reach a single area
// — e.g. `@jects/grid/features` — without naming it through the package root.
// We build ES-only here because Vite lib mode cannot express multiple inputs as
// UMD; the UMD `.cjs` main is emitted by the second pass (vite.umd.config.ts),
// preserving the existing `require` / `main` fallback.
const root = import.meta.dirname;
const src = resolve(root, 'src');

const entries = {
  // Keystone main entry — unchanged published surface (dist/grid.js).
  grid: resolve(src, 'index.ts'),
  // Additive, cleanly-separable area barrels (each its own chunk).
  engine: resolve(src, 'engine/index.ts'),
  columns: resolve(src, 'columns/index.ts'),
  features: resolve(src, 'features/index.ts'),
  'header-groups': resolve(src, 'header-groups/index.ts'),
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
      external: [/^@jects\//, 'react', 'react-dom', 'react/jsx-runtime'],
      output: {
        // One file per entry; code shared across entries (e.g. an engine seam a
        // feature reuses) is hoisted into a stable `_shared/` chunk both
        // reference — so a subpath never inlines a whole sibling area.
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
