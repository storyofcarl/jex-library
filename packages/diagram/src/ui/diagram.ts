/**
 * Diagram — the keystone Widget for the `@jects/diagram` UI. It owns a
 * {@link DiagramEngine} (a local self-contained one by default, or one injected
 * via config) and renders its model to an SVG canvas wrapped in a no-code editor:
 * a toolbar, a shapebar (drag new shapes onto the canvas), and a properties
 * panel bound to the current selection.
 *
 * It implements the frozen {@link DiagramApi} so wrappers and host apps depend on
 * a stable imperative surface, and talks to the engine ONLY through the
 * `DiagramEngine` interface. Interactions covered: pan/zoom, drag-move + resize,
 * connector draw between ports, inline text edit, multi-select + box-select,
 * alignment + distribution, snap lines, copy/apply style, search/filter,
 * expand/collapse (mindmap), and PDF/PNG/JSON export.
 */
import { Widget, register, createEl } from '@jects/core';
import { Toolbar, type ToolbarItem } from '@jects/widgets';
import type {
  AutoLayoutOptions,
  ConnectorModel,
  DiagramApi,
  DiagramConfig,
  DiagramEngine,
  DiagramEngineOptions,
  DiagramEvents,
  DiagramId,
  DiagramMode,
  DiagramDocument,
  HitResult,
  LayoutKind,
  Point,
  RouteResult,
  ShapeDefinition,
  ShapeModel,
  ShapeType,
  SwimlaneModel,
  Diagram as DiagramContract,
} from '../contract.js';
import './diagram.css';
import { LocalDiagramEngine } from './local-engine.js';
import { clampToLane, laneOf } from '../engine/swimlanes.js';
import {
  buildSvgLayers,
  renderScene,
  type RenderState,
  type SnapLine,
  type ViewTransform,
} from './renderer.js';
import { defaultShapeSize } from './shapes.js';
import {
  clamp,
  normalizeRect,
  rectsIntersect,
  shapeRect,
  snapPoint,
  type ResizeHandle,
} from './geometry.js';
import { alignShapes, distributeShapes, computeSnap, type AlignEdge } from './align.js';
import { PropertiesPanel, type PanelTarget } from './properties-panel.js';
import {
  documentToJson,
  downloadBlob,
  pngDataUrlToPdf,
  serializeSvg,
  svgToPngDataUrl,
} from './export.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

/** The shapebar palette: the quick-access shape kinds for dragging. */
const SHAPEBAR: ReadonlyArray<{ type: ShapeType; label: string }> = [
  { type: 'process', label: 'Process' },
  { type: 'decision', label: 'Decision' },
  { type: 'terminator', label: 'Terminator' },
  { type: 'rounded-rect', label: 'Card' },
  { type: 'ellipse', label: 'Ellipse' },
  { type: 'diamond', label: 'Diamond' },
  { type: 'data', label: 'Data' },
  { type: 'document', label: 'Document' },
  { type: 'database', label: 'Database' },
  { type: 'text', label: 'Text' },
];

type DragKind = 'none' | 'pan' | 'move' | 'resize' | 'marquee' | 'connect';

interface DragState {
  kind: DragKind;
  startClient: Point;
  startModel: Point;
  lastModel: Point;
  /** Per-shape original rects for move/resize. */
  origin: Map<DiagramId, { x: number; y: number; w: number; h: number }>;
  handle?: ResizeHandle;
  resizeId?: DiagramId;
  /** Source for connector drawing. */
  connectFrom?: { shape: DiagramId; port?: DiagramId; point: Point };
}

let uid = 0;
function genId(prefix: string): string {
  uid += 1;
  return `${prefix}_${Date.now().toString(36)}_${uid}`;
}

export class Diagram extends Widget<DiagramConfig, DiagramEvents>
  implements DiagramApi, DiagramContract
{
  private declare _engine: DiagramEngine;
  private declare svg: SVGSVGElement;
  private declare layers: ReturnType<typeof buildSvgLayers>;
  private declare canvasEl: HTMLElement;
  private declare shapebarEl: HTMLElement;
  private declare toolbar: Toolbar | null;
  private declare panel: PropertiesPanel | null;
  private declare _selection: Set<DiagramId>;
  private declare _view: ViewTransform;
  private declare drag: DragState;
  private declare snapLines: SnapLine[];
  private declare marquee: { x: number; y: number; width: number; height: number } | null;
  private declare pendingConnector: { from: Point; to: Point } | null;
  private declare clipboardStyle: ShapeModel['style'] | null;
  private declare searchQuery: string;
  private declare collapsed: Set<DiagramId>;
  private declare engineUnsub: (() => void) | null;
  private declare rafPending: boolean;
  private declare rafId: number;
  /** True only when this widget created the engine and therefore owns its disposal. */
  private declare ownsEngine: boolean;
  private declare editorEl: HTMLTextAreaElement | null;
  /** Roving-tabindex focus cursor: the shape id that holds keyboard focus. */
  private declare focusId: DiagramId | null;
  /** Source shape for a keyboard-initiated connector draw (Enter to start). */
  private declare connectSourceId: DiagramId | null;
  /** Undo/redo history of full-document snapshots (newest at the end). */
  private declare undoStack: DiagramDocument[];
  private declare redoStack: DiagramDocument[];
  /**
   * Set while {@link undo}/{@link redo}/{@link fromJSON} restores a snapshot so
   * the resulting engine `change` storm doesn't itself push a history entry.
   */
  private declare restoring: boolean;

  protected override defaults(): Partial<DiagramConfig> {
    return {
      mode: 'flowchart',
      editable: true,
      zoom: 1,
      grid: true,
      snap: 0,
      selectionMode: 'multi',
      defaultConnectorKind: 'orthogonal',
    };
  }

  protected buildEl(): HTMLElement {
    return createEl('div', { className: 'jects-diagram' });
  }

  protected override render(): void {
    if (this._engine) {
      this.scheduleRender();
      return;
    }
    // ── First render: build engine, chrome, canvas, wire events. ──
    this._selection = new Set();
    this.snapLines = [];
    this.marquee = null;
    this.pendingConnector = null;
    this.clipboardStyle = null;
    this.searchQuery = '';
    this.collapsed = new Set();
    this.rafPending = false;
    this.rafId = 0;
    this.editorEl = null;
    this.focusId = null;
    this.connectSourceId = null;
    this.undoStack = [];
    this.redoStack = [];
    this.restoring = false;
    this.toolbar = null;
    this.panel = null;
    this.engineUnsub = null;
    this.drag = {
      kind: 'none',
      startClient: { x: 0, y: 0 },
      startModel: { x: 0, y: 0 },
      lastModel: { x: 0, y: 0 },
      origin: new Map(),
    };

    const cfg = this.config;
    this._view = { zoom: cfg.zoom ?? 1, panX: 0, panY: 0 };

    // Engine: injected or local. Build options without `undefined` members so
    // `exactOptionalPropertyTypes` is satisfied.
    const injected = (cfg as DiagramConfig & { engine?: DiagramEngine }).engine;
    const factory = (cfg as DiagramConfig & {
      engineFactory?: (o: DiagramEngineOptions) => DiagramEngine;
    }).engineFactory;
    const engineOpts: DiagramEngineOptions = {};
    if (cfg.mode) engineOpts.mode = cfg.mode;
    if (cfg.shapes) engineOpts.shapes = cfg.shapes;
    if (cfg.connectors) engineOpts.connectors = cfg.connectors;
    if (cfg.swimlanes) engineOpts.swimlanes = cfg.swimlanes;
    // Ownership: we only dispose the engine if WE constructed it. An injected
    // engine — or one returned by a host-supplied factory — is owned by the
    // host, even when it happens to be a LocalDiagramEngine instance.
    if (injected) {
      this._engine = injected;
      this.ownsEngine = false;
    } else if (factory) {
      this._engine = factory(engineOpts);
      this.ownsEngine = false;
    } else {
      this._engine = new LocalDiagramEngine(engineOpts);
      this.ownsEngine = true;
    }

    const el = this.el;
    el.classList.toggle('jects-diagram--readonly', !cfg.editable);

    // Toolbar chrome.
    if (cfg.editable) {
      const tbHost = createEl('div', { className: 'jects-diagram__toolbar' });
      el.appendChild(tbHost);
      const { items, actions } = this.toolbarItems();
      this.toolbar = new Toolbar(tbHost, { items });
      this.toolbar.on('action', (p: { id: string }) => actions[p.id]?.());
    }

    // Main row: shapebar | canvas | properties.
    const main = createEl('div', { className: 'jects-diagram__main' });
    el.appendChild(main);

    if (cfg.editable) {
      this.shapebarEl = createEl('div', { className: 'jects-diagram__shapebar' });
      this.shapebarEl.setAttribute('role', 'toolbar');
      this.shapebarEl.setAttribute('aria-label', 'Shapes');
      this.buildShapebar();
      main.appendChild(this.shapebarEl);
    }

    this.canvasEl = createEl('div', { className: 'jects-diagram__canvas' });
    // role=group (not application): the canvas hosts focusable shape children,
    // so AT keeps browse mode and users reach each shape with Tab/arrows. Each
    // shape is a focusable, named button-role element (see renderer). The canvas
    // itself is focusable so an empty diagram and pan/marquee still have a home.
    this.canvasEl.setAttribute('role', 'group');
    this.canvasEl.setAttribute(
      'aria-label',
      'Diagram canvas. Tab to a shape; arrow keys move between shapes, ' +
        'Shift+arrows nudge the selection, Enter starts or completes a connector.',
    );
    this.canvasEl.tabIndex = 0;
    main.appendChild(this.canvasEl);

    this.svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    this.svg.setAttribute('class', 'jects-diagram__svg');
    this.svg.setAttribute('width', '100%');
    this.svg.setAttribute('height', '100%');
    this.canvasEl.appendChild(this.svg);
    this.layers = buildSvgLayers(this.svg);

    if (cfg.editable) {
      const panelHost = createEl('div', { className: 'jects-diagram__panel' });
      main.appendChild(panelHost);
      this.panel = new PropertiesPanel(panelHost, {
        target: { kind: 'none' },
        onShapeChange: (id, patch) => this.updateShape(id, patch),
        onConnectorChange: (id, patch) => this.updateConnector(id, patch),
      });
    }

    this.wireCanvasEvents();
    this.wireKeyboard();

    // Re-render on any engine change (coalesced).
    this.engineUnsub = this._engine.events.on('change', () => this.scheduleRender());
    this.track(() => this.engineUnsub?.());

    this.scheduleRender();
  }

  /* ───────────────────────── chrome ───────────────────────── */

  private toolbarItems(): {
    items: ToolbarItem[];
    actions: Record<string, () => void>;
  } {
    const items: ToolbarItem[] = [];
    const actions: Record<string, () => void> = {};
    const item = (id: string, text: string, onClick: () => void): void => {
      items.push({ id, text });
      actions[id] = onClick;
    };
    item('undo', 'Undo', () => this.undo());
    item('redo', 'Redo', () => this.redo());
    item('fit', 'Fit', () => this.fitToView());
    item('zoom-in', 'Zoom +', () => this.setZoom(this._view.zoom * 1.2));
    item('zoom-out', 'Zoom −', () => this.setZoom(this._view.zoom / 1.2));
    item('align-left', 'Align L', () => this.align('left'));
    item('align-center', 'Align C', () => this.align('center-x'));
    item('distribute', 'Distribute', () => this.distribute('horizontal'));
    item('layout', 'Auto layout', () =>
      this.autoLayout(this.getMode() === 'mindmap' ? 'radial' : 'orthogonal'),
    );
    item('lane', 'Add lane', () => this.addLaneFromToolbar());
    item('group', 'Group', () => this.group(this.getSelection()));
    item('ungroup', 'Ungroup', () => {
      for (const id of this.getSelection()) this.ungroup(id);
    });
    item('copy-style', 'Copy style', () => this.copyStyle());
    item('apply-style', 'Apply style', () => this.applyStyle());
    item('export-png', 'PNG', () => void this.exportPng());
    item('export-pdf', 'PDF', () => void this.exportPdf());
    item('export-json', 'JSON', () => this.exportJson());
    return { items, actions };
  }

  private buildShapebar(): void {
    this.shapebarEl.replaceChildren();
    for (const { type, label } of SHAPEBAR) {
      const btn = createEl('button', { className: 'jects-diagram__shapebar-item' });
      btn.type = 'button';
      btn.draggable = true;
      btn.dataset.shapeType = type;
      btn.setAttribute('aria-label', `Add ${label}`);
      btn.title = label;
      const swatch = createEl('span', { className: 'jects-diagram__shapebar-glyph' });
      swatch.dataset.shape = type;
      const text = createEl('span', { className: 'jects-diagram__shapebar-label' });
      text.textContent = label;
      btn.append(swatch, text);
      btn.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('application/x-jects-shape', type);
        e.dataTransfer?.setData('text/plain', label);
      });
      // Click also adds a shape at the viewport center (keyboard-accessible path).
      btn.addEventListener('click', () => this.addShapeOfType(type, this.viewportCenterModel()));
      this.shapebarEl.appendChild(btn);
    }
  }

  /* ───────────────────────── coordinate math ───────────────────────── */

  toModelPoint(clientX: number, clientY: number): Point {
    const rect = this.svg.getBoundingClientRect();
    const x = (clientX - rect.left - this._view.panX) / this._view.zoom;
    const y = (clientY - rect.top - this._view.panY) / this._view.zoom;
    return { x, y };
  }

  private viewportCenterModel(): Point {
    const rect = this.svg.getBoundingClientRect();
    const cx = rect.width / 2 || 200;
    const cy = rect.height / 2 || 150;
    return {
      x: (cx - this._view.panX) / this._view.zoom,
      y: (cy - this._view.panY) / this._view.zoom,
    };
  }

  /* ───────────────────────── events ───────────────────────── */

  private wireCanvasEvents(): void {
    const canvas = this.canvasEl;

    // Pointer interactions on the SVG. The move/up handlers live on `window`
    // (so a drag that leaves the canvas still tracks). Bind them HERE, where the
    // prototype methods exist — NOT as class-field arrows, which initialize
    // after `super()` runs `render()` and would register `undefined` instead.
    this.svg.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    const onMove = (e: PointerEvent): void => this.onPointerMove(e);
    const onUp = (e: PointerEvent): void => this.onPointerUp(e);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.track(() => window.removeEventListener('pointermove', onMove));
    this.track(() => window.removeEventListener('pointerup', onUp));

    // Wheel zoom (ctrl/meta) + pan.
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    // Double-click: inline text edit on a shape.
    this.svg.addEventListener('dblclick', (e) => this.onDblClick(e));

    // Drag-drop from shapebar.
    canvas.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('application/x-jects-shape')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    canvas.addEventListener('drop', (e) => this.onDrop(e));
  }

  private wireKeyboard(): void {
    this.canvasEl.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.config.editable) return;
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Middle / alt-drag = pan.
      this.beginPan(e);
      return;
    }
    if (e.button !== 0) return;
    const model = this.toModelPoint(e.clientX, e.clientY);
    const target = e.target as Element;

    // Resize handle?
    const handle = target.closest('[data-handle]') as SVGElement | null;
    if (handle) {
      const h = handle.getAttribute('data-handle') as ResizeHandle;
      const id = handle.getAttribute('data-shape')!;
      this.beginResize(e, id, h, model);
      return;
    }

    // Port? → start connector draw.
    const portEl = target.closest('[data-port]') as SVGElement | null;
    if (portEl) {
      const shape = portEl.getAttribute('data-shape')!;
      const port = portEl.getAttribute('data-port')!;
      this.beginConnect(e, shape, port, model);
      return;
    }

    const hit = this._engine.hitTest(model, 6 / this._view.zoom);
    if (hit.kind === 'shape' || hit.kind === 'connector') {
      // Group-aware selection: clicking a grouped child selects its group root
      // (so the whole group moves/selects as a unit).
      const id = hit.kind === 'shape' ? this.groupRootOf(hit.id!) : hit.id!;
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      if (additive) {
        this.toggleSelect(id);
      } else if (!this._selection.has(id)) {
        this.select(id);
      }
      if (hit.kind === 'shape') this.beginMove(e, model);
      const shape = this._engine.getShape(id);
      const connector = this._engine.getConnector(id);
      if (shape) this.emit('shapeClick', { shape, event: e as unknown as MouseEvent });
      else if (connector)
        this.emit('connectorClick', { connector, event: e as unknown as MouseEvent });
    } else {
      // Empty space → box-select (or clear).
      if (!(e.shiftKey || e.metaKey || e.ctrlKey)) this.clearSelection();
      this.beginMarquee(e, model);
    }
  }

  private beginPan(e: PointerEvent): void {
    this.drag = {
      kind: 'pan',
      startClient: { x: e.clientX, y: e.clientY },
      startModel: { x: this._view.panX, y: this._view.panY },
      lastModel: { x: this._view.panX, y: this._view.panY },
      origin: new Map(),
    };
    this.svg.setPointerCapture?.(e.pointerId);
  }

  private beginMove(e: PointerEvent, model: Point): void {
    const origin = new Map<DiagramId, { x: number; y: number; w: number; h: number }>();
    for (const id of this._selection) {
      const s = this._engine.getShape(id);
      if (s && !s.locked) origin.set(id, { x: s.x, y: s.y, w: s.w, h: s.h });
      // A group drags its children rigidly: capture their origins too.
      if (s) {
        for (const child of this.childrenOf(id)) {
          const cs = this._engine.getShape(child);
          if (cs && !cs.locked && !origin.has(child)) {
            origin.set(child, { x: cs.x, y: cs.y, w: cs.w, h: cs.h });
          }
        }
      }
    }
    // Coalesce the whole drag gesture into ONE history entry (captured here, at
    // gesture start — not on every pointermove).
    if (origin.size) this.pushHistory();
    this.drag = {
      kind: 'move',
      startClient: { x: e.clientX, y: e.clientY },
      startModel: model,
      lastModel: model,
      origin,
    };
  }

  private beginResize(
    e: PointerEvent,
    id: DiagramId,
    handle: ResizeHandle,
    model: Point,
  ): void {
    const s = this._engine.getShape(id);
    if (!s || s.locked) return;
    this.select(id);
    const origin = new Map([[id, { x: s.x, y: s.y, w: s.w, h: s.h }]]);
    // One history entry per resize gesture.
    this.pushHistory();
    this.drag = {
      kind: 'resize',
      startClient: { x: e.clientX, y: e.clientY },
      startModel: model,
      lastModel: model,
      origin,
      handle,
      resizeId: id,
    };
  }

  private beginConnect(
    e: PointerEvent,
    shape: DiagramId,
    port: DiagramId,
    model: Point,
  ): void {
    this.drag = {
      kind: 'connect',
      startClient: { x: e.clientX, y: e.clientY },
      startModel: model,
      lastModel: model,
      origin: new Map(),
      connectFrom: { shape, port, point: model },
    };
    this.pendingConnector = { from: model, to: model };
  }

  private beginMarquee(e: PointerEvent, model: Point): void {
    this.drag = {
      kind: 'marquee',
      startClient: { x: e.clientX, y: e.clientY },
      startModel: model,
      lastModel: model,
      origin: new Map(),
    };
    this.marquee = { x: model.x, y: model.y, width: 0, height: 0 };
  }

  private onPointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (d.kind === 'none') return;
    const model = this.toModelPoint(e.clientX, e.clientY);
    d.lastModel = model;

    switch (d.kind) {
      case 'pan': {
        this._view.panX = d.startModel.x + (e.clientX - d.startClient.x);
        this._view.panY = d.startModel.y + (e.clientY - d.startClient.y);
        this.scheduleRender();
        break;
      }
      case 'move': {
        this.applyMove(model);
        break;
      }
      case 'resize': {
        this.applyResize(model);
        break;
      }
      case 'connect': {
        if (this.pendingConnector) this.pendingConnector.to = model;
        this.scheduleRender();
        break;
      }
      case 'marquee': {
        this.marquee = normalizeRect(d.startModel, model);
        this.scheduleRender();
        break;
      }
    }
  }

  private applyMove(model: Point): void {
    const d = this.drag;
    const dx = model.x - d.startModel.x;
    const dy = model.y - d.startModel.y;
    const snap = this.config.snap ?? 0;
    this.snapLines = [];

    // Primary shape drives snapping; the rest follow rigidly.
    const ids = [...d.origin.keys()];
    const primaryId = ids[0];
    if (primaryId === undefined) return;
    const primaryOrigin = d.origin.get(primaryId)!;
    let proposed: Point = { x: primaryOrigin.x + dx, y: primaryOrigin.y + dy };
    if (snap > 0) proposed = snapPoint(proposed, snap);

    const others = this._engine.shapes.toArray().filter((s) => !d.origin.has(s.id));
    const primaryShape = this._engine.getShape(primaryId)!;
    const snapResult = computeSnap(
      { ...primaryShape, x: proposed.x, y: proposed.y },
      proposed,
      others,
    );
    const finalPrimary = snapResult.position;
    this.snapLines = snapResult.lines;
    const appliedDx = finalPrimary.x - primaryOrigin.x;
    const appliedDy = finalPrimary.y - primaryOrigin.y;

    for (const [id, o] of d.origin) {
      this._engine.updateShape(id, { x: o.x + appliedDx, y: o.y + appliedDy });
      this.clampShapeToLane(id);
    }
  }

  /**
   * Keep a shape inside its swimlane after a move. Resolves the shape's lane via
   * {@link laneOf} (explicit `lane` or containing lane) and, when the box has
   * drifted outside, re-flows it back inside with {@link clampToLane}. No-op when
   * there are no lanes or the shape is already inside.
   */
  private clampShapeToLane(id: DiagramId): void {
    const lanes = this._engine.swimlanes.toArray();
    if (lanes.length === 0) return;
    const s = this._engine.getShape(id);
    if (!s) return;
    const lane = laneOf(s, lanes);
    if (!lane) return;
    const clamped = clampToLane(s, lanes);
    if (clamped) this._engine.updateShape(id, { x: clamped.x, y: clamped.y });
    // Record membership so the shape stays bound to its lane on later moves.
    if (s.lane !== lane.id) this._engine.updateShape(id, { lane: lane.id });
  }

  private applyResize(model: Point): void {
    const d = this.drag;
    if (!d.resizeId || !d.handle) return;
    const o = d.origin.get(d.resizeId)!;
    const dx = model.x - d.startModel.x;
    const dy = model.y - d.startModel.y;
    // Compute new rect via geometry.resizeRect semantics inline.
    let { x, y, w, h } = o;
    const handle = d.handle;
    if (handle.includes('w')) {
      w = o.w - dx;
      x = o.x + dx;
    } else if (handle.includes('e')) {
      w = o.w + dx;
    }
    if (handle.includes('n')) {
      h = o.h - dy;
      y = o.y + dy;
    } else if (handle.includes('s')) {
      h = o.h + dy;
    }
    const minW = 8;
    const minH = 8;
    if (w < minW) {
      if (handle.includes('w')) x = o.x + o.w - minW;
      w = minW;
    }
    if (h < minH) {
      if (handle.includes('n')) y = o.y + o.h - minH;
      h = minH;
    }
    const snap = this.config.snap ?? 0;
    if (snap > 0) {
      x = Math.round(x / snap) * snap;
      y = Math.round(y / snap) * snap;
      w = Math.max(minW, Math.round(w / snap) * snap);
      h = Math.max(minH, Math.round(h / snap) * snap);
    }
    this._engine.updateShape(d.resizeId, { x, y, w, h });
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.drag;
    if (d.kind === 'none') return;

    if (d.kind === 'marquee' && this.marquee) {
      this.commitMarquee(this.marquee, e.shiftKey || e.metaKey || e.ctrlKey);
    }
    if (d.kind === 'connect' && d.connectFrom) {
      this.commitConnect(this.toModelPoint(e.clientX, e.clientY));
    }
    if (d.kind === 'move' || d.kind === 'resize') {
      for (const id of d.origin.keys()) {
        const s = this._engine.getShape(id);
        if (s) this.emit('shapeTransform', { shape: s });
      }
      this.emitChange('transform');
    }
    this.drag = {
      kind: 'none',
      startClient: { x: 0, y: 0 },
      startModel: { x: 0, y: 0 },
      lastModel: { x: 0, y: 0 },
      origin: new Map(),
    };
    this.marquee = null;
    this.pendingConnector = null;
    this.snapLines = [];
    this.scheduleRender();
  }

  private commitMarquee(rect: { x: number; y: number; width: number; height: number }, additive: boolean): void {
    if (rect.width < 2 && rect.height < 2) return;
    const hits: DiagramId[] = [];
    for (const s of this._engine.shapes.toArray()) {
      if (rectsIntersect(rect, shapeRect(s))) hits.push(s.id);
    }
    if (additive) {
      const next = new Set(this._selection);
      for (const id of hits) next.add(id);
      this.select([...next]);
    } else {
      this.select(hits);
    }
  }

  private commitConnect(model: Point): void {
    const from = this.drag.connectFrom;
    if (!from) return;
    const hit = this._engine.hitTest(model, 8 / this._view.zoom);
    let toShape: DiagramId | undefined;
    let toPort: DiagramId | undefined;
    if (hit.kind === 'port') {
      toShape = hit.shape;
      toPort = hit.port;
    } else if (hit.kind === 'shape') {
      toShape = hit.id;
    }
    if (!toShape || toShape === from.shape) return;
    const fromEnd: ConnectorModel['from'] = { shape: from.shape };
    if (from.port) fromEnd.port = from.port;
    const toEnd: ConnectorModel['to'] = { shape: toShape };
    if (toPort) toEnd.port = toPort;
    this.addConnector({
      id: genId('conn'),
      from: fromEnd,
      to: toEnd,
      kind: this.config.defaultConnectorKind ?? 'orthogonal',
      arrows: { end: 'arrow' },
    });
  }

  private onWheel(e: WheelEvent): void {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const before = this.toModelPoint(e.clientX, e.clientY);
      const nextZoom = clamp(this._view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      this._view.zoom = nextZoom;
      // Keep the cursor anchored.
      const rect = this.svg.getBoundingClientRect();
      this._view.panX = e.clientX - rect.left - before.x * nextZoom;
      this._view.panY = e.clientY - rect.top - before.y * nextZoom;
      this.emit('zoom', { zoom: nextZoom });
      this.scheduleRender();
    } else {
      this._view.panX -= e.deltaX;
      this._view.panY -= e.deltaY;
      this.scheduleRender();
    }
  }

  private onDblClick(e: MouseEvent): void {
    if (!this.config.editable) return;
    const model = this.toModelPoint(e.clientX, e.clientY);
    const hit = this._engine.hitTest(model, 6 / this._view.zoom);
    if (hit.kind === 'shape' && hit.id) this.beginInlineEdit(hit.id);
  }

  private onDrop(e: DragEvent): void {
    const type = e.dataTransfer?.getData('application/x-jects-shape') as ShapeType;
    if (!type) return;
    e.preventDefault();
    const model = this.toModelPoint(e.clientX, e.clientY);
    this.addShapeOfType(type, model);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.config.editable) return;
    const key = e.key;
    const mod = e.metaKey || e.ctrlKey;
    // Undo / redo: Ctrl/Cmd+Z undoes; Ctrl+Y or Ctrl/Cmd+Shift+Z redoes.
    if (mod && key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      if (this._selection.size) {
        e.preventDefault();
        this.remove([...this._selection]);
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === 'a') {
      e.preventDefault();
      this.select(this._engine.shapes.toArray().map((s) => s.id));
      return;
    }
    if (key === 'Escape') {
      // Cancel a pending keyboard connection first; otherwise clear selection.
      if (this.connectSourceId) {
        this.connectSourceId = null;
        this.scheduleRender();
        return;
      }
      this.clearSelection();
      return;
    }

    // Enter / Space on the focus cursor: start or complete a connector by
    // keyboard. First press arms the source; second press on a different shape
    // commits the connector — a fully pointer-free connect path.
    if (key === 'Enter' || key === ' ') {
      const focus = this.focusId ?? this.firstSelectedId();
      if (focus) {
        e.preventDefault();
        this.keyboardConnect(focus);
      }
      return;
    }

    const arrow: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const dir = arrow[key];
    if (!dir) return;

    // Shift+arrow nudges the current selection (fine-grained move). Plain arrow
    // moves the keyboard focus cursor between shapes (selection navigation).
    if (e.shiftKey && this._selection.size) {
      e.preventDefault();
      const step = 10;
      this.pushHistory();
      for (const id of this._selection) {
        const s = this._engine.getShape(id);
        if (s && !s.locked) {
          this._engine.updateShape(id, { x: s.x + dir.x * step, y: s.y + dir.y * step });
          this.clampShapeToLane(id);
        }
      }
      this.emitChange('nudge');
      return;
    }

    e.preventDefault();
    this.moveFocusCursor(dir);
  }

  /** First selected shape id, if any (stable order = selection insertion). */
  private firstSelectedId(): DiagramId | null {
    for (const id of this._selection) {
      if (this._engine.getShape(id)) return id;
    }
    return null;
  }

  /**
   * Move the roving-tabindex focus cursor to the nearest shape in `dir`. If no
   * shape is focused yet, focuses the first shape. The cursor shape is selected
   * and DOM focus is moved to its rendered element after the next paint.
   */
  private moveFocusCursor(dir: Point): void {
    const shapes = this._engine.shapes.toArray().filter((s) => !(s.data && s.data.__hidden));
    if (shapes.length === 0) return;
    const current = this.focusId ? this._engine.getShape(this.focusId) : null;
    let next: ShapeModel | null = null;
    if (!current) {
      next = shapes[0]!;
    } else {
      const cx = current.x + current.w / 2;
      const cy = current.y + current.h / 2;
      let best = Infinity;
      for (const s of shapes) {
        if (s.id === current.id) continue;
        const sx = s.x + s.w / 2;
        const sy = s.y + s.h / 2;
        const dx = sx - cx;
        const dy = sy - cy;
        // Only consider shapes in the requested half-plane.
        const along = dx * dir.x + dy * dir.y;
        if (along <= 0) continue;
        const perp = Math.abs(dx * dir.y - dy * dir.x);
        const cost = along + perp * 2;
        if (cost < best) {
          best = cost;
          next = s;
        }
      }
      // No shape in that direction → keep current focus.
      if (!next) next = current;
    }
    this.setFocusCursor(next.id);
  }

  /** Set the focus cursor to a shape, select it, and move DOM focus to it. */
  private setFocusCursor(id: DiagramId): void {
    this.focusId = id;
    this.select(id);
    this.paint();
    const el = this.svg.querySelector<SVGGElement>(`g[data-shape="${CSS.escape(id)}"]`);
    el?.focus();
  }

  /**
   * Keyboard connector flow. First call arms `connectSourceId`; the second call
   * on a different shape commits a connector from source → target.
   */
  private keyboardConnect(shapeId: DiagramId): void {
    if (!this.connectSourceId) {
      this.connectSourceId = shapeId;
      this.scheduleRender();
      return;
    }
    if (this.connectSourceId === shapeId) {
      // Same shape → cancel.
      this.connectSourceId = null;
      this.scheduleRender();
      return;
    }
    const from = this.connectSourceId;
    this.connectSourceId = null;
    this.addConnector({
      id: genId('conn'),
      from: { shape: from },
      to: { shape: shapeId },
      kind: this.config.defaultConnectorKind ?? 'orthogonal',
      arrows: { end: 'arrow' },
    });
    this.setFocusCursor(shapeId);
  }

  /* ───────────────────────── inline editing ───────────────────────── */

  private beginInlineEdit(id: DiagramId): void {
    const s = this._engine.getShape(id);
    if (!s || s.locked) return;
    this.endInlineEdit();
    const ta = createEl('textarea', { className: 'jects-diagram__inline-editor' });
    ta.value = s.text ?? '';
    ta.setAttribute('aria-label', 'Edit shape text');
    const left = this._view.panX + s.x * this._view.zoom;
    const top = this._view.panY + s.y * this._view.zoom;
    ta.style.left = `${left}px`;
    ta.style.top = `${top}px`;
    ta.style.width = `${s.w * this._view.zoom}px`;
    ta.style.height = `${s.h * this._view.zoom}px`;
    this.canvasEl.appendChild(ta);
    this.editorEl = ta;
    ta.focus();
    ta.select();
    let committed = false;
    const commit = (): void => {
      // Idempotent: Enter commits and removes the textarea, whose removal +
      // canvas refocus fires `blur` → commit again. Guard against re-entry.
      if (committed) return;
      committed = true;
      const value = ta.value;
      this.endInlineEdit();
      this.updateShape(id, { text: value });
    };
    ta.addEventListener('blur', commit);
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        commit();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this.endInlineEdit();
      }
    });
  }

  private endInlineEdit(): void {
    const ta = this.editorEl;
    if (!ta) return;
    // Null the field first so a focus-induced blur re-entry is a no-op.
    this.editorEl = null;
    if (ta.isConnected) ta.remove();
    this.canvasEl.focus();
  }

  /* ───────────────────────── selection ───────────────────────── */

  select(ids: DiagramId | DiagramId[]): void {
    const arr = Array.isArray(ids) ? ids : [ids];
    if (this.emit('beforeSelect', { ids: arr }) === false) return;
    this._selection = new Set(arr);
    this.emit('select', { ids: arr });
    this.syncPanel();
    this.scheduleRender();
  }

  private toggleSelect(id: DiagramId): void {
    const next = new Set(this._selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.select([...next]);
  }

  getSelection(): DiagramId[] {
    return [...this._selection];
  }

  clearSelection(): void {
    if (this._selection.size === 0) return;
    this.select([]);
  }

  private syncPanel(): void {
    if (!this.panel) return;
    let target: PanelTarget = { kind: 'none' };
    if (this._selection.size === 1) {
      const id = [...this._selection][0]!;
      const shape = this._engine.getShape(id);
      const connector = this._engine.getConnector(id);
      if (shape) target = { kind: 'shape', model: shape };
      else if (connector) target = { kind: 'connector', model: connector };
    }
    this.panel.update({ target });
  }

  /* ───────────────────────── undo / redo (history) ───────────────────────── */

  /** Cap on retained history entries — bounds memory for long edit sessions. */
  private static readonly HISTORY_LIMIT = 100;

  /**
   * Snapshot the current document onto the undo stack BEFORE a mutation, and
   * clear the redo stack (a new edit forks history). No-op while restoring a
   * snapshot, so undo/redo themselves never push. Rapid drag gestures call this
   * once at gesture start (see {@link beginMove}/{@link beginResize}), coalescing
   * an entire drag into a single entry.
   */
  private pushHistory(): void {
    if (this.restoring) return;
    this.undoStack.push(this._engine.toJSON());
    if (this.undoStack.length > Diagram.HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Restore a document snapshot without recording it as a new history entry. */
  private restore(doc: DiagramDocument): void {
    this.restoring = true;
    try {
      this._engine.fromJSON(doc);
    } finally {
      this.restoring = false;
    }
    // Drop selections that no longer resolve to a live element.
    for (const id of [...this._selection]) {
      if (!this._engine.getShape(id) && !this._engine.getConnector(id)) {
        this._selection.delete(id);
      }
    }
    this.syncPanel();
    this.scheduleRender();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this._engine.toJSON());
    this.restore(prev);
    this.emit('change', { document: this._engine.toJSON() });
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this._engine.toJSON());
    this.restore(next);
    this.emit('change', { document: this._engine.toJSON() });
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /* ───────────────────────── model authoring (DiagramApi) ───────────────────────── */

  addShape(shape: ShapeModel): ShapeModel {
    if (this.emit('beforeChange', { reason: 'addShape' }) === false) return shape;
    this.pushHistory();
    const added = this._engine.addShape(shape);
    this.emitChange('addShape');
    return added;
  }

  private addShapeOfType(type: ShapeType, at: Point): ShapeModel {
    const size = defaultShapeSize(type);
    const shape: ShapeModel = {
      id: genId('shape'),
      type,
      x: at.x - size.width / 2,
      y: at.y - size.height / 2,
      w: size.width,
      h: size.height,
      text: type === 'text' ? 'Text' : '',
      ports: defaultPorts(),
    };
    const added = this.addShape(shape);
    this.select(added.id);
    return added;
  }

  addConnector(connector: ConnectorModel): ConnectorModel {
    if (this.emit('beforeChange', { reason: 'addConnector' }) === false) return connector;
    this.pushHistory();
    const added = this._engine.addConnector(connector);
    this.emitChange('addConnector');
    return added;
  }

  updateShape(id: DiagramId, changes: Partial<ShapeModel>): void {
    this.pushHistory();
    this._engine.updateShape(id, changes);
    this.syncPanel();
    this.emitChange('updateShape');
  }

  updateConnector(id: DiagramId, changes: Partial<ConnectorModel>): void {
    this.pushHistory();
    this._engine.updateConnector(id, changes);
    this.syncPanel();
    this.emitChange('updateConnector');
  }

  remove(ids: DiagramId | DiagramId[]): void {
    const arr = Array.isArray(ids) ? ids : [ids];
    // Expand groups so removing a group also removes its children.
    const expanded = new Set<DiagramId>();
    for (const id of arr) {
      expanded.add(id);
      for (const child of this.childrenOf(id)) expanded.add(child);
    }
    this.pushHistory();
    for (const id of expanded) {
      if (this._engine.getConnector(id)) this._engine.removeConnector(id);
      else this._engine.removeShape(id);
      this._selection.delete(id);
    }
    this.syncPanel();
    this.emitChange('remove');
  }

  /* ───────────────────────── swimlanes (DiagramApi) ───────────────────────── */

  addSwimlane(lane: SwimlaneModel): SwimlaneModel {
    if (this.emit('beforeChange', { reason: 'addSwimlane' }) === false) return lane;
    this.pushHistory();
    const added = this._engine.addSwimlane(lane);
    // Bind any shapes already sitting inside the new lane to it.
    for (const s of this._engine.shapes.toArray()) {
      this.clampShapeToLane(s.id);
    }
    this.emitChange('addSwimlane');
    return added;
  }

  updateSwimlane(id: DiagramId, changes: Partial<SwimlaneModel>): void {
    this.pushHistory();
    this._engine.updateSwimlane(id, changes);
    // A resized/moved lane may now contain (or exclude) different shapes.
    for (const s of this._engine.shapes.toArray()) this.clampShapeToLane(s.id);
    this.emitChange('updateSwimlane');
  }

  removeSwimlane(id: DiagramId): void {
    this.pushHistory();
    // Detach members so their `lane` doesn't dangle.
    for (const s of this._engine.shapes.toArray()) {
      if (s.lane === id) {
        this._engine.updateShape(s.id, { lane: undefined } as unknown as Partial<ShapeModel>);
      }
    }
    this._engine.removeSwimlane(id);
    this.emitChange('removeSwimlane');
  }

  /**
   * Add a swimlane sized to the current content (or a default box) via the
   * toolbar lane tool. Lanes alternate orientation by count so repeated clicks
   * build a readable pool.
   */
  private addLaneFromToolbar(): void {
    const bounds = this._engine.getBounds();
    const count = this._engine.swimlanes.toArray().length;
    const orientation: SwimlaneModel['orientation'] =
      count % 2 === 0 ? 'vertical' : 'horizontal';
    const baseX = bounds.width > 0 ? bounds.x : this.viewportCenterModel().x - 160;
    const baseY = bounds.width > 0 ? bounds.y : this.viewportCenterModel().y - 120;
    const lane = this.addSwimlane({
      id: genId('lane'),
      title: `Lane ${count + 1}`,
      orientation,
      x: orientation === 'vertical' ? baseX + count * 240 : baseX,
      y: orientation === 'vertical' ? baseY : baseY + count * 200,
      w: orientation === 'vertical' ? 220 : Math.max(360, bounds.width || 360),
      h: orientation === 'vertical' ? Math.max(360, bounds.height || 360) : 180,
      order: count,
    });
    this.select(lane.id);
  }

  /* ───────────────────────── grouping (DiagramApi) ───────────────────────── */

  /**
   * Walk up the `parent` chain to the outermost group container for a shape.
   * Returns the id unchanged when it has no group ancestor. Cycle-safe.
   */
  private groupRootOf(id: DiagramId): DiagramId {
    const seen = new Set<DiagramId>();
    let cur = this._engine.getShape(id);
    while (cur?.parent && !seen.has(cur.parent)) {
      seen.add(cur.id);
      const parent = this._engine.getShape(cur.parent);
      if (!parent) break;
      cur = parent;
    }
    return cur?.id ?? id;
  }

  /** Direct child shapes of a group container (by `parent`). */
  private childrenOf(parentId: DiagramId): DiagramId[] {
    const out: DiagramId[] = [];
    for (const s of this._engine.shapes.toArray()) {
      if (s.parent === parentId) out.push(s.id);
    }
    return out;
  }

  /**
   * Group `ids` under a new invisible `group` container whose box is the union
   * of the members' rects. Each member gets `parent = group.id`; the group then
   * drags/selects as a unit. Returns the new group id (or undefined if < 2
   * groupable shapes).
   */
  group(ids: DiagramId[]): DiagramId | undefined {
    const shapes = ids
      .map((id) => this._engine.getShape(id))
      .filter((s): s is ShapeModel => !!s);
    if (shapes.length < 2) return undefined;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of shapes) {
      minX = Math.min(minX, s.x);
      minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x + s.w);
      maxY = Math.max(maxY, s.y + s.h);
    }
    this.pushHistory();
    const groupId = genId('group');
    this._engine.addShape({
      id: groupId,
      type: 'group',
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    });
    for (const s of shapes) {
      this._engine.updateShape(s.id, { parent: groupId });
    }
    this.select(groupId);
    this.emitChange('group');
    return groupId;
  }

  /**
   * Dissolve a group: detach each child (`parent` cleared) and remove the group
   * container. Returns the freed child ids (now individually selectable).
   */
  ungroup(id: DiagramId): DiagramId[] {
    const group = this._engine.getShape(id);
    if (!group || group.type !== 'group') return [];
    const children = this.childrenOf(id);
    this.pushHistory();
    for (const child of children) {
      this._engine.updateShape(child, { parent: undefined } as unknown as Partial<ShapeModel>);
    }
    this._engine.removeShape(id);
    this._selection.delete(id);
    this.select(children);
    this.emitChange('ungroup');
    return children;
  }

  /* ───────────────────────── layout / routing ───────────────────────── */

  autoLayout(kind: LayoutKind | string, options?: AutoLayoutOptions): void {
    this.pushHistory();
    this._engine.autoLayout(kind, options);
    this.emitChange('autoLayout');
  }

  route(connector: DiagramId): RouteResult {
    return this._engine.route(connector);
  }

  /* ───────────────────────── alignment / distribution ───────────────────────── */

  align(edge: AlignEdge): void {
    const shapes = this.selectedShapes();
    if (shapes.length < 2) return;
    this.pushHistory();
    const patch = alignShapes(shapes, edge);
    for (const [id, p] of patch) this._engine.updateShape(id, { x: p.x, y: p.y });
    this._engine.routeAll();
    this.emitChange('align');
  }

  distribute(axis: 'horizontal' | 'vertical'): void {
    const shapes = this.selectedShapes();
    if (shapes.length < 3) return;
    this.pushHistory();
    const patch = distributeShapes(shapes, axis);
    for (const [id, p] of patch) this._engine.updateShape(id, { x: p.x, y: p.y });
    this._engine.routeAll();
    this.emitChange('distribute');
  }

  private selectedShapes(): ShapeModel[] {
    const out: ShapeModel[] = [];
    for (const id of this._selection) {
      const s = this._engine.getShape(id);
      if (s) out.push(s);
    }
    return out;
  }

  /* ───────────────────────── copy / apply style ───────────────────────── */

  copyStyle(): void {
    const first = this.selectedShapes()[0];
    if (first?.style) this.clipboardStyle = { ...first.style };
  }

  applyStyle(): void {
    if (!this.clipboardStyle) return;
    this.pushHistory();
    for (const id of this._selection) {
      const s = this._engine.getShape(id);
      if (s) this._engine.updateShape(id, { style: { ...this.clipboardStyle } });
    }
    this.emitChange('applyStyle');
  }

  /* ───────────────────────── search / filter ───────────────────────── */

  /** Dim shapes/connectors whose text doesn't match `query` (empty clears). */
  search(query: string): DiagramId[] {
    this.searchQuery = query.trim().toLowerCase();
    this.scheduleRender();
    return this.matchedIds();
  }

  private matchedIds(): DiagramId[] {
    if (!this.searchQuery) return [];
    const q = this.searchQuery;
    const ids: DiagramId[] = [];
    for (const s of this._engine.shapes.toArray()) {
      if ((s.text ?? '').toLowerCase().includes(q)) ids.push(s.id);
    }
    return ids;
  }

  private dimmedIds(): Set<DiagramId> {
    if (!this.searchQuery) return new Set();
    const matched = new Set(this.matchedIds());
    const dimmed = new Set<DiagramId>();
    for (const s of this._engine.shapes.toArray()) {
      if (!matched.has(s.id)) dimmed.add(s.id);
    }
    return dimmed;
  }

  /* ───────────────────────── expand / collapse (mindmap) ───────────────────────── */

  /** Toggle collapse of a node's descendant subtree (mindmap/orgchart). */
  toggleCollapse(id: DiagramId): boolean {
    if (this.collapsed.has(id)) this.collapsed.delete(id);
    else this.collapsed.add(id);
    this.applyCollapseVisibility();
    this.scheduleRender();
    return this.collapsed.has(id);
  }

  isCollapsed(id: DiagramId): boolean {
    return this.collapsed.has(id);
  }

  private descendants(rootId: DiagramId): Set<DiagramId> {
    const out = new Set<DiagramId>();
    const adjacency = new Map<DiagramId, DiagramId[]>();
    for (const c of this._engine.connectors.toArray()) {
      const arr = adjacency.get(c.from.shape) ?? [];
      arr.push(c.to.shape);
      adjacency.set(c.from.shape, arr);
    }
    const stack = [...(adjacency.get(rootId) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (out.has(id)) continue;
      out.add(id);
      for (const next of adjacency.get(id) ?? []) stack.push(next);
    }
    return out;
  }

  private applyCollapseVisibility(): void {
    // Hidden = descendant of any collapsed node.
    const hidden = new Set<DiagramId>();
    for (const rootId of this.collapsed) {
      for (const d of this.descendants(rootId)) hidden.add(d);
    }
    for (const s of this._engine.shapes.toArray()) {
      const shouldHide = hidden.has(s.id);
      const isHidden = !!(s.data && s.data.__hidden);
      if (shouldHide !== isHidden) {
        this._engine.updateShape(s.id, {
          data: { ...(s.data ?? {}), __hidden: shouldHide },
        });
      }
    }
  }

  /* ───────────────────────── view ───────────────────────── */

  setZoom(zoom: number): void {
    this._view.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    this.emit('zoom', { zoom: this._view.zoom });
    this.scheduleRender();
  }

  getZoom(): number {
    return this._view.zoom;
  }

  fitToView(): void {
    const bounds = this._engine.getBounds();
    if (bounds.width === 0 || bounds.height === 0) {
      this._view = { zoom: 1, panX: 0, panY: 0 };
      this.scheduleRender();
      return;
    }
    const rect = this.svg.getBoundingClientRect();
    const vw = rect.width || 600;
    const vh = rect.height || 400;
    const pad = 40;
    const zoom = clamp(
      Math.min((vw - pad * 2) / bounds.width, (vh - pad * 2) / bounds.height),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    this._view = {
      zoom,
      panX: pad - bounds.x * zoom + (vw - pad * 2 - bounds.width * zoom) / 2,
      panY: pad - bounds.y * zoom + (vh - pad * 2 - bounds.height * zoom) / 2,
    };
    this.emit('zoom', { zoom });
    this.scheduleRender();
  }

  hitTest(point: Point): HitResult {
    return this._engine.hitTest(point);
  }

  /* ───────────────────────── mode + persistence ───────────────────────── */

  get engine(): DiagramEngine {
    return this._engine;
  }

  setMode(mode: DiagramMode): void {
    if (mode !== this._engine.mode) this.pushHistory();
    this._engine.setMode(mode);
    this.config.mode = mode;
    this.emitChange('setMode');
  }

  getMode(): DiagramMode {
    return this._engine.mode;
  }

  toJSON(): DiagramDocument {
    const doc = this._engine.toJSON();
    doc.meta = {
      ...(doc.meta ?? {}),
      view: { ...this._view },
    };
    return doc;
  }

  fromJSON(doc: DiagramDocument): void {
    this._engine.fromJSON(doc);
    this._selection.clear();
    // Loading a document is a fresh baseline — discard prior edit history.
    this.undoStack = [];
    this.redoStack = [];
    const view = (doc.meta?.view as ViewTransform | undefined) ?? undefined;
    if (view) this._view = { ...view };
    this.syncPanel();
    this.emitChange('fromJSON');
  }

  /* ───────────────────────── export ───────────────────────── */

  /** Serialize the current canvas to a standalone SVG string. */
  exportSvg(): string {
    return serializeSvg(this.svg, this.el, this._engine.getBounds());
  }

  async exportPng(filename = 'diagram.png'): Promise<string | null> {
    const bounds = this._engine.getBounds();
    const svgText = this.exportSvg();
    const url = await svgToPngDataUrl(svgText, bounds.width + 32, bounds.height + 32);
    if (url) downloadBlob(dataUrlToBlob(url), filename, 'image/png');
    return url;
  }

  async exportPdf(filename = 'diagram.pdf'): Promise<Blob | null> {
    const bounds = this._engine.getBounds();
    const svgText = this.exportSvg();
    const url = await svgToPngDataUrl(svgText, bounds.width + 32, bounds.height + 32);
    if (!url) return null;
    const pdf = pngDataUrlToPdf(url, bounds.width + 32, bounds.height + 32);
    downloadBlob(pdf, filename, 'application/pdf');
    return pdf;
  }

  exportJson(filename = 'diagram.json'): string {
    const json = documentToJson(this.toJSON());
    downloadBlob(json, filename, 'application/json');
    return json;
  }

  /* ───────────────────────── render scheduling ───────────────────────── */

  private scheduleRender(): void {
    if (this.rafPending || this.isDestroyed) return;
    this.rafPending = true;
    const run = (): void => {
      this.rafPending = false;
      // The widget may have been destroyed between scheduling and the frame
      // firing; never paint against torn-down state.
      if (this.isDestroyed) return;
      this.paint();
    };
    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(run);
    } else {
      run();
    }
  }

  /** Synchronous repaint (also exposed for tests). */
  paint(): void {
    if (this.isDestroyed || !this.svg) return;
    // Engines expose an optional `getShapeDef(key)` for custom-shape outlines.
    const defEngine = this._engine as DiagramEngine & {
      getShapeDef?: (key: string) => ShapeDefinition | undefined;
    };
    const state: RenderState = {
      selection: this._selection,
      view: this._view,
      grid: this.config.grid ?? true,
      snap: this.config.snap ?? 0,
      editable: this.config.editable ?? true,
      marquee: this.marquee,
      snapLines: this.snapLines,
      pendingConnector: this.pendingConnector,
      dimmed: this.dimmedIds(),
      focusId: this.focusId,
      connectSourceId: this.connectSourceId,
    };
    if (defEngine.getShapeDef) {
      state.resolveShapeDef = (key: string) => defEngine.getShapeDef!(key);
    }
    this.el.classList.toggle('jects-diagram--grid', state.grid);
    renderScene(this.svg, this._engine, state, this.layers);
  }

  private emitChange(_reason: string): void {
    this.emit('change', { document: this._engine.toJSON() });
    this.scheduleRender();
  }

  /* ───────────────────────── lifecycle ───────────────────────── */

  override destroy(): void {
    // Cancel any scheduled frame so run()/paint() can't fire post-teardown.
    if (this.rafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = 0;
    this.rafPending = false;
    this.endInlineEdit();
    this.toolbar?.destroy();
    this.panel?.destroy();
    // Only dispose the engine if WE created it — never an injected/host-owned one.
    if (this.ownsEngine) this._engine.destroy();
    super.destroy();
  }
}

/** Default 4-side ports so connectors can attach immediately. */
function defaultPorts(): NonNullable<ShapeModel['ports']> {
  return [
    { id: 'top', side: 'top', offset: { x: 0.5, y: 0 }, in: true, out: true },
    { id: 'right', side: 'right', offset: { x: 1, y: 0.5 }, in: true, out: true },
    { id: 'bottom', side: 'bottom', offset: { x: 0.5, y: 1 }, in: true, out: true },
    { id: 'left', side: 'left', offset: { x: 0, y: 0.5 }, in: true, out: true },
  ];
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta = '', b64 = ''] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(meta)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

register(
  'diagram',
  Diagram as unknown as new (
    host: HTMLElement | string,
    config?: Record<string, unknown>,
  ) => Diagram,
);
