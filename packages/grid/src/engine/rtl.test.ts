/**
 * RTL geometry & direction resolution — jsdom unit tests.
 *
 * Covers the pure helpers (`gridIsRTL`, `columnInsets`, `positionColumnCell`,
 * `normalizeScrollLeft`) and the DomRenderer's RTL-aware cell positioning. jsdom
 * does not compute `direction`, so direction is driven via the `dir` attribute
 * (the same authoring model consumers use) — `gridIsRTL` reads the attribute
 * chain first, which is deterministic here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  gridIsRTL,
  columnInsets,
  positionColumnCell,
  normalizeScrollLeft,
  RTL_CLASS,
} from './rtl.js';
import { resolveColumns } from './column-layout.js';
import { GridEngine } from './engine.js';
import { DomRenderer } from './dom-renderer.js';
import { DefaultSelectionModel } from './selection.js';
import type { ColumnDef, GridApi } from '../contract.js';

interface Row {
  id: number;
  a: string;
  b: string;
  c: string;
}

const frozenCols: ColumnDef<Row>[] = [
  { id: 'a', field: 'a', width: 100, frozen: 'left' },
  { id: 'b', field: 'b', width: 120 },
  { id: 'c', field: 'c', width: 80, frozen: 'right' },
];

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

/* ── gridIsRTL ──────────────────────────────────────────────────────────── */

describe('gridIsRTL', () => {
  it('returns false for a null/undefined element', () => {
    expect(gridIsRTL(null)).toBe(false);
    expect(gridIsRTL(undefined)).toBe(false);
  });

  it('reads an explicit dir="rtl" on the element', () => {
    const el = document.createElement('div');
    el.setAttribute('dir', 'rtl');
    expect(gridIsRTL(el)).toBe(true);
  });

  it('reads dir="ltr" on the element (overriding an rtl ancestor)', () => {
    const parent = document.createElement('div');
    parent.setAttribute('dir', 'rtl');
    const child = document.createElement('div');
    child.setAttribute('dir', 'ltr');
    parent.appendChild(child);
    expect(gridIsRTL(child)).toBe(false);
  });

  it('inherits dir from the nearest ancestor with one set', () => {
    const grandparent = document.createElement('div');
    grandparent.setAttribute('dir', 'rtl');
    const parent = document.createElement('div');
    const child = document.createElement('div');
    grandparent.appendChild(parent);
    parent.appendChild(child);
    expect(gridIsRTL(child)).toBe(true);
  });

  it('defaults to LTR when no dir is set anywhere', () => {
    const el = document.createElement('div');
    expect(gridIsRTL(el)).toBe(false);
  });
});

/* ── columnInsets (pure geometry, direction-independent magnitudes) ───────── */

describe('columnInsets', () => {
  const layout = resolveColumns(frozenCols, 600);

  it('frozen-start column offsets from the start by its band-left', () => {
    const a = layout.columns.find((c) => c.id === 'a')!;
    expect(columnInsets(a, layout)).toEqual({ start: 0, end: 'auto' });
  });

  it('centre column shifts past the frozen-start band', () => {
    const b = layout.columns.find((c) => c.id === 'b')!;
    // leftWidth = 100 (column a). Centre band-left of b = 0 → start 0 + 100.
    expect(columnInsets(b, layout)).toEqual({ start: 100, end: 'auto' });
  });

  it('frozen-end column offsets from the end (rightWidth - left - width)', () => {
    const c = layout.columns.find((c) => c.id === 'c')!;
    // rightWidth = 80, c band-left = 0 → end inset 80 - 0 - 80 = 0.
    expect(columnInsets(c, layout)).toEqual({ start: 'auto', end: 0 });
  });
});

/* ── positionColumnCell: LTR uses physical, RTL uses logical insets ───────── */

describe('positionColumnCell', () => {
  const layout = resolveColumns(frozenCols, 600);
  const center = layout.columns.find((c) => c.id === 'b')!;
  const frozenRight = layout.columns.find((c) => c.id === 'c')!;

  it('LTR writes physical left/right and clears logical insets', () => {
    const el = document.createElement('div');
    positionColumnCell(el, center, layout, false);
    expect(el.style.left).toBe('100px');
    expect(el.style.right).toBe('auto');
    expect(el.style.insetInlineStart).toBe('');
    expect(el.style.insetInlineEnd).toBe('');
    expect(el.style.width).toBe('120px');
    expect(el.style.position).toBe('absolute');
  });

  it('RTL writes logical inset-inline-* and clears physical left/right', () => {
    const el = document.createElement('div');
    positionColumnCell(el, center, layout, true);
    expect(el.style.insetInlineStart).toBe('100px');
    expect(el.style.insetInlineEnd).toBe('auto');
    expect(el.style.left).toBe('');
    expect(el.style.right).toBe('');
  });

  it('RTL frozen-end uses inset-inline-end (mirrors to the visual left)', () => {
    const el = document.createElement('div');
    positionColumnCell(el, frozenRight, layout, true);
    expect(el.style.insetInlineEnd).toBe('0px');
    expect(el.style.insetInlineStart).toBe('auto');
  });

  it('clears stale physical insets when a recycled LTR cell flips to RTL', () => {
    const el = document.createElement('div');
    // First lay out in LTR (sets physical left).
    positionColumnCell(el, center, layout, false);
    expect(el.style.left).toBe('100px');
    // Recycle into RTL — physical props must be cleared so they don't conflict.
    positionColumnCell(el, center, layout, true);
    expect(el.style.left).toBe('');
    expect(el.style.right).toBe('');
    expect(el.style.insetInlineStart).toBe('100px');
  });

  it('applies the z-index only to frozen columns', () => {
    const elFrozen = document.createElement('div');
    positionColumnCell(elFrozen, frozenRight, layout, false, '2');
    expect(elFrozen.style.zIndex).toBe('2');
    const elCentre = document.createElement('div');
    positionColumnCell(elCentre, center, layout, false, '2');
    expect(elCentre.style.zIndex).toBe('');
  });
});

/* ── normalizeScrollLeft ──────────────────────────────────────────────────── */

describe('normalizeScrollLeft', () => {
  it('LTR is a clamped no-op', () => {
    expect(normalizeScrollLeft(120, false)).toBe(120);
    expect(normalizeScrollLeft(-5, false)).toBe(0);
  });

  it('RTL standard model (negative scrollLeft) → distance from start', () => {
    expect(normalizeScrollLeft(0, true)).toBe(0);
    expect(normalizeScrollLeft(-200, true)).toBe(200);
  });

  it('RTL legacy positive-decreasing model uses maxScroll', () => {
    // maxScroll 500, scrollLeft 500 = at start → distance 0.
    expect(normalizeScrollLeft(500, true, 500)).toBe(0);
    // scrollLeft 300 → distance 200.
    expect(normalizeScrollLeft(300, true, 500)).toBe(200);
  });
});

/* ── DomRenderer integration: dir flips cell positioning + marker class ──── */

describe('DomRenderer RTL integration', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => host.remove());

  function mountGrid(rtl: boolean): { renderer: DomRenderer<Row>; engine: GridEngine<Row> } {
    if (rtl) host.setAttribute('dir', 'rtl');
    const data: Row[] = [{ id: 0, a: 'a0', b: 'b0', c: 'c0' }];
    const engine = new GridEngine<Row>({ data, columns: frozenCols, rowHeight: 20 });
    engine.setViewportSize(600, 100);
    const renderer = new DomRenderer<Row>(engine);
    renderer.mount(host, stubApi(engine));
    renderer.renderViewport(engine.computeViewportWindow());
    return { renderer, engine };
  }

  it('LTR: body cells use physical left, no RTL marker class', () => {
    const { renderer } = mountGrid(false);
    expect(host.classList.contains(RTL_CLASS)).toBe(false);
    const cellB = host.querySelector<HTMLElement>(
      '.jects-grid__row[data-row-index="0"] .jects-grid__cell[data-col-id="b"]',
    )!;
    expect(cellB.style.left).toBe('100px');
    expect(cellB.style.insetInlineStart).toBe('');
    renderer.destroy();
  });

  it('RTL: body + header cells use logical insets, marker class added', () => {
    const { renderer } = mountGrid(true);
    expect(host.classList.contains(RTL_CLASS)).toBe(true);

    const cellB = host.querySelector<HTMLElement>(
      '.jects-grid__row[data-row-index="0"] .jects-grid__cell[data-col-id="b"]',
    )!;
    expect(cellB.style.insetInlineStart).toBe('100px');
    expect(cellB.style.left).toBe('');

    // Frozen-end column 'c' pins to the inline end (visual left in RTL).
    const cellC = host.querySelector<HTMLElement>(
      '.jects-grid__row[data-row-index="0"] .jects-grid__cell[data-col-id="c"]',
    )!;
    expect(cellC.style.insetInlineEnd).toBe('0px');
    expect(cellC.style.insetInlineStart).toBe('auto');

    // Header cell mirrors the body cell.
    const headB = host.querySelector<HTMLElement>('.jects-grid__header-cell[data-col-id="b"]')!;
    expect(headB.style.insetInlineStart).toBe('100px');
    renderer.destroy();
  });

  it('removes the RTL marker class on destroy', () => {
    const { renderer } = mountGrid(true);
    expect(host.classList.contains(RTL_CLASS)).toBe(true);
    renderer.destroy();
    expect(host.classList.contains(RTL_CLASS)).toBe(false);
  });

  it('honours a runtime dir flip on the next paint (no remount)', () => {
    const { renderer, engine } = mountGrid(false);
    const cellB = () =>
      host.querySelector<HTMLElement>(
        '.jects-grid__row[data-row-index="0"] .jects-grid__cell[data-col-id="b"]',
      )!;
    expect(cellB().style.left).toBe('100px');

    // Flip to RTL at runtime and repaint.
    host.setAttribute('dir', 'rtl');
    renderer.renderViewport(engine.computeViewportWindow());
    expect(host.classList.contains(RTL_CLASS)).toBe(true);
    expect(cellB().style.insetInlineStart).toBe('100px');
    expect(cellB().style.left).toBe('');
    renderer.destroy();
  });
});
