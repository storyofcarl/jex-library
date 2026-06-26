import { defineConfig } from 'vitest/config';

// Default (CI-safe) test run uses jsdom and excludes the real-browser suite,
// which requires Playwright Chromium (`pnpm test:browser`).
export default defineConfig({
  test: {
    environment: 'jsdom',
    // Bound the worker pool. The default spawns one worker per CPU core, and
    // each fork loads jsdom + the full Scheduler bundle and builds real DOM —
    // on a many-core machine that aggregate working set peaked at >20 GB and
    // thrashed low-RAM dev boxes. Two forks keeps peak to a few GB while keeping
    // parallelism; this is a runner-resource bound, not a code/memory leak.
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 2 } },
    // This package is a Wave-4 scaffold: contract/types only, no unit tests
    // yet. Without this, `vitest run` exits 1 on "No test files found", which
    // fails the repo-wide `pnpm test` gate. Don't gate-fail a not-yet-implemented
    // package for having no tests; real suites land with the package's Wave-4 build.
    passWithNoTests: true,
    include: ['src/**/*.test.ts'],
    // The real-browser suites (`*.browser.test.ts`) and the axe-core a11y suites
    // (`*.a11y.test.ts`) require Playwright Chromium — run via `pnpm test:browser`.
    exclude: ['src/**/*.browser.test.ts', 'src/**/*.a11y.test.ts', 'node_modules/**'],
  },
});
