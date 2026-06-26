import { defineConfig } from 'vitest/config';

// Vue wrapper smoke suite: mounts real @jects engines inside @vue/test-utils under
// jsdom and asserts DOM render, event bridging, update-vs-remount, and cleanup.
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
