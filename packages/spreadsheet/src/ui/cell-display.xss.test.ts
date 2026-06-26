/**
 * XSS hardening spec for the spreadsheet cell-display surface (SECURITY.md row 8).
 *
 * Untrusted inputs: cell text values and formula-derived string/error text. All of
 * these reach the DOM through `CellGrid` cell rendering. This suite injects the
 * standard payloads as cell content and asserts that nothing executes and the
 * rendered DOM contains no script element, no `on*` handler attribute, and no
 * javascript:/data: URL — while legitimate text still renders verbatim.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CellGrid } from './cell-grid.js';
import { createSpreadsheetApi, defaultWorkbook } from './engine.js';
import type { SpreadsheetApi, CellRef } from '../contract.js';

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
];

let host: HTMLElement;
let api: SpreadsheetApi;
let grid: CellGrid;

beforeEach(() => {
  globalThis.__xss = false;
  host = document.createElement('div');
  document.body.appendChild(host);
  api = createSpreadsheetApi(defaultWorkbook());
  grid = new CellGrid(host, { api, maxRows: 8, maxCols: 5 });
});
afterEach(() => {
  grid.destroy();
  host.remove();
});

const ref = (row: number, col: number): CellRef => ({
  sheet: api.getActiveSheet().id,
  row,
  col,
});

/** Assert the rendered grid is free of executable markup from injected content. */
function expectDomClean(): void {
  // No script element ever materializes from cell content.
  expect(host.querySelector('script')).toBeNull();
  // No element-level event handler attributes.
  for (const el of Array.from(host.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
    }
  }
  // No href/src smuggling a dangerous URL scheme into a real anchor/iframe/img.
  expect(host.querySelector('iframe')).toBeNull();
  for (const el of Array.from(host.querySelectorAll('[href],[src]'))) {
    const url = (el.getAttribute('href') ?? el.getAttribute('src') ?? '').toLowerCase();
    expect(url.startsWith('javascript:')).toBe(false);
    expect(url.startsWith('data:text/html')).toBe(false);
  }
}

describe('cell display — XSS hardening', () => {
  it('renders payloads as inert text and never executes them', () => {
    PAYLOADS.forEach((payload, i) => {
      api.setCellInput(ref(i, 0), payload);
    });
    grid.update({});

    expectDomClean();
    expect(globalThis.__xss).toBe(false);

    // The literal text survives as text content (no element was parsed out of it).
    PAYLOADS.forEach((payload, i) => {
      const cell = host.querySelector(`[data-row="${i}"][data-col="0"]`);
      expect(cell?.textContent).toBe(payload);
    });
  });

  it('escapes payloads delivered through a formula string result', () => {
    // A formula whose result is an attacker-controlled string still routes
    // through textContent, so the markup is never interpreted.
    api.setCellInput(ref(0, 0), '<svg onload="window.__xss=true">A1</svg>');
    api.setCellInput(ref(1, 0), '=A1');
    grid.update({});

    expectDomClean();
    expect(globalThis.__xss).toBe(false);
    const derived = host.querySelector('[data-row="1"][data-col="0"]');
    expect(derived?.textContent).toBe('<svg onload="window.__xss=true">A1</svg>');
  });

  it('renders a formula error as plain inert text', () => {
    api.setCellInput(ref(0, 0), '=1/0');
    grid.update({});

    expectDomClean();
    const cell = host.querySelector('[data-row="0"][data-col="0"]');
    expect(cell?.textContent).toBe('#DIV/0!');
  });

  it('still renders legitimate text correctly', () => {
    api.setCellInput(ref(0, 0), 'Hello, World!');
    api.setCellInput(ref(1, 0), '42');
    grid.update({});

    const a = host.querySelector('[data-row="0"][data-col="0"]');
    const b = host.querySelector('[data-row="1"][data-col="0"]');
    expect(a?.textContent).toBe('Hello, World!');
    expect(b?.textContent).toBe('42');
    expect(globalThis.__xss).toBe(false);
  });
});
