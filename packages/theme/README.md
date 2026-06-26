# @jects/theme — shippable Jects UI themes plus the runtime theming API

## What it is

`@jects/theme` is the CSS layer you actually ship for the Jects UI suite. It turns the `@jects/tokens` definitions into ready-to-import stylesheets (light, dark, high-contrast, and named presets) and adds a small runtime — `setTheme` / `applyTheme` / `exportThemeCss` — for switching themes and applying per-scope token overrides at runtime. The default look is the house style: Cool Zinc + Calm CMYK.

## Install

```bash
pnpm add @jects/theme
```

This brings in `@jects/tokens` transitively (it is a direct dependency).

## CSS

Always import the base stylesheet first — it sets the reset, the light `:root` tokens, and the base scope styles (organized into CSS `@layer`s):

```ts
import '@jects/theme/style.css';   // alias of base.css
```

Then import any variant stylesheets you want (see [Subpath exports](#subpath-exports)) and mark the region Jects controls with the scope class:

```html
<body class="jects-scope">
  <!-- Jects components live here -->
</body>
```

## Minimal example

```ts
import '@jects/theme/style.css';
import '@jects/theme/dark.css';
import { setTheme, getTheme } from '@jects/theme';

setTheme('dark');                 // toggles data-jects-theme + .jects-dark on <html>
getTheme();                       // → 'dark'

// scope a theme to a single element
const panel = document.querySelector('#panel')!;
setTheme('stockholm', panel);
```

## Subpath exports

Every non-`.`, non-`./style.css` entry in the package's `exports` map:

- `@jects/theme/base.css` — base layer: reset, light `:root` tokens, and base scope styles (same file as `style.css`).
- `@jects/theme/dark.css` — dark-mode overrides (`.jects-dark` / `[data-jects-theme='dark']`).
- `@jects/theme/high-contrast.css` — light-hc + dark-hc overrides (`.jects-hc`, `data-jects-theme='light-hc'` / `'dark-hc'`).
- `@jects/theme/stockholm.css` — the "Stockholm" minimalist preset (tight radius, flat shadows).
- `@jects/theme/material.css` — the "Material" preset.
- `@jects/theme/all.css` — a bundle that `@import`s every variant (base, dark, high-contrast, stockholm, material, and the additional presets).

## Common recipes

### Switch themes at runtime

```ts
import { setTheme, getTheme } from '@jects/theme';

setTheme('dark');                                  // on <html> by default
setTheme('light-hc', document.documentElement);    // explicit scope
getTheme();                                         // → active ThemeName
```

`ThemeName` is `'light' | 'dark' | 'light-hc' | 'dark-hc' | 'stockholm' | 'material'`.

### Override tokens at runtime

`applyTheme` writes inline CSS custom properties on a scope element (this is what the live customizer uses). Color values are written verbatim, so pass OKLCH triplets; scalar tokens (radius, font-family) take normal CSS values:

```ts
import { applyTheme } from '@jects/theme';

applyTheme(document.documentElement, {
  primary: '0.6 0.2 265',             // OKLCH triplet
  'primary-foreground': '0.985 0 0',
  radius: '0.5rem',                   // scalar token
});
```

### Export and clear overrides

```ts
import { exportThemeCss, clearTheme } from '@jects/theme';

const css = exportThemeCss();         // serialize current values into a `:root { ... }` string
clearTheme(document.documentElement); // remove previously applied inline overrides
```

### Re-exported token constants

For programmatic access to the underlying token system, `@jects/theme` re-exports from `@jects/tokens`:

```ts
import { LIGHT_DEFAULTS, DARK_DEFAULTS, TOKEN_PREFIX } from '@jects/theme';
import type { JectsSemanticName } from '@jects/theme';
```

## Theming

Theme your whole app by overriding `--jects-*` CSS custom properties — never by patching component CSS. Use the runtime `applyTheme` / `exportThemeCss` API for dynamic overrides, or ship a static `theme.css` loaded after `@jects/theme/base.css`. See [`docs/modules/theme.md`](../../docs/modules/theme.md) for the full token reference, variant activation table, and `@layer` cascade ordering.

## Stability & support

Stable. The CSS is auto-generated from `@jects/tokens` and the runtime surface is small, well-typed, and covered by the package test suite.

Part of the Jects UI suite. Commercial terms: see LICENSE.md.
