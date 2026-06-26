/**
 * Visual / interaction smoke test for the {@link Diagram} Widget, run in the
 * Vitest browser (Chromium) provider so real layout, pointer capture, focus,
 * and SVG geometry are exercised end-to-end.
 *
 * Covers the keystone interactions a host depends on:
 *   - drag a shape with the pointer and see its model position change;
 *   - draw a connector between two shapes by dragging from a port;
 *   - auto-layout a tree and assert the rendered shapes do not overlap;
 *   - keyboard-only: Tab to a shape, arrow-navigate, Enter to connect;
 *   - the inline text editor mounts at the canvas (body) level and is not
 *     clipped by the SVG / canvas overflow.
 *
 * Companion to `diagram.a11y.test.ts` (axe coverage). Together they satisfy the
 * gate's "axe + visual/interaction smoke" requirement for the public component.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Diagram } from './diagram.js';
import type { ShapeModel } from '../contract.js';

let host: HTMLElement | undefined;
let widget: Diagram | undefined;

afterEach(() => {
  widget?.destroy();
  widget = undefined;
  host?.remove();
  host = undefined;
});

function mount(): HTMLElement {
  const h = document.createElement('div');
  h.style.width = '900px';
  h.style.height = '600px';
  h.style.position = 'relative';
  document.body.appendChild(h);
  host = h;
  return h;
}

function shape(id: string, x: number, y: number, text = id): ShapeModel {
  return {
    id,
    type: 'process',
    x,
    y,
    w: 120,
    h: 64,
    text,
    ports: [
      { id: 'top', side: 'top', offset: { x: 0.5, y: 0 }, in: true, out: true },
      { id: 'right', side: 'right', offset: { x: 1, y: 0.5 }, in: true, out: true },
      { id: 'bottom', side: 'bottom', offset: { x: 0.5, y: 1 }, in: true, out: true },
      { id: 'left', side: 'left', offset: { x: 0, y: 0.5 }, in: true, out: true },
    ],
  };
}

/** Center client point of a rendered shape `<g>`'s body, in CSS pixels. */
function bodyCenter(svg: SVGSVGElement, id: string): { x: number; y: number } {
  const g = svg.querySelector(`g[data-shape="${id}"] .jects-diagram__shape-body`)!;
  const r = (g as SVGGraphicsElement).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function pointer(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, {
    pointerId: 1,
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
    button: 0,
  });
}

describe('Diagram interaction smoke (browser)', () => {
  it('drags a shape and updates its model position', async () => {
    const h = mount();
    const d = new Diagram(h, { shapes: [shape('a', 100, 100), shape('b', 400, 300)] });
    widget = d;
    d.paint();
    await Promise.resolve();

    const svg = h.querySelector('svg.jects-diagram__svg') as SVGSVGElement;
    // getShape returns the LIVE record (mutated in place), so snapshot coords.
    const beforeX = d.engine.getShape('a')!.x;
    const beforeY = d.engine.getShape('a')!.y;
    const c = bodyCenter(svg, 'a');

    // pointerdown on the shape body, then drag right+down, then up.
    svg.dispatchEvent(pointer('pointerdown', c.x, c.y));
    window.dispatchEvent(pointer('pointermove', c.x + 80, c.y + 40));
    window.dispatchEvent(pointer('pointerup', c.x + 80, c.y + 40));

    const after = d.engine.getShape('a')!;
    expect(after.x).toBeGreaterThan(beforeX + 40);
    expect(after.y).toBeGreaterThan(beforeY + 20);
  });

  it('draws a connector by dragging from a port to another shape', async () => {
    const h = mount();
    const d = new Diagram(h, { shapes: [shape('a', 100, 100), shape('b', 400, 120)] });
    widget = d;
    // Select 'a' so its ports become visible/interactive.
    d.select('a');
    d.paint();
    await Promise.resolve();

    const svg = h.querySelector('svg.jects-diagram__svg') as SVGSVGElement;
    const port = svg.querySelector(
      'g[data-shape="a"] circle[data-port="right"]',
    ) as SVGCircleElement;
    expect(port).toBeTruthy();
    const pr = port.getBoundingClientRect();
    const portCenter = { x: pr.left + pr.width / 2, y: pr.top + pr.height / 2 };
    const target = bodyCenter(svg, 'b');

    const before = d.engine.connectors.count;
    // Dispatch on the port element so `e.target` resolves to the port (synthetic
    // events don't hit-test — target is the element dispatched on).
    port.dispatchEvent(pointer('pointerdown', portCenter.x, portCenter.y));
    window.dispatchEvent(pointer('pointermove', target.x, target.y));
    window.dispatchEvent(pointer('pointerup', target.x, target.y));

    expect(d.engine.connectors.count).toBe(before + 1);
    const conn = d.engine.connectors.toArray().at(-1)!;
    expect(conn.from.shape).toBe('a');
    expect(conn.to.shape).toBe('b');
  });

  it('auto-layout renders a tree without overlapping shapes', async () => {
    const h = mount();
    // root → a,b ; a → a1,a2 ; b → b1,b2 (3 levels — exercises mod propagation)
    const d = new Diagram(h, {
      shapes: [
        shape('root', 0, 0),
        shape('a', 0, 0),
        shape('b', 0, 0),
        shape('a1', 0, 0),
        shape('a2', 0, 0),
        shape('b1', 0, 0),
        shape('b2', 0, 0),
      ],
      connectors: [
        { id: 'e1', from: { shape: 'root' }, to: { shape: 'a' }, kind: 'orthogonal' },
        { id: 'e2', from: { shape: 'root' }, to: { shape: 'b' }, kind: 'orthogonal' },
        { id: 'e3', from: { shape: 'a' }, to: { shape: 'a1' }, kind: 'orthogonal' },
        { id: 'e4', from: { shape: 'a' }, to: { shape: 'a2' }, kind: 'orthogonal' },
        { id: 'e5', from: { shape: 'b' }, to: { shape: 'b1' }, kind: 'orthogonal' },
        { id: 'e6', from: { shape: 'b' }, to: { shape: 'b2' }, kind: 'orthogonal' },
      ],
    });
    widget = d;
    d.autoLayout('orthogonal', { direction: 'down', nodeSpacing: 40 });
    d.paint();
    await Promise.resolve();

    // Assert no two shape bodies overlap in the rendered model.
    const ids = ['root', 'a', 'b', 'a1', 'a2', 'b1', 'b2'];
    const rects = ids.map((id) => d.engine.getShape(id)!);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const r = rects[i]!;
        const s = rects[j]!;
        const overlap =
          r.x < s.x + s.w && r.x + r.w > s.x && r.y < s.y + s.h && r.y + r.h > s.y;
        expect(overlap, `${ids[i]} overlaps ${ids[j]}`).toBe(false);
      }
    }
  });

  it('keyboard: Tab to a shape, arrow-navigate, Enter to connect — pointer-free', async () => {
    const h = mount();
    const d = new Diagram(h, { shapes: [shape('a', 100, 100), shape('b', 400, 100)] });
    widget = d;
    d.paint();
    await Promise.resolve();

    const svg = h.querySelector('svg.jects-diagram__svg') as SVGSVGElement;
    const canvas = h.querySelector('.jects-diagram__canvas') as HTMLElement;

    // Exactly one shape is in the tab order (roving tabindex).
    const tabbable = svg.querySelectorAll('g[data-shape][tabindex="0"]');
    expect(tabbable.length).toBe(1);

    // Focus the canvas, ArrowRight moves the focus cursor onto a shape.
    canvas.focus();
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    await Promise.resolve();
    expect(d.getSelection().length).toBe(1);

    // Enter arms the connection source on the focused shape; ArrowRight to the
    // other shape; Enter completes the connector.
    const before = d.engine.connectors.count;
    const firstSel = d.getSelection()[0]!;
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', { key: firstSel === 'a' ? 'ArrowRight' : 'ArrowLeft', bubbles: true }),
    );
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();

    expect(d.engine.connectors.count).toBe(before + 1);
  });

  it('inline editor mounts at canvas level and is not clipped', async () => {
    const h = mount();
    const d = new Diagram(h, { shapes: [shape('a', 120, 120, 'Hello')] });
    widget = d;
    d.paint();
    await Promise.resolve();

    const svg = h.querySelector('svg.jects-diagram__svg') as SVGSVGElement;
    const canvas = h.querySelector('.jects-diagram__canvas') as HTMLElement;
    const c = bodyCenter(svg, 'a');

    // Double-click opens the inline editor.
    svg.dispatchEvent(
      new MouseEvent('dblclick', { clientX: c.x, clientY: c.y, bubbles: true }),
    );
    await Promise.resolve();

    const editor = canvas.querySelector(
      'textarea.jects-diagram__inline-editor',
    ) as HTMLTextAreaElement;
    expect(editor, 'inline editor exists').toBeTruthy();
    // Mounted inside the canvas (the positioned container), not detached.
    expect(editor.parentElement).toBe(canvas);

    const er = editor.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    // Has real size (rendered, not display:none) and overlaps the canvas
    // viewport — i.e. it is visible and not clipped away off-screen.
    expect(er.width).toBeGreaterThan(0);
    expect(er.height).toBeGreaterThan(0);
    expect(er.left).toBeLessThan(cr.right);
    expect(er.right).toBeGreaterThan(cr.left);
    expect(er.top).toBeLessThan(cr.bottom);
    expect(er.bottom).toBeGreaterThan(cr.top);

    // Editing then Enter commits the new text to the model.
    editor.value = 'Edited';
    editor.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    expect(d.engine.getShape('a')!.text).toBe('Edited');
  });
});
