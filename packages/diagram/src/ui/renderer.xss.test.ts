/**
 * XSS hardening suite for the Diagram untrusted-HTML surfaces
 * (docs/SECURITY.md surface #5):
 *   - node/edge label text MUST be escaped (rendered via `textContent`);
 *   - HTML (`foreignObject`) shape bodies MUST be routed through the shared
 *     `@jects/core` allow-list sanitizer.
 *
 * Each payload is injected into the untrusted field and we assert (a) a global
 * flag stays false — no `onerror`/`onload`/`alert` handler ever fires — and (b)
 * the rendered DOM carries no `<script>`, no `on*` handler attribute, and no
 * `javascript:`/`data:text/html` URL. Legitimate text/markup must survive.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderShape, renderConnector, type RenderState } from './renderer.js';
import type { ConnectorModel, DiagramEngine, ShapeModel } from '../contract.js';

declare global {
  // eslint-disable-next-line no-var
  var __xss: boolean;
}

const PAYLOADS: readonly string[] = [
  '<img src=x onerror="window.__xss=true">',
  '<script>window.__xss=true</script>',
  '<a href="javascript:window.__xss=true">click</a>',
  '<svg onload="window.__xss=true"></svg>',
  '"><iframe src="javascript:window.__xss=true"></iframe>',
  '<a href="data:text/html,<script>window.__xss=true</script>">x</a>',
  '<div style="background:url(javascript:window.__xss=true)">styled</div>',
];

function baseState(): RenderState {
  return {
    selection: new Set(),
    view: { zoom: 1, panX: 0, panY: 0 },
    grid: false,
    snap: 0,
    editable: true,
    marquee: null,
    snapLines: [],
    pendingConnector: null,
    dimmed: new Set(),
  };
}

const URL_ATTRS: readonly string[] = ['href', 'src', 'xlink:href'];

/**
 * Assert a rendered subtree has no LIVE injection vectors. This is a
 * DOM-structural check, not a string scan: payloads escaped into inert text
 * nodes (e.g. a label `&lt;svg onload=...&gt;`) are safe even though the raw
 * substring survives in the serialized markup. What matters is that no parsed
 * element carries an executable construct.
 */
function assertClean(root: Element): void {
  // No live script/iframe (or other parsed dangerous) elements.
  expect(root.querySelector('script')).toBeNull();
  expect(root.querySelector('iframe')).toBeNull();
  expect(root.querySelector('object')).toBeNull();
  expect(root.querySelector('embed')).toBeNull();

  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      // No on* event-handler attribute survived parsing.
      expect(name.startsWith('on')).toBe(false);
      // No URL-bearing attribute resolves to an executable/unsafe scheme.
      if (URL_ATTRS.includes(name)) {
        const v = attr.value.replace(/\s+/g, '').toLowerCase();
        expect(v.startsWith('javascript:')).toBe(false);
        expect(v.startsWith('vbscript:')).toBe(false);
        expect(v.startsWith('data:text/html')).toBe(false);
      }
    }
  }
}

describe('Diagram XSS hardening', () => {
  let host: HTMLElement;

  beforeEach(() => {
    globalThis.__xss = false;
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    globalThis.__xss = false;
  });

  it.each(PAYLOADS)('sanitizes HTML (foreignObject) shape body: %s', (payload) => {
    const shape: ShapeModel = {
      id: 's1',
      type: 'rect',
      x: 0,
      y: 0,
      w: 200,
      h: 120,
      data: { html: payload },
    };
    const g = renderShape(shape, baseState());
    host.appendChild(g);
    // Let any (failed) async handlers attempt to fire.
    expect(globalThis.__xss).toBe(false);
    assertClean(g);
  });

  it.each(PAYLOADS)('escapes node label text: %s', (payload) => {
    const shape: ShapeModel = {
      id: 's2',
      type: 'rect',
      x: 0,
      y: 0,
      w: 200,
      h: 120,
      text: payload,
    };
    const g = renderShape(shape, baseState());
    host.appendChild(g);
    expect(globalThis.__xss).toBe(false);
    // Label lives in a <text> node as inert text content, not parsed markup.
    const textEl = g.querySelector('text.jects-diagram__shape-text');
    expect(textEl).toBeTruthy();
    expect(textEl?.textContent).toBe(payload);
    assertClean(g);
  });

  it.each(PAYLOADS)('escapes edge (connector) label text: %s', (payload) => {
    const connector: ConnectorModel = {
      id: 'c1',
      from: { shape: 'a' },
      to: { shape: 'b' },
      kind: 'straight',
      // Pinned points so the renderer reads the cached route and never touches
      // the engine (resolveRenderPoints returns early when >= 2 points exist).
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      label: payload,
    };
    // Engine is unused once cached points are present; a stub keeps the test pure.
    const engine = {} as DiagramEngine;
    const g = renderConnector(connector, engine, baseState());
    host.appendChild(g);
    expect(globalThis.__xss).toBe(false);
    const labelEl = g.querySelector('text');
    expect(labelEl?.textContent).toBe(payload);
    assertClean(g);
  });

  it('preserves legitimate formatting in HTML shape bodies', () => {
    const shape: ShapeModel = {
      id: 's3',
      type: 'rect',
      x: 0,
      y: 0,
      w: 200,
      h: 120,
      data: { html: '<b>Bold</b> and <a href="https://example.com">link</a>' },
    };
    const g = renderShape(shape, baseState());
    host.appendChild(g);
    const body = g.querySelector('.jects-diagram__html-body');
    expect(body?.querySelector('b')?.textContent).toBe('Bold');
    const a = body?.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com');
    expect(globalThis.__xss).toBe(false);
  });

  it('strips onerror but keeps the <img> in HTML shape bodies', () => {
    const shape: ShapeModel = {
      id: 's4',
      type: 'rect',
      x: 0,
      y: 0,
      w: 200,
      h: 120,
      data: { html: '<img src="x" onerror="window.__xss=true" alt="pic">' },
    };
    const g = renderShape(shape, baseState());
    host.appendChild(g);
    const img = g.querySelector('.jects-diagram__html-body img');
    expect(img).toBeTruthy();
    expect(img?.hasAttribute('onerror')).toBe(false);
    expect(img?.getAttribute('alt')).toBe('pic');
    expect(globalThis.__xss).toBe(false);
  });
});
