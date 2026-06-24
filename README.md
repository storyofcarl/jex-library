# Jects UI

> A framework-agnostic, commercially-licensed JavaScript/TypeScript UI component suite —
> a unified replica of the combined surface area of **Bryntum** and **DHTMLX**, built on a
> clean, fully-customizable (shadcn-style) design system.

**Branding:** Product "Jects UI" · npm scope `@jects` · CSS class prefix `jects-` ·
CSS token prefix `--jects-` · custom elements `<jects-*>`.

## Architecture

- **One engine, many frameworks.** A zero-dependency vanilla TS core (`@jects/core`) is the
  source of truth. React / Angular / Vue wrappers are thin adapters.
- **Light-DOM, class-based engine.** No Shadow DOM — edit one stylesheet to restyle everything.
- **Imperative public API is the stable contract:** `new Button(el, opts); btn.on('click', fn); btn.destroy();`
- **Reactivity via a tiny signals lib** (`signal` / `computed` / `effect` / `batch`).
- **Theming = CSS custom properties only**, OKLCH channel-triplet tokens, three tiers, single `--jects-radius`.

See [`docs/PLAN.md`](docs/PLAN.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md) for the locked
architectural decisions (D1–D12) and the build waves, and
[`docs/CONTRIBUTING-COMPONENTS.md`](docs/CONTRIBUTING-COMPONENTS.md) for the component-author brief.

## Monorepo layout

```
packages/
  core        @jects/core     — signals, Widget, Store, TreeStore, EventEmitter, DOM utils, virtualization, factory
  tokens      @jects/tokens   — OKLCH 3-tier design tokens → CSS vars + SCSS maps + TS types
  theme       @jects/theme    — generated themes (light/dark/contrast/branded), applyTheme/setTheme
  icons       @jects/icons    — tree-shakeable SVG icon set + sprite
  widgets     @jects/widgets  — components (Button is the reference component)
tooling/
  vite-config @jects/vite-config — shared Vite library preset
apps/
  customizer  @jects/customizer — live theme builder, exports theme.css
  docs        @jects/docs-app   — minimal docs shell
```

## Develop

```bash
pnpm install
pnpm build        # turbo run build (topological, ^build)
pnpm test         # vitest across packages
pnpm typecheck
pnpm customizer   # run the theme customizer app
pnpm docs         # run the docs shell
```

## Tech stack

pnpm workspaces · Turborepo · Vite (library mode) · TypeScript (strict) · Vitest (+ browser mode) ·
Changesets. Node ≥ 20.17, pnpm 10.24.

## License

Commercial. © Composition Media. All rights reserved.
