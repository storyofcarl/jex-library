import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const css = readFileSync(resolve(root, 'dist/tokens.css'), 'utf8');
const ts = readFileSync(resolve(root, 'dist-src/index.ts'), 'utf8');

test('house style values are present', () => {
  assert.match(css, /--jects-foreground: 0\.145 0\.006 272;/);
  assert.match(css, /--jects-primary: 0\.21 0\.008 272;/);
  assert.match(css, /--jects-radius: 0\.625rem;/);
});

test('calm CMYK palette present', () => {
  assert.match(css, /--jects-cmyk-cyan: 0\.70 0\.10 210;/);
  assert.match(css, /--jects-cmyk-magenta: 0\.62 0\.14 350;/);
  assert.match(css, /--jects-cmyk-yellow: 0\.80 0\.11 92;/);
  assert.match(css, /--jects-cmyk-key: 0\.21 0\.008 272;/);
});

test('data ramp present', () => {
  assert.match(css, /--jects-data-1: 0\.70 0\.10 210;/);
  assert.match(css, /--jects-data-8:/);
});

test('TS type union generated', () => {
  assert.match(ts, /export type JectsTokenName =/);
  assert.match(ts, /'--jects-primary'/);
  assert.match(ts, /export const TOKEN_PREFIX = '--jects-'/);
});
