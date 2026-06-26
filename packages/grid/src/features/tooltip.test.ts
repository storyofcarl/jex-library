/**
 * jsdom unit tests for TooltipFeature — per-cell tooltips.
 *
 * Exercises: registration, column `tooltip` renderer resolution (string / html /
 * element / suppress), overflow fallback, aria-describedby wiring + cleanup,
 * show/hide scheduling, the vetoable `beforeTooltipShow` + `tooltipShow`/
 * `tooltipHide` events, header tooltips, hide-on-scroll/repaint, and leak-free
 * `destroy()`.
 *
 * jsdom does not lay out, so overflow (`scrollWidth`/`clientWidth`) is forced via
 * property stubs — the production overflow math is verified in the browser test.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CellAddress } from '../contract.js';
import {
  TooltipFeature,
  tooltipFeature,
  detailTooltip,
  type CellTooltipPayload,
  type TooltipColumnDef,
} from './tooltip.js';
import { makeHarness, makeStore, type FeatureHarness } from './test-harness.js';

interface Row {
  id: number;
  name: string;
  note: string;
}

const ROWS: Row[] = [
  { id: 1, name: 'Alice', note: 'A short note' },
  { id: 2, name: 'Bob', note: 'A much longer note that would overflow a narrow cell' },
  { id: 3, name: 'Carol', note: '' },
];

function cols(extra?: Partial<TooltipColumnDef<Row>>): TooltipColumnDef<Row>[] {
  return [
    { field: 'name', header: 'Name', ...extra },
    { field: 'note', header: 'Note' },
  ];
}

let h: FeatureHarness<Row>;
beforeEach(() => {
  h = makeHarness<Row>({ store: makeStore(ROWS), columns: cols() });
});
afterEach(() => h.destroy());

/** Paint a minimal recycled row + cells into the grid root (mimics the renderer). */
function paintRow(el: HTMLElement, rowIndex: number, columnCount = 2): HTMLElement[] {
  const rowEl = document.createElement('div');
  rowEl.className = 'jects-grid__row';
  rowEl.dataset['rowIndex'] = String(rowIndex);
  el.appendChild(rowEl);
  const cells: HTMLElement[] = [];
  for (let c = 0; c < columnCount; c++) {
    const cell = document.createElement('div');
    cell.className = 'jects-grid__cell';
    cell.dataset['colIndex'] = String(c);
    cell.tabIndex = -1;
    rowEl.appendChild(cell);
    cells.push(cell);
  }
  return cells;
}

function paintHeader(el: HTMLElement, columnCount = 2): HTMLElement[] {
  const headRow = document.createElement('div');
  headRow.className = 'jects-grid__header-row';
  el.appendChild(headRow);
  const cells: HTMLElement[] = [];
  for (let c = 0; c < columnCount; c++) {
    const cell = document.createElement('div');
    cell.className = 'jects-grid__header-cell';
    cell.dataset['colIndex'] = String(c);
    headRow.appendChild(cell);
    cells.push(cell);
  }
  return cells;
}

/** Force a cell to report (or not) overflow. */
function setOverflow(cell: HTMLElement, on: boolean): void {
  Object.defineProperty(cell, 'scrollWidth', { value: on ? 200 : 50, configurable: true });
  Object.defineProperty(cell, 'clientWidth', { value: 50, configurable: true });
  Object.defineProperty(cell, 'scrollHeight', { value: 20, configurable: true });
  Object.defineProperty(cell, 'clientHeight', { value: 20, configurable: true });
}

describe('TooltipFeature (jsdom)', () => {
  it('registers under the name "tooltip" and marks the grid', () => {
    const f = h.api.use(new TooltipFeature<Row>()) as TooltipFeature<Row>;
    expect(f.name).toBe('tooltip');
    expect(h.api.features.get('tooltip')).toBe(f);
    expect(h.el.classList.contains('jects-grid--has-tooltips')).toBe(true);
  });

  it('shows a string tooltip from a column renderer and wires aria-describedby', () => {
    h = makeHarness<Row>({
      store: makeStore(ROWS),
      columns: cols({ tooltip: (ctx) => `Name: ${String(ctx.value)}` }),
    });
    const f = h.api.use(new TooltipFeature<Row>()) as TooltipFeature<Row>;
    const [nameCell] = paintRow(h.el, 0);
    setOverflow(nameCell!, false);

    expect(f.showFor(nameCell!)).toBe(true);
    expect(f.isVisible).toBe(true);
    expect(f.bubbleEl?.textContent).toBe('Name: Alice');

    // aria-describedby points at the bubble id; bubble has role=tooltip.
    const describedBy = nameCell!.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(describedBy).toBe(f.bubbleEl?.id);
    expect(f.bubbleEl?.getAttribute('role')).toBe('tooltip');

    // Address tracked.
    expect(f.currentAddress).toEqual<CellAddress>({ rowIndex: 0, colIndex: 0 });
  });

  it('renders trusted HTML and element content from the renderer', () => {
    h = makeHarness<Row>({
      store: makeStore(ROWS),
      columns: [
        { field: 'name', header: 'Name', tooltip: () => ({ html: '<b>bold</b>' }) },
        {
          field: 'note',
          header: 'Note',
          tooltip: () => {
            const span = document.createElement('span');
            span.className = 'custom-node';
            span.textContent = 'node';
            return span;
          },
        },
      ] as TooltipColumnDef<Row>[],
    });
    const f = h.api.use(new TooltipFeature<Row>()) as TooltipFeature<Row>;
    const cells = paintRow(h.el, 0);
    cells.forEach((c) => setOverflow(c, false));

    expect(f.showFor(cells[0]!)).toBe(true);
    expect(f.bubbleEl?.querySelector('b')?.textContent).toBe('bold');

    expect(f.showFor(cells[1]!)).toBe(true);
    expect(f.bubbleEl?.querySelector('.custom-node')?.textContent).toBe('node');
  });

  it('suppresses the tooltip when the renderer returns false/empty', () => {
    h = makeHarness<Row>({
      store: makeStore(ROWS),
      columns: cols({ tooltip: () => false }),
    });
    const f = h.api.use(new TooltipFeature<Row>()) as TooltipFeature<Row>;
    const [nameCell] = paintRow(h.el, 0);
    setOverflow(nameCell!, false);

    expect(f.showFor(nameCell!)).toBe(false);
    expect(f.isVisible).toBe(false);
    expect(nameCell!.hasAttribute('aria-describedby')).toBe(false);
  });

  it('falls back to the full text for overflow-truncated cells', () => {
    const f = h.api.use(new TooltipFeature<Row>()) as TooltipFeature<Row>;
    const cells = paintRow(h.el, 1);
    cells[1]!.textContent = ROWS[1]!.note;
    setOverflow(cells[1]!, true);

    expect(f.showFor(cells[1]!)).toBe(true);
    expect(f.bubbleEl?.textContent).toBe(ROWS[1]!.note);
  });

  it('does NOT show an overflow tooltip when the cell is not truncated', () => {
    const f = h.api.use(new TooltipFeature<Row>()) as TooltipFeature<Row>;
    const cells = paintRow(h.el, 0);
    cells[0]!.textContent = 'Alice';
    setOverflow(cells[0]!, false);
    expect(f.showFor(cells[0]!)).toBe(false);
  });

  it('overflowOnly ignores column renderers', () => {
    h = makeHarness<Row>({
      store: makeStore(ROWS),
      columns: cols({ tooltip: () => 'explicit' }),
    });
    const f = h.api.use(new TooltipFeature<Row>({ overflowOnly: true })) as TooltipFeature<Row>;
    const [nameCell] = paintRow(h.el, 0);
    nameCell!.textContent = 'Alice';
    setOverflow(nameCell!, false);
    // No overflow + overflowOnly → nothing, even though a renderer exists.
    expect(f.showFor(nameCell!)).toBe(false);
  });

  it('emits beforeTooltipShow (vetoable) + tooltipShow + tooltipHide', () => {
    h = makeHarness<Row>({
      store: makeStore(ROWS),
      columns: cols({ tooltip: () => 'tip' }),
    });
    const f = h.api.use(new TooltipFeature<Row>()) as TooltipFeature<Row>;
    const [nameCell] = paintRow(h.el, 0);
    setOverflow(nameCell!, false);

    const shown: CellTooltipPayload<Row>[] = [];
    const hidden: Array<CellAddress | null> = [];
    (h.api.on as never as (e: string, fn: (p: unknown) => void) => void)('tooltipShow', (p) =>
      shown.push(p as CellTooltipPayload<Row>),
    );
    (h.api.on as never as (e: string, fn: (p: unknown) => void) => void)('tooltipHide', (p) =>
      hidden.push((p as { address: CellAddress | null }).address),
    );

    f.showFor(nameCell!);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.column.field).toBe('name');
    expect(shown[0]!.content).toBe('tip');

    f.hideNow();
    expect(hidden).toHaveLength(1);
    expect(hidden[0]).toEqual({ rowIndex: 0, colIndex: 0 });

    // aria cleaned up on hide.
    expect(nameCell!.hasAttribute('aria-describedby')).toBe(false);
  });

  it('a beforeTooltipShow veto cancels the tooltip', () => {
    h = makeHarness<Row>({
      store: makeStore(ROWS),
      columns: cols({ tooltip: () => 'tip' }),
    });
    const f = h.api.use(new TooltipFeature<Row>()) as TooltipFeature<Row>;
    const [nameCell] = paintRow(h.el, 0);
    setOverflow(nameCell!, false);

    (h.api.on as never as (e: string, fn: (p: unknown) => boolean) => void)(
      'beforeTooltipShow',
      () => false,
    );
    expect(f.showFor(nameCell!)).toBe(false);
    expect(f.isVisible).toBe(false);
    expect(nameCell!.hasAttribute('aria-describedby')).toBe(false);
  });

  it('moving to another cell re-targets the bubble and moves aria-describedby', () => {
    h = makeHarness<Row>({
      store: makeStore(ROWS),
      columns: cols({ tooltip: (ctx) => `tip:${String(ctx.value)}` }),
    });
    const f = h.api.use(new TooltipFeature<Row>()) as TooltipFeature<Row>;
    const a = paintRow(h.el, 0);
    const b = paintRow(h.el, 1);
    [...a, ...b].forEach((c) => setOverflow(c, false));

    f.showFor(a[0]!);
    expect(a[0]!.getAttribute('aria-describedby')).toBe(f.bubbleEl?.id);

    f.showFor(b[0]!);
    // Old cell released, new cell wired.
    expect(a[0]!.hasAttribute('aria-describedby')).toBe(false);
    expect(b[0]!.getAttribute('aria-describedby')).toBe(f.bubbleEl?.id);
    expect(f.currentAddress).toEqual({ rowIndex: 1, colIndex: 0 });
  });

  it('shows on pointerover after the delay and hides on pointerout (fake timers)', async () => {
    h = makeHarness<Row>({
      store: makeStore(ROWS),
      columns: cols({ tooltip: () => 'hover-tip' }),
    });
    const f = h.api.use(
      new TooltipFeature<Row>({ showDelay: 50, hideDelay: 10 }),
    ) as TooltipFeature<Row>;
    const [nameCell] = paintRow(h.el, 0);
    setOverflow(nameCell!, false);

    nameCell!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(f.isVisible).toBe(false); // still within delay
    await new Promise((r) => setTimeout(r, 70));
    expect(f.isVisible).toBe(true);

    nameCell!.dispatchEvent(
      new MouseEvent('pointerout', { bubbles: true, relatedTarget: h.el }),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(f.isVisible).toBe(false);
  });

  it('Escape dismisses an open tooltip', () => {
    h = makeHarness<Row>({
      store: makeStore(ROWS),
      columns: cols({ tooltip: () => 'tip' }),
    });
    const f = h.api.use(new TooltipFeature<Row>()) as TooltipFeature<Row>;
    const [nameCell] = paintRow(h.el, 0);
    setOverflow(nameCell!, false);
    f.showFor(nameCell!);
    expect(f.isVisible).toBe(true);

    h.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(f.isVisible).toBe(false);
  });

  it('shows tooltips on focusin for keyboard users', async () => {
    h = makeHarness<Row>({
      store: makeStore(ROWS),
      columns: cols({ tooltip: () => 'focus-tip' }),
    });
    const f = h.api.use(new TooltipFeature<Row>({ showDelay: 200 })) as TooltipFeature<Row>;
    const [nameCell] = paintRow(h.el, 0);
    setOverflow(nameCell!, false);

    nameCell!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    // Focus uses a clamped delay (<=100ms).
    await new Promise((r) => setTimeout(r, 120));
    expect(f.isVisible).toBe(true);
  });

  it('hides on viewportChange (recycled cells)', () => {
    h = makeHarness<Row>({
      store: makeStore(ROWS),
      columns: cols({ tooltip: () => 'tip' }),
    });
    const f = h.api.use(new TooltipFeature<Row>()) as TooltipFeature<Row>;
    const [nameCell] = paintRow(h.el, 0);
    setOverflow(nameCell!, false);
    f.showFor(nameCell!);
    expect(f.isVisible).toBe(true);

    h.api.emit('viewportChange', { window: {} as never });
    expect(f.isVisible).toBe(false);
  });

  it('supports header tooltips when enabled', () => {
    h = makeHarness<Row>({
      store: makeStore(ROWS),
      columns: cols({ tooltip: (ctx) => `header:${ctx.column.header ?? ''}` }),
    });
    const f = h.api.use(new TooltipFeature<Row>({ headers: true })) as TooltipFeature<Row>;
    const headers = paintHeader(h.el);
    headers.forEach((c) => setOverflow(c, false));

    expect(f.showFor(headers[0]!)).toBe(true);
    expect(f.bubbleEl?.textContent).toBe('header:Name');
    // Header tooltips report rowIndex -1.
    expect(f.currentAddress).toEqual({ rowIndex: -1, colIndex: 0 });
  });

  it('ignores header cells when headers are disabled', () => {
    h = makeHarness<Row>({
      store: makeStore(ROWS),
      columns: cols({ tooltip: () => 'tip' }),
    });
    const f = h.api.use(new TooltipFeature<Row>({ headers: false })) as TooltipFeature<Row>;
    const headers = paintHeader(h.el);
    headers.forEach((c) => setOverflow(c, false));
    expect(f.showFor(headers[0]!)).toBe(false);
  });

  it('detailTooltip() builds an escaped html card', () => {
    const { html } = detailTooltip([
      ['Name', 'Alice <x>'],
      ['Age', 30],
    ]);
    expect(html).toContain('jects-grid-tooltip__card');
    expect(html).toContain('Alice &lt;x&gt;');
    expect(html).toContain('>30<');
  });

  it('factory builds a feature with options', () => {
    const f = tooltipFeature<Row>({ placement: 'bottom', showDelay: 10 });
    expect(f).toBeInstanceOf(TooltipFeature);
    expect(f.name).toBe('tooltip');
  });

  it('destroy() removes listeners, the bubble, aria, and the marker class (leak-free)', () => {
    h = makeHarness<Row>({
      store: makeStore(ROWS),
      columns: cols({ tooltip: () => 'tip' }),
    });
    const f = h.api.use(new TooltipFeature<Row>()) as TooltipFeature<Row>;
    const [nameCell] = paintRow(h.el, 0);
    setOverflow(nameCell!, false);
    f.showFor(nameCell!);
    const bubbleId = f.bubbleEl?.id;

    f.destroy();

    expect(nameCell!.hasAttribute('aria-describedby')).toBe(false);
    expect(f.bubbleEl).toBeNull();
    expect(h.el.classList.contains('jects-grid--has-tooltips')).toBe(false);
    expect(document.getElementById(bubbleId ?? '___none___')).toBeNull();
    // A post-destroy show is a no-op.
    expect(f.showFor(nameCell!)).toBe(false);
  });
});
