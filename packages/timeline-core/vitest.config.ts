import { defineConfig } from 'vitest/config';

// Default (CI-safe) test run uses jsdom and excludes the real-browser suite,
// which requires Playwright Chromium (`pnpm test:browser`).
export default defineConfig({
  test: {
    environment: 'jsdom',
    // This package is a Wave-4 (D10) scaffold: contract/types only, no unit
    // tests yet. Without this, `vitest run` exits 1 on "No test files found",
    // which fails the repo-wide `pnpm test` gate. Don't gate-fail a not-yet-
    // implemented package for having no tests; real suites land with D10.
    passWithNoTests: true,
    include: ['src/**/*.test.ts'],
    // The real-browser suites (`*.browser.test.ts`) and the axe-core a11y suites
    // (`*.a11y.test.ts`) require Playwright Chromium — run via `pnpm test:browser`.
    exclude: ['src/**/*.browser.test.ts', 'src/**/*.a11y.test.ts', 'node_modules/**'],
  },
});
