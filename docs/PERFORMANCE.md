# Jects UI — Performance

> Reference benchmark run. Measured **live in a real browser** (headless Chromium
> via Playwright), not synthetic micro-benchmarks. Your numbers will vary with
> hardware, OS, and browser version.

## How to reproduce

```sh
pnpm build              # refresh the self-contained gallery under deploy/
node scripts/bench/run.mjs
# or simply:
pnpm bench
```

The harness serves `deploy/` over a local http server, launches one headless
Chromium (memory capped at 1024 MB to match `NODE_OPTIONS=--max-old-space-size=1024`),
navigates to the gallery's `#performance` route, runs the in-browser benchmarks
via `window.__runJectsBench()`, reads `window.__JECTS_PERF__`, and rewrites this file.

## Machine (reference run)

| Field | Value |
| --- | --- |
| Run at | 2026-06-26T23:31:24.955Z |
| Platform | win32 |
| Architecture | x64 |
| CPU | 12th Gen Intel(R) Core(TM) i7-12700KF |
| CPU cores | 20 |
| Node | v20.17.0 |

## Results

| Module | Dataset rows | Build avg ms | Frame p50 ms | Frame p95 ms | Frame p99 ms | ~FPS | Memory MB | Budget ms | Status |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | :-: |
| Grid | 100,000 | 48.0 | 16.70 | 16.80 | 16.80 | 60 | 87.5 | 180 | ok |
| Pivot | 50,000 | 53.0 | 16.70 | 16.80 | 16.80 | 60 | 87.5 | 180 | ok |
| Scheduler | 2,000 | 6.0 | 16.70 | 16.70 | 16.80 | 60 | 87.5 | 450 | ok |
| Gantt | 1,000 | 267.0 | 16.70 | 16.70 | 16.80 | 60 | 87.5 | 600 | ok |
| Spreadsheet | 1,000 | 26.0 | 16.70 | 16.80 | 16.80 | 60 | 87.5 | 320 | ok |
| Diagram | 600 | 1.0 | 16.70 | 16.70 | 16.80 | 60 | 87.5 | 400 | ok |
| Kanban | 2,000 | 32.0 | 16.70 | 16.80 | 16.80 | 60 | 87.5 | 260 | ok |
| Calendar | 1,000 | 11.0 | 16.70 | 16.80 | 16.80 | 60 | 87.5 | 220 | ok |
| Charts | 2,000 | 23.0 | 16.70 | 16.70 | 16.80 | 60 | 87.5 | 160 | ok |

## Methodology & disclaimer

- Each module mounts a representative dataset and measures **build+render** time
  (initial mount to first painted frame) and **average frame time** under
  interaction; `~FPS` is derived from the average frame time.
- Numbers are a **reference run on the machine listed above** — they are
  illustrative, not a guarantee. Real-world performance depends on your hardware,
  display refresh rate, browser, and dataset shape.
- Measurements come from a real browser rendering real components, not from
  isolated synthetic loops. Treat them as directional, and re-run `pnpm bench`
  on your own hardware for numbers that reflect your environment.
