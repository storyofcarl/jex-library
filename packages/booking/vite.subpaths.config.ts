import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Drop every emitted CSS asset from THIS build's output. The package's full
 * stylesheet (`dist/style.css`) is produced by the main `vite.config.ts` build
 * and referenced by the `.`/`./style.css` exports. The subpath sources never
 * import the package CSS, but guard against any stray stylesheet so the main
 * build's canonical `dist/style.css` is the only one that survives.
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
    closeBundle() {
      for (const rel of ['assets/booking.css', 'assets/style.css', 'style.css']) {
        const p = resolve(outDir, rel);
        // Never remove the canonical top-level style.css from the main build.
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
 * Additive **subpath** build for `@jects/booking`.
 *
 * A SECOND build (run after the main `vite.config.ts` ES+UMD build, with
 * `emptyOutDir: false`) that emits one ES chunk per cleanly-separable area of
 * the package, so consumers can `import { … } from '@jects/booking/timezone'`
 * (or `/availability`, `/ics`) and pull ONLY that area's code.
 *
 * Verified against the source import graph:
 *  - `timezone`     → `src/booking/timezone.ts` (zero internal imports).
 *  - `ics`          → `src/booking/ics.ts` (zero internal imports).
 *  - `availability` → `src/booking/availability-rules.ts` + `slots.ts` only.
 * None of these import the `Booking` widget (`src/booking/booking.ts`),
 * `@jects/widgets`, or the package CSS, so the chunks stay small and do NOT
 * re-bundle the whole package hub.
 *
 * The main `.` entry (`dist/booking.js` ES + `dist/booking.umd.cjs` UMD) is
 * produced by `vite.config.ts` and left completely intact + tree-shakeable;
 * this build only ADDS the subpath chunks. The per-file `.d.ts` for each barrel
 * (`dist/subpaths/{availability,timezone,ics}.d.ts`) is already emitted by the
 * main build's vite-plugin-dts (its entryRoot is `src/`).
 *
 * ES-only with multiple inputs (UMD cannot express multiple entry points) — the
 * same proven shape as `packages/gantt/vite.subpaths.config.ts`.
 */
const root = import.meta.dirname;
const src = resolve(root, 'src');

const entries = {
  availability: resolve(src, 'subpaths/availability.ts'),
  timezone: resolve(src, 'subpaths/timezone.ts'),
  ics: resolve(src, 'subpaths/ics.ts'),
} as const;

export default defineConfig({
  build: {
    // Append to the main build's output — never wipe `booking.js`/`booking.umd.cjs`.
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
        // One file per entry; shared code lands in a stable hashed chunk.
        entryFileNames: '[name].js',
        chunkFileNames: '_shared/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
        exports: 'named',
      },
    },
  },
  plugins: [dropCssAssets(resolve(root, 'dist'))],
});
