import { resolve } from 'node:path';
import { defineConfig, type UserConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { jectsLibConfig } from '@jects/vite-config';

/**
 * Two-pass library build for `@jects/spreadsheet`.
 *
 * Pass `main` (default) — the package entry `.`: ESM (`spreadsheet.js`) + UMD
 * (`spreadsheet.umd.cjs`), exactly as before. UMD cannot express multiple entry
 * points, so the main entry keeps its own single-entry pass. This pass owns
 * `emptyOutDir` (it runs first and clears `dist`).
 *
 * Pass `subpaths` (run with `--mode subpaths`, `emptyOutDir:false`) — the
 * additive subpath entries. Each is a REAL separate ESM chunk that imports only
 * its own cleanly-separable area:
 *   - `./engine` → `src/entry-engine.ts` → `src/engine/*` only (headless formula core)
 *   - `./io`     → `src/entry-io.ts`     → the pure CSV/JSON/XLSX/ZIP transforms only
 * Shared code Rollup hoists lands in `_shared/`. The `@jects/*` peer scope stays
 * external so the main entry and subpaths are tree-shakeable and never bundle a
 * sibling package.
 *
 * The `build` script runs both passes (see package.json).
 */

const root = import.meta.dirname;
const src = resolve(root, 'src');

const subpathConfig: UserConfig = defineConfig({
  build: {
    // Do NOT clear dist — the main pass produced spreadsheet.js/.umd.cjs first.
    emptyOutDir: false,
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: {
        engine: resolve(src, 'entry-engine.ts'),
        io: resolve(src, 'entry-io.ts'),
      },
      // UMD cannot express multiple entries; subpaths are ESM-only.
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^@jects\//],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '_shared/[name]-[hash].js',
        exports: 'named',
      },
    },
  },
  plugins: [
    dts({
      entryRoot: src,
      insertTypesEntry: false,
      tsconfigPath: resolve(root, 'tsconfig.json'),
      // Only emit declarations for the subpath barrels + what they reach.
      include: ['src/entry-engine.ts', 'src/entry-io.ts'],
    }),
  ],
}) as UserConfig;

export default defineConfig(({ mode }) =>
  mode === 'subpaths'
    ? subpathConfig
    : jectsLibConfig({
        root,
        name: 'JectsSpreadsheet',
        fileName: 'spreadsheet',
        globals: {
          '@jects/core': 'JectsCore',
          '@jects/grid': 'JectsGrid',
          '@jects/widgets': 'JectsWidgets',
          '@jects/theme': 'JectsTheme',
        },
      }),
);
