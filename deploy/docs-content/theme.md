# @jects/theme

> The shippable Jects UI theme(s) — generated token CSS plus a small runtime for switching/overriding themes.

## Overview

`@jects/theme` is the CSS layer you actually ship. It turns the `@jects/tokens` definitions into ready-to-import stylesheets (light, dark, high-contrast, and named presets) and adds a tiny runtime (`setTheme`/`applyTheme`/`exportThemeCss`) for switching themes and applying per-scope overrides.

It depends on `@jects/tokens` and emits:

- **Base CSS** (`base.css` / `style.css`) — the reset, light `:root` tokens, and base scope styles, organized into CSS `@layer`s.
- **Mode/preset stylesheets** — `dark.css`, `high-contrast.css` (light-hc + dark-hc), `stockholm.css`, `material.css`, and an `all.css` bundle.
- **Runtime** (`dist/theme.js` / `theme.umd.cjs`) — `setTheme`, `getTheme`, `applyTheme`, `clearTheme`, `exportThemeCss`.

The default look is the house style: **Cool Zinc + Calm CMYK**.

## Installation

```bash
pnpm add @jects/theme
```

(Brings in `@jects/tokens` transitively.)

## Integration / Usage

### Include the base CSS

Always import the base stylesheet first — it sets the reset, the light tokens, and the base scope styles:

```ts
import '@jects/theme/style.css';   // alias of base.css
// or
import '@jects/theme/base.css';
```

Then mark the region(s) Jects controls with the scope class/attribute (the base styles key off these):

```html
<body class="jects-scope">
  <!-- Jects components live here -->
</body>
```

### Enable dark mode and other variants

Import the variant stylesheet(s) you want, then toggle them. Variants activate via either a class **or** the `data-jects-theme` attribute:

```ts
import '@jects/theme/base.css';
import '@jects/theme/dark.css';
import '@jects/theme/high-contrast.css';
```

```html
<!-- class-based -->
<html class="jects-dark">              <!-- dark -->
<html class="jects-dark jects-hc">     <!-- dark + high contrast -->

<!-- attribute-based (equivalent) -->
<html data-jects-theme="dark">
<html data-jects-theme="light-hc">
```

Available subpath CSS exports:

| Import | What it provides |
| --- | --- |
| `@jects/theme/style.css` | Base (= `base.css`). Reset + light `:root` tokens + base scope styles. |
| `@jects/theme/base.css` | Same as `style.css`. |
| `@jects/theme/dark.css` | Dark overrides (`.jects-dark` / `[data-jects-theme='dark']`). |
| `@jects/theme/high-contrast.css` | Light-hc + dark-hc (`.jects-hc`, `data-jects-theme='light-hc'`/`'dark-hc'`). |
| `@jects/theme/stockholm.css` | "Stockholm" minimalist preset (tight radius, flat shadows). |
| `@jects/theme/material.css` | "Material" preset. |
| `@jects/theme/all.css` | Bundle that `@import`s every variant (base, dark, high-contrast, stockholm, material, and the bootstrap/refined/corporate presets). |

### Switch themes at runtime

```ts
import { setTheme, getTheme } from '@jects/theme';

setTheme('dark');                 // toggles data-jects-theme + .jects-dark on <html>
setTheme('stockholm', document.querySelector('#panel')!); // scope to an element
getTheme();                       // → 'dark'
```

`ThemeName` is `'light' | 'dark' | 'light-hc' | 'dark-hc' | 'stockholm' | 'material'`.

### Override tokens at runtime

`applyTheme` writes inline CSS custom properties on a scope element (this is what the live customizer uses). Color values are written verbatim, so pass **OKLCH triplets**:

```ts
import { applyTheme, clearTheme, exportThemeCss } from '@jects/theme';

applyTheme(document.documentElement, {
  primary: '0.6 0.2 265',         // OKLCH triplet
  'primary-foreground': '0.985 0 0',
  radius: '0.5rem',               // scalar tokens take CSS values
});

const css = exportThemeCss();     // serialize current values to a `:root { ... }` string
clearTheme(document.documentElement); // remove inline overrides
```

## Reference

### Runtime API
| Export | Description |
| --- | --- |
| `setTheme(name, scope?)` | Set the active theme on a scope (default `<html>`); toggles `data-jects-theme` + `.jects-dark`/`.jects-hc`. |
| `getTheme(scope?)` | Read the active theme name. |
| `applyTheme(scope, overrides)` | Apply per-scope token overrides as inline custom properties (verbatim values). |
| `clearTheme(scope, names?)` | Remove inline overrides (named, or all known semantic tokens). |
| `exportThemeCss(scope?, names?, selector?)` | Serialize current effective token values into a `:root { ... }` stylesheet string ("Export theme.css"). |
| `ThemeName` | `'light' \| 'dark' \| 'light-hc' \| 'dark-hc' \| 'stockholm' \| 'material'`. |
| `ThemeOverrides` | Override map: `primary`, `background`, `border`, `ring`, `radius`, `font-family`, … plus any `[token]: value`. |
| `LIGHT_DEFAULTS`, `DARK_DEFAULTS`, `TOKEN_PREFIX`, `JectsSemanticName` | Re-exported from `@jects/tokens`. |

### Theme variants & activation
| Variant | Class | Attribute |
| --- | --- | --- |
| Light (default) | — (on `:root`) | `data-jects-theme='light'` |
| Dark | `.jects-dark` | `data-jects-theme='dark'` |
| Light high-contrast | `.jects-hc` | `data-jects-theme='light-hc'` |
| Dark high-contrast | `.jects-dark.jects-hc` | `data-jects-theme='dark-hc'` |
| Stockholm | `.jects-theme-stockholm` | `data-jects-theme='stockholm'` |
| Material | (see material.css) | `data-jects-theme='material'` |

### CSS layers
The base CSS declares cascade layers in priority order so overrides are predictable:

```css
@layer jects.reset, jects.tokens, jects.base, jects.components, jects.utilities;
```

Tokens live in `jects.tokens`; your own app styles (declared outside these layers, or in `jects.utilities`) win over component defaults.

## Examples

### A `theme.css` override: custom primary + radius + dark mode

```css
/* theme.css — load AFTER @jects/theme/base.css (+ dark.css) */

/* Brand the light theme */
:root {
  --jects-primary: 0.55 0.18 265;        /* OKLCH L C H */
  --jects-primary-foreground: 0.985 0 0;
  --jects-ring: 0.65 0.12 265;
  --jects-radius: 0.5rem;                 /* single radius → whole scale */
}

/* Tweak the dark theme too */
.jects-dark,
[data-jects-theme='dark'] {
  --jects-primary: 0.72 0.14 265;
  --jects-primary-foreground: 0.21 0.008 272;
}
```

```ts
import '@jects/theme/base.css';
import '@jects/theme/dark.css';
import './theme.css';
import { setTheme } from '@jects/theme';

setTheme('dark'); // honor user preference
```

## Notes

- **Tokens-only theming.** Theme your whole app by overriding `--jects-*` tokens — never by patching component CSS.
- **OKLCH triplets** for color values everywhere (both in CSS overrides and `applyTheme`); scalar tokens (radius, font-family) take normal CSS values.
- **No Shadow DOM** in data components — these stylesheets cascade into widgets normally, which is why the `@layer` ordering matters for predictable overrides.
- Generated CSS is **auto-generated** by `scripts/build-theme.mjs` from `@jects/tokens` — don't hand-edit files in `dist/css/`.

## Theme customizer

The product site ships a live theme customizer at `#customizer` — collapsible, searchable groups for the full
token system (semantic colors, data/CMYK ramps, typography incl. weights/line-height/letter-spacing, spacing +
**density**, radius, **borders & outlines**, **tables**, elevation, motion), a multi-component live preview, a
WCAG contrast checker, preset starting points + `theme.css` import, shareable-URL state, and Download/Copy of the
complete overridden token set as `theme.css`. It writes overrides via `applyTheme(scope, …)` and exports via
`exportThemeCss(scope, …)`.
