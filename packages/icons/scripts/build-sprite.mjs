// Build an SVG sprite (symbol per icon) from the TS icon definitions.
// Parses icons.ts without importing TS (simple, dependency-free regex extraction).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const src = readFileSync(resolve(root, 'src/icons.ts'), 'utf8');

// Match:  'name': icon('<...>'),  or  name: icon('<...>'),
const re = /(?:'([\w-]+)'|([\w-]+))\s*:\s*icon\(\s*'([\s\S]*?)'\s*\)/g;
const symbols = [];
let m;
while ((m = re.exec(src)) !== null) {
  const name = m[1] ?? m[2];
  const body = m[3];
  symbols.push(
    `  <symbol id="jects-i-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`,
  );
}

const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${symbols.join('\n')}\n</svg>\n`;
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/sprite.svg'), sprite);
console.log(`icons: wrote sprite with ${symbols.length} symbols`);
