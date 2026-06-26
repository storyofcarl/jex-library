# Production checklist

A pre-launch checklist for shipping a Jects UI application.

## Install & import

- [ ] Install only the packages you use plus `@jects/theme`
      (e.g. `pnpm add @jects/grid @jects/theme`).
- [ ] Import the theme once at app entry: `import '@jects/theme/style.css'`.
- [ ] Import each component's stylesheet: `import '@jects/grid/style.css'`.
- [ ] Prefer subpath imports where available (e.g. `@jects/react/grid`, `@jects/grid/columns`) so the
      bundler only pulls what you use.

## Framework integration

- [ ] Construct components in a browser-only lifecycle (effect / `onMounted` / `afterRender`).
- [ ] Call `.destroy()` on unmount to release listeners and DOM.
- [ ] Pass large datasets by reference; avoid recreating component instances on every render.

## Theming

- [ ] Pick a base theme (light / dark / high-contrast) or export one from the customizer.
- [ ] Override `--jects-*` tokens at your app scope rather than editing component CSS.
- [ ] Verify color contrast meets your accessibility target (the customizer includes a WCAG checker).

## Security

- [ ] Never pass untrusted strings to HTML-accepting options; pass text, or sanitize first.
- [ ] Set a Content-Security-Policy; the suite needs no `unsafe-eval`.
- [ ] Review the [`SECURITY.md`](./SECURITY.md) HTML/injection contract for any custom renderers.

## Performance

- [ ] Lazy-load heavy routes/components; load component CSS with the route.
- [ ] Run the relevant scenario through the `#performance` benchmark on representative hardware.
- [ ] Analyze your production bundle; confirm only the expected packages/subpaths are included.

## Accessibility

- [ ] Verify keyboard operation for interactive components (Grid, Gantt, Scheduler, Spreadsheet, Diagram).
- [ ] Run axe (or your a11y tooling) against pages embedding the components.
- [ ] Test with reduced-motion and high-contrast settings.

## Quality gates

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` pass in CI.
- [ ] Example apps build (`pnpm --filter "./examples/*" build`).
- [ ] Pin the suite version; all `@jects/*` packages share one version line.
