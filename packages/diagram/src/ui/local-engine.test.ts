import { describe, it, expect } from 'vitest';
import { LocalDiagramEngine } from './local-engine.js';
import type { ConnectorModel, ShapeModel } from '../contract.js';

function shape(id: string, x: number, y: number): ShapeModel {
  return { id, type: 'rect', x, y, w: 100, h: 60 };
}

describe('LocalDiagramEngine', () => {
  it('adds/updates/removes shapes and emits change', () => {
    const e = new LocalDiagramEngine();
    let changes = 0;
    e.events.on('change', () => (changes += 1));

    e.addShape(shape('a', 0, 0));
    expect(e.getShape('a')).toBeDefined();
    e.updateShape('a', { text: 'hi' });
    expect(e.getShape('a')?.text).toBe('hi');
    expect(changes).toBeGreaterThanOrEqual(2);

    e.removeShape('a');
    expect(e.getShape('a')).toBeUndefined();
  });

  it('cascades connector removal when a shape is removed', () => {
    const e = new LocalDiagramEngine();
    e.addShape(shape('a', 0, 0));
    e.addShape(shape('b', 200, 0));
    e.addConnector({
      id: 'c1',
      from: { shape: 'a' },
      to: { shape: 'b' },
      kind: 'straight',
    });
    expect(e.connectors.count).toBe(1);
    e.removeShape('a');
    expect(e.connectors.count).toBe(0);
  });

  it('routes connectors by kind', () => {
    const e = new LocalDiagramEngine();
    e.addShape(shape('a', 0, 0));
    e.addShape(shape('b', 300, 200));
    const straight = e.addConnector({
      id: 's',
      from: { shape: 'a' },
      to: { shape: 'b' },
      kind: 'straight',
    });
    const r1 = e.route(straight);
    expect(r1.points.length).toBe(2);

    const elbow = e.addConnector({
      id: 'e',
      from: { shape: 'a' },
      to: { shape: 'b' },
      kind: 'elbow',
    });
    const r2 = e.route(elbow);
    expect(r2.points.length).toBeGreaterThan(2);
  });

  it('honors pinned waypoints', () => {
    const e = new LocalDiagramEngine();
    e.addShape(shape('a', 0, 0));
    e.addShape(shape('b', 300, 0));
    const pts = [
      { x: 1, y: 1 },
      { x: 50, y: 50 },
      { x: 99, y: 1 },
    ];
    const c: ConnectorModel = {
      id: 'c',
      from: { shape: 'a' },
      to: { shape: 'b' },
      kind: 'orthogonal',
      points: pts,
      pinned: true,
    };
    e.addConnector(c);
    expect(e.route('c').points).toEqual(pts);
  });

  it('resolves a port attachment point', () => {
    const e = new LocalDiagramEngine();
    e.addShape({
      ...shape('a', 0, 0),
      ports: [{ id: 'right', side: 'right', offset: { x: 1, y: 0.5 } }],
    });
    e.addShape(shape('b', 300, 0));
    e.addConnector({
      id: 'c',
      from: { shape: 'a', port: 'right' },
      to: { shape: 'b' },
      kind: 'straight',
    });
    const r = e.route('c');
    expect(r.startPoint).toEqual({ x: 100, y: 30 });
  });

  it('hit-tests shapes, ports, and connectors', () => {
    const e = new LocalDiagramEngine();
    e.addShape({
      ...shape('a', 0, 0),
      ports: [{ id: 'r', side: 'right', offset: { x: 1, y: 0.5 } }],
    });
    e.addShape(shape('b', 300, 0));
    expect(e.hitTest({ x: 50, y: 30 }).kind).toBe('shape');
    expect(e.hitTest({ x: 100, y: 30 }).kind).toBe('port');
    expect(e.hitTest({ x: 5000, y: 5000 }).kind).toBe('none');
  });

  it('computes bounds across shapes', () => {
    const e = new LocalDiagramEngine();
    e.addShape(shape('a', 0, 0));
    e.addShape(shape('b', 200, 100));
    const b = e.getBounds();
    expect(b.x).toBe(0);
    expect(b.width).toBe(300);
    expect(b.height).toBe(160);
  });

  it('runs orthogonal and radial auto-layout', () => {
    const e = new LocalDiagramEngine();
    e.addShape(shape('a', 0, 0));
    e.addShape(shape('b', 0, 0));
    e.addShape(shape('c', 0, 0));
    e.addConnector({ id: 'c1', from: { shape: 'a' }, to: { shape: 'b' }, kind: 'straight' });
    e.addConnector({ id: 'c2', from: { shape: 'b' }, to: { shape: 'c' }, kind: 'straight' });

    const ortho = e.autoLayout('orthogonal');
    expect(ortho.positions.size).toBe(3);
    // b is one rank below a, c below b.
    expect(e.getShape('b')!.y).toBeGreaterThan(e.getShape('a')!.y);

    const radial = e.autoLayout('radial');
    expect(radial.positions.size).toBe(3);
  });

  it('serializes and rehydrates as JSON', () => {
    const e = new LocalDiagramEngine({ mode: 'mindmap' });
    e.addShape(shape('a', 5, 5));
    e.addConnector({ id: 'c', from: { shape: 'a' }, to: { shape: 'a' }, kind: 'curved' });
    const doc = e.toJSON();
    expect(doc.version).toBe(1);
    expect(doc.mode).toBe('mindmap');
    expect(doc.shapes.length).toBe(1);

    const e2 = new LocalDiagramEngine();
    e2.fromJSON(doc);
    expect(e2.mode).toBe('mindmap');
    expect(e2.getShape('a')).toBeDefined();
  });

  it('supports custom routers and layouts via registries', () => {
    const e = new LocalDiagramEngine();
    e.addShape(shape('a', 0, 0));
    e.addShape(shape('b', 300, 0));
    e.registerRouter({
      kind: 'custom-kind',
      route: (_c, from, to) => ({
        points: [{ x: from.x, y: from.y }, { x: to.x, y: to.y }],
        startPoint: { x: from.x, y: from.y },
        endPoint: { x: to.x, y: to.y },
      }),
    });
    e.addConnector({
      id: 'c',
      from: { shape: 'a' },
      to: { shape: 'b' },
      kind: 'custom-kind' as never,
    });
    const r = e.route('c');
    expect(r.points[0]).toEqual({ x: 0, y: 0 });
  });
});
