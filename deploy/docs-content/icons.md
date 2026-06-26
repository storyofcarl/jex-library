# @jects/icons

> The Jects UI icon set — tree-shakeable inline SVG path data plus render helpers and a sprite.

## Overview

`@jects/icons` is the icon layer of Jects UI. Each icon is stored as **inner SVG markup** (paths/lines/circles, no `<svg>` wrapper) for a 24×24 stroke icon using `currentColor`, with **Lucide-compatible geometry**. Because icons are plain data objects and exports are side-effect-free, bundlers tree-shake unused icons.

It ships three ways to use icons:

- `renderIcon(name, opts)` — produce an inline SVG **string** (for template/HTML output).
- `createIconEl(name, opts)` — produce a detached **`SVGElement`** (for direct DOM use).
- A prebuilt **sprite** (`@jects/icons/sprite.svg`) plus `spriteId(name)` for `<use>`-based rendering.

The icon color follows `currentColor`, so icons inherit text color (and therefore Jects theme tokens) automatically.

## Installation

```bash
pnpm add @jects/icons
```

Ships ESM (`dist/icons.js`), CJS (`dist/icons.umd.cjs`), types (`dist/index.d.ts`), and a sprite (`dist/sprite.svg`).

## Integration / Usage

### Render to an SVG string

```ts
import { renderIcon } from '@jects/icons';

element.innerHTML = renderIcon('search', { size: 16 });
// stroke uses currentColor, so it inherits the surrounding text color
```

### Render to a DOM element

```ts
import { createIconEl } from '@jects/icons';

const svg = createIconEl('check', { size: 20, label: 'Done' });
button.appendChild(svg);
```

### Sizing & options

Both `renderIcon` and `createIconEl` take `RenderIconOptions`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `size` | `number` | `24` | Rendered pixel size (width = height). |
| `strokeWidth` | `number` | `2` | Stroke width. |
| `className` | `string` | — | Extra classes; the base class `jects-icon` is always applied. |
| `label` | `string` | — | Accessible label. When omitted the icon is marked `aria-hidden`. |

Color is **not** an option — icons render with `stroke: currentColor`, so set `color` on the element/ancestor (e.g. via a theme token) to recolor.

### Sprite / `<use>` rendering

For many repeated icons, include the sprite once and reference symbols by id:

```ts
import { spriteId } from '@jects/icons';
// e.g. inject @jects/icons/sprite.svg into the document, then:
const id = spriteId('calendar'); // the <symbol> id for the calendar icon
```

```html
<svg class="jects-icon" width="24" height="24"><use href="#" /></svg>
<!-- href set to `#${spriteId('calendar')}` -->
```

### Discovering available names

```ts
import { iconNames, icons, type IconName } from '@jects/icons';

iconNames;              // string[] of every available icon name
icons['search'];        // { size: 24, body: '<...inner svg...>' }
```

`IconName` is a literal union of all names, so `renderIcon` calls are type-checked against the set.

## Reference

### Exports
| Export | Description |
| --- | --- |
| `renderIcon(name, options?)` | Render an icon to an inline SVG **string** (`stroke: currentColor`). |
| `createIconEl(name, options?)` | Render an icon to a detached **`SVGElement`**. |
| `spriteId(name)` | The `<symbol>` id used in the sprite for an icon. |
| `icons` | Map of `name → IconDef` (`{ size: 24, body }`). |
| `iconNames` | `IconName[]` — all available names. |
| `IconName` | Union type of every icon name (`keyof typeof icons`). |
| `IconDef` | `{ size: 24; body: string }` — viewBox size + inner SVG markup. |
| `RenderIconOptions` | `{ size?, strokeWidth?, className?, label? }`. |

### Available icons (24 total)
| Category | Names |
| --- | --- |
| Chevrons/arrows | `chevron-up`, `chevron-down`, `chevron-left`, `chevron-right`, `chevrons-up-down`, `arrow-up`, `arrow-down` |
| Actions | `close`, `x`, `plus`, `minus`, `check`, `check-circle`, `search`, `filter`, `edit`, `trash` |
| Menus | `menu`, `more-horizontal`, `more-vertical` |
| Status / time | `info`, `alert-triangle`, `loader`, `calendar`, `clock` |

The authoritative list is always `iconNames` at runtime (or `icons` for the path data).

## Examples

### Render an icon at a given size with an accessible label

```ts
import { renderIcon, createIconEl } from '@jects/icons';

// String output (e.g. inside a template):
const html = `<button>${renderIcon('plus', { size: 16, label: 'Add item' })} Add</button>`;

// DOM output:
const trash = createIconEl('trash', { size: 18, strokeWidth: 1.75, className: 'danger' });
deleteButton.prepend(trash);
```

```css
/* icons inherit currentColor — recolor by setting color */
.danger { color: oklch(var(--jects-destructive)); }
```

## Notes

- **`currentColor` everywhere** — icons take their stroke from the inherited text color, so they theme automatically via `--jects-*` tokens (set `color`, not a fill/stroke prop).
- **Tree-shakeable** — `sideEffects: false` and per-icon data mean unused icons drop out of bundles when you import only what you render.
- **Lucide-compatible 24×24 stroke geometry** with a default `strokeWidth` of 2.
- **Accessibility** — pass `label` for meaningful icons; omit it for decorative ones (the icon is then `aria-hidden`).
