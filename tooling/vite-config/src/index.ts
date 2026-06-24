import { resolve } from 'node:path';
import { defineConfig, type UserConfig, type LibraryFormats } from 'vite';
import dts from 'vite-plugin-dts';

export interface JectsLibOptions {
  /** Absolute path to the package root (pass `__dirname` or `import.meta.dirname`). */
  root: string;
  /** Entry file relative to `root`. Default `src/index.ts`. */
  entry?: string;
  /** UMD/IIFE global name, e.g. `JectsCore`. */
  name: string;
  /** UMD module file basename. Default derived from `name` lowercased. */
  fileName?: string;
  /** Output formats. Default `['es', 'umd']`. */
  formats?: LibraryFormats[];
  /**
   * Extra externals beyond the always-externalized `@jects/*` peer scope.
   * Accepts strings or RegExps.
   */
  external?: (string | RegExp)[];
  /** Globals map for UMD/IIFE builds. */
  globals?: Record<string, string>;
  /** Whether to emit `.d.ts` via vite-plugin-dts. Default `true`. */
  dts?: boolean;
  /**
   * Whether Vite should empty `outDir` before building. Default `true`.
   * Set `false` for packages that pre-generate assets into `dist` (theme/icons).
   */
  emptyOutDir?: boolean;
}

/**
 * Shared Vite **library** preset for every `@jects/*` package.
 *
 * - ESM + UMD output (CDN-ready), `.d.ts` via vite-plugin-dts.
 * - Always externalizes the `@jects/*` peer scope so a consumer ships core once.
 * - CSS is emitted unbundled as `dist/style.css` (referenced from the package `exports` map).
 */
export function jectsLibConfig(options: JectsLibOptions): UserConfig {
  const {
    root,
    entry = 'src/index.ts',
    name,
    fileName = name.toLowerCase(),
    formats = ['es', 'umd'] as LibraryFormats[],
    external = [],
    globals = {},
    dts: emitDts = true,
    emptyOutDir = true,
  } = options;

  // Always treat the @jects scope as a peer (externalized), plus any caller extras.
  const externals: (string | RegExp)[] = [/^@jects\//, ...external];

  return defineConfig({
    build: {
      emptyOutDir,
      lib: {
        entry: resolve(root, entry),
        name,
        formats,
        fileName: (format) => (format === 'es' ? `${fileName}.js` : `${fileName}.${format}.cjs`),
      },
      sourcemap: true,
      cssCodeSplit: false,
      rollupOptions: {
        external: externals,
        output: {
          globals,
          assetFileNames: (asset) =>
            asset.names?.some((n) => n.endsWith('.css')) ? 'style.css' : 'assets/[name][extname]',
          exports: 'named',
        },
      },
    },
    plugins: emitDts
      ? [
          dts({
            entryRoot: resolve(root, 'src'),
            insertTypesEntry: true,
            tsconfigPath: resolve(root, 'tsconfig.json'),
          }),
        ]
      : [],
  }) as UserConfig;
}

export default jectsLibConfig;
