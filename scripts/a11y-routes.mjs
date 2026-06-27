/**
 * Accessibility gate for the LIVE gallery routes (not just isolated components).
 *
 * The per-package browser a11y specs test each component in isolation; the demo
 * routes COMBINE features (grid + filter-bar + summary, gantt + project-lines, …),
 * which is where real a11y defects hid. This gate serves the gallery built from
 * the current source (preview/ + freshly-built packages/<pkg>/dist via the import map),
 * runs axe-core on every route, and FAILS (exit 1) on any serious/critical
 * violation — so that class of regression can't return silently.
 *
 * Run: `node scripts/a11y-routes.mjs` (or `pnpm a11y:routes`). Requires a prior
 * `pnpm build` (so packages/<pkg>/dist exist) and a chromium (`pnpm exec playwright
 * install chromium`). Mirrors the server/launch pattern of scripts/visual-smoke.mjs.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = 4179;
const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core'); // package main → axe.js
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.md':'text/plain','.woff2':'font/woff2','.woff':'font/woff','.map':'application/json' };

// Routes that mount live components (docs-only routes have no demo to audit).
const ROUTES = [
  'home', 'grid', 'pivot', 'spreadsheet', 'gantt', 'scheduler', 'calendar', 'booking',
  'kanban', 'todo', 'charts', 'diagram', 'buttons', 'inputs', 'forms', 'layout',
  'navigation', 'overlays', 'richtext', 'chatbot', 'customizer', 'compare', 'performance',
  'a11y', 'server-data', 'flow-analytics', 'flow-planning', 'flow-data', 'realtime',
  'planning-control-center', 'operations-dispatch', 'analytics-workspace', 'workflow-delivery',
];

const srv = createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
  if (p === '/') p = '/preview/index.html';
  const f = join(ROOT, p.replace(/^\/+/, ''));
  if (!f.startsWith(ROOT) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));
const base = `http://127.0.0.1:${PORT}/preview/index.html`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=1024'] });

const failures = [];
let audited = 0;
for (const id of ROUTES) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}#${id}`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(id === 'performance' ? 5000 : 2600);
    await page.addScriptTag({ path: AXE_PATH });
    const v = await page.evaluate(async (rid) => {
      const el = document.getElementById(rid) || document.querySelector('.g-main') || document.body;
      const r = await window.axe.run(el, {});
      return r.violations
        .filter((x) => x.impact === 'serious' || x.impact === 'critical')
        .map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, target: x.nodes[0]?.target?.[0] }));
    }, id);
    audited++;
    for (const x of v) failures.push(`${id}: ${x.id} (${x.impact}) ×${x.n} — ${x.target ?? ''}`);
  } catch (e) {
    failures.push(`${id}: NAV/RUN error — ${e.message}`);
  }
  await ctx.close();
}
await browser.close();
srv.close();

console.log(`a11y-routes: audited ${audited}/${ROUTES.length} routes with axe-core (serious/critical gate).`);
if (failures.length) {
  console.error(`a11y-routes: ${failures.length} serious/critical violation(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('a11y-routes: OK — no serious/critical accessibility violations on any route.');
