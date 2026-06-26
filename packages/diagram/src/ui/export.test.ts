import { describe, it, expect } from 'vitest';
import { documentToJson, pngDataUrlToPdf } from './export.js';
import type { DiagramDocument } from '../contract.js';

const doc: DiagramDocument = {
  version: 1,
  mode: 'flowchart',
  shapes: [{ id: 'a', type: 'rect', x: 0, y: 0, w: 10, h: 10 }],
  connectors: [],
};

describe('export', () => {
  it('serializes a document to pretty JSON that round-trips', () => {
    const json = documentToJson(doc);
    expect(json).toContain('"version": 1');
    const parsed = JSON.parse(json) as DiagramDocument;
    expect(parsed.shapes[0].id).toBe('a');
  });

  it('wraps a PNG data URL in a PDF blob with a header', async () => {
    // A 1x1 transparent PNG.
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const blob = pngDataUrlToPdf(png, 100, 80);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
    // jsdom's Blob lacks `.text()`/`.arrayBuffer()`; read bytes when available.
    if (typeof blob.arrayBuffer === 'function') {
      const buf = await blob.arrayBuffer();
      const text = new TextDecoder().decode(buf);
      expect(text.startsWith('%PDF-1.4')).toBe(true);
      expect(text).toContain('/MediaBox [0 0 100 80]');
      expect(text).toContain('%%EOF');
    }
  });
});
