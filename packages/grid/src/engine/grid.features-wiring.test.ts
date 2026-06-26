/**
 * jsdom tests that the declarative `features` config keys actually install their
 * features through `autoRegisterFeatures()` (gap 2: previously-dead `export` /
 * `clipboard` keys, plus the new `selectionColumn` / `responsive` keys).
 *
 * Constructs a REAL Grid and asserts the feature registry + DOM reflect the
 * config — i.e. declaring the key is no longer a silent no-op.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@jects/widgets';
import { Grid } from './grid.js';
import type { ColumnDef } from '../contract.js';

interface Row {
  id: number;
  name: string;
  age: number;
}

const cols = (): ColumnDef<Row>[] => [
  { field: 'name', header: 'Name', width: 120 },
  { field: 'age', header: 'Age', type: 'number', width: 80, responsivePriority: 1 },
];

const data = (): Row[] => [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Linus', age: 54 },
];

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

describe('autoRegisterFeatures — newly-wired feature keys', () => {
  it('features.export installs the export feature (was a dead key)', () => {
    const g = new Grid<Row>(host, { data: data(), columns: cols(), features: { export: true } });
    expect(g.features.has('export')).toBe(true);
    g.destroy();
  });

  it('features.clipboard installs the selection/clipboard feature (was a dead key)', () => {
    const g = new Grid<Row>(host, {
      data: data(),
      columns: cols(),
      selection: 'range',
      features: { clipboard: true },
    });
    expect(g.features.has('selection')).toBe(true);
    g.destroy();
  });

  it('neither is installed when the keys are absent', () => {
    const g = new Grid<Row>(host, { data: data(), columns: cols() });
    expect(g.features.has('export')).toBe(false);
    // The columns-area clipboard feature is opt-in; not auto-installed.
    expect(g.features.has('selection')).toBe(false);
    g.destroy();
  });

  it('features.selectionColumn installs the selector column + checkbox header', () => {
    const g = new Grid<Row>(host, {
      data: data(),
      columns: cols(),
      selection: 'multi',
      features: { selectionColumn: true },
    });
    expect(g.features.has('selectionColumn')).toBe(true);
    // The selector column is prepended (now 3 header cells: select + name + age).
    const headerCells = host.querySelectorAll('.jects-grid__header-cell');
    expect(headerCells.length).toBe(3);
    // The header "select all" checkbox renders via the meta.headerRenderer seam.
    expect(host.querySelector('.jects-grid-select__input[data-select-all="true"]')).toBeTruthy();
    g.destroy();
  });

  it('features.responsive installs the responsive feature', () => {
    const g = new Grid<Row>(host, {
      data: data(),
      columns: cols(),
      features: { responsive: true },
    });
    expect(g.features.has('responsive')).toBe(true);
    g.destroy();
  });

  it('updateColumn renames a header in place without a setColumns rebuild', () => {
    const g = new Grid<Row>(host, { data: data(), columns: cols() });
    g.updateColumn('age', { header: 'Years' });
    const headerCells = host.querySelectorAll('.jects-grid__header-cell');
    expect(headerCells[1]!.textContent).toBe('Years');
    // Column identity/field is preserved (not a full rebuild).
    expect(g.getColumn('age')!.field).toBe('age');
    g.destroy();
  });
});
