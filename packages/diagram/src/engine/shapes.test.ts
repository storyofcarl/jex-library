import { describe, it, expect } from 'vitest';
import {
  getBuiltinShape,
  builtinShapeTypes,
  resolvePorts,
  portPoint,
  shapeOutline,
  cardinalPorts,
} from './shapes.js';
import { BUILTIN_SHAPE_COUNT } from './engine.js';
import type { ShapeModel } from '../contract.js';

function shape(over: Partial<ShapeModel> = {}): ShapeModel {
  return { id: 's', type: 'rect', x: 0, y: 0, w: 100, h: 60, ...over };
}

describe('shape catalog', () => {
  it('ships 30+ built-in shape types', () => {
    expect(BUILTIN_SHAPE_COUNT).toBeGreaterThanOrEqual(30);
    expect(builtinShapeTypes().length).toBe(BUILTIN_SHAPE_COUNT);
  });

  it('every built-in type produces a non-empty SVG outline path', () => {
    for (const t of builtinShapeTypes()) {
      const def = getBuiltinShape(t)!;
      const path = def.outline({ width: 120, height: 80 });
      expect(typeof path).toBe('string');
      expect(path.length).toBeGreaterThan(0);
      expect(path.trim().startsWith('M')).toBe(true);
    }
  });

  it('has sensible default sizes and styles using token names only', () => {
    for (const t of builtinShapeTypes()) {
      const def = getBuiltinShape(t)!;
      expect(def.defaultSize.width).toBeGreaterThan(0);
      expect(def.defaultSize.height).toBeGreaterThan(0);
      // style values are token names (strings) — never hardcoded hex
      const fill = def.defaultStyle.fill;
      if (typeof fill === 'string') expect(fill).not.toMatch(/^#|rgb|hsl/);
    }
  });

  it('decision shape exposes labelled Yes/No branch ports', () => {
    const def = getBuiltinShape('decision')!;
    const labels = def.defaultPorts.map((p) => p.label).filter(Boolean);
    expect(labels).toContain('Yes');
    expect(labels).toContain('No');
  });

  it('resolvePorts prefers explicit ports, else catalog defaults', () => {
    const custom = [{ id: 'p1', side: 'top' as const, offset: { x: 0.5, y: 0 } }];
    expect(resolvePorts(shape({ ports: custom }))).toBe(custom);
    expect(resolvePorts(shape({ type: 'rect' })).length).toBe(4);
  });

  it('portPoint maps normalized offset to model coordinates', () => {
    const s = shape({ x: 10, y: 20, w: 100, h: 60 });
    const p = portPoint(s, { id: 'r', side: 'right', offset: { x: 1, y: 0.5 } });
    expect(p).toEqual({ x: 110, y: 50 });
  });

  it('cardinalPorts returns four in/out perimeter ports', () => {
    const ports = cardinalPorts();
    expect(ports.map((p) => p.id).sort()).toEqual(['bottom', 'left', 'right', 'top']);
    expect(ports.every((p) => p.in && p.out)).toBe(true);
  });

  it('shapeOutline falls back to a rect for unknown/custom types', () => {
    const path = shapeOutline(shape({ type: 'custom' }));
    expect(path.startsWith('M')).toBe(true);
  });
});
