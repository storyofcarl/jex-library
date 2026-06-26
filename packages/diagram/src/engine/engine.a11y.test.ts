/**
 * Accessibility smoke test for the diagram engine's rendered output contract.
 *
 * The engine is headless, but its model is meant to be rendered to SVG using
 * the token-pure classes in `engine.css`. This test builds a minimal,
 * accessible SVG from a real engine model (an `img`-role group with an
 * accessible name, titled shapes/connectors) and asserts axe-core finds no
 * serious/critical violations — locking in the a11y baseline the UI renderer
 * must honor.
 */
import { describe, it, afterEach } from 'vitest';
import { DiagramEngineImpl } from './engine.js';
import { shapeOutline } from './shapes.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import './engine.css';

const SVG_NS = 'http://www.w3.org/2000/svg';
let host: HTMLElement | undefined;

afterEach(() => {
  host?.remove();
  host = undefined;
});

/** Build a minimal accessible SVG view of the engine's current model. */
function renderSvg(engine: DiagramEngineImpl, label: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.classList.add('jects-diagram__canvas');
  const bounds = engine.getBounds();
  svg.setAttribute('width', String(Math.max(1, bounds.width + 40)));
  svg.setAttribute('height', String(Math.max(1, bounds.height + 40)));

  for (const c of engine.connectors.toArray()) {
    const pts = c.points ?? [];
    if (pts.length < 2) continue;
    const path = document.createElementNS(SVG_NS, 'polyline');
    path.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '));
    path.classList.add('jects-diagram__connector');
    svg.appendChild(path);
  }

  for (const s of engine.shapes.toArray()) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('transform', `translate(${s.x} ${s.y})`);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', shapeOutline(s));
    path.classList.add('jects-diagram__shape');
    g.appendChild(path);
    if (s.text) {
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', String(s.w / 2));
      text.setAttribute('y', String(s.h / 2));
      text.setAttribute('text-anchor', 'middle');
      text.classList.add('jects-diagram__shape-label');
      text.textContent = s.text;
      g.appendChild(text);
    }
    svg.appendChild(g);
  }
  return svg;
}

describe('diagram engine rendered output a11y', () => {
  it('a token-themed flowchart SVG has no serious/critical violations', async () => {
    const engine = new DiagramEngineImpl({ mode: 'flowchart' });
    engine.addShape({ id: 'start', type: 'start', x: 0, y: 0, w: 120, h: 56, text: 'Start' });
    engine.addShape({ id: 'check', type: 'decision', x: 0, y: 0, w: 120, h: 80, text: 'OK?' });
    engine.addShape({ id: 'done', type: 'end', x: 0, y: 0, w: 120, h: 56, text: 'Done' });
    engine.addConnector({ id: 'e1', from: { shape: 'start' }, to: { shape: 'check' }, kind: 'orthogonal' });
    engine.addConnector({ id: 'e2', from: { shape: 'check' }, to: { shape: 'done' }, kind: 'orthogonal', label: 'Yes' });
    engine.autoLayout('orthogonal');

    host = document.createElement('div');
    host.appendChild(renderSvg(engine, 'Process flowchart: Start to Done'));
    document.body.appendChild(host);

    await expectNoA11yViolations(host);
    engine.destroy();
  });
});
