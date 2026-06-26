/**
 * DiagramEngineImpl — the headless diagram engine.
 *
 * Owns the framework-free model graph (shapes / connectors / swimlanes as
 * `@jects/core` {@link Store}s) plus the routing, auto-layout, hit-test, and
 * JSON (de)serialization algorithms. Never touches the DOM.
 *
 * Implements the frozen {@link DiagramEngine} contract. The UI Widget owns one
 * of these and is the only thing that renders it. All structural mutations emit
 * fine-grained typed events on `events` and a coalesced `change`.
 */

import { Store, EventEmitter } from '@jects/core';
import type {
  DiagramEngine,
  DiagramEngineOptions,
  DiagramEngineEvents,
  DiagramMode,
  DiagramId,
  ShapeModel,
  ConnectorModel,
  SwimlaneModel,
  RouteResult,
  LayoutKind,
  LayoutResult,
  AutoLayoutOptions,
  Point,
  Rect,
  HitResult,
  DiagramDocument,
  ShapeDefinition,
  ConnectorRouter,
  AutoLayout,
} from '../contract.js';
import { shapeRect, unionRects } from './geometry.js';
import { builtinRouters } from './routing.js';
import { builtinLayouts, layoutForMode } from './layout.js';
import { hitTest, HIT_TOLERANCE } from './hit-test.js';
import { toDocument, fromDocument } from './serialize.js';
import { getBuiltinShape, BUILTIN_SHAPE_COUNT } from './shapes.js';

/** Re-exported so consumers can introspect catalog size. */
export { BUILTIN_SHAPE_COUNT };

export class DiagramEngineImpl implements DiagramEngine {
  readonly shapes: Store<ShapeModel>;
  readonly connectors: Store<ConnectorModel>;
  readonly swimlanes: Store<SwimlaneModel>;
  readonly events = new EventEmitter<DiagramEngineEvents>();

  private _mode: DiagramMode;
  private readonly routers = new Map<string, ConnectorRouter>();
  private readonly layouts = new Map<string, AutoLayout>();
  private readonly shapeDefs = new Map<string, ShapeDefinition>();
  private destroyed = false;

  constructor(options: DiagramEngineOptions = {}) {
    this._mode = options.mode ?? 'flowchart';
    this.shapes = new Store<ShapeModel>({ data: options.shapes ?? [] });
    this.connectors = new Store<ConnectorModel>({ data: options.connectors ?? [] });
    this.swimlanes = new Store<SwimlaneModel>({ data: options.swimlanes ?? [] });

    for (const r of builtinRouters()) this.routers.set(r.kind, r);
    for (const l of builtinLayouts()) this.layouts.set(l.kind, l);
    for (const r of options.routers ?? []) this.routers.set(r.kind, r);
    for (const l of options.layouts ?? []) this.layouts.set(l.kind, l);
    for (const d of options.shapeDefs ?? []) this.shapeDefs.set(d.key, d);
  }

  get mode(): DiagramMode {
    return this._mode;
  }

  setMode(mode: DiagramMode): void {
    if (mode === this._mode) return;
    this._mode = mode;
    this.emitChange('mode');
  }

  /* ── Shape graph ───────────────────────────────────────────────────────── */

  addShape(shape: ShapeModel): ShapeModel {
    const normalized = this.applyShapeDefaults(shape);
    const [added] = this.shapes.add(normalized);
    const record = added ?? normalized;
    this.events.emit('shapeAdd', { shape: record });
    this.emitChange('shapeAdd');
    return record;
  }

  updateShape(id: DiagramId, changes: Partial<ShapeModel>): ShapeModel | undefined {
    const updated = this.shapes.update(id, changes);
    if (!updated) return undefined;
    this.events.emit('shapeChange', { shape: updated, changes });
    // Re-route connectors touching this shape.
    this.routeConnectorsFor(id);
    this.emitChange('shapeChange');
    return updated;
  }

  removeShape(id: DiagramId): ShapeModel | undefined {
    const existing = this.shapes.getById(id);
    if (!existing) return undefined;
    // Cascade: remove connectors attached to this shape.
    const attached = this.connectors
      .toArray()
      .filter((c) => c.from.shape === id || c.to.shape === id);
    for (const c of attached) this.removeConnector(c.id);
    this.shapes.remove(id);
    this.events.emit('shapeRemove', { shape: existing });
    this.emitChange('shapeRemove');
    return existing;
  }

  getShape(id: DiagramId): ShapeModel | undefined {
    return this.shapes.getById(id);
  }

  /** Fill default geometry/style/ports from the built-in catalog. */
  private applyShapeDefaults(shape: ShapeModel): ShapeModel {
    const def = getBuiltinShape(shape.type);
    if (!def) return { ...shape };
    const out: ShapeModel = { ...shape };
    if (out.w == null || out.w <= 0) out.w = def.defaultSize.width;
    if (out.h == null || out.h <= 0) out.h = def.defaultSize.height;
    return out;
  }

  /* ── Connector graph ───────────────────────────────────────────────────── */

  addConnector(connector: ConnectorModel): ConnectorModel {
    const record = { ...connector };
    if (!record.kind) record.kind = 'orthogonal';
    if (!record.arrows) record.arrows = { end: 'arrow' };
    const [added] = this.connectors.add(record);
    const result = added ?? record;
    this.events.emit('connectorAdd', { connector: result });
    // Compute an initial route if both endpoints exist.
    try {
      this.route(result);
    } catch {
      /* endpoints may not exist yet; route lazily later */
    }
    this.emitChange('connectorAdd');
    return result;
  }

  updateConnector(
    id: DiagramId,
    changes: Partial<ConnectorModel>,
  ): ConnectorModel | undefined {
    const updated = this.connectors.update(id, changes);
    if (!updated) return undefined;
    this.events.emit('connectorChange', { connector: updated, changes });
    if (!updated.pinned) {
      try {
        this.route(updated);
      } catch {
        /* ignore */
      }
    }
    this.emitChange('connectorChange');
    return updated;
  }

  removeConnector(id: DiagramId): ConnectorModel | undefined {
    const existing = this.connectors.getById(id);
    if (!existing) return undefined;
    this.connectors.remove(id);
    this.events.emit('connectorRemove', { connector: existing });
    this.emitChange('connectorRemove');
    return existing;
  }

  getConnector(id: DiagramId): ConnectorModel | undefined {
    return this.connectors.getById(id);
  }

  /* ── Swimlanes ─────────────────────────────────────────────────────────── */

  addSwimlane(lane: SwimlaneModel): SwimlaneModel {
    const [added] = this.swimlanes.add({ ...lane });
    const record = added ?? lane;
    this.events.emit('laneChange', { lane: record });
    this.emitChange('laneAdd');
    return record;
  }

  updateSwimlane(
    id: DiagramId,
    changes: Partial<SwimlaneModel>,
  ): SwimlaneModel | undefined {
    const updated = this.swimlanes.update(id, changes);
    if (!updated) return undefined;
    this.events.emit('laneChange', { lane: updated });
    this.emitChange('laneChange');
    return updated;
  }

  removeSwimlane(id: DiagramId): SwimlaneModel | undefined {
    const existing = this.swimlanes.getById(id);
    if (!existing) return undefined;
    this.swimlanes.remove(id);
    this.emitChange('laneRemove');
    return existing;
  }

  /* ── Routing ───────────────────────────────────────────────────────────── */

  /**
   * Compute the path for one connector WITHOUT mutating the model. Pure: it
   * never writes `points` back into the store and never emits any event, so it
   * is safe to call from a repaint. Throws if endpoints are missing.
   */
  computeRoute(connector: ConnectorModel | DiagramId): RouteResult {
    const c =
      typeof connector === 'string' ? this.connectors.getById(connector) : connector;
    if (!c) throw new Error(`route: connector not found`);
    const from = this.shapes.getById(c.from.shape);
    const to = this.shapes.getById(c.to.shape);
    if (!from || !to) {
      throw new Error(`route: endpoint shape(s) missing for connector ${c.id}`);
    }
    // User-pinned points are preserved verbatim.
    if (c.pinned && c.points && c.points.length >= 2) {
      return {
        points: c.points.map((p) => ({ ...p })),
        startPoint: { ...c.points[0]! },
        endPoint: { ...c.points[c.points.length - 1]! },
      };
    }
    const router = this.routers.get(c.kind) ?? this.routers.get('straight')!;
    const obstacles = this.shapes.toArray();
    return router.route(c, from, to, obstacles);
  }

  route(connector: ConnectorModel | DiagramId): RouteResult {
    const c =
      typeof connector === 'string' ? this.connectors.getById(connector) : connector;
    if (!c) throw new Error(`route: connector not found`);
    const result = this.computeRoute(c);
    // Cache waypoints back onto the model only when they actually changed, so a
    // no-op re-route does not emit a store update / change-storm. The store's
    // own `update` emits unconditionally, so we guard with a deep-equality test.
    if (!c.pinned && !pointsEqual(c.points, result.points)) {
      this.connectors.update(c.id, { points: result.points });
    }
    this.events.emit('connectorRoute', { connector: c, route: result });
    return result;
  }

  routeAll(): void {
    for (const c of this.connectors.toArray()) {
      try {
        this.route(c);
      } catch {
        /* skip connectors with missing endpoints */
      }
    }
    this.emitChange('routeAll');
  }

  /** Re-route every connector that touches `shapeId`. */
  private routeConnectorsFor(shapeId: DiagramId): void {
    for (const c of this.connectors.toArray()) {
      if (c.pinned) continue;
      if (c.from.shape === shapeId || c.to.shape === shapeId) {
        try {
          this.route(c);
        } catch {
          /* ignore */
        }
      }
    }
  }

  /* ── Auto-layout ───────────────────────────────────────────────────────── */

  autoLayout(kind: LayoutKind | string, options: AutoLayoutOptions = {}): LayoutResult {
    const layout = this.layouts.get(kind);
    if (!layout) throw new Error(`autoLayout: no layout registered for "${kind}"`);
    // Merge mode-default options under user options.
    const modeDefaults = layoutForMode(this._mode).options;
    const merged: AutoLayoutOptions = { ...modeDefaults, ...options };
    const shapes = this.shapes.toArray();
    const connectors = this.connectors.toArray();
    const result = layout.apply(shapes, connectors, merged);

    // Apply positions transactionally.
    for (const [id, pos] of result.positions) {
      const s = this.shapes.getById(id);
      if (s && (s.x !== pos.x || s.y !== pos.y)) {
        this.shapes.update(id, { x: pos.x, y: pos.y });
      }
    }
    // Apply explicit routes if provided, else re-route.
    if (result.routes) {
      for (const [id, pts] of result.routes) {
        this.connectors.update(id, { points: pts });
      }
    } else if (merged.rerouteConnectors !== false) {
      this.routeAll();
    }

    this.events.emit('layout', { kind, result });
    this.emitChange('layout');
    return result;
  }

  /**
   * Run the auto-layout that matches the active mode (convenience used by the
   * mode rules). Public-API consumers call `autoLayout(kind)` directly.
   */
  autoLayoutForMode(options: AutoLayoutOptions = {}): LayoutResult {
    const { kind } = layoutForMode(this._mode);
    return this.autoLayout(kind, options);
  }

  /* ── Hit-testing ───────────────────────────────────────────────────────── */

  hitTest(point: Point, tolerance = HIT_TOLERANCE): HitResult {
    return hitTest(
      {
        shapes: this.shapes.toArray(),
        connectors: this.connectors.toArray(),
        swimlanes: this.swimlanes.toArray(),
      },
      point,
      tolerance,
    );
  }

  /* ── Bounds ────────────────────────────────────────────────────────────── */

  getBounds(): Rect {
    const rects: Rect[] = [];
    for (const s of this.shapes.toArray()) rects.push(shapeRect(s));
    for (const l of this.swimlanes.toArray()) {
      rects.push({ x: l.x, y: l.y, width: l.w, height: l.h });
    }
    for (const c of this.connectors.toArray()) {
      if (c.points) {
        for (const p of c.points) rects.push({ x: p.x, y: p.y, width: 0, height: 0 });
      }
    }
    return unionRects(rects);
  }

  /* ── Serialization ─────────────────────────────────────────────────────── */

  toJSON(): DiagramDocument {
    return toDocument({
      mode: this._mode,
      shapes: this.shapes.toArray(),
      connectors: this.connectors.toArray(),
      swimlanes: this.swimlanes.toArray(),
    });
  }

  fromJSON(doc: DiagramDocument): void {
    const norm = fromDocument(doc);
    this._mode = norm.mode;
    this.shapes.parse(norm.shapes);
    this.connectors.parse(norm.connectors);
    this.swimlanes.parse(norm.swimlanes);
    this.routeAll();
    this.events.emit('load', { document: this.toJSON() });
    this.emitChange('load');
  }

  /* ── Extension registries ──────────────────────────────────────────────── */

  registerShape(def: ShapeDefinition): void {
    this.shapeDefs.set(def.key, def);
  }
  registerRouter(router: ConnectorRouter): void {
    this.routers.set(router.kind, router);
  }
  registerLayout(layout: AutoLayout): void {
    this.layouts.set(layout.kind, layout);
  }

  /** Look up a registered custom shape definition. */
  getShapeDef(key: string): ShapeDefinition | undefined {
    return this.shapeDefs.get(key);
  }

  /* ── Teardown ──────────────────────────────────────────────────────────── */

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.events.clear();
    this.shapes.events.clear();
    this.connectors.events.clear();
    this.swimlanes.events.clear();
    this.routers.clear();
    this.layouts.clear();
    this.shapeDefs.clear();
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  private emitChange(reason: string): void {
    if (this.destroyed) return;
    this.events.emit('change', { reason });
  }
}

/** Factory matching the contract construction shape. */
export function createDiagramEngine(options?: DiagramEngineOptions): DiagramEngine {
  return new DiagramEngineImpl(options);
}

/** Deep-equal two waypoint arrays (used to skip no-op route store writes). */
function pointsEqual(a: Point[] | undefined, b: Point[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.x !== b[i]!.x || a[i]!.y !== b[i]!.y) return false;
  }
  return true;
}
