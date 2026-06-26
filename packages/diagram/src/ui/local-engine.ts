/**
 * A self-contained {@link DiagramEngine} implementation owned by the UI when no
 * engine is injected via config. It is intentionally decoupled from the parallel
 * "diagram-engine" build area: the UI codes against the frozen `DiagramEngine`
 * interface from `contract.ts`, and a host app can swap in the production engine
 * through `DiagramConfig.engine` / `engineFactory` without touching the UI.
 *
 * This local engine covers everything the UI exercises: a model graph backed by
 * `@jects/core` `Store`s, connector routing (straight / elbow / orthogonal /
 * curved), radial + orthogonal auto-layout, hit-testing, bounds, and JSON
 * (de)serialization. It emits the contract's typed engine events so the UI can
 * subscribe with one `change` listener.
 */
import { Store, EventEmitter } from '@jects/core';
import type {
  AutoLayout,
  AutoLayoutOptions,
  ConnectorModel,
  ConnectorRouter,
  DiagramDocument,
  DiagramEngine,
  DiagramEngineEvents,
  DiagramEngineOptions,
  DiagramId,
  DiagramMode,
  HitResult,
  LayoutKind,
  LayoutResult,
  Point,
  Rect,
  RouteResult,
  ShapeDefinition,
  ShapeModel,
  SwimlaneModel,
} from '../contract.js';
import {
  distToPolyline,
  pointInRect,
  shapeRect,
  unionRects,
} from './geometry.js';
import { builtinRouters } from '../engine/routing.js';
import { builtinLayouts } from '../engine/layout.js';

const DOC_VERSION = 1;

export class LocalDiagramEngine implements DiagramEngine {
  readonly shapes: Store<ShapeModel>;
  readonly connectors: Store<ConnectorModel>;
  readonly swimlanes: Store<SwimlaneModel>;
  readonly events = new EventEmitter<DiagramEngineEvents>();

  private _mode: DiagramMode;
  private routers = new Map<string, ConnectorRouter>();
  private layouts = new Map<string, AutoLayout>();
  private shapeDefs = new Map<string, ShapeDefinition>();

  constructor(opts: DiagramEngineOptions = {}) {
    this._mode = opts.mode ?? 'flowchart';
    this.shapes = new Store<ShapeModel>({ data: opts.shapes ?? [] });
    this.connectors = new Store<ConnectorModel>({ data: opts.connectors ?? [] });
    this.swimlanes = new Store<SwimlaneModel>({ data: opts.swimlanes ?? [] });
    // Register the production-strength algorithms from `../engine` as the
    // built-in routers/layouts (A* obstacle-avoiding orthogonal routing,
    // Reingold–Tilford tidy-tree + leaf-weighted radial layout). User-supplied
    // routers/layouts still override these by `kind`.
    for (const r of builtinRouters()) this.routers.set(String(r.kind), r);
    for (const l of builtinLayouts()) this.layouts.set(String(l.kind), l);
    for (const d of opts.shapeDefs ?? []) this.shapeDefs.set(d.key, d);
    for (const r of opts.routers ?? []) this.routers.set(String(r.kind), r);
    for (const l of opts.layouts ?? []) this.layouts.set(String(l.kind), l);
  }

  get mode(): DiagramMode {
    return this._mode;
  }

  setMode(mode: DiagramMode): void {
    if (mode === this._mode) return;
    this._mode = mode;
    this.events.emit('change', { reason: 'mode' });
  }

  // ── Shapes ──
  addShape(shape: ShapeModel): ShapeModel {
    const added = this.shapes.add(shape)[0] ?? shape;
    this.events.emit('shapeAdd', { shape: added });
    this.events.emit('change', { reason: 'shapeAdd' });
    return added;
  }

  updateShape(id: DiagramId, changes: Partial<ShapeModel>): ShapeModel | undefined {
    const updated = this.shapes.update(id, changes);
    if (updated) {
      this.events.emit('shapeChange', { shape: updated, changes });
      this.events.emit('change', { reason: 'shapeChange' });
    }
    return updated;
  }

  removeShape(id: DiagramId): ShapeModel | undefined {
    const shape = this.shapes.getById(id);
    if (!shape) return undefined;
    // Cascade: drop connectors touching this shape.
    const orphans = this.connectors
      .toArray()
      .filter((c) => c.from.shape === id || c.to.shape === id);
    for (const o of orphans) this.removeConnector(o.id);
    this.shapes.remove(id);
    this.events.emit('shapeRemove', { shape });
    this.events.emit('change', { reason: 'shapeRemove' });
    return shape;
  }

  getShape(id: DiagramId): ShapeModel | undefined {
    return this.shapes.getById(id);
  }

  // ── Connectors ──
  addConnector(connector: ConnectorModel): ConnectorModel {
    const added = this.connectors.add(connector)[0] ?? connector;
    this.events.emit('connectorAdd', { connector: added });
    this.events.emit('change', { reason: 'connectorAdd' });
    return added;
  }

  updateConnector(
    id: DiagramId,
    changes: Partial<ConnectorModel>,
  ): ConnectorModel | undefined {
    const updated = this.connectors.update(id, changes);
    if (updated) {
      this.events.emit('connectorChange', { connector: updated, changes });
      this.events.emit('change', { reason: 'connectorChange' });
    }
    return updated;
  }

  removeConnector(id: DiagramId): ConnectorModel | undefined {
    const connector = this.connectors.getById(id);
    if (!connector) return undefined;
    this.connectors.remove(id);
    this.events.emit('connectorRemove', { connector });
    this.events.emit('change', { reason: 'connectorRemove' });
    return connector;
  }

  getConnector(id: DiagramId): ConnectorModel | undefined {
    return this.connectors.getById(id);
  }

  // ── Swimlanes ──
  addSwimlane(lane: SwimlaneModel): SwimlaneModel {
    const added = this.swimlanes.add(lane)[0] ?? lane;
    this.events.emit('laneChange', { lane: added });
    this.events.emit('change', { reason: 'laneAdd' });
    return added;
  }

  updateSwimlane(
    id: DiagramId,
    changes: Partial<SwimlaneModel>,
  ): SwimlaneModel | undefined {
    const updated = this.swimlanes.update(id, changes);
    if (updated) {
      this.events.emit('laneChange', { lane: updated });
      this.events.emit('change', { reason: 'laneChange' });
    }
    return updated;
  }

  removeSwimlane(id: DiagramId): SwimlaneModel | undefined {
    const lane = this.swimlanes.getById(id);
    if (!lane) return undefined;
    this.swimlanes.remove(id);
    this.events.emit('change', { reason: 'laneRemove' });
    return lane;
  }

  // ── Routing ──
  /**
   * Compute a connector's path WITHOUT mutating the model or emitting any
   * event. Pure — safe to call from a repaint. Returns a zero-length route when
   * endpoints are missing (the renderer tolerates this).
   */
  computeRoute(connector: ConnectorModel | DiagramId): RouteResult {
    const c =
      typeof connector === 'string' ? this.connectors.getById(connector) : connector;
    if (!c) {
      const zero = { x: 0, y: 0 };
      return { points: [zero, zero], startPoint: zero, endPoint: zero };
    }
    const from = this.shapes.getById(c.from.shape);
    const to = this.shapes.getById(c.to.shape);
    if (!from || !to) {
      const zero = { x: 0, y: 0 };
      return { points: [zero, zero], startPoint: zero, endPoint: zero };
    }

    // User-pinned waypoints are preserved verbatim (no re-routing).
    if (c.pinned && c.points && c.points.length >= 2) {
      const start = c.points[0]!;
      const end = c.points[c.points.length - 1]!;
      return { points: c.points, startPoint: { ...start }, endPoint: { ...end } };
    }

    // Delegate to the registered router for the kind (the strong `../engine`
    // routers are registered as built-ins; custom routers override by `kind`).
    // The orthogonal router obstacle-avoids using the full shape list.
    const router = this.routers.get(String(c.kind)) ?? this.routers.get('straight')!;
    return router.route(c, from, to, this.shapes.toArray());
  }

  /**
   * Compute AND cache a connector's route onto the model. Used on structural
   * changes (shape/connector add/update/remove, layout) — NOT on repaint.
   */
  route(connector: ConnectorModel | DiagramId): RouteResult {
    const c =
      typeof connector === 'string' ? this.connectors.getById(connector) : connector;
    const result = this.computeRoute(c ?? { x: 0 } as never);
    if (c) this.applyRoute(c, result);
    return result;
  }

  private applyRoute(c: ConnectorModel, r: RouteResult): void {
    // Only write back when the points actually changed: the Store emits its
    // `update`/`change` unconditionally, so a no-op re-route would otherwise
    // pollute the change stream and re-enter the render loop.
    if (!c.pinned && !samePoints(c.points, r.points)) {
      this.connectors.update(c.id, { points: r.points });
    }
    this.events.emit('connectorRoute', { connector: c, route: r });
  }

  routeAll(): void {
    for (const c of this.connectors.toArray()) this.route(c);
    this.events.emit('change', { reason: 'routeAll' });
  }

  // ── Auto-layout ──
  autoLayout(kind: LayoutKind | string, options: AutoLayoutOptions = {}): LayoutResult {
    // The strong tidy-tree / radial layouts from `../engine` are registered as
    // built-ins; custom layouts override by `kind`. Fall back to orthogonal for
    // an unknown kind so callers always get a usable patch.
    const layout =
      this.layouts.get(String(kind)) ?? this.layouts.get('orthogonal')!;
    const result = layout.apply(
      this.shapes.toArray(),
      this.connectors.toArray(),
      options,
    );
    for (const [id, pos] of result.positions) {
      this.shapes.update(id, { x: pos.x, y: pos.y });
    }
    if (options.rerouteConnectors !== false) this.routeAll();
    this.events.emit('layout', { kind, result });
    this.events.emit('change', { reason: 'layout' });
    return result;
  }

  // ── Hit-testing ──
  hitTest(point: Point, tolerance = 6): HitResult {
    // Ports first (small targets), then shapes (topmost z), then connectors.
    const shapes = [...this.shapes.toArray()].sort((a, b) => (b.z ?? 0) - (a.z ?? 0));
    for (const s of shapes) {
      const r = shapeRect(s);
      if (s.ports) {
        for (const p of s.ports) {
          const px = r.x + p.offset.x * r.width;
          const py = r.y + p.offset.y * r.height;
          if (Math.hypot(point.x - px, point.y - py) <= tolerance + 2) {
            return { kind: 'port', id: p.id, shape: s.id, port: p.id, distance: 0 };
          }
        }
      }
    }
    for (const s of shapes) {
      if (pointInRect(point, shapeRect(s))) {
        return { kind: 'shape', id: s.id, distance: 0 };
      }
    }
    let best: HitResult = { kind: 'none' };
    let bestDist = tolerance;
    for (const c of this.connectors.toArray()) {
      const pts = c.points && c.points.length >= 2 ? c.points : this.route(c).points;
      const d = distToPolyline(point, pts);
      if (d <= bestDist) {
        bestDist = d;
        best = { kind: 'connector', id: c.id, distance: d };
      }
    }
    if (best.kind !== 'none') return best;
    for (const lane of this.swimlanes.toArray()) {
      if (pointInRect(point, shapeRect(lane))) {
        return { kind: 'swimlane', id: lane.id, distance: 0 };
      }
    }
    return { kind: 'none' };
  }

  getBounds(): Rect {
    const rects: Rect[] = [
      ...this.shapes.toArray().map(shapeRect),
      ...this.swimlanes.toArray().map(shapeRect),
    ];
    return unionRects(rects) ?? { x: 0, y: 0, width: 0, height: 0 };
  }

  // ── Serialization ──
  toJSON(): DiagramDocument {
    return {
      version: DOC_VERSION,
      mode: this._mode,
      shapes: this.shapes.toArray().map((s) => ({ ...s })),
      connectors: this.connectors.toArray().map((c) => ({ ...c })),
      swimlanes: this.swimlanes.toArray().map((l) => ({ ...l })),
    };
  }

  fromJSON(doc: DiagramDocument): void {
    this._mode = doc.mode ?? 'flowchart';
    this.shapes.parse((doc.shapes ?? []).map((s) => ({ ...s })));
    this.connectors.parse((doc.connectors ?? []).map((c) => ({ ...c })));
    this.swimlanes.parse((doc.swimlanes ?? []).map((l) => ({ ...l })));
    this.events.emit('load', { document: doc });
    this.events.emit('change', { reason: 'load' });
  }

  // ── Extension registries ──
  registerShape(def: ShapeDefinition): void {
    this.shapeDefs.set(def.key, def);
  }

  /** Look up a registered custom shape definition (used by the renderer). */
  getShapeDef(key: string): ShapeDefinition | undefined {
    return this.shapeDefs.get(key);
  }

  registerRouter(router: ConnectorRouter): void {
    this.routers.set(String(router.kind), router);
  }

  registerLayout(layout: AutoLayout): void {
    this.layouts.set(String(layout.kind), layout);
  }

  destroy(): void {
    this.events.clear();
  }
}

/** Factory matching the shape host apps use to inject an engine. */
export function createLocalEngine(opts?: DiagramEngineOptions): DiagramEngine {
  return new LocalDiagramEngine(opts);
}

/** Deep-equal two waypoint arrays (skip no-op route store writes). */
function samePoints(a: Point[] | undefined, b: Point[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.x !== b[i]!.x || a[i]!.y !== b[i]!.y) return false;
  }
  return true;
}
