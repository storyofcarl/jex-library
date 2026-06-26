import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';

// Import each component through its OWN per-component entry (the same module the
// `@jects/vue/<name>` subpath export points at), not the barrel `index.ts`.
import { JectsGrid } from './grid.js';
import { JectsButton } from './button.js';

enableAutoUnmount(afterEach);

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Every per-component source entry and the single engine module it is allowed to import. */
const ENTRY_ENGINE: Record<string, string> = {
  grid: '@jects/grid',
  gantt: '@jects/gantt',
  scheduler: '@jects/scheduler',
  calendar: '@jects/calendar',
  kanban: '@jects/kanban',
  todo: '@jects/todo',
  charts: '@jects/charts',
  diagram: '@jects/diagram',
  spreadsheet: '@jects/spreadsheet',
  pivot: '@jects/pivot',
  booking: '@jects/booking',
  chatbot: '@jects/chatbot',
  button: '@jects/widgets',
  form: '@jects/widgets',
  window: '@jects/widgets',
  textfield: '@jects/widgets',
  select: '@jects/widgets',
  richtext: '@jects/widgets',
};

describe('@jects/vue per-component subpath isolation', () => {
  it('renders a component imported from its own subpath entry (grid)', () => {
    const grid = mount(JectsGrid, {
      props: { data: [{ id: 1, name: 'Ada' }], columns: [{ field: 'name', header: 'Name' }] },
    });
    expect(grid.find('.jects-grid').exists()).toBe(true);
  });

  it('renders a widget imported from its own subpath entry (button)', () => {
    const button = mount(JectsButton, { props: { text: 'Click me' } });
    expect(button.find('.jects-btn').exists()).toBe(true);
  });

  it('each per-component entry imports ONLY its own engine, never a sibling engine', () => {
    const present = new Set(readdirSync(SRC_DIR));
    for (const [entry, ownEngine] of Object.entries(ENTRY_ENGINE)) {
      const file = `${entry}.ts`;
      expect(present.has(file), `${file} should exist`).toBe(true);

      const source = readFileSync(resolve(SRC_DIR, file), 'utf8');
      // Collect every `@jects/*` specifier the entry actually IMPORTS (ignore prose
      // in doc comments, which legitimately names sibling engines as examples).
      const engines = [...source.matchAll(/from\s+'(@jects\/[a-z]+)'/g)].map((m) => m[1]);
      const unique = [...new Set(engines)];

      // Exactly one engine, and it must be the entry's own engine.
      expect(unique, `${file} imports unexpected @jects engines`).toEqual([ownEngine]);
    }
  });
});
