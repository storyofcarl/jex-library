import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = (f) => readFileSync(resolve(__dirname, '..', 'dist/css', f), 'utf8');

test('layer order declared first in base.css', () => {
  const base = css('base.css');
  assert.match(base, /@layer jects\.reset, jects\.tokens, jects\.base, jects\.components, jects\.utilities;/);
});

test('base light tokens present', () => {
  const base = css('base.css');
  assert.match(base, /--jects-background: 1 0 0;/);
  assert.match(base, /--jects-primary: 0\.21 0\.008 272;/);
});

test('derived radii cascade via calc', () => {
  const base = css('base.css');
  assert.match(base, /--jects-radius-sm: calc\(var\(--jects-radius\) - 4px\);/);
});

test('dark theme overrides keyed off class + attr', () => {
  const dark = css('dark.css');
  assert.match(dark, /\.jects-dark/);
  assert.match(dark, /\[data-jects-theme='dark'\]/);
  assert.match(dark, /--jects-background: 0\.145 0\.006 272;/);
});

test('branded presets exist', () => {
  assert.match(css('stockholm.css'), /jects-theme-stockholm/);
  assert.match(css('material.css'), /jects-theme-material/);
});
