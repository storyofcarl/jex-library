import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards the additive subpath exports (`@jects/gantt/engine|export|io|resource`).
 *
 * Each subpath is a REAL separate build entry (see `vite.subpaths.config.ts`)
 * whose chunk must import ONLY its own area plus the shared, type-only
 * `contract.ts` — never the `Gantt` widget (`ui/gantt.ts`) or the whole UI tree.
 * These tests assert that invariant at the SOURCE level (the build chunk was
 * verified by hand to contain no `gantt.js` reference) and that the package
 * `exports` map points every subpath at the right barrel.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(SRC, '..', 'package.json');

/** Areas exposed as subpaths and the barrel each one points at. */
const SUBPATHS = ['engine', 'export', 'io', 'resource'] as const;

/** Collect the `../<area>/...` and `./...` specifiers a source file imports. */
function siblingImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  // Only real import/export-from statements — ignore prose in doc comments.
  const specs = [...source.matchAll(/(?:^|\n)\s*(?:import|export)[^;]*?from\s+'([^']+)'/g)].map(
    (m) => m[1],
  );
  return specs.filter((s) => s.startsWith('.'));
}

describe('@jects/gantt additive subpath exports', () => {
  it('every subpath barrel exists', () => {
    for (const area of SUBPATHS) {
      const present = new Set(readdirSync(resolve(SRC, area)));
      expect(present.has('index.ts'), `${area}/index.ts should exist`).toBe(true);
    }
  });

  it('no subpath barrel (transitively) imports the Gantt widget or another subpath area', () => {
    // The whole UI tree is reachable from `ui/gantt.js`; pulling it would mean the
    // chunk re-bundles the package. None of the four areas may reference it, nor
    // may they reach into a *different* subpath area's code (cross-area coupling).
    const FORBIDDEN_FROM: Record<string, RegExp[]> = {
      engine: [/ui\/gantt/, /\/export\//, /\/io\//, /\/resource\//],
      export: [/ui\/gantt/, /\/engine\//, /\/io\//],
      io: [/ui\/gantt/, /\/engine\//, /\/export\//],
      // resource legitimately uses the contract-only `engine/effort` + `ui/default-engine`
      // (both import nothing but `contract.ts`), so only the widget + export/io are off-limits.
      resource: [/ui\/gantt/, /\/export\//, /\/io\//],
    };

    for (const area of SUBPATHS) {
      const dir = resolve(SRC, area);
      const files = readdirSync(dir).filter(
        (f) => f.endsWith('.ts') && !/\.(test|stories)\.ts$/.test(f),
      );
      for (const f of files) {
        const imports = siblingImports(resolve(dir, f));
        for (const spec of imports) {
          for (const bad of FORBIDDEN_FROM[area]) {
            expect(
              bad.test(spec),
              `${area}/${f} imports forbidden module '${spec}'`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('package.json exports map declares each subpath -> dist .js + .d.ts', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf8')) as {
      exports: Record<string, { import?: string; types?: string }>;
    };
    // Main entry stays intact (additive-only): ES import + UMD require + types.
    const main = pkg.exports['.'] as { import?: string; require?: string; types?: string };
    expect(main.import).toBe('./dist/gantt.js');
    expect(main.require).toBe('./dist/gantt.umd.cjs');
    expect(main.types).toBe('./dist/index.d.ts');

    for (const area of SUBPATHS) {
      const entry = pkg.exports[`./${area}`];
      expect(entry, `exports['./${area}'] should be declared`).toBeTruthy();
      expect(entry.import).toBe(`./dist/${area}.js`);
      expect(entry.types).toBe(`./dist/${area}/index.d.ts`);
    }
  });
});
