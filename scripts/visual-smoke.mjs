/**
 * Visual smoke — renders key routes across viewports and themes against the
 * built gallery under deploy/, captures a screenshot of each, and FAILS (exit 1)
 * if any combination logs a console error or page error.
 *
 * This is a smoke + artifact capture, not pixel-diff regression: it catches
 * "the page broke / errored / went blank" across desktop/tablet/mobile and
 * light/dark, which is the common regression, without environment-fragile
 * baseline images. (Pixel-level baselines would need @playwright/test and
 * CI-generated, OS-pinned snapshots.)
 *
 * Run: `node scripts/visual-smoke.mjs` (or `pnpm visual`). Screenshots are
 * written to artifacts/visual/.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(process.cwd(), 'deploy');
const OUT = resolve(process.cwd(), 'artifacts/visual');
const PORT = 4177;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/plain', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json' };

const ROUTES = ['home', 'grid', 'gantt', 'scheduler', 'spreadsheet', 'diagram', 'pivot', 'planning-control-center', 'analytics-workspace', 'compare', 'performance'];
const VIEWPORTS = [{ w: 1440, h: 900, tag: 'desktop' }, { w: 390, h: 844, tag: 'mobile' }];
const THEMES = ['light', 'dark'];

if (!existsSync(ROOT)) { console.error('visual: deploy/ not found — run a sync/build first.'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const srv = createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
  if (p === '/') p = '/index.html';
  const f = join(ROOT, p.replace(/^\/+/, ''));
  if (!f.startsWith(ROOT) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));
const base = `http://127.0.0.1:${PORT}`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=1024'] });

const failures = [];
let shots = 0;

async function applyTheme(page, theme) {
  // Click the topbar theme segment button matching the theme name, if present.
  await page.evaluate((t) => {
    const want = t === 'dark' ? 'dark' : 'light';
    const btns = [...document.querySelectorAll('.g-seg button, button')];
    const b = btns.find((x) => (x.textContent || '').trim().toLowerCase() === want);
    if (b) b.click();
  }, theme).catch(() => {});
}

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    for (const id of ROUTES) {
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      try {
        await page.goto(`${base}/#${id}`, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(id === 'performance' ? 5000 : 2200);
        if (theme === 'dark') { await applyTheme(page, 'dark'); await page.waitForTimeout(400); }
        await page.screenshot({ path: join(OUT, `${id}-${vp.tag}-${theme}.png`) });
        shots++;
        if (errs.length) failures.push(`${id} @ ${vp.tag}/${theme}: ${errs.slice(0, 2).join(' | ')}`);
      } catch (e) {
        failures.push(`${id} @ ${vp.tag}/${theme}: NAV ${e.message}`);
      }
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
srv.close();

console.log(`visual: captured ${shots} screenshots in ${OUT}`);
if (failures.length) {
  console.error(`visual: ${failures.length} route(s) errored:`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('visual: OK — all routes rendered cleanly across viewports + themes.');
