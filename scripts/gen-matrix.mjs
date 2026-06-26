/**
 * Generate docs/MATRIX.md — a rot-proof capability/readiness matrix.
 *
 * For every package it reports, by SCANNING the repo (never hand-maintained):
 *   - public export count (breadth proxy, from dist/index.d.ts)
 *   - unit / browser / a11y test file + case counts
 *   - storybook stories present
 *   - a live gallery demo present (gallery imports the package)
 *   - a per-module doc present (docs/modules/<pkg>.md)
 *   - gzip size of the built ESM entry
 *
 * Run: `node scripts/gen-matrix.mjs`  (or `pnpm matrix`)
 */
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = process.cwd();
const PKG_DIR = join(ROOT, 'packages');
const gallery = existsSync(join(ROOT, 'preview/gallery.js'))
  ? readFileSync(join(ROOT, 'preview/gallery.js'), 'utf8')
  : '';

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

const countCases = (files) =>
  files.reduce((n, f) => {
    const s = readFileSync(f, 'utf8');
    return n + (s.match(/\b(it|test)\s*\(/g) ?? []).length;
  }, 0);

const kb = (bytes) => (bytes / 1024).toFixed(1) + ' KB';

const rows = [];
for (const name of readdirSync(PKG_DIR).sort()) {
  const dir = join(PKG_DIR, name);
  if (!statSync(dir).isDirectory()) continue;
  const pjPath = join(dir, 'package.json');
  if (!existsSync(pjPath)) continue;
  const pj = JSON.parse(readFileSync(pjPath, 'utf8'));
  const src = join(dir, 'src');
  const files = existsSync(src) ? walk(src) : [];

  const unit = files.filter((f) => /(?<!\.browser)(?<!\.a11y)\.test\.tsx?$/.test(f));
  const browser = files.filter((f) => /\.browser\.test\.tsx?$/.test(f));
  const a11y = files.filter((f) => /\.a11y\.test\.tsx?$/.test(f));
  const stories = files.filter((f) => /\.stories\.tsx?$/.test(f));

  // public export count from dist/index.d.ts
  let exportCount = 0;
  const dts = join(dir, 'dist/index.d.ts');
  if (existsSync(dts)) {
    const d = readFileSync(dts, 'utf8');
    exportCount = (d.match(/^export\s+(declare\s+)?(abstract\s+)?(class|function|const|type|interface|enum)\s/gm) ?? []).length;
    // also count names inside `export { a, b, c }` / `export type { ... }` blocks
    // (including re-export `... } from './x'` barrels).
    for (const blk of d.match(/export\s+(type\s+)?\{[^}]*\}/gs) ?? []) {
      const names = blk.replace(/export\s+(type\s+)?\{/, '').replace(/\}.*/s, '');
      exportCount += names.split(',').filter((s) => s.trim()).length;
    }
  }

  // gallery demo present?
  const hasDemo = gallery.includes(`'${pj.name}'`) || gallery.includes(`"${pj.name}"`);

  // doc present?
  const docPath = join(ROOT, 'docs/modules', `${name}.md`);
  const hasDoc = existsSync(docPath);

  // gzip of built entry
  let gz = '';
  const entry = pj.exports?.['.']?.import || pj.module;
  if (entry) {
    const abs = join(dir, entry.replace(/^\.\//, ''));
    if (existsSync(abs)) gz = kb(gzipSync(readFileSync(abs)).length);
  }

  rows.push({
    name: pj.name,
    exports: exportCount || '—',
    unit: unit.length ? `${countCases(unit)} (${unit.length}f)` : '—',
    browser: browser.length ? `${countCases(browser)}` : '—',
    a11y: a11y.length ? `${countCases(a11y)}` : '—',
    stories: stories.length ? '✓' : '—',
    demo: hasDemo ? '✓' : '—',
    doc: hasDoc ? '✓' : '—',
    gz: gz || '—',
  });
}

const head =
  '| Package | Public exports | Unit tests | Browser | A11y | Stories | Live demo | Docs | Bundle (gzip) |\n' +
  '| --- | --: | --- | --: | --: | :-: | :-: | :-: | --: |';
const body = rows
  .map(
    (r) =>
      `| \`${r.name}\` | ${r.exports} | ${r.unit} | ${r.browser} | ${r.a11y} | ${r.stories} | ${r.demo} | ${r.doc} | ${r.gz} |`,
  )
  .join('\n');

const totalUnit = rows.reduce((n, r) => n + (parseInt(r.unit) || 0), 0);
const out = `# Jects UI — Capability & Readiness Matrix

> **Auto-generated** by \`scripts/gen-matrix.mjs\` (run \`pnpm matrix\`). Do not edit by hand —
> it is derived from the repository (package exports, test files, stories, the live gallery,
> per-module docs, and built bundle sizes), so it can't drift from the code.

${head}
${body}

**Legend** — *Public exports*: count from \`dist/index.d.ts\` (breadth proxy). *Unit/Browser/A11y*:
test-case counts (\`Nf\` = N files). *Stories*: Storybook stories present. *Live demo*: the package is
mounted in the public gallery. *Docs*: \`docs/modules/<pkg>.md\` exists. *Bundle*: gzip of the ESM entry.

Totals: **${rows.length} packages**, ~**${totalUnit} unit test cases** across the suite.
`;

writeFileSync(join(ROOT, 'docs/MATRIX.md'), out);
console.log(`Wrote docs/MATRIX.md (${rows.length} packages, ~${totalUnit} unit cases)`);
