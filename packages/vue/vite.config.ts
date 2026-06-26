import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

/**
 * `@jects/vue` is built with MULTIPLE entry points — one per component — so each
 * subpath export (`@jects/vue/grid`, `@jects/vue/button`, …) is its own chunk that
 * imports ONLY its own engine plus the shared factory chunk. A consumer of
 * `@jects/vue/grid` therefore never triggers bundler resolution of sibling engines
 * (`@jects/gantt`, `@jects/scheduler`, …).
 *
 * The shared Vite preset (`@jects/vite-config`) only supports a single `lib.entry`,
 * so this package defines its own multi-entry config. `vue` and the whole `@jects/*`
 * peer scope stay external, exactly as the preset would externalize them.
 */
const root = import.meta.dirname;

/** Every public entry: the back-compat barrel plus one file per component. */
const entries = {
  index: 'src/index.ts',
  factory: 'src/factory.ts',
  // engines
  grid: 'src/grid.ts',
  gantt: 'src/gantt.ts',
  scheduler: 'src/scheduler.ts',
  calendar: 'src/calendar.ts',
  kanban: 'src/kanban.ts',
  todo: 'src/todo.ts',
  charts: 'src/charts.ts',
  diagram: 'src/diagram.ts',
  spreadsheet: 'src/spreadsheet.ts',
  pivot: 'src/pivot.ts',
  booking: 'src/booking.ts',
  chatbot: 'src/chatbot.ts',
  // widgets
  button: 'src/button.ts',
  form: 'src/form.ts',
  window: 'src/window.ts',
  textfield: 'src/textfield.ts',
  select: 'src/select.ts',
  richtext: 'src/richtext.ts',
} as const;

const input: Record<string, string> = {};
for (const [name, file] of Object.entries(entries)) {
  input[name] = resolve(root, file);
}

export default defineConfig({
  build: {
    emptyOutDir: true,
    sourcemap: true,
    cssCodeSplit: false,
    // ESM-only: multi-entry subpath exports are inherently tree-shake-oriented and
    // not meaningful as a single UMD global, so no UMD bundle is emitted here.
    lib: {
      entry: input,
      formats: ['es'],
    },
    rollupOptions: {
      // `vue` and the entire `@jects/*` peer scope stay external (peers/optionals).
      external: ['vue', /^@jects\//],
      output: {
        // One file per entry; the shared factory becomes its own chunk that every
        // component entry imports, so no engine code is duplicated across chunks.
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (asset) =>
          asset.names?.some((n) => n.endsWith('.css')) ? 'style.css' : 'assets/[name][extname]',
        exports: 'named',
      },
    },
  },
  plugins: [
    dts({
      entryRoot: resolve(root, 'src'),
      insertTypesEntry: true,
      tsconfigPath: resolve(root, 'tsconfig.json'),
    }),
  ],
});
