import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Import a couple of components through their OWN additive family subpath barrels
// (the same source modules the `@jects/widgets/<family>` exports point at), not
// the package barrel `index.ts`.
import { Form } from './forms.js';
import { Window, Dialog } from './overlays.js';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Every additive family subpath barrel and the family folder(s) it is allowed to
 * re-export from. The barrel may also pull a small set of SHARED LEAF modules
 * (e.g. the Button leaf used by `nav`, or the `anchored-panel` positioner used by
 * `datetime`/`pickers`) — those are listed as allowed extras. The point of the
 * check is that a barrel never widens into the whole kit.
 */
const SUBPATH_FAMILIES: Record<string, { folders: string[]; sharedLeaves?: string[] }> = {
  forms: { folders: ['forms'] },
  overlays: { folders: ['overlays', 'windows'] },
  'rich-text': { folders: ['richtext'] },
  fields: { folders: ['fields'] },
  nav: { folders: ['nav'], sharedLeaves: ['button/button'] },
  layout: { folders: ['layout'] },
  datetime: { folders: ['datetime'], sharedLeaves: ['overlays/anchored-panel'] },
  pickers: { folders: ['pickers'], sharedLeaves: ['overlays/anchored-panel'] },
  'data-views': { folders: ['data-views'] },
};

describe('@jects/widgets additive family subpath barrels', () => {
  it('re-exports a real component through a family barrel (forms → Form)', () => {
    expect(typeof Form).toBe('function');
  });

  it('overlays barrel surfaces both overlay and window surfaces', () => {
    expect(typeof Window).toBe('function');
    expect(typeof Dialog).toBe('function');
  });

  it('every family barrel exists and re-exports ONLY from its own family (+ allowed shared leaves)', () => {
    const present = new Set(readdirSync(SRC_DIR));
    for (const [name, { folders, sharedLeaves = [] }] of Object.entries(SUBPATH_FAMILIES)) {
      const file = `${name}.ts`;
      expect(present.has(file), `${file} should exist`).toBe(true);

      const source = readFileSync(resolve(SRC_DIR, file), 'utf8');
      // Collect every relative module specifier the barrel re-exports from.
      const specifiers = [...source.matchAll(/from\s+'\.\/([a-z0-9/-]+)\.js'/g)].map((m) => m[1]);
      expect(specifiers.length, `${file} should re-export at least one module`).toBeGreaterThan(0);

      const allowed = (spec: string) =>
        folders.some((folder) => spec.startsWith(`${folder}/`)) ||
        sharedLeaves.includes(spec);

      for (const spec of specifiers) {
        expect(
          allowed(spec),
          `${file} re-exports './${spec}.js' which is outside its family + allowed shared leaves`,
        ).toBe(true);
      }
    }
  });
});
