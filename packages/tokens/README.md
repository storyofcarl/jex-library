# @jects/tokens — the OKLCH 3-tier design-token source of truth for Jects UI.

## What it is

`@jects/tokens` defines the single source of truth for every design value in Jects UI — color, spacing, type, radius, shadow, z-index, and motion. It stores those values once (as OKLCH channel triplets and scalars) and emits them in three consumable formats: CSS custom properties, an SCSS map, and TypeScript constants/types. Colors are stored as OKLCH triplets (`L C H`, e.g. `0.21 0.008 272`) rather than full color strings, so runtime theming and contrast-safe overrides stay cheap.

## Install

```bash
pnpm add @jects/tokens @jects/theme
```

Most apps consume `@jects/theme` (which builds ready-to-use theme stylesheets on top of this package). Add `@jects/tokens` directly when you need the raw token CSS, the SCSS map, or the TypeScript constants/types.

## CSS

This package emits its custom properties via `dist/tokens.css` (exported as `./tokens.css` — there is no `./style.css`):

```css
@import '@jects/tokens/tokens.css';
```

That puts every `--jects-*` custom property on `:root`. Color tokens are OKLCH triplets, so wrap them in `oklch()` when you use them.

## Minimal example

`@jects/tokens` has no component constructor — it ships token data plus small string helpers. The typical vanilla-TS use builds CSS references from token names:

```ts
import { tokenVar, oklchToken } from '@jects/tokens';

const host = document.querySelector<HTMLDivElement>('#card')!;
host.style.background = oklchToken('card');          // 'oklch(var(--jects-card))'
host.style.color = oklchToken('card-foreground');    // 'oklch(var(--jects-card-foreground))'
host.style.borderColor = oklchToken('border', 0.5);  // 'oklch(var(--jects-border) / 0.5)'
host.style.borderRadius = tokenVar('radius');        // 'var(--jects-radius)'
```

## Subpath exports

- `./tokens.css` — CSS custom properties on `:root` (the runtime contract). Import this in your stylesheet.
- `./tokens.scss` — the same tokens as an SCSS map, for Sass build pipelines.
- `./tokens.json` — the raw token definitions (the source `tokens.json`), for tooling that needs the values directly.

## Common recipes

Build color references in TypeScript:

```ts
import { tokenVar, oklchToken } from '@jects/tokens';

tokenVar('primary');        // → 'var(--jects-primary)'
oklchToken('primary');      // → 'oklch(var(--jects-primary))'
oklchToken('primary', 0.5); // → 'oklch(var(--jects-primary) / 0.5)'
```

Iterate the categorical chart palette for a legend or series mapping:

```ts
import { DATA_TOKENS, oklchToken } from '@jects/tokens';

const seriesColors = DATA_TOKENS.map((name) => oklchToken(name));
// ['oklch(var(--jects-data-1))', … 'oklch(var(--jects-data-8))']
```

Read the per-mode OKLCH defaults (e.g. to seed a custom theme):

```ts
import { LIGHT_DEFAULTS, DARK_DEFAULTS, SEMANTIC_TOKENS } from '@jects/tokens';

LIGHT_DEFAULTS['primary']; // OKLCH triplet string, e.g. '0.21 0.008 272'
DARK_DEFAULTS['primary'];  // the dark-mode triplet
```

Override a token at runtime — because color tokens are triplets, override them with triplets:

```css
:root {
  --jects-primary: 0.55 0.18 265; /* brand blue (OKLCH L C H) */
  --jects-radius: 0.375rem;        /* single radius drives the whole scale */
}
```

## Theming

Every visual value is a CSS custom property under the `--jects-*` prefix (`TOKEN_PREFIX === '--jects-'`); override any of them on `:root` or a scoped element to retheme. Include `@jects/theme` for ready-made light/dark/high-contrast stylesheets built on these tokens. See [docs/modules/theme.md](../../docs/modules/theme.md).

## Stability & support

**Stable.** The token set, prefix, export map, and helper signatures are validated against `src/tokens.json` by the package's build-and-test step (`test/tokens.test.mjs`), and the emitted CSS/SCSS/TS are generated from that single source.

Part of the Jects UI suite. Commercial terms: see LICENSE.md.

---

Repository: <https://github.com/storyofcarl/jex-library> · Live demo: <https://jexlibrary.vercel.app>
