# @jects/icons — the icon layer of the Jects UI suite

## What it is

`@jects/icons` is a tree-shakeable set of 24×24 stroke icons stored as inline SVG path data, plus small helpers to render them as an SVG string or a detached `SVGElement`, and a prebuilt sprite for `<use>`-based rendering. Icons stroke with `currentColor`, so they inherit the surrounding text color and theme automatically. Because each icon is a plain side-effect-free data object, bundlers drop the ones you never render.

## Install

```bash
pnpm add @jects/icons @jects/theme
```

`@jects/theme` is optional but recommended — icons inherit `color`, so the theme tokens that drive your text color also drive your icons. The package itself has no runtime dependencies.

## Minimal example

```ts
import { renderIcon, createIconEl } from '@jects/icons';

// 1) Render to an inline SVG string (templates / HTML output):
host.innerHTML = renderIcon('search', { size: 16 });

// 2) Render to a detached SVGElement (direct DOM use):
const el = createIconEl('check', { size: 20, label: 'Done' });
button.appendChild(el);
```

The icon stroke uses `currentColor`, so set `color` on the element or an ancestor to recolor it — there is no color option.

## Subpath exports

- `@jects/icons/sprite.svg` — the prebuilt SVG sprite containing every icon as a `<symbol>`; inject it once into the document and reference symbols by id via `spriteId(name)` and `<use href="#...">`.

## Common recipes

Render an icon with an accessible label and extra classes:

```ts
import { createIconEl } from '@jects/icons';

const trash = createIconEl('trash', { size: 18, strokeWidth: 1.75, className: 'danger' });
deleteButton.prepend(trash);
```

Discover the available names (and inspect the raw path data) at runtime — `IconName` is a literal union, so calls are type-checked against the set:

```ts
import { iconNames, icons, type IconName } from '@jects/icons';

iconNames;            // string[] of every available icon name
icons['search'];      // IconDef → { size: 24, body: '<...inner svg...>' }
```

Sprite / `<use>` rendering for many repeated icons — include the sprite once, then reference symbols by id:

```ts
import { spriteId } from '@jects/icons';

const id = spriteId('calendar'); // the <symbol> id for the calendar icon
```

```html
<svg class="jects-icon" width="24" height="24"><use href="#JECTS_SPRITE_ID" /></svg>
<!-- set href to `#${spriteId('calendar')}` -->
```

## Theming

Icons take their stroke from the inherited text color, so they theme automatically through Jects CSS custom properties (`--jects-*`). Recolor by setting `color` (e.g. `color: oklch(var(--jects-destructive))`), not a fill/stroke prop. Include [`@jects/theme`](../../docs/modules/theme.md) for the token definitions. See also `docs/modules/theme.md`.

## Accessibility

Pass `label` for meaningful icons (it is applied as an accessible label); omit it for decorative icons, in which case the rendered SVG is marked `aria-hidden`.

## Stability & support

**Stable.** The surface is small (`renderIcon`, `createIconEl`, `spriteId`, plus the `icons` / `iconNames` data and `IconName` / `IconDef` / `RenderIconOptions` types) and exercised by the package test suite.

Part of the Jects UI suite. Repository: <https://github.com/storyofcarl/jex-library> · Live demo: <https://jexlibrary.vercel.app>. Commercial terms: see LICENSE.md.
