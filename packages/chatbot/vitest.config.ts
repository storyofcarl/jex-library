import { defineConfig } from 'vitest/config';

// Default (CI-safe) test run uses jsdom and excludes the real-browser suite,
// which requires Playwright Chromium (`pnpm test:browser`).
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // The real-browser suites (`*.browser.test.ts`) and the axe-core a11y suites
    // (`*.a11y.test.ts`) require Playwright Chromium — run via `pnpm test:browser`.
    exclude: ['src/**/*.browser.test.ts', 'src/**/*.a11y.test.ts', 'node_modules/**'],
  },
});
