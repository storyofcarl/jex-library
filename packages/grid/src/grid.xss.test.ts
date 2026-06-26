/**
 * XSS hardening suite for @jects/grid (docs/SECURITY.md surfaces #1 + #2).
 *
 * Surface #1 — Grid cell text + column headers: untrusted row values and header
 * labels must be rendered as text (escaped), never parsed as HTML.
 * Surface #2 — Custom cell renderers: a renderer returning a string has that
 * string set as `textContent` (escaped); the documented `escapeHtml`/`escape`
 * and `sanitizeHtml` helpers let authors who emit markup neutralize untrusted
 * row data.
 *
 * The suite injects the standard payloads into every untrusted field and asserts
 * (a) a global flag stays false (no handler/alert fires), (b) the rendered DOM
 * contains no `<script>`, no `on*` handler attribute, and no `javascript:`/
 * `data:text/html` URL, and (c) legitimate text still renders.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GridEngine } from './engine/engine.js';
import { DomRenderer } from './engine/dom-renderer.js';
import { DefaultSelectionModel } from './engine/selection.js';
import type { ColumnDef, GridApi, CellRenderContext } from './contract.js';
import { escape, escapeHtml, sanitizeHtml } from '@jects/core';

interface Row {
  id: number;
  name: string;
}

/** The standard XSS payload battery (docs/SECURITY.md §4). */
const PAYLOADS: readonly string[] = [
  '<img src=x onerror="window.__xss=true">',
  '<script>window.__xss=true</script>',
  '<a href="javascript:window.__xss=true">click</a>',
  '<svg onload="window.__xss=true"></svg>',
  '"><iframe src="javascript:window.__xss=true"></iframe>',
  '<a href="data:text/html,<script>window.__xss=true</script>">x</a>',
  '<div style="background:url(javascript:window.__xss=true)">x</div>',
];

declare global {
  // eslint-disable-next-line no-var
  var __xss: boolean | undefined;
}

/** Minimal GridApi stub sufficient for the renderer's reads. */
function stubApi(engine: GridEngine<Row>): GridApi<Row> {
  const selection = new DefaultSelectionModel<Row>('multi', {
    getRowById: (id) => engine.getRowById(id),
    onChange: () => {},
  });
  return {
    selection,
    columns: engine.columns.map((c) => c.def),
  } as unknown as GridApi<Row>;
}

/**
 * Assert an element subtree carries no executable injection: no `<script>` or
 * `<iframe>`, no `on*` handler attribute, and no `javascript:`/`data:text/html`
 * URL. (A sanitized `<img src=x>` with its `onerror` stripped is *safe* and
 * therefore allowed — the escaped-text tests below separately assert that
 * untrusted text produces no element at all.)
 */
function assertDomClean(el: HTMLElement): void {
  expect(el.querySelector('script')).toBeNull();
  expect(el.querySelector('iframe')).toBeNull();
  // No event-handler attributes anywhere in the subtree.
  for (const node of el.querySelectorAll('*')) {
    for (const attr of Array.from(node.attributes)) {
      expect(attr.name.startsWith('on')).toBe(false);
      if (attr.name === 'href' || attr.name === 'src') {
        expect(/^\s*javascript:/i.test(attr.value)).toBe(false);
        expect(/^\s*data:text\/html/i.test(attr.value)).toBe(false);
      }
    }
  }
}

let host: HTMLElement;
beforeEach(() => {
  globalThis.__xss = false;
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  globalThis.__xss = undefined;
});

describe('@jects/grid XSS: cell text (surface #1)', () => {
  it('renders untrusted row values as escaped text, never as HTML', () => {
    const cols: ColumnDef<Row>[] = [{ field: 'name', width: 200 }];
    const data: Row[] = [
      ...PAYLOADS.map((p, i) => ({ id: i, name: p })),
      { id: 999, name: 'Legit Name' },
    ];
    const engine = new GridEngine<Row>({ data, columns: cols, rowHeight: 24 });
    engine.setViewportSize(400, 600);
    const r = new DomRenderer<Row>(engine);
    r.mount(host, stubApi(engine));
    engine.setScroll(0, 0);
    r.renderViewport(engine.computeViewportWindow());

    assertDomClean(host);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('svg')).toBeNull();
    expect(globalThis.__xss).toBe(false);

    // The malicious markup survives verbatim as text content (escaped, not parsed).
    const cellText = Array.from(host.querySelectorAll('.jects-grid__cell')).map(
      (c) => c.textContent ?? '',
    );
    expect(cellText.some((t) => t.includes('<img src=x onerror='))).toBe(true);
    expect(cellText.some((t) => t === 'Legit Name')).toBe(true);

    r.destroy();
  });
});

describe('@jects/grid XSS: column headers (surface #1)', () => {
  it('renders untrusted header labels as escaped text', () => {
    const cols: ColumnDef<Row>[] = PAYLOADS.map((p, i) => ({
      field: 'name',
      id: `c${i}`,
      header: p,
      width: 120,
    }));
    const engine = new GridEngine<Row>({
      data: [{ id: 0, name: 'x' }],
      columns: cols,
      rowHeight: 24,
    });
    engine.setViewportSize(400, 200);
    const r = new DomRenderer<Row>(engine);
    r.mount(host, stubApi(engine)); // mount() paints the header

    const header = host.querySelector('.jects-grid__header') as HTMLElement;
    assertDomClean(header);
    expect(header.querySelector('img')).toBeNull();
    expect(header.querySelector('svg')).toBeNull();
    expect(globalThis.__xss).toBe(false);

    const headerText = Array.from(
      host.querySelectorAll('.jects-grid__header-cell'),
    ).map((c) => c.textContent ?? '');
    expect(headerText.some((t) => t.includes('<script>'))).toBe(true);

    r.destroy();
  });
});

describe('@jects/grid XSS: custom cell renderer (surface #2)', () => {
  it('escapes a renderer that returns an HTML string (string → textContent)', () => {
    const renderer = (ctx: CellRenderContext<Row>): string =>
      `<b>${ctx.value as string}</b>`; // author forgot to escape — must NOT execute
    const cols: ColumnDef<Row>[] = [
      { field: 'name', type: 'template', renderer, width: 200 },
    ];
    const engine = new GridEngine<Row>({
      data: [{ id: 0, name: '<img src=x onerror="window.__xss=true">' }],
      columns: cols,
      rowHeight: 24,
    });
    engine.setViewportSize(400, 200);
    const r = new DomRenderer<Row>(engine);
    r.mount(host, stubApi(engine));
    engine.setScroll(0, 0);
    r.renderViewport(engine.computeViewportWindow());

    assertDomClean(host);
    expect(globalThis.__xss).toBe(false);
    const cell = host.querySelector('.jects-grid__cell');
    expect(cell?.querySelector('b')).toBeNull(); // string went to textContent
    expect(cell?.querySelector('img')).toBeNull();
    expect(cell?.textContent).toContain('<img src=x onerror=');

    r.destroy();
  });

  it('renderer authors can safely emit markup via escapeHtml', () => {
    const renderer = (ctx: CellRenderContext<Row>): void => {
      // Documented pattern: escape interpolated row data before innerHTML.
      ctx.el.innerHTML = `<b>${escapeHtml(ctx.value as string)}</b>`;
    };
    const cols: ColumnDef<Row>[] = [
      { field: 'name', type: 'template', renderer, width: 200 },
    ];
    const engine = new GridEngine<Row>({
      data: [{ id: 0, name: '<img src=x onerror="window.__xss=true">' }],
      columns: cols,
      rowHeight: 24,
    });
    engine.setViewportSize(400, 200);
    const r = new DomRenderer<Row>(engine);
    r.mount(host, stubApi(engine));
    engine.setScroll(0, 0);
    r.renderViewport(engine.computeViewportWindow());

    assertDomClean(host);
    expect(globalThis.__xss).toBe(false);
    const cell = host.querySelector('.jects-grid__cell');
    // The author's <b> wrapper renders, but the injected value is inert text.
    expect(cell?.querySelector('b')).not.toBeNull();
    expect(cell?.querySelector('img')).toBeNull();

    r.destroy();
  });
});

describe('@jects/grid XSS: exported helpers (surface #2 contract)', () => {
  it('escape/escapeHtml neutralize every payload', () => {
    for (const p of PAYLOADS) {
      const out = escape(p);
      expect(out).not.toContain('<');
      expect(out).not.toContain('>');
    }
    expect(escapeHtml).toBe(escape); // grid re-exports the core helper, no duplicate
  });

  it('sanitizeHtml strips scripts/handlers/js-urls but keeps formatting', () => {
    for (const p of PAYLOADS) {
      const clean = sanitizeHtml(p);
      expect(clean).not.toMatch(/<script/i);
      expect(clean).not.toMatch(/<iframe/i);
      expect(clean).not.toMatch(/on\w+\s*=/i);
      expect(clean).not.toMatch(/javascript:/i);
    }
    // Legitimate formatting survives.
    expect(sanitizeHtml('<b>bold</b>')).toContain('<b>');

    // Render the sanitized output into the DOM and confirm nothing executes.
    const div = document.createElement('div');
    host.appendChild(div);
    div.innerHTML = PAYLOADS.map((p) => sanitizeHtml(p)).join('');
    assertDomClean(div);
    expect(globalThis.__xss).toBe(false);
  });
});
