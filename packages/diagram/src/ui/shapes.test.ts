import { describe, it, expect } from 'vitest';
import {
  shapeGeometry,
  connectorPath,
  arrowMarker,
  defaultShapeSize,
} from './shapes.js';
import type { ShapeType } from '../contract.js';

describe('shapes', () => {
  it('produces rect geometry for rect/process', () => {
    const g = shapeGeometry('rect', 0, 0, 100, 50);
    expect(g.tag).toBe('rect');
  });

  it('produces ellipse geometry for circle', () => {
    const g = shapeGeometry('circle', 0, 0, 80, 80);
    expect(g.tag).toBe('ellipse');
  });

  it('produces polygon geometry for decision/diamond', () => {
    const g = shapeGeometry('decision', 0, 0, 100, 60);
    expect(g.tag).toBe('polygon');
    if (g.tag === 'polygon') expect(g.points.split(' ').length).toBe(4);
  });

  it('produces path geometry for database/document/cloud', () => {
    for (const t of ['database', 'document', 'cloud'] as ShapeType[]) {
      expect(shapeGeometry(t, 0, 0, 100, 60).tag).toBe('path');
    }
  });

  it('covers a wide range of shape types without throwing', () => {
    const types: ShapeType[] = [
      'rect', 'rounded-rect', 'ellipse', 'circle', 'square', 'triangle',
      'diamond', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon',
      'octagon', 'star', 'cross', 'arrow-shape', 'callout', 'cloud',
      'process', 'predefined-process', 'decision', 'terminator', 'start',
      'end', 'delay', 'preparation', 'manual-input', 'manual-operation',
      'data', 'document', 'multi-document', 'database', 'storage',
      'display', 'card', 'off-page', 'org-node', 'mind-node', 'text',
    ];
    for (const t of types) {
      const g = shapeGeometry(t, 5, 5, 120, 64);
      expect(['rect', 'ellipse', 'polygon', 'path']).toContain(g.tag);
    }
  });

  it('builds straight and curved connector paths', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ];
    expect(connectorPath(pts, 'straight')).toContain('M 0 0 L 100 50');
    expect(connectorPath(pts, 'curved')).toContain('C');
    expect(connectorPath([{ x: 0, y: 0 }], 'straight')).toBe('');
  });

  it('emits arrowheads (and none for none)', () => {
    expect(arrowMarker('none', { x: 0, y: 0 }, { x: -1, y: 0 })).toBe('');
    expect(arrowMarker('arrow', { x: 10, y: 0 }, { x: 0, y: 0 })).toContain('polygon');
    expect(arrowMarker('circle', { x: 10, y: 0 }, { x: 0, y: 0 })).toContain('circle');
    expect(arrowMarker('diamond', { x: 10, y: 0 }, { x: 0, y: 0 })).toContain('polygon');
  });

  it('returns sensible default sizes', () => {
    expect(defaultShapeSize('circle')).toEqual({ width: 80, height: 80 });
    expect(defaultShapeSize('decision').width).toBe(120);
    expect(defaultShapeSize('text').height).toBe(32);
  });
});
