# @jects/widgets — the enterprise widget kit for Jects UI

## What it is

`@jects/widgets` is the Suite-class component library of [Jects UI](https://github.com/storyofcarl/jex-library): fields, choice controls, date/time, pickers, display, feedback, forms, layout, navigation, overlays, windows, rich text, tabs, and data views. Every component is a plain TypeScript class built on the `@jects/core` `Widget` base — it renders into the light DOM (no Shadow DOM, no virtual DOM, no framework), exposes an imperative API (`new Component(host, config)` + methods + events), and is themed entirely through `--jects-*` CSS variables. Components ship with full keyboard and ARIA wiring and self-register with the `@jects/core` factory on import, so they can be composed by `type` (this is how `Form` builds its child controls).

See it live: [jexlibrary.vercel.app](https://jexlibrary.vercel.app).

## Install

```bash
pnpm add @jects/widgets @jects/core @jects/theme @jects/icons
```

All three peers are required: `@jects/core` (the `Widget` base class, event bus, and `create()`/`register()` factory), `@jects/theme` (the `--jects-*` token CSS), and `@jects/icons` (icon glyphs used by `Button`, `Toolbar`, `Menu`, and others).

The package is ESM (`type: module`) and side-effect-free except for CSS, so it tree-shakes — import only the components you use.

## CSS

This package ships `dist/style.css` (exported as `@jects/widgets/style.css`). Import the theme tokens once, then the widgets stylesheet:

```ts
import '@jects/theme/style.css';   // --jects-* tokens
import '@jects/widgets/style.css'; // widget component styles
```

Scope the tokens by adding the `jects-scope` class to a wrapping element (commonly `<body>`):

```html
<body class="jects-scope"> ... </body>
```

## Minimal example

```ts
import { TextField, Button } from '@jects/widgets';

const name = new TextField('#name-host', { label: 'Name', clearable: true });
name.on('change', ({ value }) => console.log(value));

const save = new Button('#save-host', { text: 'Save', variant: 'primary' });
save.on('click', () => console.log(name.getConfig().value));

// Tear down when done.
save.destroy();
name.destroy();
```

Every constructor takes `(host: HTMLElement | string, config?)`, where `host` is an element or a CSS selector. Each component inherits the `@jects/core` `Widget` surface: `.on()`/`.off()`/`.emit()`, `.update(patch)`, `.getConfig()`, `.show()`/`.hide()`, `.destroy()`, plus `.el`, `.id`, and `.isDestroyed`.

## Subpath exports

The root entry (`@jects/widgets`) re-exports every component. These additive subpaths pull in only one family each (lighter graphs when you need just a slice); side-effect CSS always lives in `@jects/widgets/style.css`:

- `@jects/widgets/fields` — `TextField`, `NumberField`, `TextArea`, `DisplayField`, `Label`, `Link`.
- `@jects/widgets/datetime` — `DatePicker`, `TimePicker`, `DateTimeField`, `MiniCalendar`, plus date/time utilities.
- `@jects/widgets/pickers` — `ColorPicker` (+ `parseHex`), `FilePicker` (+ `formatBytes`).
- `@jects/widgets/forms` — `Form` and `TagsField`.
- `@jects/widgets/layout` — `Layout`, `Splitter`, `Panel`, `Container`.
- `@jects/widgets/nav` — `Toolbar`, `Menu`, `ContextMenu`, `Sidebar`, `Ribbon`.
- `@jects/widgets/overlays` — `Tooltip`, `Popup`, `Mask`.
- `@jects/widgets/rich-text` — `RichText` (+ `sanitizeHtml`).
- `@jects/widgets/data-views` — `Tree`, `List`, `DataView`.

## Common recipes

### Validated form with conditional fields and dirty tracking

```ts
import { Form } from '@jects/widgets';

const form = new Form('#host', {
  ariaLabel: 'Contact form',
  layout: { cols: 2 },
  validateOn: 'blur',
  fields: [
    { name: 'email', control: 'email', label: 'Email', rules: { required: true, email: true } },
    { name: 'password', control: 'password', label: 'Password', rules: { required: true, minLength: 8 } },
    { name: 'byPhone', control: 'switch', label: 'Prefer phone contact' },
    // Phone only shows (and only validates) when the switch is on.
    { name: 'phone', control: 'text', label: 'Phone',
      showWhen: (v) => !!v.byPhone, rules: { required: true } },
  ],
  submitText: 'Send', resetText: 'Clear',
  onSubmit: (values) => console.log('submit', values),
});

form.on('dirty', ({ dirty }) => console.log(dirty ? 'changed' : 'pristine'));
```

### Promise-based modal dialog

```ts
import { Dialog } from '@jects/widgets';

const dialog = new Dialog(document.body, {
  title: 'Delete file?',
  text: 'This action cannot be undone.',
  tone: 'destructive',
  actions: [
    { key: 'cancel', text: 'Cancel', variant: 'outline' },
    { key: 'delete', text: 'Delete', variant: 'destructive', autoFocus: true },
  ],
});

const choice = await dialog.open(); // 'cancel' | 'delete' | null
if (choice === 'delete') { /* … */ }
```

### Draggable, resizable window

```ts
import { Window } from '@jects/widgets';

const win = new Window(document.body, {
  title: 'Welcome',
  modal: true,
  width: 380,
  text: 'A draggable, resizable floating panel. Press Escape to close.',
});

win.on('beforeClose', () => confirm('Close this window?')); // vetoable
```

### Rich text editor with Markdown export

```ts
import { RichText } from '@jects/widgets';

const rt = new RichText('#editor', {
  toolbar: ['bold', 'italic', 'underline', 'separator', 'h1', 'h2', 'ul', 'ol', 'link'],
  pasteClean: true,
  value: '<h2>Quarterly report</h2><p>Edit this <strong>rich</strong> content.</p>',
});

rt.on('change', ({ html }) => save(html));
const markdown = rt.getMarkdown();
```

## Events

Every component exposes a typed event surface via the inherited `.on(event, handler)` / `.off()` (each component ships its own `*Events` type, e.g. `FormEvents`, `WindowEvents`, `RichTextEvents`). Key examples:

- **`Form`:** `change`, `dirty`, `beforeSubmit` (vetoable), `submit`, `invalid`.
- **`Window` / `Dialog`:** `beforeClose` (vetoable), `close`, `beforeMove`/`move`, `beforeResize`/`resize`, `maximize`/`restore`/`minimize`, `focus`, and (Dialog) `action`.
- **`RichText`:** `beforeChange` (vetoable), `change`, `input`, `focus`, `blur`.

All widgets also inherit the base `@jects/core` events `destroy`, `render`, `show`, and `hide`. Vetoable `before*` events cancel the action when a handler returns `false`.

## Theming

All visual styling is driven by `--jects-*` CSS custom properties from `@jects/theme` — override any token on `:root` or a scoped element to re-skin, and toggle the bundled variants with `.jects-dark` / `.jects-hc` (or `[data-jects-theme]`). See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

Components are built for keyboard and screen-reader use: ARIA roles and labels, `aria-invalid`/`aria-describedby`-wired error slots on fields, roving focus in menus and tabs, and modal focus trapping with `inert` backgrounds for `Window`, `Dialog`, and `Mask`.

## Stability & support

**Stable.** Backed by an extensive test suite (100+ unit and browser test files, including `axe-core` accessibility checks). Part of the Jects UI suite. Commercial terms: see LICENSE.md.
