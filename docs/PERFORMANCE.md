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
| Run at | 2026-06-26T19:07:55.657Z |
| Platform | win32 |
| Architecture | x64 |
| CPU | 12th Gen Intel(R) Core(TM) i7-12700KF |
| CPU cores | 20 |
| Node | v20.17.0 |

## Results

| Module | Dataset rows | Build+render ms | Avg frame ms | ~FPS |
| --- | --: | --: | --: | --: |
| Grid | 100,000 | 88.0 | 16.67 | 60 |
| Pivot | 50,000 | 67.0 | 16.67 | 60 |
| Scheduler | 2,000 | 14.0 | 16.67 | 60 |
| Gantt | 1,000 | 398.0 | 16.67 | 60 |

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
