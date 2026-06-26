import { jectsLibConfig } from '@jects/vite-config';

// Single-entry UMD pass for @jects/widgets, kept ONLY to satisfy the `.`
// export's `require` condition (`dist/widgets.umd.cjs`). It runs FIRST and is the
// pass that empties `dist`; the multi-entry ESM build (`vite.config.ts`) then
// adds `dist/widgets.js`, the per-subpath chunks, and the `.d.ts` files.
//
// UMD cannot express multiple entry points, so the additive family subpaths are
// ESM-only — this pass intentionally emits only the main bundle and the CSS.
export default jectsLibConfig({
  root: import.meta.dirname,
  name: 'JectsWidgets',
  fileName: 'widgets',
  formats: ['umd'],
  // The ESM pass owns type emission; skip dts here to avoid double work.
  dts: false,
  globals: {
    '@jects/core': 'JectsCore',
    '@jects/icons': 'JectsIcons',
    '@jects/theme': 'JectsTheme',
  },
});
