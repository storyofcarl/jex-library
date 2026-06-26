import { describe, it, expect, vi } from 'vitest';
import { DiagramEngineImpl, createDiagramEngine } from './engine.js';
import type { ShapeModel, ConnectorModel } from '../contract.js';

function process(id: string, x = 0, y = 0): ShapeModel {
  return { id, type: 'process', x, y, w: 120, h: 64, text: id };
}

describe('DiagramEngine — construction', () => {
  it('seeds stores from options and defaults to flowchart mode', () => {
    const e = createDiagramEngine({ shapes: [process('a')], mode: 'orgchart' });
    expect(e.mode).toBe('orgchart');
    expect(e.shapes.count).toBe(1);
  });

  it('setMode emits a change and updates mode', () => {
    const e = new DiagramEngineImpl();
    const onChange = vi.fn();
    e.events.on('change', onChange);
    e.setMode('mindmap');
    expect(e.mode).toBe('mindmap');
    expect(onChange).toHaveBeenCalled();
  });
});

describe('shape graph', () => {
  it('addShape fills default size from the catalog and emits', () => {
    const e = new DiagramEngineImpl();
    const onAdd = vi.fn();
    e.events.on('shapeAdd', onAdd);
    const s = e.addShape({ id: 'a', type: 'process', x: 0, y: 0, w: 0, h: 0 });
    expect(s.w).toBeGreaterThan(0);
    expect(s.h).toBeGreaterThan(0);
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('updateShape re-routes attached connectors', () => {
    const e = new DiagramEngineImpl();
    e.addShape(process('a', 0, 0));
    e.addShape(process('b', 400, 0));
    e.addConnector({ id: 'c', from: { shape: 'a' }, to: { shape: 'b' }, kind: 'straight' });
    const before = e.getConnector('c')!.points!;
    e.updateShape('a', { x: 0, y: 300 });
    const after = e.getConnector('c')!.points!;
    expect(after).not.toEqual(before);
  });

  it('removeShape cascades and deletes attached connectors', () => {
    const e = new DiagramEngineImpl();
    e.addShape(process('a'));
    e.addShape(process('b', 300));
    e.addConnector({ id: 'c', from: { shape: 'a' }, to: { shape: 'b' }, kind: 'straight' });
    e.removeShape('a');
    expect(e.getShape('a')).toBeUndefined();
    expect(e.getConnector('c')).toBeUndefined();
  });
});

describe('connector graph + routing', () => {
  it('addConnector defaults kind+arrows and computes an initial route', () => {
    const e = new DiagramEngineImpl();
    e.addShape(process('a'));
    e.addShape(process('b', 300));
    const c = e.addConnector({ id: 'c', from: { shape: 'a' }, to: { shape: 'b' } } as ConnectorModel);
    expect(c.kind).toBe('orthogonal');
    expect(c.arrows?.end).toBe('arrow');
    expect(e.getConnector('c')!.points!.length).toBeGreaterThanOrEqual(2);
  });

  it('route preserves user-pinned points', () => {
    const e = new DiagramEngineImpl();
    e.addShape(process('a'));
    e.addShape(process('b', 300));
    const pinned = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
    e.addConnector({ id: 'c', from: { shape: 'a' }, to: { shape: 'b' }, kind: 'orthogonal', points: pinned, pinned: true });
    const r = e.route('c');
    expect(r.points).toEqual(pinned);
  });

  it('routeAll skips connectors with missing endpoints without throwing', () => {
    const e = new DiagramEngineImpl();
    e.addShape(process('a'));
    e.connectors.add({ id: 'dangling', from: { shape: 'a' }, to: { shape: 'ghost' }, kind: 'straight' });
    expect(() => e.routeAll()).not.toThrow();
  });
});

describe('auto-layout (mode-aware)', () => {
  it('applies orthogonal positions and emits a layout event', () => {
    const e = new DiagramEngineImpl({ mode: 'flowchart' });
    e.addShape(process('root', 999, 999));
    e.addShape(process('a', 999, 999));
    e.addConnector({ id: 'e', from: { shape: 'root' }, to: { shape: 'a' }, kind: 'orthogonal' });
    const onLayout = vi.fn();
    e.events.on('layout', onLayout);
    const res = e.autoLayout('orthogonal');
    expect(onLayout).toHaveBeenCalled();
    expect(e.getShape('a')!.y).toBeGreaterThan(e.getShape('root')!.y);
    expect(res.positions.size).toBe(2);
  });

  it('throws for an unregistered layout kind', () => {
    const e = new DiagramEngineImpl();
    expect(() => e.autoLayout('nope')).toThrow();
  });
});

describe('hit-test + bounds', () => {
  it('hitTest delegates to the model graph', () => {
    const e = new DiagramEngineImpl();
    e.addShape(process('a', 0, 0));
    expect(e.hitTest({ x: 10, y: 10 }).id).toBe('a');
    expect(e.hitTest({ x: 9999, y: 9999 }).kind).toBe('none');
  });

  it('getBounds unions shapes', () => {
    const e = new DiagramEngineImpl();
    e.addShape(process('a', 0, 0));
    e.addShape(process('b', 500, 300));
    const b = e.getBounds();
    expect(b.width).toBeGreaterThanOrEqual(500);
  });
});

describe('serialization', () => {
  it('toJSON / fromJSON round-trips the model graph', () => {
    const e = new DiagramEngineImpl({ mode: 'pert' });
    e.addShape(process('a'));
    e.addShape(process('b', 300));
    e.addConnector({ id: 'c', from: { shape: 'a' }, to: { shape: 'b' }, kind: 'orthogonal' });
    const doc = e.toJSON();

    const e2 = new DiagramEngineImpl();
    const onLoad = vi.fn();
    e2.events.on('load', onLoad);
    e2.fromJSON(doc);
    expect(e2.mode).toBe('pert');
    expect(e2.shapes.count).toBe(2);
    expect(e2.connectors.count).toBe(1);
    expect(onLoad).toHaveBeenCalled();
  });
});

describe('extension registries', () => {
  it('registerRouter overrides a kind', () => {
    const e = new DiagramEngineImpl();
    e.addShape(process('a'));
    e.addShape(process('b', 300));
    const custom = {
      kind: 'straight' as const,
      route: () => ({ points: [{ x: 7, y: 7 }, { x: 8, y: 8 }], startPoint: { x: 7, y: 7 }, endPoint: { x: 8, y: 8 } }),
    };
    e.registerRouter(custom);
    e.addConnector({ id: 'c', from: { shape: 'a' }, to: { shape: 'b' }, kind: 'straight' });
    expect(e.route('c').points[0]).toEqual({ x: 7, y: 7 });
  });

  it('registerShape stores a custom shape definition', () => {
    const e = new DiagramEngineImpl();
    e.registerShape({ key: 'gear', defaultSize: { width: 50, height: 50 } });
    expect(e.getShapeDef('gear')?.defaultSize.width).toBe(50);
  });
});

describe('teardown', () => {
  it('destroy is idempotent and clears listeners', () => {
    const e = new DiagramEngineImpl();
    e.addShape(process('a'));
    e.destroy();
    expect(e.isDestroyed).toBe(true);
    expect(() => e.destroy()).not.toThrow();
    expect(e.events.listenerCount()).toBe(0);
  });
});
