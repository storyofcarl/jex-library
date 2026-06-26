import { jectsLibConfig } from '@jects/vite-config';

/**
 * @jects/scheduler — UMD-only second pass for the MAIN entry.
 *
 * The primary `vite.config.ts` is ES-only multi-entry (UMD cannot express
 * multiple entry points). This pass re-emits ONLY the single-file UMD bundle for
 * the `.` entry (`dist/scheduler.umd.cjs`) so the package `require` field keeps
 * resolving. It must run AFTER the ESM pass and must NOT empty the outDir or
 * re-emit `.d.ts` (the ESM pass already produced both). Chained in the package
 * `build` script.
 */
export default jectsLibConfig({
  root: import.meta.dirname,
  name: 'JectsScheduler',
  fileName: 'scheduler',
  formats: ['umd'],
  emptyOutDir: false,
  dts: false,
  globals: {
    '@jects/core': 'JectsCore',
    '@jects/timeline-core': 'JectsTimelineCore',
    '@jects/grid': 'JectsGrid',
    '@jects/widgets': 'JectsWidgets',
    '@jects/theme': 'JectsTheme',
  },
});
