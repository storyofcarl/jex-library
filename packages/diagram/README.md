# @jects/diagram — a framework-free, no-code diagram editor

## What it is

`@jects/diagram` is a diagramming component for the Jects UI suite: a `Diagram` widget rendered into the light DOM on top of a headless `DiagramEngine` (a `@jects/core` store-backed model graph plus routing, auto-layout, hit-testing and serialization). It ships 30+ built-in flowchart/UML/org shapes, custom/HTML/image shapes, A\*-routed connectors, tidy-tree and radial auto-layout, swimlanes, groups, undo/redo and JSON/SVG/PNG/PDF export. The whole component is driven by one imperative API (`DiagramApi`) and themed entirely through `--jects-*` CSS variables.

## Install

```sh
pnpm add @jects/diagram @jects/core @jects/theme @jects/widgets
```

`@jects/core`, `@jects/theme` and `@jects/widgets` are peer dependencies. The package is ESM and tree-shakeable (`"type": "module"`, side effects limited to CSS); a UMD build (`diagram.umd.cjs`) is also published for `require`.

## CSS

```ts
import '@jects/theme/base.css';   // --jects-* token base (required)
import '@jects/diagram/style.css'; // component styles
```

## Minimal example

```ts
import { Diagram } from '@jects/diagram';
import '@jects/theme/base.css';
import '@jects/diagram/style.css';

const host = document.getElementById('diagram')!;

const diagram = new Diagram(host, {
  mode: 'flowchart',
  editable: true,
  grid: true,
  snap: 8,
  shapes: [
    { id: 'start', type: 'start',    x: 180, y: 20,  w: 140, h: 56, text: 'Start' },
    { id: 'check', type: 'decision', x: 170, y: 140, w: 160, h: 90, text: 'Valid?' },
    { id: 'end',   type: 'end',      x: 180, y: 280, w: 140, h: 56, text: 'Done' },
  ],
  connectors: [
    { id: 'c1', from: { shape: 'start' }, to: { shape: 'check' }, kind: 'orthogonal', arrows: { end: 'arrow' } },
    { id: 'c2', from: { shape: 'check' }, to: { shape: 'end' },   kind: 'orthogonal', label: 'Yes' },
  ],
});

diagram.on('select', (ev) => console.log('selected', ev.ids));

// later…
diagram.destroy();
```

## Subpath exports

- `@jects/diagram/style.css` — the component's side-effect stylesheet (import once).

The public API is a single `.` entry point; all classes, factories and helpers below are imported from `@jects/diagram`. No additional code subpaths are exported.

## Common recipes

**Auto-layout, then fit to view**

```ts
const diagram = new Diagram(host, { mode: 'orgchart', editable: true });

diagram.addShape({ id: 'ceo', type: 'org-node', x: 0, y: 0,   w: 140, h: 56, text: 'CEO' });
diagram.addShape({ id: 'cto', type: 'org-node', x: 0, y: 120, w: 140, h: 56, text: 'CTO' });
diagram.addShape({ id: 'cfo', type: 'org-node', x: 0, y: 120, w: 140, h: 56, text: 'CFO' });
diagram.addConnector({ id: 'e1', from: { shape: 'ceo' }, to: { shape: 'cto' }, kind: 'orthogonal' });
diagram.addConnector({ id: 'e2', from: { shape: 'ceo' }, to: { shape: 'cfo' }, kind: 'orthogonal' });

diagram.autoLayout('orthogonal', { nodeSpacing: 40, rankSpacing: 80, direction: 'down' });
diagram.fitToView();
```

**Custom, HTML and image nodes**

```ts
// Register a custom outline (normalized 0..w / 0..h path), then reference it.
diagram.engine.registerShape({
  key: 'badge',
  defaultSize: { width: 120, height: 80 },
  outline: ({ width: w, height: h }) =>
    `M ${w * 0.5} 0 L ${w} ${h * 0.3} L ${w} ${h * 0.75} L ${w * 0.5} ${h} L 0 ${h * 0.75} L 0 ${h * 0.3} Z`,
});
diagram.addShape({ id: 'badge1', type: 'custom', shapeDef: 'badge', x: 560, y: 270, w: 120, h: 80, text: 'Custom' });

// HTML body (foreignObject) via data.html.
diagram.addShape({ id: 'note', type: 'rect', x: 540, y: 30, w: 220, h: 96,
  data: { html: "<div style='padding:8px'><b>SLA note</b></div>" } });

// Image node via type:'image' + data.href.
diagram.addShape({ id: 'logo', type: 'image', x: 580, y: 150, w: 120, h: 80, data: { href: '/logo.svg' } });
```

**Serialize and export**

```ts
import { documentToJson, downloadBlob } from '@jects/diagram';

// Versioned, structured-clonable document.
const json = documentToJson(diagram.toJSON());
downloadBlob(json, 'diagram.json', 'application/json');

// Raster / vector exports (async — they rasterize the live SVG).
const pngUrl = await diagram.exportPng('diagram.png');
const pdfBlob = await diagram.exportPdf('diagram.pdf');

diagram.fromJSON(JSON.parse(json)); // reload later
```

**Selection, grouping, undo/redo**

```ts
diagram.select(['ceo', 'cto']);
const groupId = diagram.group(diagram.getSelection());
diagram.align('left');
diagram.undo();
diagram.redo();
```

## Events

Subscribe with `diagram.on(event, handler)`; the call returns an unsubscribe function. `before*` events are vetoable — return `false` to cancel. Key events:

- `beforeSelect` / `select` — `{ ids: DiagramId[] }`, before (vetoable) and after a selection change.
- `beforeChange` / `change` — model mutation; `before` is vetoable, `change` carries `{ document: DiagramDocument }`.
- `shapeClick` / `connectorClick` — `{ shape | connector, event: MouseEvent }`.
- `shapeTransform` — `{ shape: ShapeModel }` after a user move/resize.
- `zoom` — `{ zoom: number }`.

Lower-level collection events (`shapeAdd`/`shapeRemove`/`shapeChange`, `connectorAdd`/`connectorRoute`, `laneChange`, `layout`, `load`, `change`) are available on `diagram.engine.events`.

## Theming

All visuals resolve `--jects-*` CSS custom properties from `@jects/theme/base.css`; `DiagramStyle.fill`/`stroke`/`textColor` carry token names (e.g. `'card'`, `'primary'`, `'accent-foreground'`), never raw colors, which renderers map onto `oklch(var(--jects-*))`. Retheme by including a theme stylesheet or overriding tokens on an ancestor element. See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

The editable canvas supports keyboard interaction — roving-tabindex focus across shapes and keyboard-driven connector drawing — alongside pointer editing.

## Stability & support

Beta — the engine, routing, layout, serialization and export paths are covered by unit and browser (axe-core) tests, and the public API is settling toward v1; expect minor surface changes before then.

Part of the Jects UI suite. Live demo: <https://jexlibrary.vercel.app>. Source: <https://github.com/storyofcarl/jex-library>. Commercial terms: see LICENSE.md.
