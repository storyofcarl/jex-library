/// <reference types="vitest" />
import angular from '@analogjs/vite-plugin-angular';
import { defineConfig } from 'vite';

// Angular wrapper smoke suite. The Analog plugin runs the Angular AOT compiler over
// the wrapper source so signal inputs/outputs (`input()` / `output()`) are registered
// in each directive definition — the runtime JIT compiler cannot introspect those
// from field initializers. The suite then drives the components through TestBed under
// jsdom and asserts DOM render, event forwarding, update-vs-recreate, and cleanup.
export default defineConfig({
  plugins: [angular()],
  // Pre-bundle Angular's testing entrypoints with esbuild so they bypass the Analog
  // Angular plugin's decorator transform (which otherwise rewrites a dynamic import
  // in `@angular/core/testing` to a bare `fesm2022/null` that vite cannot resolve).
  optimizeDeps: {
    include: [
      '@angular/core/testing',
      '@angular/platform-browser-dynamic/testing',
      '@angular/platform-browser',
      '@angular/compiler',
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 1 } },
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    server: {
      deps: {
        inline: [/@angular/, /@analogjs/],
      },
    },
  },
});
