import { defineConfig } from 'vitest/config';

// Web Components smoke suite: registers the custom elements, mounts real @jects
// engines into light-DOM elements under jsdom, and asserts DOM render, event
// re-dispatch, update-vs-remount, and teardown on removal.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 2 } },
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
  },
});
