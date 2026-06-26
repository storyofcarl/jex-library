import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// Per-component subpath entries. Each compiles to its own `dist/<name>.js` chunk
// that imports ONLY its own `@jects/<engine>` (or the matching `@jects/widgets`
// symbol) plus the shared factory — never a sibling engine. The shared factory is
// hoisted by Rollup into a `_shared/` chunk that every entry references.
//
// We build ES-only with multiple inputs (UMD cannot express multiple entry points).
// React, its JSX runtime, ReactDOM, and the whole `@jects/*` peer scope stay
// external so the host app ships a single copy of each.
const root = import.meta.dirname;
const src = resolve(root, 'src');

const entries = {
  index: resolve(src, 'index.ts'),
  // engines
  grid: resolve(src, 'grid.tsx'),
  gantt: resolve(src, 'gantt.tsx'),
  scheduler: resolve(src, 'scheduler.tsx'),
  calendar: resolve(src, 'calendar.tsx'),
  booking: resolve(src, 'booking.tsx'),
  kanban: resolve(src, 'kanban.tsx'),
  todo: resolve(src, 'todo.tsx'),
  charts: resolve(src, 'charts.tsx'),
  diagram: resolve(src, 'diagram.tsx'),
  spreadsheet: resolve(src, 'spreadsheet.tsx'),
  pivot: resolve(src, 'pivot.tsx'),
  chatbot: resolve(src, 'chatbot.tsx'),
  // widgets
  button: resolve(src, 'button.tsx'),
  form: resolve(src, 'form.tsx'),
  window: resolve(src, 'window.tsx'),
  textfield: resolve(src, 'textfield.tsx'),
  select: resolve(src, 'select.tsx'),
  richtext: resolve(src, 'richtext.tsx'),
} as const;

export default defineConfig({
  build: {
    emptyOutDir: true,
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: entries,
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^@jects\//, 'react', 'react-dom', 'react/jsx-runtime'],
      output: {
        // One file per entry; shared code (the factory) lands in a stable chunk.
        entryFileNames: '[name].js',
        chunkFileNames: '_shared/[name]-[hash].js',
        exports: 'named',
      },
    },
  },
  plugins: [
    dts({
      entryRoot: src,
      insertTypesEntry: false,
      tsconfigPath: resolve(root, 'tsconfig.json'),
    }),
  ],
});
