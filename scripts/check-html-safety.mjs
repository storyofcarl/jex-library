#!/usr/bin/env node
/**
 * check-html-safety.mjs — mechanical guard against unsafe HTML injection.
 *
 * POLICY
 * ------
 * Assigning a raw string to `.innerHTML` or calling `insertAdjacentHTML` is the
 * primary XSS vector in this codebase. This guard makes unsafe usage *fail CI*
 * unless the site is demonstrably safe.
 *
 * It scans every `*.ts` / `*.tsx` under `packages/*​/src` (skipping `*.test.*`
 * and `*.d.ts`) and flags any line matching:
 *     /\.innerHTML\s*=/        e.g.  el.innerHTML = ...
 *     /insertAdjacentHTML/     e.g.  el.insertAdjacentHTML('beforeend', ...)
 *
 * A flagged line is ALLOWED (not an error) when the offending line itself, OR
 * the line immediately above it, contains one of these safety markers:
 *
 *     sanitizeHtml            allow-list sanitizer (rich HTML from data)
 *     escapeHtml              text-escape alias
 *     escape(                 text-escape (escapes interpolated text)
 *     safeHtml                branded sanitize-then-brand helper
 *     staticHtml              branded value-free template helper
 *     renderIcon             trusted internal icon SVG factory
 *     textContent            DOM text assignment (not HTML)
 *     // jects-safe-html:    explicit human vet, with a stated reason
 *
 * The marker may live on the SAME line (inline, e.g. `el.innerHTML =
 * sanitizeHtml(x)`) or on the LINE ABOVE (an annotation comment, or a guard
 * expression that spans lines). Honesty is required for the annotation: never
 * annotate a site that actually carries user/config data — sanitize those.
 *
 * Exit code: 1 if any unguarded site remains (after printing each file:line),
 * else 0 with an OK message.
 *
 * No dependencies — pure Node ESM, walks the tree with fs/path only.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PACKAGES_DIR = join(ROOT, 'packages');

/** Lines matching either of these are candidate injection sites. */
const SINK_PATTERNS = [/\.innerHTML\s*=/, /insertAdjacentHTML/];

/** Presence of any of these (same line or line above) clears the site. */
const SAFETY_MARKERS = [
  'sanitizeHtml',
  'escapeHtml',
  'escape(',
  'safeHtml',
  'staticHtml',
  'trustedHtml',
  'setHtml',
  'insertSafeHtml',
  'renderIcon',
  'textContent',
  '// jects-safe-html:',
];

/** Recursively collect `*.ts` / `*.tsx` files under `dir`, skipping tests/decls. */
function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...collectFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\./.test(entry) || /\.stories\./.test(entry) || entry.endsWith('.d.ts')) continue;
    // sanitize.ts defines the sanctioned setHtml/insertSafeHtml sinks themselves
    // (and documents insertAdjacentHTML in prose) — the only place raw sinks live.
    if (full.replace(/\\/g, '/').endsWith('packages/core/src/sanitize.ts')) continue;
    out.push(full);
  }
  return out;
}

/** True if the candidate `line` (or `prev`, the line above) is marked safe. */
function isGuarded(line, prev) {
  const haystack = `${prev ?? ''}\n${line}`;
  return SAFETY_MARKERS.some((m) => haystack.includes(m));
}

function isSink(line) {
  return SINK_PATTERNS.some((p) => p.test(line));
}

function main() {
  // Only scan `packages/<name>/src` trees.
  let srcDirs = [];
  for (const pkg of readdirSync(PACKAGES_DIR)) {
    const src = join(PACKAGES_DIR, pkg, 'src');
    try {
      if (statSync(src).isDirectory()) srcDirs.push(src);
    } catch {
      /* package without a src dir — skip */
    }
  }

  const offenders = [];
  let scanned = 0;
  for (const src of srcDirs) {
    for (const file of collectFiles(src)) {
      scanned++;
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!isSink(line)) continue;
        if (isGuarded(line, i > 0 ? lines[i - 1] : undefined)) continue;
        offenders.push({ file: relative(ROOT, file).replace(/\\/g, '/'), line: i + 1, text: line.trim() });
      }
    }
  }

  if (offenders.length > 0) {
    console.error(`\n[check-html-safety] ${offenders.length} unguarded HTML sink(s) found in ${scanned} files:\n`);
    for (const o of offenders) {
      console.error(`  ${o.file}:${o.line}  ${o.text}`);
    }
    console.error(
      '\nEach site must either route through sanitizeHtml/escape/safeHtml/staticHtml,\n' +
        'use textContent/renderIcon, or carry a `// jects-safe-html: <reason>` annotation\n' +
        'on the line above. See the header of this script for the full policy.\n',
    );
    process.exit(1);
  }

  console.log(`[check-html-safety] OK — scanned ${scanned} files, no unguarded HTML sinks.`);
  process.exit(0);
}

main();
