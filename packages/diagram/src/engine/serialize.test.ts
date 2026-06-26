import { describe, it, expect } from 'vitest';
import { toDocument, fromDocument, deepClonePlain, DOCUMENT_VERSION } from './serialize.js';
import type { ShapeModel, ConnectorModel, SwimlaneModel } from '../contract.js';

const shapes: ShapeModel[] = [
  { id: 's1', type: 'process', x: 0, y: 0, w: 120, h: 64, text: 'A' },
  { id: 's2', type: 'decision', x: 200, y: 0, w: 120, h: 80, text: 'B', data: { tag: 1 } },
];
const connectors: ConnectorModel[] = [
  { id: 'c1', from: { shape: 's1' }, to: { shape: 's2', port: 'top' }, kind: 'orthogonal', label: 'Yes' },
];
const swimlanes: SwimlaneModel[] = [
  { id: 'l1', orientation: 'horizontal', x: 0, y: 0, w: 400, h: 200, title: 'Lane' },
];

describe('serialize / toDocument', () => {
  it('produces a JSON-stringify-safe document with version + mode', () => {
    const doc = toDocument({ mode: 'flowchart', shapes, connectors, swimlanes });
    expect(doc.version).toBe(DOCUMENT_VERSION);
    expect(doc.mode).toBe('flowchart');
    expect(() => JSON.stringify(doc)).not.toThrow();
    expect(doc.shapes.length).toBe(2);
    expect(doc.connectors.length).toBe(1);
    expect(doc.swimlanes!.length).toBe(1);
  });

  it('deep-clones — mutating the snapshot does not touch the source', () => {
    const doc = toDocument({ mode: 'flowchart', shapes, connectors, swimlanes });
    (doc.shapes[1]!.data as { tag: number }).tag = 99;
    expect((shapes[1]!.data as { tag: number }).tag).toBe(1);
  });

  it('omits empty swimlanes and meta', () => {
    const doc = toDocument({ mode: 'mindmap', shapes, connectors, swimlanes: [] });
    expect(doc.swimlanes).toBeUndefined();
    expect(doc.meta).toBeUndefined();
  });
});

describe('round-trip', () => {
  it('survives toDocument → JSON → fromDocument unchanged', () => {
    const doc = toDocument({ mode: 'pert', shapes, connectors, swimlanes, meta: { zoom: 1.5 } });
    const roundtrip = fromDocument(JSON.parse(JSON.stringify(doc)));
    expect(roundtrip.mode).toBe('pert');
    expect(roundtrip.shapes.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(roundtrip.connectors[0]!.label).toBe('Yes');
    expect(roundtrip.connectors[0]!.to.port).toBe('top');
    expect(roundtrip.swimlanes[0]!.title).toBe('Lane');
    expect(roundtrip.meta).toEqual({ zoom: 1.5 });
  });
});

describe('fromDocument normalization', () => {
  it('fills defaults for a null / empty document', () => {
    const n = fromDocument(null);
    expect(n.mode).toBe('flowchart');
    expect(n.shapes).toEqual([]);
    expect(n.connectors).toEqual([]);
    expect(n.swimlanes).toEqual([]);
  });

  it('coerces invalid mode and connector kind to defaults', () => {
    const n = fromDocument({
      mode: 'bogus' as never,
      shapes: [{ id: 'x', type: 'rect', x: 0, y: 0, w: 0, h: 0 }],
      connectors: [{ id: 'c', from: { shape: 'x' }, to: { shape: 'x' }, kind: 'nope' as never }],
    });
    expect(n.mode).toBe('flowchart');
    // self-loop x→x is kept (both endpoints exist) but its kind is coerced.
    expect(n.connectors.length).toBe(1);
    expect(n.connectors[0]!.kind).toBe('orthogonal');
  });

  it('drops connectors with missing endpoints', () => {
    const n = fromDocument({
      mode: 'flowchart',
      shapes: [{ id: 'a', type: 'rect', x: 0, y: 0, w: 10, h: 10 }],
      connectors: [{ id: 'c', from: { shape: 'a' }, to: { shape: 'ghost' }, kind: 'straight' }],
    });
    expect(n.connectors.length).toBe(0);
  });

  it('fills missing geometry from the built-in default size', () => {
    const n = fromDocument({
      mode: 'flowchart',
      shapes: [{ id: 'p', type: 'process' } as never],
      connectors: [],
    });
    expect(n.shapes[0]!.w).toBeGreaterThan(0);
    expect(n.shapes[0]!.h).toBeGreaterThan(0);
  });

  it('skips malformed records but keeps valid ones', () => {
    const n = fromDocument({
      mode: 'flowchart',
      shapes: [null as never, { id: 'ok', type: 'rect', x: 1, y: 2, w: 3, h: 4 }],
      connectors: [],
    });
    expect(n.shapes.map((s) => s.id)).toEqual(['ok']);
  });
});

describe('deepClonePlain', () => {
  it('clones nested objects and arrays', () => {
    const src = { a: [1, { b: 2 }], c: 'x' };
    const out = deepClonePlain(src);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
    expect(out.a).not.toBe(src.a);
  });
  it('passes primitives through', () => {
    expect(deepClonePlain(5)).toBe(5);
    expect(deepClonePlain(null)).toBe(null);
  });
});
