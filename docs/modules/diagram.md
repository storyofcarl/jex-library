# @jects/diagram
> A no-code diagram editor with 30+ shapes, smart connectors, auto-layout, swimlanes, groups, a properties panel, undo/redo and JSON / SVG / PNG / PDF export.

## Overview
`@jects/diagram` is a framework-free diagramming component: a `Diagram` Widget rendered into the light DOM on top of a headless `DiagramEngine` (a `@jects/core` `Store`-backed model graph plus routing, auto-layout, hit-test and serialization). It targets the feature bar of draw.io / yFiles / Bryntum Diagram — built-in flowchart/UML/org shapes, custom/HTML/image shapes, routed connectors, tidy-tree & radial auto-layout, swimlanes and grouping. It is driven entirely by an imperative API (`DiagramApi`) and themed through `--jects-*` CSS variables; shape/connector styles carry token names, never raw colors.

## Installation
```sh
pnpm add @jects/diagram @jects/core @jects/theme @jects/widgets
```
`@jects/core`, `@jects/theme` and `@jects/widgets` are peer dependencies. The package is ESM, tree-shakeable, and framework-free (`"type": "module"`, `sideEffects` limited to CSS). A UMD build (`diagram.umd.cjs`) is also published for `require`.

## Integration

### CSS
Import the theme base once, then the component's side-effect stylesheet:
```ts
import '@jects/theme/base.css';     // --jects-* token base (required)
import '@jects/diagram/style.css';
```

### Vanilla TS
```ts
import { Diagram } from '@jects/diagram';

const diagram = new Diagram(host, {   // host: HTMLElement | string (selector)
  mode: 'flowchart',
  editable: true,
});
```

### Frameworks (React / Angular / Vue)
Wrap with a thin adapter: construct on mount, `.destroy()` on unmount. The instance is the API.

```tsx
import { useEffect, useRef } from 'react';
import { Diagram } from '@jects/diagram';
import '@jects/diagram/style.css';

export function DiagramView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Diagram>();

  useEffect(() => {
    const diagram = new Diagram(hostRef.current!, {
      mode: 'flowchart',
      editable: true,
      shapes: [{ id: 'a', type: 'start', x: 40, y: 40, w: 140, h: 56, text: 'Start' }],
    });
    apiRef.current = diagram;
    return () => diagram.destroy();
  }, []);

  return <div ref={hostRef} style={{ height: 480 }} />;
}
```
Angular/Vue follow the same pattern (mount in `ngAfterViewInit` / `onMounted`, `destroy()` in the teardown hook).

### Theming
Shapes, connectors, swimlanes and chrome resolve `--jects-*` tokens. `DiagramStyle.fill`/`stroke`/`textColor` take token names (e.g. `'card'`, `'primary'`, `'accent-foreground'`) which renderers map onto `oklch(var(--jects-*))`. Retheme by overriding tokens on an ancestor.

## Features

- **Built-in shapes (30+)** — flowchart (`process`, `decision`, `terminator`, `start`, `end`, `delay`, `preparation`, `predefined-process`, `manual-input`/`manual-operation`), data/IO (`data`, `document`, `multi-document`, `database`, `storage`, `internal-storage`, `display`, `card`), generic primitives (`rect`, `rounded-rect`, `ellipse`, `circle`, `square`, `triangle`, `diamond`, `parallelogram`, `trapezoid`, `pentagon`, `hexagon`, `octagon`, `star`, `cross`, `arrow-shape`, `callout`, `cloud`), and org/mind/PERT nodes (`org-node`, `mind-node`, `pert-node`, `off-page`, `text`).
- **Custom / HTML / image shapes** — register a custom outline via `engine.registerShape({ key, defaultSize, outline })` (`type: 'custom'` + `shapeDef`); embed an HTML body via `data.html` (foreignObject); embed an image via `type: 'image'` + `data.href`.
- **Ports** — named connection anchors per side (`top`/`right`/`bottom`/`left`/`center`/`free`) with normalized offsets and in/out gating; connectors with no port snap to the nearest perimeter point at route time.
- **Connectors & routing** — `straight`, `elbow`, `orthogonal` (obstacle-avoiding routing), and `curved` kinds; per-end arrowheads (`arrow`, `triangle`, `diamond`, `circle`, `open`, `none`); midpoint labels; user-pinned waypoints. Pluggable routers (`StraightRouter`, `ElbowRouter`, `OrthogonalRouter`, `CurvedRouter`) overridable per kind.
- **Auto-layout** — `orthogonal` (layered / Sugiyama-style tidy tree for flow & org charts) and `radial` (mind-map / hub-and-spoke), with `nodeSpacing` / `rankSpacing` / `direction` (`down`/`up`/`right`/`left`) tunables and optional connector re-routing. Pluggable via `engine.registerLayout`.
- **Authoring modes** — `flowchart` / `orgchart` / `mindmap` / `pert`, which bias tooling defaults and layout.
- **Swimlanes** — horizontal/vertical pools/lanes (nestable) that partition the canvas; moved shapes are clamped back inside their lane.
- **Groups** — group selected shapes under a container that drags/selects as a unit; `ungroup` dissolves it.
- **Editing UX** — drag-move, resize, draw connectors from edges, marquee select, grid + snapping, pan/zoom, inline text editing, a shape rail, a built-in toolbar (align / distribute / copy-apply style / export) and a properties panel; full keyboard support (roving-tabindex focus, keyboard connector draw).
- **Alignment** — `align(edge)` and `distribute(axis)` across the selection; snap guides.
- **Collapse / search** — collapse a node's descendant subtree (mindmap/orgchart) and dim non-matching elements via `search(query)`.
- **Undo/redo** — full-document snapshot history (drag gestures coalesce into a single entry).
- **Hit-test & coordinates** — `hitTest(point)` against the model graph and `toModelPoint(clientX, clientY)` for custom interactions.
- **Serialization & export** — `toJSON()` / `fromJSON()` (`DiagramDocument`, versioned & structured-clonable); export to standalone SVG (`exportSvg`), PNG (`exportPng`), PDF (`exportPdf`) and JSON (`exportJson`). Helper exports `documentToJson`, `serializeSvg`, `svgToPngDataUrl`, `pngDataUrlToPdf`, `downloadBlob`.

## Quick start
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
  selectionMode: 'multi',
  shapes: [
    { id: 'start', type: 'start',    x: 180, y: 20,  w: 140, h: 56, text: 'Start',       lane: 'lane-intake' },
    { id: 'input', type: 'data',     x: 180, y: 120, w: 140, h: 60, text: 'Get request', lane: 'lane-intake' },
    { id: 'check', type: 'decision', x: 170, y: 230, w: 160, h: 90, text: 'Valid?',      lane: 'lane-process' },
    { id: 'ok',    type: 'process',  x: 40,  y: 370, w: 150, h: 60, text: 'Process',     lane: 'lane-process' },
    { id: 'err',   type: 'process',  x: 330, y: 370, w: 150, h: 60, text: 'Reject',      lane: 'lane-process' },
    { id: 'end',   type: 'end',      x: 180, y: 470, w: 140, h: 56, text: 'Done',        lane: 'lane-process' },
  ],
  connectors: [
    { id: 'c1', from: { shape: 'start' }, to: { shape: 'input' }, kind: 'orthogonal', arrows: { end: 'arrow' } },
    { id: 'c2', from: { shape: 'input' }, to: { shape: 'check' }, kind: 'orthogonal' },
    { id: 'c3', from: { shape: 'check' }, to: { shape: 'ok' },    kind: 'orthogonal', label: 'Yes' },
    { id: 'c4', from: { shape: 'check' }, to: { shape: 'err' },   kind: 'orthogonal', label: 'No' },
    { id: 'c5', from: { shape: 'ok' },    to: { shape: 'end' },   kind: 'orthogonal' },
  ],
  swimlanes: [
    { id: 'lane-intake',  title: 'Intake',     orientation: 'horizontal', x: 0, y: 0,   w: 520, h: 200, order: 0 },
    { id: 'lane-process', title: 'Processing', orientation: 'horizontal', x: 0, y: 200, w: 520, h: 360, order: 1 },
  ],
});

diagram.on('select', (ev) => console.log('selected', ev.ids));
```

## Configuration
Extends `WidgetConfig`. Main fields:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `'flowchart' \| 'orgchart' \| 'mindmap' \| 'pert'` | `'flowchart'` | Authoring mode; biases tooling and auto-layout. |
| `shapes` | `ShapeModel[]` | `[]` | Initial shapes (nodes). |
| `connectors` | `ConnectorModel[]` | `[]` | Initial connectors (edges). |
| `swimlanes` | `SwimlaneModel[]` | `[]` | Initial swimlanes / pools. |
| `editable` | `boolean` | `true` | Editable canvas vs. read-only viewer. |
| `zoom` | `number` | `1` | Initial zoom (1 = 100%). |
| `grid` | `boolean` | `true` | Show the background grid. |
| `snap` | `number` | — | Snap moved/resized shapes to this grid step (model units). |
| `selectionMode` | `'none' \| 'single' \| 'multi'` | `'multi'` | Selection granularity. |
| `defaultConnectorKind` | `'straight' \| 'elbow' \| 'orthogonal' \| 'curved'` | `'orthogonal'` | Routing kind for newly drawn connectors. |

(Defaults marked with the documented config comment values; `snap` has no default — omit it to disable snapping.) A `ShapeModel` requires `id`, `type`, `x`, `y`, `w`, `h` and may carry `text`, `style`, `ports`, `rotation`, `parent`, `lane`, `z`, `locked`, `data`, `shapeDef`. A `ConnectorModel` requires `id`, `from`, `to`, `kind` and may carry `arrows`, `label`, `style`, `points`, `pinned`, `z`, `data`.

## Methods
Selected public methods (the `Diagram` instance implements `DiagramApi`):

| Method | Description |
| --- | --- |
| `addShape(shape: ShapeModel): ShapeModel` | Add a node. |
| `addConnector(connector: ConnectorModel): ConnectorModel` | Add an edge. |
| `updateShape(id, changes)` / `updateConnector(id, changes)` | Patch a shape / connector. |
| `remove(ids: DiagramId \| DiagramId[])` | Remove shapes/connectors. |
| `addSwimlane(lane)` / `updateSwimlane(id, changes)` / `removeSwimlane(id)` | Manage swimlanes. |
| `group(ids): DiagramId \| undefined` / `ungroup(id): DiagramId[]` | Group / dissolve a group container. |
| `autoLayout(kind, options?)` | Run `'orthogonal'` or `'radial'` auto-layout (`{ nodeSpacing, rankSpacing, direction }`). |
| `route(connector: DiagramId): RouteResult` | Recompute a connector's path. |
| `align(edge)` / `distribute(axis)` | Align / distribute the selection. |
| `copyStyle()` / `applyStyle()` | Copy the selected shape's style; apply it to the selection. |
| `search(query): DiagramId[]` | Dim non-matching elements (empty clears). |
| `toggleCollapse(id): boolean` / `isCollapsed(id): boolean` | Collapse/expand a subtree. |
| `select(ids)` / `getSelection(): DiagramId[]` / `clearSelection()` | Selection control. |
| `setZoom(zoom)` / `getZoom(): number` / `fitToView()` | Zoom & fit. |
| `toModelPoint(clientX, clientY): Point` / `hitTest(point): HitResult` | Coordinate / hit-test helpers. |
| `setMode(mode)` / `getMode(): DiagramMode` | Switch / read authoring mode. |
| `undo()` / `redo()` / `canUndo()` / `canRedo()` | History. |
| `toJSON(): DiagramDocument` / `fromJSON(doc)` | Serialize / load the document. |
| `exportSvg(): string` | Standalone SVG string. |
| `exportPng(filename?): Promise<string \| null>` | PNG data-URL (optionally triggers download). |
| `exportPdf(filename?): Promise<Blob \| null>` | PDF Blob. |
| `exportJson(filename?): string` | JSON string. |
| `engine: DiagramEngine` | The headless engine (`registerShape`/`registerRouter`/`registerLayout`, `Store`s, `events`). |
| `destroy()` | Tear down the widget. |

## Events
Subscribe with `diagram.on(event, handler)` (returns an unsubscribe function). `before*` events are vetoable — return `false` to cancel.

| Event | Payload | Fires when |
| --- | --- | --- |
| `beforeSelect` | `{ ids: DiagramId[] }` | Before a selection change (vetoable). |
| `select` | `{ ids: DiagramId[] }` | The selection changed. |
| `beforeChange` | `{ reason: string }` | Before a shape/connector creation (vetoable). |
| `change` | `{ document: DiagramDocument }` | The model changed (UI re-render / persist hook). |
| `shapeClick` | `{ shape: ShapeModel; event: MouseEvent }` | A shape is clicked. |
| `connectorClick` | `{ connector: ConnectorModel; event: MouseEvent }` | A connector is clicked. |
| `shapeTransform` | `{ shape: ShapeModel }` | A shape is moved/resized by the user. |
| `zoom` | `{ zoom: number }` | The zoom level changed. |

Engine-level collection events (`shapeAdd`/`shapeRemove`/`shapeChange`, `connectorAdd`/…, `connectorRoute`, `laneChange`, `layout`, `load`, `change`) are available on `diagram.engine.events`.

## Examples

**Nodes + connectors + auto-layout**
```ts
const diagram = new Diagram(host, { mode: 'orgchart', editable: true });

diagram.addShape({ id: 'ceo', type: 'org-node', x: 0, y: 0,   w: 140, h: 56, text: 'CEO' });
diagram.addShape({ id: 'cto', type: 'org-node', x: 0, y: 120, w: 140, h: 56, text: 'CTO' });
diagram.addShape({ id: 'cfo', type: 'org-node', x: 0, y: 120, w: 140, h: 56, text: 'CFO' });

diagram.addConnector({ id: 'e1', from: { shape: 'ceo' }, to: { shape: 'cto' }, kind: 'orthogonal' });
diagram.addConnector({ id: 'e2', from: { shape: 'ceo' }, to: { shape: 'cfo' }, kind: 'orthogonal' });

// Tidy-tree layout, then fit the content to the viewport.
diagram.autoLayout('orthogonal', { nodeSpacing: 40, rankSpacing: 80, direction: 'down' });
diagram.fitToView();
```

**Custom shape + HTML / image nodes**
```ts
// Register a custom outline (normalized 0..w / 0..h path).
diagram.engine.registerShape({
  key: 'badge',
  defaultSize: { width: 120, height: 80 },
  defaultStyle: { fill: 'primary', stroke: 'border', strokeWidth: 2 },
  outline: ({ width: w, height: h }) =>
    `M ${w * 0.5} 0 L ${w} ${h * 0.3} L ${w} ${h * 0.75} L ${w * 0.5} ${h} L 0 ${h * 0.75} L 0 ${h * 0.3} Z`,
});
diagram.addShape({ id: 'badge1', type: 'custom', shapeDef: 'badge', x: 560, y: 270, w: 120, h: 80, text: 'Custom' });

// HTML body (foreignObject) via data.html.
diagram.addShape({ id: 'note', type: 'rect', x: 540, y: 30, w: 220, h: 96,
  data: { html: "<div style='padding:8px'><b>SLA note</b><br/>Editable HTML body.</div>" } });

// Image node via type:'image' + data.href.
diagram.addShape({ id: 'logo', type: 'image', x: 580, y: 150, w: 120, h: 80, data: { href: '/logo.svg' } });
```

**Export to JSON (and PNG / PDF)**
```ts
import { documentToJson, downloadBlob } from '@jects/diagram';

// Versioned, structured-clonable document.
const json = documentToJson(diagram.toJSON());
downloadBlob(json, 'diagram.json', 'application/json');

// Raster / vector exports (async — they rasterize the live SVG).
const pngUrl = await diagram.exportPng('diagram.png');
const pdfBlob = await diagram.exportPdf('diagram.pdf');

// Reload later.
diagram.fromJSON(JSON.parse(json));
```

## Theming
All visuals resolve `--jects-*` tokens from `@jects/theme/base.css` — `DiagramStyle.fill`/`stroke`/`textColor` carry token names, not colors, and renderers map them to `oklch(var(--jects-*))`. Useful tokens:

- Surfaces / lines: `--jects-card`, `--jects-background`, `--jects-border`, `--jects-muted`.
- Emphasis: `--jects-primary`, `--jects-accent`, `--jects-accent-foreground`, `--jects-foreground`.

Example shape style: `{ fill: 'accent', stroke: 'primary', strokeWidth: 3, textColor: 'accent-foreground', fontSize: 14 }`. Switch themes by adding a theme stylesheet (e.g. `@jects/theme/dark.css`) or redefining tokens on a scoping element; the widget renders into the light DOM so app-level tokens cascade in.
