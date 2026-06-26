/**
 * Accessibility + visual smoke (axe-core, real Chromium) — Quality Gate Q2 for
 * merged cells / spans. Mounts a span-enabled grid body and asserts:
 *   - zero serious/critical axe violations with the merged (aria-colspan/rowspan)
 *     cells present in a role=grid context,
 *   - the origin cell is *visually* enlarged across the summed column widths /
 *     row heights (real browser layout, unlike jsdom), and
 *   - covered cells are not rendered (display:none), so no duplicate content
 *     overlaps the merged origin.
 *
 * Runs via `pnpm --filter @jects/grid test:browser` (Playwright Chromium).
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import './span-cells.css';
import { GridEngine } from './engine.js';
import { SpanDomRenderer } from './span-renderer.js';
import { DefaultSelectionModel } from './selection.js';
import type { ColumnDef, GridApi } from '../contract.js';
import type { Model } from '@jects/core';
import type { SpanProvider } from '../columns/spans.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

interface Row extends Model {
  id: number;
  group: string;
  a: string;
  b: string;
}

function data(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    group: i < 2 ? 'Spanned header' : `g${i}`,
    a: `a${i}`,
    b: `b${i}`,
  }));
}

/** Merge the first column across all 3 columns on row 0 (a section header). */
const headerColSpan: SpanProvider<Row> = (ctx) =>
  ctx.rowIndex === 0 ? { colSpan: 3, rowSpan: 1 } : 1;
/** Merge the first column down 2 rows starting at row 0 (grouped category). */
const categoryRowSpan: SpanProvider<Row> = (ctx) =>
  ctx.rowIndex === 0 ? { colSpan: 1, rowSpan: 2 } : 1;

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

let host: HTMLElement;
let root: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '420px';
  host.style.height = '300px';
  host.style.position = 'relative';
  // role=grid wrapper so axe evaluates the cells in a valid grid context.
  root = document.createElement('div');
  root.className = 'jects-grid';
  root.setAttribute('role', 'grid');
  root.setAttribute('aria-rowcount', '6');
  root.setAttribute('aria-colcount', '3');
  root.style.height = '100%';
  host.appendChild(root);
  document.body.appendChild(host);
});
afterEach(() => host.remove());

function cell(rowIndex: number, colIndex: number): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `.jects-grid__row[data-row-index="${rowIndex}"] .jects-grid__cell[data-col-index="${colIndex}"]`,
  );
}

describe('SpanDomRenderer a11y + visual', () => {
  it('colSpan: merged origin enlarges across summed widths; no axe violations', async () => {
    const columns: ColumnDef<Row>[] = [
      { id: 'a', field: 'a', header: 'A', width: 120, meta: { span: headerColSpan } },
      { id: 'b', field: 'b', header: 'B', width: 100 },
      { id: 'c', field: 'group', header: 'C', width: 100 },
    ];
    const engine = new GridEngine<Row>({ data: data(5), columns, rowHeight: 32 });
    engine.setViewportSize(420, 260);
    const r = new SpanDomRenderer<Row>(engine);
    r.mount(root, stubApi(engine));
    r.renderViewport(engine.computeViewportWindow());

    const origin = cell(0, 0)!;
    expect(origin.getAttribute('aria-colspan')).toBe('3');
    // Real browser layout: the merged origin spans 120 + 100 + 100 = 320px.
    expect(Math.round(origin.getBoundingClientRect().width)).toBe(320);
    // Covered cells are not rendered.
    expect(getComputedStyle(cell(0, 1)!).display).toBe('none');
    expect(getComputedStyle(cell(0, 2)!).display).toBe('none');

    await expectNoA11yViolations(host);
    r.destroy();
  });

  it('rowSpan: merged origin enlarges across summed heights; covered row hidden', async () => {
    const columns: ColumnDef<Row>[] = [
      { id: 'cat', field: 'group', header: 'Category', width: 140, meta: { span: categoryRowSpan } },
      { id: 'a', field: 'a', header: 'A', width: 120 },
      { id: 'b', field: 'b', header: 'B', width: 120 },
    ];
    const engine = new GridEngine<Row>({ data: data(5), columns, rowHeight: 32 });
    engine.setViewportSize(420, 260);
    const r = new SpanDomRenderer<Row>(engine);
    r.mount(root, stubApi(engine));
    r.renderViewport(engine.computeViewportWindow());

    const origin = cell(0, 0)!;
    expect(origin.getAttribute('aria-rowspan')).toBe('2');
    // Real browser layout: the merged origin spans 2 × 32 = 64px tall.
    expect(Math.round(origin.getBoundingClientRect().height)).toBe(64);
    // The cell below (row 1, col 0) is covered → not rendered.
    expect(getComputedStyle(cell(1, 0)!).display).toBe('none');
    // The sibling cells on rows 0/1 still render normally.
    expect(getComputedStyle(cell(0, 1)!).display).not.toBe('none');
    expect(getComputedStyle(cell(1, 1)!).display).not.toBe('none');

    await expectNoA11yViolations(host);
    r.destroy();
  });
});
