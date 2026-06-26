/**
 * Jects UI — reproducible performance bench harness.
 *
 * Drives the live in-browser benchmarks exposed by the gallery's `#performance`
 * route and records the numbers into docs/PERFORMANCE.md (and stdout).
 *
 * Pattern: mirrors the repo's headless conventions — a tiny Node static http
 * server over `deploy/` (the prebuilt, self-contained gallery that gets served),
 * ONE chromium via Playwright (headless, `--no-sandbox`, memory capped to match
 * `NODE_OPTIONS=--max-old-space-size=1024`), same as the browser test setup
 * (vitest.browser.config.ts: provider playwright, name chromium, headless true).
 *
 * Page contract consumed (provided by the `#performance` route):
 *   window.__JECTS_PERF__ = {
 *     runAt: <number>,
 *     results: [ { module, rows, buildMs, frameMs, fps } ]
 *   }
 *   window.__runJectsBench()  // async; runs/reruns all benchmarks, resolves to results[]
 *
 * Run:  pnpm build   (to refresh deploy/)  then  node scripts/bench/run.mjs
 *   or: pnpm bench
 *
 * Exits 1 (loudly) if the route never renders or returns no results.
 */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const DEPLOY_DIR = join(ROOT, 'deploy');
const PORT = 4178;
const NAV_TIMEOUT_MS = 60_000;
const BENCH_TIMEOUT_MS = 120_000; // benches can build large datasets
const POLL_TIMEOUT_MS = 60_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.scss': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Tiny static file server rooted at deploy/. Path-traversal safe. */
function startServer() {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        // Strip query/hash, decode, default to index.html.
        let urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
        if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

        // Resolve against the deploy root and guard against escaping it.
        const rel = normalize(urlPath).replace(/^[/\\]+/, '');
        const filePath = join(DEPLOY_DIR, rel);
        if (!filePath.startsWith(DEPLOY_DIR + sep) && filePath !== DEPLOY_DIR) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        let body;
        try {
          body = await readFile(filePath);
        } catch {
          // SPA-ish fallback: unknown non-asset paths serve index.html so the
          // hash route still boots (the bench route is `/#performance`).
          if (!extname(filePath)) {
            body = await readFile(join(DEPLOY_DIR, 'index.html'));
            res.setHeader('Content-Type', MIME['.html']);
            res.statusCode = 200;
            res.end(body);
            return;
          }
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        res.setHeader('Content-Type', MIME[extname(filePath).toLowerCase()] || 'application/octet-stream');
        res.statusCode = 200;
        res.end(body);
      } catch (err) {
        res.statusCode = 500;
        res.end('Server error: ' + (err && err.message));
      }
    });

    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function fmt(n, digits = 1) {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function buildMarkdown({ results, machine, runStamp }) {
  const rows = results
    .map((r) => {
      const ds = typeof r.rows === 'number' ? r.rows.toLocaleString('en-US') : '—';
      const p = r.skipped ? 'skipped' : r.pass === false ? 'over' : r.pass === true ? 'ok' : '—';
      return `| ${r.module ?? '—'} | ${ds} | ${fmt(r.buildMs)} | ${fmt(r.frameP50 ?? r.frameMs, 2)} | ${fmt(r.frameP95, 2)} | ${fmt(r.frameP99, 2)} | ${fmt(r.fps, 0)} | ${fmt(r.memMB, 1)} | ${fmt(r.budgetMs, 0)} | ${p} |`;
    })
    .join('\n');

  return `# Jects UI — Performance

> Reference benchmark run. Measured **live in a real browser** (headless Chromium
> via Playwright), not synthetic micro-benchmarks. Your numbers will vary with
> hardware, OS, and browser version.

## How to reproduce

\`\`\`sh
pnpm build              # refresh the self-contained gallery under deploy/
node scripts/bench/run.mjs
# or simply:
pnpm bench
\`\`\`

The harness serves \`deploy/\` over a local http server, launches one headless
Chromium (memory capped at 1024 MB to match \`NODE_OPTIONS=--max-old-space-size=1024\`),
navigates to the gallery's \`#performance\` route, runs the in-browser benchmarks
via \`window.__runJectsBench()\`, reads \`window.__JECTS_PERF__\`, and rewrites this file.

## Machine (reference run)

| Field | Value |
| --- | --- |
| Run at | ${runStamp} |
| Platform | ${machine.platform} |
| Architecture | ${machine.arch} |
| CPU | ${machine.cpuModel} |
| CPU cores | ${machine.cpuCount} |
| Node | ${machine.node} |

## Results

| Module | Dataset rows | Build avg ms | Frame p50 ms | Frame p95 ms | Frame p99 ms | ~FPS | Memory MB | Budget ms | Status |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | :-: |
${rows}

## Methodology & disclaimer

- Each module mounts a representative dataset and measures **build+render** time
  (initial mount to first painted frame) and **average frame time** under
  interaction; \`~FPS\` is derived from the average frame time.
- Numbers are a **reference run on the machine listed above** — they are
  illustrative, not a guarantee. Real-world performance depends on your hardware,
  display refresh rate, browser, and dataset shape.
- Measurements come from a real browser rendering real components, not from
  isolated synthetic loops. Treat them as directional, and re-run \`pnpm bench\`
  on your own hardware for numbers that reflect your environment.
`;
}

async function main() {
  if (!existsSync(DEPLOY_DIR)) {
    console.error(`ERROR: deploy/ not found at ${DEPLOY_DIR}. Run "pnpm build" first.`);
    process.exit(1);
  }
  if (!existsSync(join(DEPLOY_DIR, 'index.html'))) {
    console.error(`ERROR: deploy/index.html missing. Run "pnpm build" first.`);
    process.exit(1);
  }

  const machine = {
    platform: process.platform,
    arch: process.arch,
    cpuModel: (os.cpus()[0] && os.cpus()[0].model) || 'unknown',
    cpuCount: os.cpus().length,
    node: process.version,
  };
  const runStamp = new Date().toISOString();

  let server;
  let browser;
  try {
    server = await startServer();
    console.log(`bench: serving deploy/ at http://127.0.0.1:${PORT}/`);

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        // Honor the same memory cap the rest of the headless tooling uses.
        '--js-flags=--max-old-space-size=1024',
      ],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    page.on('pageerror', (err) => console.warn(`bench: page error: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.warn(`bench: console error: ${msg.text()}`);
    });

    const url = `http://127.0.0.1:${PORT}/#performance`;
    console.log(`bench: navigating to ${url}`);
    await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });

    // Give the hash route a chance to mount and register the bench hooks.
    await page
      .waitForFunction(
        () => typeof window.__runJectsBench === 'function' || !!window.__JECTS_PERF__,
        undefined,
        { timeout: NAV_TIMEOUT_MS },
      )
      .catch(() => {
        // Non-fatal here — we still attempt the fallback poll below.
        console.warn('bench: __runJectsBench / __JECTS_PERF__ not detected within nav timeout; will poll.');
      });

    let results;
    const hasRunner = await page.evaluate(() => typeof window.__runJectsBench === 'function');

    if (hasRunner) {
      console.log('bench: running window.__runJectsBench() ...');
      results = await page.evaluate(async () => {
        const out = await window.__runJectsBench();
        // Prefer the explicit return; fall back to the published contract object.
        if (Array.isArray(out)) return out;
        return (window.__JECTS_PERF__ && window.__JECTS_PERF__.results) || null;
      }, { timeout: BENCH_TIMEOUT_MS });
    } else {
      console.log('bench: __runJectsBench missing — polling for window.__JECTS_PERF__ ...');
      await page.waitForFunction(
        () => !!(window.__JECTS_PERF__ && Array.isArray(window.__JECTS_PERF__.results) && window.__JECTS_PERF__.results.length),
        undefined,
        { timeout: POLL_TIMEOUT_MS },
      );
      results = await page.evaluate(() => window.__JECTS_PERF__.results);
    }

    if (!Array.isArray(results) || results.length === 0) {
      console.error('ERROR: bench produced no results (window.__JECTS_PERF__.results empty or missing).');
      console.error('       Is the #performance route present in deploy/ and exposing the contract?');
      process.exit(1);
    }

    const md = buildMarkdown({ results, machine, runStamp });
    await writeFile(join(ROOT, 'docs', 'PERFORMANCE.md'), md, 'utf8');

    // Print a compact table to stdout.
    console.log('');
    console.log(`bench: ${results.length} module(s) measured @ ${runStamp}`);
    console.log(`bench: ${machine.cpuModel} (${machine.cpuCount} cores) · ${machine.platform}/${machine.arch} · node ${machine.node}`);
    console.log('');
    console.log('Module                 | Rows      | Build ms | Frame ms | ~FPS');
    console.log('-----------------------+-----------+----------+----------+-----');
    for (const r of results) {
      const mod = String(r.module ?? '—').padEnd(22).slice(0, 22);
      const rows = (typeof r.rows === 'number' ? r.rows.toLocaleString('en-US') : '—').padStart(9);
      const build = fmt(r.buildMs).padStart(8);
      const frame = fmt(r.frameMs, 2).padStart(8);
      const fps = fmt(r.fps, 0).padStart(4);
      console.log(`${mod} | ${rows} | ${build} | ${frame} | ${fps}`);
    }
    console.log('');
    console.log('bench: wrote docs/PERFORMANCE.md');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await closeServer(server).catch(() => {});
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('ERROR: bench failed:', (err && err.stack) || err);
    process.exit(1);
  },
);
