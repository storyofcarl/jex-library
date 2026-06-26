import { defineConfig } from 'vitest/config';

// React wrapper smoke suite: mounts real @jects engines inside @testing-library/react
// under jsdom and asserts DOM render, event bridging, update-vs-remount, and cleanup.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: false,
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 2 } },
    include: ['src/**/*.test.tsx'],
    exclude: ['node_modules/**', 'dist/**'],
  },
});
