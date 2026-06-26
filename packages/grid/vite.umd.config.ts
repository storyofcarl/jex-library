import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Second build pass: emit ONLY the UMD `.cjs` main (dist/grid.umd.cjs) for the
// package's `require` / `main` fallback. The primary ESM + multi-entry build
// (vite.config.ts) runs first and owns dist (incl. all `.d.ts` and style.css);
// this pass appends the single UMD artifact, so `emptyOutDir` is false and dts
// is intentionally not re-emitted here.
const root = import.meta.dirname;

export default defineConfig({
  build: {
    emptyOutDir: false,
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(root, 'src/index.ts'),
      name: 'JectsGrid',
      formats: ['umd'],
      fileName: () => 'grid.umd.cjs',
    },
    rollupOptions: {
      external: [/^@jects\//],
      output: {
        globals: {
          '@jects/core': 'JectsCore',
          '@jects/theme': 'JectsTheme',
          '@jects/widgets': 'JectsWidgets',
        },
        // The canonical, complete `style.css` is emitted by the primary ESM pass
        // (which sees every entry's CSS graph). Route this pass's CSS to a
        // throwaway name so it never overwrites that artifact, then drop it.
        assetFileNames: (asset) =>
          asset.names?.some((n) => n.endsWith('.css'))
            ? '_umd-style-discard.css'
            : 'assets/[name][extname]',
        exports: 'named',
      },
    },
  },
  plugins: [],
});
