/**
 * Generate docs/MATRIX.md + docs/matrix.json — a rot-proof capability/readiness matrix.
 *
 * For every package it reports, by SCANNING the repo (never hand-maintained):
 *   - maturity (mirrors docs/STATUS.md)
 *   - public subpath count (real `exports` entries, the integration surface)
 *   - unit / browser / a11y test file + case counts
 *   - a live gallery demo present (gallery imports the package)
 *   - a per-module doc present (docs/modules/<pkg>.md)
 *   - JS gzip of the ESM entry PLUS every dist chunk it transitively imports
 *     (so the number reflects what actually ships, not just the re-export hub)
 *   - CSS gzip of the package's stylesheet, if any
 *
 * Run: `node scripts/gen-matrix.mjs`  (or `pnpm matrix`)
 */
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = process.cwd();
const PKG_DIR = join(ROOT, 'packages');
const gallery = existsSync(join(ROOT, 'preview/gallery.js'))
  ? readFileSync(join(ROOT, 'preview/gallery.js'), 'utf8')
  : '';

// Maturity mirrors docs/STATUS.md (single source of truth for human-set maturity).
const MATURITY = {
  '@jects/core': 'Stable', '@jects/tokens': 'Stable', '@jects/theme': 'Stable',
  '@jects/icons': 'Stable', '@jects/timeline-core': 'Beta',
  '@jects/grid': 'Stable', '@jects/gantt': 'Beta', '@jects/scheduler': 'Beta',
  '@jects/calendar': 'Beta', '@jects/booking': 'Beta', '@jects/kanban': 'Beta',
  '@jects/todo': 'Beta', '@jects/spreadsheet': 'Beta', '@jects/pivot': 'Beta',
  '@jects/charts': 'Beta', '@jects/diagram': 'Beta', '@jects/widgets': 'Stable',
  '@jects/chatbot': 'Experimental',
  '@jects/react': 'Beta', '@jects/vue': 'Beta', '@jects/angular': 'Beta', '@jects/elements': 'Beta',
};

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

/**
 * Resolve, transitively, every same-package dist file an entry imports — following
 * only RELATIVE specifiers (./ , ../). Bare specifiers (@jects/core, externals) are
 * peers shipped once and are NOT counted. Returns the set of absolute file paths,
 * including the entry itself.
 */
function transitiveLocalFiles(entryAbs) {
  const seen = new Set();
  const stack = [entryAbs];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    const specs = [];
    const re = /(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) specs.push(m[1] || m[2] || m[3]);
    for (const spec of specs) {
      if (!spec.startsWith('.')) continue; // bare/external peer — not counted
      let r = resolve(dirname(f), spec);
      if (!existsSync(r)) { if (existsSync(r + '.js')) r += '.js'; else continue; }
      stack.push(r);
    }
  }
  return seen;
}

const rows = [];
const noDist = [];
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

  // Resolve a dist dir: prefer the package's own build; fall back to the vendored
  // copy under deploy/ so the matrix never silently blanks bundle numbers.
  let distBase = join(dir, 'dist');
  if (!existsSync(distBase)) {
    const vendored = join(ROOT, 'deploy/packages', name, 'dist');
    distBase = existsSync(vendored) ? vendored : '';
  }
  if (!distBase) noDist.push(pj.name);

  // Subpath count: real exports entries that are integration surface
  // (exclude ".", "./style.css", "./package.json").
  const exp = pj.exports && typeof pj.exports === 'object' ? pj.exports : {};
  const subpaths = Object.keys(exp).filter((k) => k !== '.' && k !== './style.css' && k !== './package.json');

  // exported-name breadth from dist/index.d.ts (kept, but demoted)
  let exportCount = 0;
  const dts = distBase ? join(distBase, 'index.d.ts') : '';
  if (dts && existsSync(dts)) {
    const d = readFileSync(dts, 'utf8');
    exportCount = (d.match(/^export\s+(declare\s+)?(abstract\s+)?(class|function|const|type|interface|enum)\s/gm) ?? []).length;
    for (const blk of d.match(/export\s+(type\s+)?\{[^}]*\}/gs) ?? []) {
      const names = blk.replace(/export\s+(type\s+)?\{/, '').replace(/\}.*/s, '');
      exportCount += names.split(',').filter((s) => s.trim()).length;
    }
  }

  const hasDemo = gallery.includes(`'${pj.name}'`) || gallery.includes(`"${pj.name}"`);
  const hasDoc = existsSync(join(ROOT, 'docs/modules', `${name}.md`));

  // JS gzip = entry + every dist chunk it transitively imports (real ship size).
  let jsgz = '';
  const entry = pj.exports?.['.']?.import?.default || pj.exports?.['.']?.import || pj.module;
  const entryRel = typeof entry === 'string' ? entry : '';
  if (entryRel && distBase) {
    const abs = join(distBase, entryRel.replace(/^\.\/dist\//, '').replace(/^\.\//, ''));
    if (existsSync(abs)) {
      let total = 0;
      for (const f of transitiveLocalFiles(abs)) total += gzipSync(readFileSync(f)).length;
      jsgz = kb(total);
    }
  }

  // CSS gzip of the package stylesheet, if it ships one.
  let cssgz = '';
  if (distBase) {
    const cssRel = pj.exports?.['./style.css'];
    const cssAbs = cssRel
      ? join(distBase, String(cssRel).replace(/^\.\/dist\//, '').replace(/^\.\//, ''))
      : join(distBase, 'style.css');
    if (existsSync(cssAbs)) cssgz = kb(gzipSync(readFileSync(cssAbs)).length);
  }

  rows.push({
    name: pj.name,
    maturity: MATURITY[pj.name] || '—',
    subpaths: subpaths.length || '—',
    unit: unit.length ? `${countCases(unit)} (${unit.length}f)` : '—',
    browser: browser.length ? `${countCases(browser)}` : '—',
    a11y: a11y.length ? `${countCases(a11y)}` : '—',
    demo: hasDemo ? '✓' : '—',
    doc: hasDoc ? '✓' : '—',
    jsgz: jsgz || '—',
    cssgz: cssgz || '—',
    exportNames: exportCount || '—',
  });
}

const head =
  '| Package | Maturity | Subpaths | Unit tests | Browser | A11y | Live demo | Docs | JS (gzip) | CSS (gzip) | Exported names |\n' +
  '| --- | :-: | --: | --- | --: | --: | :-: | :-: | --: | --: | --: |';
const body = rows
  .map(
    (r) =>
      `| \`${r.name}\` | ${r.maturity} | ${r.subpaths} | ${r.unit} | ${r.browser} | ${r.a11y} | ${r.demo} | ${r.doc} | ${r.jsgz} | ${r.cssgz} | ${r.exportNames} |`,
  )
  .join('\n');

const totalUnit = rows.reduce((n, r) => n + (parseInt(r.unit) || 0), 0);
const out = `# Jects UI — Capability & Readiness Matrix

> **Auto-generated** by \`scripts/gen-matrix.mjs\` (run \`pnpm matrix\`). Do not edit by hand —
> it is derived from the repository (package exports, test files, the live gallery, per-module docs,
> and built bundle sizes), so it cannot drift from the code.

${head}
${body}

**Legend** — *Maturity*: mirrors \`STATUS.md\`. *Subpaths*: real \`exports\` entries beyond \`.\` and
\`./style.css\` (the integration surface). *Unit/Browser/A11y*: test-case counts (\`Nf\` = N files).
*Live demo*: the package is mounted in the public gallery. *Docs*: \`docs/modules/<pkg>.md\` exists.
*JS (gzip)*: gzip of the ESM entry **plus every dist chunk it transitively imports** (peers shipped
once via externals are not counted) — i.e. the real download for using the main entry. *CSS (gzip)*:
gzip of the package stylesheet, if any. *Exported names*: a breadth proxy from \`dist/index.d.ts\`, not
a quality metric.

Totals: **${rows.length} packages**, ~**${totalUnit} unit test cases** across the suite.
`;

writeFileSync(join(ROOT, 'docs/MATRIX.md'), out);
writeFileSync(
  join(ROOT, 'docs/matrix.json'),
  JSON.stringify({ generatedFrom: 'scripts/gen-matrix.mjs', packages: rows, totals: { packages: rows.length, unitCases: totalUnit } }, null, 2) + '\n',
);
console.log(`Wrote docs/MATRIX.md + docs/matrix.json (${rows.length} packages, ~${totalUnit} unit cases)`);
if (noDist.length) {
  console.warn(`WARNING: no dist (source or deploy) for: ${noDist.join(', ')} — bundle columns blank for these. Run "pnpm build" first.`);
  if (process.env.CI) {
    console.error('::error::Matrix generated without dist for some packages; build before generating in CI.');
    process.exit(1);
  }
}
