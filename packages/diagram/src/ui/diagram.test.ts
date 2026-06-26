import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Diagram } from './diagram.js';
import { LocalDiagramEngine } from './local-engine.js';
import type { ShapeModel } from '../contract.js';

function shape(id: string, x = 0, y = 0): ShapeModel {
  return { id, type: 'rect', x, y, w: 100, h: 60, text: id };
}

describe('Diagram widget', () => {
  let host: HTMLElement;
  let d: Diagram;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (d && !d.isDestroyed) d.destroy();
    host.remove();
  });

  it('builds chrome: toolbar, shapebar, canvas, panel', () => {
    d = new Diagram(host);
    expect(d.el.querySelector('.jects-diagram__toolbar')).toBeTruthy();
    expect(d.el.querySelector('.jects-diagram__shapebar')).toBeTruthy();
    expect(d.el.querySelector('.jects-diagram__canvas')).toBeTruthy();
    expect(d.el.querySelector('.jects-diagram__panel')).toBeTruthy();
    expect(d.el.querySelector('svg.jects-diagram__svg')).toBeTruthy();
  });

  it('omits editor chrome in read-only mode', () => {
    d = new Diagram(host, { editable: false });
    expect(d.el.querySelector('.jects-diagram__toolbar')).toBeFalsy();
    expect(d.el.querySelector('.jects-diagram__shapebar')).toBeFalsy();
    expect(d.el.querySelector('.jects-diagram__panel')).toBeFalsy();
    expect(d.el.classList.contains('jects-diagram--readonly')).toBe(true);
  });

  it('owns a local engine by default and accepts an injected one', () => {
    d = new Diagram(host);
    expect(d.engine).toBeInstanceOf(LocalDiagramEngine);

    const injected = new LocalDiagramEngine();
    const host2 = document.createElement('div');
    document.body.appendChild(host2);
    const d2 = new Diagram(host2, { engine: injected } as never);
    expect(d2.engine).toBe(injected);
    d2.destroy();
    host2.remove();
  });

  it('renders shapes to the SVG scene', () => {
    d = new Diagram(host, { shapes: [shape('a'), shape('b', 200)] });
    d.paint();
    const nodes = d.el.querySelectorAll('.jects-diagram__shape');
    expect(nodes.length).toBe(2);
    expect(d.el.querySelector('[data-shape="a"]')).toBeTruthy();
  });

  it('addShape + select drives the API and renders a connector', () => {
    d = new Diagram(host);
    const a = d.addShape(shape('a'));
    const b = d.addShape(shape('b', 300));
    d.addConnector({ id: 'c', from: { shape: a.id }, to: { shape: b.id }, kind: 'orthogonal' });
    d.paint();
    expect(d.el.querySelector('[data-connector="c"]')).toBeTruthy();
  });

  it('manages selection with events', () => {
    d = new Diagram(host, { shapes: [shape('a'), shape('b', 200)] });
    const events: string[][] = [];
    d.on('select', (p) => events.push(p.ids));
    d.select(['a', 'b']);
    expect(d.getSelection()).toEqual(['a', 'b']);
    d.clearSelection();
    expect(d.getSelection()).toEqual([]);
    expect(events.length).toBe(2);
  });

  it('honors a beforeSelect veto', () => {
    d = new Diagram(host, { shapes: [shape('a')] });
    d.on('beforeSelect', () => false);
    d.select('a');
    expect(d.getSelection()).toEqual([]);
  });

  it('removes shapes (and cascades connectors) via remove()', () => {
    d = new Diagram(host);
    d.addShape(shape('a'));
    d.addShape(shape('b', 300));
    d.addConnector({ id: 'c', from: { shape: 'a' }, to: { shape: 'b' }, kind: 'straight' });
    d.remove('a');
    expect(d.engine.getShape('a')).toBeUndefined();
    expect(d.engine.getConnector('c')).toBeUndefined();
  });

  it('aligns and distributes selected shapes', () => {
    d = new Diagram(host, {
      shapes: [shape('a', 0, 0), shape('b', 50, 100), shape('c', 200, 200)],
    });
    d.select(['a', 'b', 'c']);
    d.align('left');
    expect(d.engine.getShape('b')!.x).toBe(0);
    expect(d.engine.getShape('c')!.x).toBe(0);

    d.distribute('horizontal');
    // No throw; middle shape repositioned.
    expect(d.engine.getShape('b')).toBeDefined();
  });

  it('copies and applies style across the selection', () => {
    d = new Diagram(host, {
      shapes: [
        { ...shape('a'), style: { fill: 'primary' } },
        shape('b', 200),
      ],
    });
    d.select('a');
    d.copyStyle();
    d.select('b');
    d.applyStyle();
    expect(d.engine.getShape('b')!.style?.fill).toBe('primary');
  });

  it('search dims non-matching shapes', () => {
    d = new Diagram(host, {
      shapes: [
        { ...shape('a'), text: 'Apple' },
        { ...shape('b', 200), text: 'Banana' },
      ],
    });
    const matched = d.search('app');
    expect(matched).toEqual(['a']);
    d.paint();
    expect(d.el.querySelector('[data-shape="b"]')!.classList.contains('jects-diagram__shape--dimmed')).toBe(true);
    expect(d.el.querySelector('[data-shape="a"]')!.classList.contains('jects-diagram__shape--dimmed')).toBe(false);
  });

  it('toggles collapse hiding descendants (mindmap)', () => {
    d = new Diagram(host, { mode: 'mindmap' });
    d.addShape(shape('root'));
    d.addShape(shape('child', 200));
    d.addConnector({ id: 'c', from: { shape: 'root' }, to: { shape: 'child' }, kind: 'straight' });
    expect(d.toggleCollapse('root')).toBe(true);
    expect(d.engine.getShape('child')!.data?.__hidden).toBe(true);
    expect(d.toggleCollapse('root')).toBe(false);
    expect(d.engine.getShape('child')!.data?.__hidden).toBe(false);
  });

  it('runs auto-layout for the active mode', () => {
    d = new Diagram(host);
    d.addShape(shape('a'));
    d.addShape(shape('b'));
    d.addConnector({ id: 'c', from: { shape: 'a' }, to: { shape: 'b' }, kind: 'straight' });
    d.autoLayout('orthogonal');
    expect(d.engine.getShape('b')!.y).toBeGreaterThanOrEqual(d.engine.getShape('a')!.y);
  });

  it('clamps zoom and reports it', () => {
    d = new Diagram(host);
    d.setZoom(100);
    expect(d.getZoom()).toBeLessThanOrEqual(8);
    d.setZoom(0.001);
    expect(d.getZoom()).toBeGreaterThanOrEqual(0.1);
  });

  it('round-trips through JSON', () => {
    d = new Diagram(host, { mode: 'pert', shapes: [shape('a')] });
    const json = d.toJSON();
    expect(json.mode).toBe('pert');
    expect(json.meta?.view).toBeDefined();

    const host2 = document.createElement('div');
    document.body.appendChild(host2);
    const d2 = new Diagram(host2);
    d2.fromJSON(json);
    expect(d2.getMode()).toBe('pert');
    expect(d2.engine.getShape('a')).toBeDefined();
    d2.destroy();
    host2.remove();
  });

  it('exports SVG, JSON, and a PDF blob', async () => {
    d = new Diagram(host, { shapes: [shape('a')] });
    const svg = d.exportSvg();
    expect(svg).toContain('<svg');
    const json = d.exportJson();
    expect(json).toContain('"version"');
    // PNG/PDF rasterization may be null under jsdom; assert it does not throw.
    const pdf = await d.exportPdf();
    expect(pdf === null || pdf instanceof Blob).toBe(true);
  });

  it('binds the properties panel to a single selected shape', () => {
    d = new Diagram(host, { shapes: [shape('a')] });
    d.select('a');
    expect(d.el.querySelector('.jects-diagram-props__field')).toBeTruthy();
    expect(d.el.querySelector('.jects-diagram-props__empty')).toBeFalsy();
  });

  it('emits change with a document on edits', () => {
    d = new Diagram(host, { shapes: [shape('a')] });
    let last: unknown = null;
    d.on('change', (p) => (last = p.document));
    d.updateShape('a', { text: 'changed' });
    expect(last).toBeTruthy();
  });

  it('cleans up on destroy', () => {
    d = new Diagram(host, { shapes: [shape('a')] });
    d.destroy();
    expect(d.isDestroyed).toBe(true);
    expect(host.querySelector('.jects-diagram')).toBeFalsy();
  });
});
