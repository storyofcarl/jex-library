import { describe, it, expect } from 'vitest';
import { hitTest } from './hit-test.js';
import type { ShapeModel, ConnectorModel, SwimlaneModel } from '../contract.js';

const shapes: ShapeModel[] = [
  { id: 's1', type: 'rect', x: 0, y: 0, w: 100, h: 60, z: 0 },
  { id: 's2', type: 'rect', x: 50, y: 20, w: 100, h: 60, z: 5 }, // overlaps s1, higher z
];
const connectors: ConnectorModel[] = [
  {
    id: 'c1',
    from: { shape: 's1' },
    to: { shape: 's2' },
    kind: 'straight',
    points: [
      { x: 200, y: 200 },
      { x: 400, y: 200 },
    ],
  },
];
const swimlanes: SwimlaneModel[] = [
  { id: 'l1', orientation: 'horizontal', x: -50, y: -50, w: 500, h: 500 },
];

const input = { shapes, connectors, swimlanes };

describe('hit-testing', () => {
  it('returns the topmost (higher z) shape under the point', () => {
    const r = hitTest(input, { x: 75, y: 40 });
    expect(r.kind).toBe('shape');
    expect(r.id).toBe('s2');
  });

  it('hits the lower shape where only it covers the point', () => {
    const r = hitTest(input, { x: 10, y: 10 });
    expect(r.kind).toBe('shape');
    expect(r.id).toBe('s1');
  });

  it('detects a port near a shape edge before the shape body', () => {
    // exactly on s1's right-center port (100,30) and s2's top port (100,20)
    const r = hitTest(input, { x: 100, y: 30 });
    expect(r.kind).toBe('port');
    expect(r.shape).toBeDefined();
    expect(r.port).toBeDefined();
  });

  it('hits a connector polyline within tolerance', () => {
    const r = hitTest(input, { x: 300, y: 202 }, 6);
    expect(r.kind).toBe('connector');
    expect(r.id).toBe('c1');
    expect(r.distance).toBeLessThanOrEqual(6);
  });

  it('falls through to the swimlane backdrop', () => {
    const r = hitTest(input, { x: -40, y: 300 });
    expect(r.kind).toBe('swimlane');
    expect(r.id).toBe('l1');
  });

  it('returns none when nothing is under the point', () => {
    const r = hitTest({ shapes: [], connectors: [], swimlanes: [] }, { x: 9999, y: 9999 });
    expect(r.kind).toBe('none');
    expect(r.id).toBeUndefined();
  });

  it('uses the routes map over stale model points when provided', () => {
    // A route well clear of every shape box (shapes span x:0..150, y:0..80).
    const routes = new Map([['c1', [{ x: 300, y: 300 }, { x: 300, y: 400 }]]]);
    // Without routes, the model points are at y≈200; a query at (300,350) misses
    // the connector and falls through to the swimlane backdrop.
    const r = hitTest(input, { x: 300, y: 350 }, 4);
    expect(r.kind).not.toBe('connector');
    // With the routes map, the same point lands on the rerouted connector.
    const r2 = hitTest({ ...input, routes }, { x: 300, y: 350 }, 4);
    expect(r2.kind).toBe('connector');
    expect(r2.id).toBe('c1');
  });
});
