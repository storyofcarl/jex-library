# @jects/tokens

> The OKLCH 3-tier design-token source of truth — CSS custom properties, SCSS maps, and TS types.

## Overview

`@jects/tokens` is the raw design-token layer of Jects UI. It defines the **single source of truth** for every design value (color, spacing, type, radius, shadow, z-index, motion) and emits it in three consumable formats from one `tokens.json`:

- `dist/tokens.css` — CSS custom properties on `:root` (the runtime contract).
- `dist/tokens.scss` — SCSS map (for Sass pipelines).
- `dist/index.js` + `dist/index.d.ts` — TypeScript constants/types and helpers.

Colors are stored as **OKLCH channel triplets** (`L C H`, e.g. `0.21 0.008 272`) — *not* full color strings — so they are consumed as `oklch(var(--jects-x))`. Every token name is prefixed `--jects-`. The house style is **"Cool Zinc + Calm CMYK"** (shadcn zinc nudged to the cool neutral hue `272`, plus a calm CMYK categorical palette).

`@jects/theme` builds on this package to ship ready-to-use theme stylesheets; `@jects/tokens` is the underlying definitions.

## Installation

```bash
pnpm add @jects/tokens
```

Most apps consume `@jects/theme` (which depends on `@jects/tokens`). Add `@jects/tokens` directly when you need the raw token CSS, the SCSS map, or the TS constants/types.

## Integration / Usage

### As CSS

```css
@import '@jects/tokens/tokens.css';
```

Then reference tokens. Color tokens are OKLCH triplets, so wrap them in `oklch()`:

```css
.my-card {
  background: oklch(var(--jects-card));
  color: oklch(var(--jects-card-foreground));
  border: 1px solid oklch(var(--jects-border));
  border-radius: var(--jects-radius);
  padding: var(--jects-space-4);
  box-shadow: var(--jects-shadow-sm);
}
```

### As SCSS

```scss
@use '@jects/tokens/tokens.scss';
```

### As TypeScript

```ts
import {
  TOKEN_PREFIX,        // '--jects-'
  SEMANTIC_TOKENS, CMYK_TOKENS, DATA_TOKENS, SCALE_TOKENS,
  LIGHT_DEFAULTS, DARK_DEFAULTS,
  tokenVar, oklchToken,
} from '@jects/tokens';

tokenVar('primary');        // → 'var(--jects-primary)'
oklchToken('primary');      // → 'oklch(var(--jects-primary))'
oklchToken('primary', 0.5); // → 'oklch(var(--jects-primary) / 0.5)'
```

You can also import the raw definitions via `@jects/tokens/tokens.json`.

### Token tiers

The system is **3-tier: primitive → semantic → component**.

1. **Primitive (Tier 1)** — the irreducible base values in `tokens.json`: `neutral-hue` (`272`), `white` (`1 0 0`), `black` (`0 0 0`). These seed everything else.
2. **Semantic (Tier 2)** — role-based tokens that components actually consume: `--jects-background`, `--jects-primary`, `--jects-destructive`, `--jects-border`, etc. These are theme-dependent (light vs dark vs high-contrast).
3. **Component (Tier 3)** — per-component variables that components declare locally, resolving up to semantic tokens (e.g. derived radii like `--jects-radius-sm` = `calc(var(--jects-radius) - 4px)`).

### Overriding tokens

Override any token by redeclaring the custom property on `:root` (or a scoped element). Because color tokens are triplets, override them with triplets:

```css
:root {
  --jects-primary: 0.6 0.2 265;  /* OKLCH L C H — a blue primary */
  --jects-radius: 0.375rem;       /* single radius drives the whole scale */
}
```

## Reference

All names below are prefixed with `--jects-` in CSS. The TS exports list the un-prefixed names; `JectsTokenName` is the full prefixed union.

### Tier 1 — Primitives (`tokens.json`)
| Token | Value |
| --- | --- |
| `neutral-hue` | `272` (the cool hue all neutrals use) |
| `white` | `1 0 0` |
| `black` | `0 0 0` |

### Tier 2 — Semantic colors (`SEMANTIC_TOKENS`)
OKLCH triplets; theme-dependent (light / dark / high-contrast / preset values differ).

| Group | Tokens |
| --- | --- |
| Surfaces | `background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground` |
| Brand | `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `accent`, `accent-foreground`, `muted`, `muted-foreground` |
| Status | `destructive`, `destructive-foreground`, `success`, `success-foreground`, `warning`, `warning-foreground` |
| Lines/focus | `border`, `input`, `ring` |

### Calm CMYK palette (`CMYK_TOKENS`)
Categorical (qualitative) palette, theme-invariant.

| Token | Value | | Token | Value |
| --- | --- | --- | --- | --- |
| `cmyk-cyan` | `0.70 0.10 210` | | `cmyk-cyan-soft` | `0.95 0.03 210` |
| `cmyk-magenta` | `0.62 0.14 350` | | `cmyk-magenta-soft` | `0.94 0.035 350` |
| `cmyk-yellow` | `0.80 0.11 92` | | `cmyk-yellow-soft` | `0.96 0.04 92` |
| `cmyk-key` | `0.21 0.008 272` | | `cmyk-key-soft` | `0.95 0.004 272` |

### Chart series ramp (`DATA_TOKENS`)
`data-1` … `data-8` — the qualitative series ramp (built from the CMYK order) for charts/legends. e.g. `--jects-data-1: 0.70 0.10 210`, … `--jects-data-8: 0.40 0.02 272`.

### Scales (`SCALE_TOKENS`) — theme-invariant
| Group | Tokens / values |
| --- | --- |
| Spacing | `space-0` (0) … `space-12` (3rem); step = `0.25rem` (`space-4` = 1rem) |
| Radius | `radius` = `0.625rem` — the **single radius**; theme CSS derives `radius-sm/md/lg/xl` from it via `calc()` |
| Font family | `font-family` (system sans), `font-family-mono` (system mono) |
| Font size | `font-size-xs` `.75rem`, `sm` `.875rem`, `md` `1rem`, `lg` `1.125rem`, `xl` `1.25rem`, `2xl` `1.5rem` |
| Font weight | `font-weight-normal` 400, `medium` 500, `semibold` 600, `bold` 700 |
| Shadow | `shadow-sm`, `shadow-md`, `shadow-lg` (OKLCH-based) |
| Z-index | `z-dropdown` 1000, `z-sticky` 1020, `z-overlay` 1030, `z-modal` 1040, `z-popover` 1050, `z-tooltip` 1060 |
| Motion | `duration-fast` 120ms, `duration-normal` 200ms, `duration-slow` 320ms |

### TS helpers
| Export | Description |
| --- | --- |
| `TOKEN_PREFIX` | The literal `'--jects-'`. |
| `SEMANTIC_TOKENS` / `CMYK_TOKENS` / `DATA_TOKENS` / `SCALE_TOKENS` | Read-only arrays of un-prefixed token names. |
| `LIGHT_DEFAULTS` / `DARK_DEFAULTS` | `Record<string,string>` of OKLCH triplet defaults per mode. |
| `tokenVar(name)` | Build `var(--jects-<name>)`. |
| `oklchToken(name, alpha?)` | Build `oklch(var(--jects-<name>) [/ alpha])`. |
| `JectsTokenName` / `JectsSemanticName` / `JectsCmykName` / `JectsScaleName` | Type unions of token names. |

## Examples

### Override the house palette to a branded primary + tighter radius

```css
@import '@jects/tokens/tokens.css';

:root {
  --jects-primary: 0.55 0.18 265;          /* brand blue (OKLCH triplet) */
  --jects-primary-foreground: 0.985 0 0;   /* near-white text on it */
  --jects-ring: 0.65 0.12 265;             /* matching focus ring */
  --jects-radius: 0.375rem;                /* drives sm/md/lg/xl */
}
```

## Notes

- **OKLCH triplets, not colors.** Tokens store `L C H` only — always consume color tokens as `oklch(var(--jects-x))` (optionally `oklch(var(--jects-x) / 0.5)` for alpha). This is what makes runtime theming and contrast-safe overrides cheap.
- **Tokens-only theming.** Every visual change should be expressible as a token override — components never hardcode colors/spacing.
- **Single radius.** Set `--jects-radius` once; the whole radius scale follows.
- Generated files are **auto-generated** from `src/tokens.json` (do not hand-edit `dist/tokens.css` / `tokens.scss`).

## Component tokens (tier 3)

Component-level tokens layer on top of the semantic tier; they let the theme customizer (and consumers)
tune controls, borders, focus outlines, density, and tables without touching component CSS. Defaults equal
the values components previously hard-coded (so introducing them changed nothing visually).

| Token | Default | Drives |
| --- | --- | --- |
| `--jects-border-width` | `1px` | every bordered surface |
| `--jects-ring-width` | `2px` | `:focus-visible` outline width |
| `--jects-ring-offset` | `2px` | `:focus-visible` outline offset |
| `--jects-density` | `1` | multiplier on control height/padding (compact↔comfortable) |
| `--jects-control-height` | `2.25rem` | control height baseline |
| `--jects-control-padding-x` / `-y` | `0.75rem` / `0.375rem` | control padding |
| `--jects-line-height` | `1.5` | body/control line-height |
| `--jects-letter-spacing` | `0em` | body/control letter-spacing |
| `--jects-table-header-bg` | `oklch(var(--jects-muted))` | data-grid header background |
| `--jects-table-border` | `oklch(var(--jects-border))` | grid/header border |
| `--jects-table-row-stripe` | `oklch(var(--jects-muted) / 0.3)` | zebra striping |
| `--jects-table-row-hover` | `oklch(var(--jects-accent) / 0.4)` | row hover |
| `--jects-table-cell-padding-x` | `0.75rem` | table cell horizontal padding |
| `--jects-table-cell-padding-y` / `--jects-table-row-height` | `0.5rem` / `2.25rem` | reserved for CSS-driven tables (grid row height is JS-virtualized) |

Override them per scope like any token (`applyTheme(scope, { 'border-width': '2px', 'table-header-bg': 'oklch(...)' })`),
or edit them live in the **theme customizer** (`#customizer`).
