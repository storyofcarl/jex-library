import { defineConfig } from 'vitest/config';

// Default (CI-safe) test run uses jsdom and excludes the real-browser suite,
// which requires Playwright Chromium (`pnpm test:browser`).
export default defineConfig({
  test: {
    environment: 'jsdom',
    // Bound the worker pool: the default spawns one worker per CPU core, and on a
    // many-core machine the aggregate jsdom working set can thrash low-RAM boxes.
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 2 } },
    include: ['src/**/*.test.ts'],
    // The real-browser suites (`*.browser.test.ts`) and the axe-core a11y suites
    // (`*.a11y.test.ts`) require Playwright Chromium — run via `pnpm test:browser`.
    exclude: ['src/**/*.browser.test.ts', 'src/**/*.a11y.test.ts', 'node_modules/**'],
  },
});
