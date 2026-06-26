# @jects/widgets
> The Jects UI Suite — a framework-free, light-DOM widget kit: fields, choice controls, date/time, pickers, display, feedback, forms, layout, navigation, overlays, windows, rich text, tabs and data views.

## Overview
`@jects/widgets` is the Suite-class component library of Jects UI (in the spirit of the DHTMLX Suite or a general component kit), built on the `@jects/core` `Widget` base class. Every component is a plain TypeScript class that renders into the light DOM (no Shadow DOM, no virtual DOM, no framework), exposes an imperative API (`new Component(host, config)` + methods + events), and is themed entirely through `--jects-*` CSS variables. Components ship with full ARIA wiring (labels, `aria-invalid`/`aria-describedby`, focus traps, inert backgrounds) and self-register with the `@jects/core` widget factory on import so they can be composed by `type` (this is how `Form` builds its controls).

## Installation

```bash
pnpm add @jects/widgets @jects/core @jects/theme @jects/icons
```

The three peer dependencies are required:

| Peer | Why |
| --- | --- |
| `@jects/core` | `Widget` base class, event bus, and the `create()`/`register()` factory. |
| `@jects/theme` | The `--jects-*` token CSS (light/dark/high-contrast/branded). |
| `@jects/icons` | Icon glyphs used by `Button`, `Toolbar`, `Menu`, etc. |

The package is ESM, `type: module`, side-effect-free except for CSS (`sideEffects: ["**/*.css"]`), so it tree-shakes — import only the components you use.

## Integration

### CSS (required)
Import the base theme tokens once, then the widgets stylesheet:

```ts
import '@jects/theme/style.css';   // --jects-* tokens (base / light)
import '@jects/widgets/style.css'; // widget component styles
// optional: import '@jects/theme/dark.css';
```

Scope the tokens by adding the `jects-scope` class (or `data-jects-scope`) to a wrapping element (commonly `<body>` or `<html>`):

```html
<body class="jects-scope"> ... </body>
```

### Vanilla TypeScript

```ts
import { TextField, Button } from '@jects/widgets';

const name = new TextField('#name-host', { label: 'Name', clearable: true });
name.on('change', ({ value }) => console.log(value));

const save = new Button('#save-host', { text: 'Save', variant: 'primary' });
save.on('click', () => console.log(name.getConfig().value));
```

Every constructor takes `(host: HTMLElement | string, config?)`. The `host` is either an element or a CSS selector. Each component inherits the `@jects/core` `Widget` surface: `.on()/.off()/.emit()`, `.update(patch)`, `.getConfig()`, `.show()/.hide()`, `.destroy()`, `.el`, `.id`, `.isDestroyed`.

### Frameworks (React / Angular / Vue)
Use a thin wrapper: mount the widget in an effect, drive it via `.update()`, and tear it down with `.destroy()`.

```tsx
import { useEffect, useRef } from 'react';
import { Form, type FormConfig } from '@jects/widgets';

export function JectsForm(props: { config: FormConfig; onSubmit?: (v: Record<string, unknown>) => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = new Form(host.current!, props.config);
    const off = form.on('submit', ({ values }) => props.onSubmit?.(values));
    return () => { off(); form.destroy(); };
  }, []);
  return <div ref={host} />;
}
```

The same pattern (mount in `ngAfterViewInit` / `onMounted`, `.destroy()` in `ngOnDestroy` / `onUnmounted`) applies to Angular and Vue.

### Theming
All visual styling is driven by `--jects-*` CSS custom properties from `@jects/theme`. Override any token on `:root` or a scoped element to re-skin; switch the bundled themes with the `.jects-dark` / `.jects-hc` classes or `[data-jects-theme]`. See [Theming](#theming).

### Factory registration
Importing a component runs a side-effect `register('<type>', Class)` against the `@jects/core` factory, so components can also be created by string `type` via `create({ type, ...config }, host)`. `Form` relies on this to instantiate its child controls (`textfield`, `select`, `datepicker`, …) without importing each one.

## Features

Exported components, grouped by family (names below are the actual exports from `@jects/widgets`):

- **Fields:** `TextField`, `NumberField`, `TextArea`, `DisplayField`, `Label`, `Link`
- **Choice:** `Select`, `ComboBox`, `Checkbox`, `CheckboxGroup`, `Radio`, `RadioGroup`, `Switch`
- **Display:** `Slider`, `RangeSlider`, `Rating`, `ProgressBar`, `Badge`, `Avatar`, `Spacer`
- **DateTime:** `DatePicker`, `TimePicker`, `DateTimeField`, `MiniCalendar` (plus date utilities: `MONTH_NAMES`, `WEEKDAY_NAMES`, `WEEKDAY_ABBR`, `startOfDay`, `isSameDay`, `isSameMonth`, `addDays`, `addMonths`, `daysInMonth`, `clampDate`, `isDisabledDay`, `buildMonthMatrix`, `weekdayHeaders`, `parseISODate`, `formatISODate`, `pad2`, `formatTime24`, `formatTime12`, `parseTime`, `snapMinutes`)
- **Pickers:** `ColorPicker` (+ `parseHex`), `FilePicker` (+ `formatBytes`)
- **Feedback:** `MessageManager` plus the imperative helpers `alert`, `confirm`, `prompt`
- **Forms:** `Form`, `TagsField`
- **Layout:** `Layout` (border regions), `Splitter`, `Panel`, `Container`
- **Navigation:** `Toolbar`, `Menu`, `ContextMenu`, `Sidebar`, `Ribbon`
- **Tabs:** `Tabbar`, `TabPanel`, `Pagination`
- **Overlays:** `Tooltip`, `Popup`, `Mask`
- **Windows:** `Window`, `Dialog`
- **Rich text:** `RichText` (+ `sanitizeHtml`)
- **Data views:** `Tree`, `List`, `DataView`
- **Reference component:** `Button`

Cross-cutting capabilities: full keyboard + ARIA support, vetoable lifecycle events (`beforeSubmit`, `beforeClose`, `beforeResize`, `beforeMove`, `beforeChange`), modal focus trapping with background `inert`, and CSS-variable theming throughout.

## Quick start

A small validated form plus a modal window:

```ts
import '@jects/theme/style.css';
import '@jects/widgets/style.css';
import { Form, Window } from '@jects/widgets';

// A two-field form with validation.
const form = new Form('#form-host', {
  ariaLabel: 'Sign in',
  fields: [
    { name: 'email', control: 'email', label: 'Email', rules: { required: true, email: true } },
    { name: 'password', control: 'password', label: 'Password', rules: { required: true, minLength: 8 } },
  ],
  submitText: 'Sign in',
  onSubmit: (values) => console.log('submit', values),
});

// Open a modal window.
new Window(document.body, {
  title: 'Welcome',
  modal: true,
  width: 380,
  text: 'A draggable, resizable floating panel. Press Escape to close.',
});
```

## Configuration

### `FormConfig`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `fields` | `FieldSchema[]` | `[]` | The field schema — each entry becomes a control. |
| `layout` | `FormLayout` | `{ cols: 1 }` | Grid columns + optional `fieldsets` groups. |
| `ariaLabel` | `string` | — | Accessible name for the `<form>`. |
| `submitText` | `string \| null` | `'Submit'` | Submit button label; `null` omits the button. |
| `resetText` | `string \| null` | — | Reset button label; omitted when unset. |
| `validateOn` | `'change' \| 'blur' \| 'submit'` | `'change'` | When per-field validation runs (supersedes `validateOnChange`). |
| `validateOnChange` | `boolean` | `true` | Legacy switch; `false` ≡ `validateOn: 'submit'`. |
| `validate` | `(values) => Record<string,string> \| string \| null` | — | Form-level cross-field validator run after per-field rules pass. |
| `onSubmit` | `(values) => void` | — | Convenience submit handler (also via `.on('submit')`). |

`FieldSchema` (per field): `name` (key in the value bag), `control` (`FieldControl`), `label`, `value`, `rules` (`FieldRules`), `colSpan`, `group` (fieldset legend), `props` (passed straight through to the underlying control), `showWhen` (conditional visibility — a `(values) => boolean` predicate or `{ field, eq }`), `hidden`, `disabled`, `readonly`, `disabledWhen`.

`FieldControl` values: `text`, `password`, `email`, `url`, `number`, `textarea`, `tags`, `select`, `combobox`, `checkbox`, `checkboxgroup`, `radio`, `switch`, `date`, `time`, `datetime`, `color`, `file`, `slider`, `rangeslider`, `rating`.

`FieldRules`: `required`, `email`, `numeric`, `min`, `max`, `minLength`, `maxLength`, `pattern` (each accepts a value or `{ value, message }`), plus `custom(value, values)` (sync) and `asyncValidate(value, values)` (async). A hidden field never validates and can never block submit.

### `WindowConfig`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `string` | — | Header title (also the accessible name). |
| `text` / `html` | `string` | — | Plain-text or trusted-HTML body. |
| `x` / `y` | `number` | `40` / `40` | Initial position (px). |
| `width` / `height` | `number` | `420` / `300` | Initial size (px). |
| `minWidth` / `minHeight` | `number` | `200` / `120` | Resize lower clamp. |
| `maxWidth` / `maxHeight` | `number` | — | Optional resize upper clamp. |
| `draggable` | `boolean` | `true` | Drag by the header. |
| `resizable` | `boolean` | `true` | Eight edge/corner resize handles. |
| `closable` | `boolean` | `true` | Close button + Escape-to-close. |
| `maximizable` | `boolean` | `true` | Show maximize/restore control. |
| `minimizable` | `boolean` | `false` | Show minimize control. |
| `modal` | `boolean` | `false` | Render a `Mask` backdrop, trap focus, inert the background, close on Escape. |
| `maximized` | `boolean` | `false` | Start maximized. |
| `label` | `string` | — | Explicit accessible name (overrides `title`). |

`DialogConfig` extends `WindowConfig` (minus `minimizable`) and adds `actions: DialogAction[]` (footer buttons: `{ key, text, variant?, autoFocus?, closeOnAction? }`) and `tone: 'default' | 'destructive'`. Dialog presets are `modal: true`, `resizable: false`, `maximizable: false`.

### `RichTextConfig` (highlights)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string` | — | Initial HTML content. |
| `placeholder` | `string` | — | Shown when empty. |
| `readOnly` / `disabled` | `boolean` | `false` | Non-editable states. |
| `toolbar` | `RichTextToolbarItem[]` | full set | Toolbar layout; `'separator'` between groups; `[]` hides the toolbar. |
| `minHeight` | `string` | `'8rem'` | Minimum editor height. |
| `pasteClean` | `boolean` | `true` | Sanitize pasted HTML to the allow-list. |
| `sourceView` | `boolean` | `false` | Start in raw-HTML source view. |
| `fontFamilies` / `fontSizes` | `string[]` | built-ins | Options for the font selects. |

`RichTextCommand` toolbar items include `bold`, `italic`, `underline`, `strike`, `h1`–`h3`, `paragraph`, `ul`, `ol`, `blockquote`, `code`, `link`, `unlink`, `alignLeft/Center/Right`, `indent`, `outdent`, `fontFamily`, `fontSize`, `foreColor`, `backColor`, `insertImage`, `insertTable`, `tableAddRow/Column`, `tableDeleteRow/Column`, `sourceView`, `undo`, `redo`, `clear`.

### Field control config (example: `TextFieldConfig`)
The text-like controls share a common shape: `value`, `placeholder`, `label`, `ariaLabel`, `inputType` (`text|email|password|tel|url|search`), `disabled`, `readOnly`, `required`, `clearable`, `prefix`, `suffix`, `size` (`sm|md|lg`), `invalid`, `error` (message below the control, implies invalid), `name`. `NumberField` and `TextArea` add their own keys but follow the same pattern; all three render their own `aria-describedby`-wired error slot, which is why `Form` pushes validation messages directly into them.

## Methods

### `Form`

| Method | Description |
| --- | --- |
| `getValue()` / `getFieldValue(name)` | Read the whole value bag / one field. |
| `setValue(values)` / `setFieldValue(name, value)` | Patch many / one field value. |
| `validate(): Promise<ValidationResult>` | Validate the whole form (async-aware); renders errors, emits `invalid`. |
| `validateField(name): Promise<string>` | Validate one field; returns its message (`''` = valid). |
| `submit(): Promise<boolean>` | Validate, fire `beforeSubmit` (vetoable) then `submit`; resolves to success. |
| `reset()` | Reset every field to its schema value, clear errors + dirt. |
| `isDirty()` / `isFieldDirty(name)` | Whether any / one field differs from the pristine snapshot. |
| `getDirtyValues()` / `getTouched()` | Changed values / field names that fired a change. |
| `getErrors()` | Currently-displayed errors (field → message; form-level under `''`). |
| `getField(name)` | The underlying control widget for a field. |

### `Window` (inherited by `Dialog`)

| Method | Description |
| --- | --- |
| `moveTo(x, y)` / `resizeTo(w, h)` | Position / size (resize clamped to min/max). |
| `maximize()` / `restore()` / `toggleMaximize()` | Maximize state (saves/restores the prior rect). |
| `minimize()` | Hide the window (fires `minimize`). |
| `close(reason?)` | Vetoable close (`'api' \| 'close-button' \| 'escape' \| 'backdrop'`); destroys. |
| `focus()` / `toFront()` | Focus first focusable + raise / raise in the z-stack. |
| `maximized` (getter) | Current maximized state. |
| `update(patch)` | Merge config + re-render; toggling `modal` installs/removes the backdrop + focus trap. |

`Dialog.open(): Promise<string | null>` resolves with the chosen action `key` (or `null` when dismissed via Escape / backdrop / close).

### `RichText`

| Method | Description |
| --- | --- |
| `getHTML()` / `setHTML(html)` | Read / replace sanitized content (`setHTML` fires `change`). |
| `getMarkdown()` / `setMarkdown(md)` | Serialize to / load from Markdown. |
| `focusEditor()` | Focus the editable region. |
| `clear()` | Clear all content (fires `change`). |

## Events

### `Form`

| Event | Payload | When |
| --- | --- | --- |
| `change` | `{ name, value, values, form }` | Any field value changes. |
| `dirty` | `{ dirty, values, form }` | Fired alongside `change` with the current dirty state. |
| `beforeSubmit` | `{ values, form }` | Vetoable — return `false` to cancel submit. |
| `submit` | `{ values, form }` | After a valid (non-vetoed) submit. |
| `invalid` | `{ errors, values, form }` | Validation failed (on submit or programmatic validate). |

### `Window` / `Dialog`

| Event | Payload | When |
| --- | --- | --- |
| `beforeClose` | `{ window, reason }` | Vetoable — return `false` to keep it open. |
| `close` | `{ window, reason }` | After a (non-vetoed) close. |
| `beforeMove` / `move` | `{ window, x, y }` | Drag-move (vetoable / committed). |
| `beforeResize` / `resize` | `{ window, width, height }` | Resize (vetoable / committed). |
| `maximize` / `restore` / `minimize` | `{ window }` | State changes. |
| `focus` | `{ window }` | Window focused / raised. |
| `action` *(Dialog)* | `{ dialog, key }` | A footer action button was pressed. |

### `RichText`

| Event | Payload | When |
| --- | --- | --- |
| `beforeChange` | `{ editor, html }` | Vetoable — return `false` to cancel a change. |
| `change` | `{ editor, html }` | Content changed (command or typing). |
| `input` | `{ editor, html }` | Every input into the editable region. |
| `focus` / `blur` | `{ editor }` | Editable region focus changes. |

All widgets also inherit the base `@jects/core` events `destroy`, `render`, `show`, `hide`.

## Examples

### 1. Validated form with conditional fields, fieldsets and dirty tracking

```ts
import { Form } from '@jects/widgets';

const form = new Form('#host', {
  ariaLabel: 'Enterprise contact form',
  layout: { cols: 2, fieldsets: [
    { legend: 'Contact', group: 'contact' },
    { legend: 'Preferences', group: 'prefs' },
  ] },
  validateOn: 'blur',
  fields: [
    { name: 'name', control: 'text', label: 'Name', group: 'contact', rules: { required: true } },
    { name: 'email', control: 'email', label: 'Email', group: 'contact', rules: { required: true, email: true } },
    { name: 'password', control: 'password', label: 'Password', group: 'contact', rules: { required: true, minLength: 8 } },
    { name: 'byPhone', control: 'switch', label: 'Prefer phone contact', group: 'prefs' },
    // Conditional: phone only shows (and only validates) when the switch is on.
    { name: 'phone', control: 'text', label: 'Phone', group: 'prefs',
      showWhen: (v) => !!v.byPhone, rules: { required: true, pattern: '^[0-9 +()-]{7,}$' } },
    { name: 'satisfaction', control: 'rating', label: 'Satisfaction', group: 'prefs', props: { max: 5 } },
    { name: 'role', control: 'select', label: 'Role', group: 'prefs', props: { options: [
      { value: 'eng', label: 'Engineer' }, { value: 'pm', label: 'Product' },
    ] } },
  ],
  submitText: 'Send', resetText: 'Clear',
});

form.on('dirty', ({ dirty }) =>
  console.log(dirty ? `Changed: ${Object.keys(form.getDirtyValues()).join(', ')}` : 'Pristine'));
```

### 2. A modal confirmation dialog (promise-based)

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

### 3. A rich text editor with a custom toolbar and Markdown export

```ts
import { RichText } from '@jects/widgets';

const rt = new RichText('#editor', {
  toolbar: [
    'bold', 'italic', 'underline', 'separator',
    'h1', 'h2', 'paragraph', 'separator',
    'ul', 'ol', 'blockquote', 'code', 'separator',
    'link', 'insertImage', 'insertTable', 'separator',
    'sourceView', 'undo', 'redo', 'clear',
  ],
  pasteClean: true,
  value: '<h2>Quarterly report</h2><p>Edit this <strong>rich</strong> content.</p>',
});

rt.on('change', ({ html }) => save(html));
const markdown = rt.getMarkdown();
```

## Theming

Widgets are styled exclusively through `--jects-*` CSS variables defined by `@jects/theme`. The token set is in OKLCH and is consumed as `oklch(var(--jects-*))`.

- **Semantic colors:** `--jects-background`, `--jects-foreground`, `--jects-primary`, `--jects-primary-foreground`, `--jects-muted`, `--jects-muted-foreground`, `--jects-border`, `--jects-input`, `--jects-ring`.
- **Categorical palettes:** `--jects-cmyk-cyan` / `-magenta` / `-yellow` / `-black` (Calm CMYK) and the `--jects-data-1…n` ramp (used by tags/status pills/charts).
- **Radii:** `--jects-radius` plus derived `--jects-radius-sm/md/lg/xl`.
- **Typography:** `--jects-font-family`, `--jects-font-size-md`.
- **Z-index:** `--jects-z-overlay`, `--jects-z-modal` (the `Window`/`Mask` stack seeds its z-counter from `--jects-z-modal`).

Switch the bundled themes by toggling a class or attribute on a scope element:

```html
<body class="jects-scope jects-dark"> … </body>
<!-- or: <body class="jects-scope" data-jects-theme="dark"> -->
```

Available variants: `.jects-dark` / `[data-jects-theme=dark]`, high contrast `.jects-hc` (combinable with dark), and the branded presets shipped as separate stylesheets (`@jects/theme/stockholm.css`, `@jects/theme/material.css`). Override any token under `:root` or your scope element to re-skin — for example `:root { --jects-radius: 12px; --jects-primary: 0.55 0.18 250; }`. The theme CSS is emitted inside an `@layer` cascade (`jects.reset, jects.tokens, jects.base, jects.components, jects.utilities`) so plain consumer overrides win without specificity battles.
