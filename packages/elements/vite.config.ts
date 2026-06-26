import { resolve } from 'node:path';
import { defineConfig, type UserConfig } from 'vite';
import dts from 'vite-plugin-dts';

/**
 * `@jects/elements` build — MULTI-ENTRY, one chunk per component subpath.
 *
 * Unlike the shared single-entry `jectsLibConfig` preset (which emits a single UMD
 * bundle), this package ships per-component subpath exports (`@jects/elements/grid`,
 * `…/gantt`, …). Each subpath must be its OWN entry that, when bundled by a consumer,
 * imports ONLY its engine (kept external) plus the tiny shared factory chunk — never a
 * sibling engine. A single-entry UMD build cannot express that, so we drive Rollup with
 * one input per entry and let it hoist the common factory into a shared chunk.
 *
 * Output: ESM (`*.js`) + CJS (`*.cjs`). No UMD/IIFE global — UMD only supports a single
 * entry, and the suite already externalizes the whole `@jects/*` peer scope, so each
 * engine is resolved by the host app, not inlined here.
 */
const root = import.meta.dirname;

/** Subpath/entry id -> source file. The id becomes the output basename (`<id>.js`). */
const entries: Record<string, string> = {
  index: 'src/index.ts',
  // data + scheduling engines
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
  // key widgets
  button: 'src/button.ts',
  form: 'src/form.ts',
  window: 'src/window.ts',
  textfield: 'src/textfield.ts',
  select: 'src/select.ts',
  richtext: 'src/richtext.ts',
};

const input = Object.fromEntries(
  Object.entries(entries).map(([id, file]) => [id, resolve(root, file)]),
);

export default defineConfig({
  build: {
    emptyOutDir: true,
    sourcemap: true,
    cssCodeSplit: false,
    // The whole `@jects/*` peer scope is externalized so a host app ships a single
    // copy of core + each engine. This is what guarantees per-entry isolation: an
    // engine import stays an external `import '@jects/<engine>'` and is never inlined,
    // so the grid entry's only `@jects/*` reference is `@jects/grid`.
    rollupOptions: {
      input,
      external: [/^@jects\//],
      output: [
        {
          format: 'es',
          dir: 'dist',
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: (asset) =>
            asset.names?.some((n) => n.endsWith('.css')) ? 'style.css' : 'assets/[name][extname]',
          exports: 'named',
        },
        {
          format: 'cjs',
          dir: 'dist',
          entryFileNames: '[name].cjs',
          chunkFileNames: 'chunks/[name]-[hash].cjs',
          assetFileNames: (asset) =>
            asset.names?.some((n) => n.endsWith('.css')) ? 'style.css' : 'assets/[name][extname]',
          exports: 'named',
        },
      ],
    },
  },
  plugins: [
    dts({
      entryRoot: resolve(root, 'src'),
      insertTypesEntry: true,
      tsconfigPath: resolve(root, 'tsconfig.json'),
    }),
  ],
}) as UserConfig;
