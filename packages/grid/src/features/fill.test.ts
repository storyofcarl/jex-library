/**
 * jsdom unit tests for FillFeature — range fill (fill handle / drag-fill +
 * copy-fill + series fill).
 *
 * Two layers:
 *   1. Pure helpers (boundingRect, projectTarget, detectSeries, seriesValueAt) —
 *      the series/geometry math, tested directly.
 *   2. The feature itself over the test harness: handle injection, pointer-drag
 *      copy/series fill writing through `store.update`, vetoable `beforeFill`,
 *      the `fill` notification, keyboard fill, programmatic `fill()`, and a
 *      leak-free `destroy()`.
 *
 * The harness's stub selection returns no cells, so each test swaps in a tiny
 * selection that reports a fixed bounding box (the feature derives its source
 * range purely from `selection.getSelectedCells()`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CellAddress, ColumnDef, SelectionModel } from '../contract.js';
import {
  FillFeature,
  fillFeature,
  boundingRect,
  projectTarget,
  detectSeries,
  seriesValueAt,
  rectCells,
  type FillEvent,
  type FillRect,
} from './fill.js';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';
import { UndoRedoFeature } from './undo-redo.js';
import type { GridFeature } from '../contract.js';

interface Row {
  id: number;
  n: number;
  label: string;
  when: Date;
}

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    n: 0,
    label: '',
    when: new Date(2020, 0, 1),
  }));
}

const COLUMNS: ColumnDef<Row>[] = [
  { field: 'n', header: 'N', type: 'number' },
  { field: 'label', header: 'Label' },
  { field: 'when', header: 'When', type: 'date' },
];

/** Install a selection that reports a fixed rectangle of cells. */
function setSelection(h: FeatureHarness<Row>, cells: CellAddress[]): void {
  const sel = {
    mode: 'range',
    getSelectedIds: () => [],
    getSelectedRows: () => [],
    getSelectedCells: () => cells.map((c) => ({ ...c })),
    isSelected: () => false,
    isCellSelected: (r: number, c: number) =>
      cells.some((x) => x.rowIndex === r && x.colIndex === c),
    select: () => {},
    add: () => {},
    deselect: () => {},
    selectRange: () => {},
    clear: () => {},
  } as unknown as SelectionModel<Row>;
  (h.api as { selection: SelectionModel<Row> }).selection = sel;
}

/** Paint a faithful recycled grid of cell elements for the visible rows. */
function paintGrid(el: HTMLElement, rowCount: number, colCount: number): void {
  for (const r of el.querySelectorAll('.jects-grid__row')) r.remove();
  for (let r = 0; r < rowCount; r++) {
    const rowEl = document.createElement('div');
    rowEl.className = 'jects-grid__row';
    rowEl.dataset['rowIndex'] = String(r);
    rowEl.dataset['rowId'] = String(r + 1);
    for (let c = 0; c < colCount; c++) {
      const cell = document.createElement('div');
      cell.className = 'jects-grid__cell';
      cell.dataset['colIndex'] = String(c);
      Object.defineProperty(cell, 'offsetWidth', { value: 80, configurable: true });
      Object.defineProperty(cell, 'offsetHeight', { value: 24, configurable: true });
      rowEl.appendChild(cell);
    }
    el.appendChild(rowEl);
  }
}

function rect(top: number, left: number, bottom: number, right: number): FillRect {
  return { top, left, bottom, right };
}

/* ════════════════════════════════════════════════════════════════════════ */
describe('fill — pure helpers', () => {
  it('boundingRect computes the enclosing rectangle (or null)', () => {
    expect(boundingRect([])).toBeNull();
    expect(
      boundingRect([
        { rowIndex: 2, colIndex: 1 },
        { rowIndex: 0, colIndex: 3 },
        { rowIndex: 1, colIndex: 0 },
      ]),
    ).toEqual({ top: 0, left: 0, bottom: 2, right: 3 });
  });

  it('rectCells enumerates row-major', () => {
    expect(rectCells(rect(0, 0, 1, 1))).toEqual([
      { rowIndex: 0, colIndex: 0 },
      { rowIndex: 0, colIndex: 1 },
      { rowIndex: 1, colIndex: 0 },
      { rowIndex: 1, colIndex: 1 },
    ]);
  });

  it('projectTarget picks the dominant axis and excludes the source', () => {
    const src = rect(0, 0, 0, 0);
    expect(projectTarget(src, { rowIndex: 3, colIndex: 0 })).toEqual({
      direction: 'down',
      target: rect(1, 0, 3, 0),
    });
    expect(projectTarget(src, { rowIndex: 0, colIndex: 2 })).toEqual({
      direction: 'right',
      target: rect(0, 1, 0, 2),
    });
    // Inside the source → no fill.
    expect(projectTarget(rect(0, 0, 2, 2), { rowIndex: 1, colIndex: 1 })).toBeNull();
  });

  it('projectTarget supports up and left fills', () => {
    const src = rect(5, 5, 5, 5);
    expect(projectTarget(src, { rowIndex: 2, colIndex: 5 })).toEqual({
      direction: 'up',
      target: rect(2, 5, 4, 5),
    });
    expect(projectTarget(src, { rowIndex: 5, colIndex: 2 })).toEqual({
      direction: 'left',
      target: rect(5, 2, 5, 4),
    });
  });

  it('detectSeries finds constant numeric steps', () => {
    expect(detectSeries([1, 2])).toEqual({ kind: 'number', last: 2, step: 1 });
    expect(detectSeries([2, 4, 6])).toEqual({ kind: 'number', last: 6, step: 2 });
    expect(detectSeries([10])).toEqual({ kind: 'number', last: 10, step: 1 });
    // Inconsistent step → not a series.
    expect(detectSeries([1, 2, 4])).toBeNull();
  });

  it('detectSeries finds date series (and single-cell = +1 day)', () => {
    const d0 = new Date(2020, 0, 1);
    const d1 = new Date(2020, 0, 8);
    const s = detectSeries([d0, d1]);
    expect(s?.kind).toBe('date');
    expect(s?.step).toBe(7 * 86_400_000);
    const single = detectSeries([d0]);
    expect(single?.step).toBe(86_400_000);
  });

  it('seriesValueAt continues numeric and date progressions', () => {
    expect(seriesValueAt({ kind: 'number', last: 2, step: 2 }, 1)).toBe(4);
    expect(seriesValueAt({ kind: 'number', last: 2, step: 2 }, 3)).toBe(8);
    // Float dust is rounded to the step's precision.
    expect(seriesValueAt({ kind: 'number', last: 0.3, step: 0.1 }, 1)).toBe(0.4);
    const d = seriesValueAt({ kind: 'date', last: new Date(2020, 0, 1).getTime(), step: 86_400_000 }, 2);
    expect(d).toBeInstanceOf(Date);
    expect((d as Date).getDate()).toBe(3);
  });
});

/* ════════════════════════════════════════════════════════════════════════ */
describe('FillFeature (jsdom)', () => {
  let h: FeatureHarness<Row>;
  beforeEach(() => {
    h = makeHarness<Row>({ store: makeStore(makeRows(8)), columns: COLUMNS });
  });
  afterEach(() => h.destroy());

  it('registers under the name "fill" and flags the grid', () => {
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;
    expect(f.name).toBe('fill');
    expect(h.api.features.get('fill')).toBe(f);
    expect(h.el.classList.contains('jects-grid--fillable')).toBe(true);
  });

  it('injects an accessible fill handle anchored on the active range', () => {
    // The handle is mounted in a body-level overlay (outside the role="grid"
    // subtree, so it is not an invalid grid child per WAI-ARIA).
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(0, 0, 0, 0)));
    h.api.emit('selectionChange', { selectedIds: [], cells: [{ rowIndex: 0, colIndex: 0 }] });

    const handle = f.getHandleEl()!;
    expect(handle).toBeTruthy();
    expect(handle.closest('.jects-grid')).toBeNull(); // outside the grid subtree
    expect(handle.getAttribute('role')).toBe('button');
    expect(handle.getAttribute('aria-label')).toBeTruthy();
    expect(handle.tabIndex).toBe(0);
    expect(handle.hidden).toBe(false);
  });

  it('ties the handle to the active cell via aria-owns / aria-describedby', () => {
    // The handle lives in a body-level overlay (outside the grid focus subtree),
    // so it must be aria-associated with the cell it operates on — otherwise AT
    // announces it as an orphan at the end of <body> with no positional context.
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(0, 0, 0, 0)));
    h.api.emit('selectionChange', { selectedIds: [], cells: [{ rowIndex: 0, colIndex: 0 }] });

    const handle = f.getHandleEl()!;
    const describedBy = handle.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const cellEl = document.getElementById(describedBy!);
    expect(cellEl).toBeTruthy();
    expect(cellEl!.classList.contains('jects-grid__cell')).toBe(true);
    // The active cell owns the handle (logical containment for AT).
    expect(cellEl!.getAttribute('aria-owns')).toBe(handle.id);

    // When the selection clears, the relationship is torn down (no orphan owns).
    setSelection(h, []);
    h.api.emit('selectionChange', { selectedIds: [], cells: [] });
    expect(cellEl!.getAttribute('aria-owns')).toBeNull();
  });

  it('hides the handle when there is no selection', () => {
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;
    paintGrid(h.el, 8, 3);
    setSelection(h, []);
    h.api.emit('selectionChange', { selectedIds: [], cells: [] });
    expect(f.getHandleEl()).toBeNull();
  });

  it('programmatic fill() copies a single value down through store.update', () => {
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;
    h.api.store.update(1, { label: 'X' });
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(0, 1, 0, 1))); // single 'label' cell at row 0

    const written = f.fill({ direction: 'down', count: 3 });
    expect(written).toHaveLength(3);
    expect(h.api.store.getById(2)!.label).toBe('X');
    expect(h.api.store.getById(3)!.label).toBe('X');
    expect(h.api.store.getById(4)!.label).toBe('X');
  });

  it('series fill continues a numeric progression', () => {
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;
    h.api.store.update(1, { n: 2 });
    h.api.store.update(2, { n: 4 });
    paintGrid(h.el, 8, 3);
    // Source is the two-cell numeric column n (rows 0..1, col 0).
    setSelection(h, rectCells(rect(0, 0, 1, 0)));

    const written = f.fill({ direction: 'down', count: 3 });
    expect(written).toHaveLength(3);
    expect(h.api.store.getById(3)!.n).toBe(6);
    expect(h.api.store.getById(4)!.n).toBe(8);
    expect(h.api.store.getById(5)!.n).toBe(10);
  });

  it('a single numeric cell series-fills with +1 steps', () => {
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;
    h.api.store.update(1, { n: 5 });
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(0, 0, 0, 0)));
    const written = f.fill({ direction: 'down', count: 2 });
    expect(written).toHaveLength(2);
    expect(h.api.store.getById(2)!.n).toBe(6);
    expect(h.api.store.getById(3)!.n).toBe(7);
  });

  it('series: "never" copies a numeric cell instead of incrementing', () => {
    const f = h.api.use(new FillFeature<Row>({ series: 'never' })) as FillFeature<Row>;
    h.api.store.update(1, { n: 5 });
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(0, 0, 0, 0)));
    f.fill({ direction: 'down', count: 2 });
    expect(h.api.store.getById(2)!.n).toBe(5);
    expect(h.api.store.getById(3)!.n).toBe(5);
  });

  it('date series fill advances by the detected step', () => {
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;
    h.api.store.update(1, { when: new Date(2020, 0, 1) });
    h.api.store.update(2, { when: new Date(2020, 0, 8) });
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(0, 2, 1, 2))); // 'when' column, two cells
    f.fill({ direction: 'down', count: 2 });
    const a = h.api.store.getById(3)!.when as Date;
    const b = h.api.store.getById(4)!.when as Date;
    expect(a.getDate()).toBe(15);
    expect(b.getDate()).toBe(22);
  });

  it('emits a vetoable beforeFill — returning false cancels the write', () => {
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;
    h.api.store.update(1, { label: 'X' });
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(0, 1, 0, 1)));
    h.api.on('beforeFill', () => false);
    const written = f.fill({ direction: 'down', count: 3 });
    expect(written).toHaveLength(0);
    expect(h.api.store.getById(2)!.label).toBe('');
  });

  it('emits a fill notification with source/target/kind/cells', () => {
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;
    h.api.store.update(1, { n: 1 });
    h.api.store.update(2, { n: 2 });
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(0, 0, 1, 0)));
    const events: FillEvent<Row>[] = [];
    h.api.on('fill', (e) => events.push(e));
    f.fill({ direction: 'down', count: 2 });
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('series');
    expect(events[0]!.direction).toBe('down');
    expect(events[0]!.source).toEqual(rect(0, 0, 1, 0));
    expect(events[0]!.cells).toHaveLength(2);
  });

  it('copy-fills a multi-cell block by tiling', () => {
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;
    h.api.store.update(1, { label: 'A' });
    h.api.store.update(2, { label: 'B' });
    paintGrid(h.el, 8, 3);
    // 2x1 label source → tiles A,B,A,B downward.
    setSelection(h, rectCells(rect(0, 1, 1, 1)));
    f.fill({ direction: 'down', count: 4 });
    expect(h.api.store.getById(3)!.label).toBe('A');
    expect(h.api.store.getById(4)!.label).toBe('B');
    expect(h.api.store.getById(5)!.label).toBe('A');
    expect(h.api.store.getById(6)!.label).toBe('B');
  });

  it('pointer drag from the handle fills down to the swept cell', () => {
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;
    h.api.store.update(1, { n: 3 });
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(0, 0, 0, 0)));
    h.api.emit('selectionChange', { selectedIds: [], cells: [{ rowIndex: 0, colIndex: 0 }] });
    const handle = f.getHandleEl()!;

    // Stub elementsFromPoint so cellFromPoint resolves to (row 2, col 0).
    // jsdom doesn't implement it, so define (then restore) the method directly.
    const targetCell = h.el.querySelector(
      '.jects-grid__row[data-row-index="2"] .jects-grid__cell[data-col-index="0"]',
    ) as HTMLElement;
    const docAny = document as unknown as {
      elementsFromPoint?: (x: number, y: number) => Element[];
    };
    const prev = docAny.elementsFromPoint;
    docAny.elementsFromPoint = () => [targetCell];

    firePointer(handle, 'pointerdown', { clientX: 80, clientY: 24 });
    firePointer(window, 'pointermove', { clientX: 80, clientY: 72 });
    firePointer(window, 'pointerup', { clientX: 80, clientY: 72 });

    expect(h.api.store.getById(2)!.n).toBe(4); // series +1
    expect(h.api.store.getById(3)!.n).toBe(5);
    if (prev) docAny.elementsFromPoint = prev;
    else delete docAny.elementsFromPoint;
    expect(f).toBeTruthy();
  });

  it('keyboard ArrowDown then Enter fills down by one cell', () => {
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;
    h.api.store.update(1, { label: 'K' });
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(0, 1, 0, 1)));
    h.api.emit('selectionChange', { selectedIds: [], cells: [{ rowIndex: 0, colIndex: 1 }] });
    const handle = f.getHandleEl()!;

    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(h.api.store.getById(2)!.label).toBe('K');
    expect(h.api.store.getById(3)!.label).toBe('K');
    expect(f).toBeTruthy();
  });

  it('keyboard Escape cancels without writing', () => {
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;
    h.api.store.update(1, { label: 'K' });
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(0, 1, 0, 1)));
    h.api.emit('selectionChange', { selectedIds: [], cells: [{ rowIndex: 0, colIndex: 1 }] });
    const handle = f.getHandleEl()!;

    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(h.api.store.getById(2)!.label).toBe('');
    expect(f).toBeTruthy();
  });

  it('clips the fill to the grid bounds', () => {
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;
    h.api.store.update(8, { label: 'last' });
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(7, 1, 7, 1))); // last row
    // Drag far past the end → clipped, nothing to write below.
    const written = f.fill({ direction: 'down', count: 5 });
    expect(written).toHaveLength(0);
  });

  it('fillFeature() factory builds an instance', () => {
    const f = fillFeature<Row>({ series: 'always' });
    expect(f).toBeInstanceOf(FillFeature);
    expect(f.name).toBe('fill');
  });

  it('destroy() removes the handle, preview, overlay, class, and listeners', () => {
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(0, 0, 0, 0)));
    h.api.emit('selectionChange', { selectedIds: [], cells: [{ rowIndex: 0, colIndex: 0 }] });
    expect(f.getHandleEl()).toBeTruthy();
    expect(document.body.querySelector('.jects-grid-fill-overlay')).toBeTruthy();

    f.destroy();
    expect(document.body.querySelector('[data-fill-handle]')).toBeNull();
    expect(document.body.querySelector('.jects-grid__fill-preview')).toBeNull();
    expect(document.body.querySelector('.jects-grid-fill-overlay')).toBeNull();
    expect(h.el.classList.contains('jects-grid--fillable')).toBe(false);

    // After destroy, a selectionChange must not re-inject the handle.
    h.api.emit('selectionChange', { selectedIds: [], cells: [{ rowIndex: 0, colIndex: 0 }] });
    expect(f.getHandleEl()).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════════════ */
describe('FillFeature — series:"always" forces a series (not a copy alias)', () => {
  let h: FeatureHarness<Row>;
  beforeEach(() => {
    h = makeHarness<Row>({ store: makeStore(makeRows(8)), columns: COLUMNS });
  });
  afterEach(() => h.destroy());

  it('forces a numeric series from an INCONSISTENT thin source (detectSeries → null)', () => {
    // 1,2,4 has no constant step → detectSeries returns null. Under 'auto' this
    // copies; under 'always' it must FORCE a series (seed=last value, step from
    // the last pair = 4-2 = 2) → 6, 8, 10.
    const f = h.api.use(new FillFeature<Row>({ series: 'always' })) as FillFeature<Row>;
    h.api.store.update(1, { n: 1 });
    h.api.store.update(2, { n: 2 });
    h.api.store.update(3, { n: 4 });
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(0, 0, 2, 0))); // 3-cell numeric source
    const written = f.fill({ direction: 'down', count: 3 });
    expect(written).toHaveLength(3);
    expect(h.api.store.getById(4)!.n).toBe(6);
    expect(h.api.store.getById(5)!.n).toBe(8);
    expect(h.api.store.getById(6)!.n).toBe(10);
  });

  it("'auto' (the default) COPIES the same inconsistent source — proving the modes differ", () => {
    const f = h.api.use(new FillFeature<Row>({ series: 'auto' })) as FillFeature<Row>;
    h.api.store.update(1, { n: 1 });
    h.api.store.update(2, { n: 2 });
    h.api.store.update(3, { n: 4 });
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(0, 0, 2, 0)));
    f.fill({ direction: 'down', count: 3 });
    // Copy/tile of [1,2,4] → 1, 2, 4.
    expect(h.api.store.getById(4)!.n).toBe(1);
    expect(h.api.store.getById(5)!.n).toBe(2);
    expect(h.api.store.getById(6)!.n).toBe(4);
  });

  it("'always' still COPIES a non-numeric source (no numeric seed to force)", () => {
    const f = h.api.use(new FillFeature<Row>({ series: 'always' })) as FillFeature<Row>;
    h.api.store.update(1, { label: 'A' });
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(0, 1, 0, 1))); // single text cell
    f.fill({ direction: 'down', count: 2 });
    expect(h.api.store.getById(2)!.label).toBe('A');
    expect(h.api.store.getById(3)!.label).toBe('A');
  });
});

/* ════════════════════════════════════════════════════════════════════════ */
describe('FillFeature — undo coalescing', () => {
  let h: FeatureHarness<Row>;
  beforeEach(() => {
    h = makeHarness<Row>({ store: makeStore(makeRows(8)), columns: COLUMNS });
  });
  afterEach(() => h.destroy());

  it('a multi-cell fill is ONE undo step (not N) when UndoRedoFeature is installed', () => {
    const undo = new UndoRedoFeature<Row>({ mergeWindow: 0 });
    h.api.use(undo as unknown as GridFeature<Row>);
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;

    h.api.store.update(1, { label: 'X' });
    undo.clear(); // ignore the seed edit above
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(0, 1, 0, 1)));

    // Fill 'X' down 4 cells → 4 store.update calls, but ONE undo command.
    const written = f.fill({ direction: 'down', count: 4 });
    expect(written).toHaveLength(4);
    expect(undo.undoLength).toBe(1);
    expect(undo.peekUndo()).toMatch(/fill/i);

    // A single undo reverts the WHOLE fill at once.
    undo.undo();
    expect(h.api.store.getById(2)!.label).toBe('');
    expect(h.api.store.getById(3)!.label).toBe('');
    expect(h.api.store.getById(4)!.label).toBe('');
    expect(h.api.store.getById(5)!.label).toBe('');

    // … and redo re-applies the whole fill.
    undo.redo();
    expect(h.api.store.getById(2)!.label).toBe('X');
    expect(h.api.store.getById(5)!.label).toBe('X');
  });

  it('still writes directly (no throw) when no UndoRedoFeature is present', () => {
    const f = h.api.use(new FillFeature<Row>()) as FillFeature<Row>;
    h.api.store.update(1, { label: 'Y' });
    paintGrid(h.el, 8, 3);
    setSelection(h, rectCells(rect(0, 1, 0, 1)));
    const written = f.fill({ direction: 'down', count: 2 });
    expect(written).toHaveLength(2);
    expect(h.api.store.getById(2)!.label).toBe('Y');
  });
});

/** Fire a pointer-ish event (jsdom lacks the PointerEvent ctor by default). */
function firePointer(
  target: EventTarget,
  type: string,
  init: { clientX: number; clientY: number; pointerId?: number },
): void {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
  });
  Object.defineProperty(ev, 'pointerId', { value: init.pointerId ?? 1 });
  target.dispatchEvent(ev);
}
