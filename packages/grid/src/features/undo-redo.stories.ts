/**
 * Usage stories for UndoRedoFeature (transaction / undo-redo stack).
 *
 * Framework-free imperative usage examples (the house "stories" format): each
 * function builds a real Grid, installs the feature, and returns the instance so
 * a docs shell / playground can mount and tear it down. Ctrl/Cmd+Z and
 * Ctrl/Cmd+Y are bound automatically.
 */
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { UndoRedoFeature, undoRedoFeature } from './undo-redo.js';

interface Person {
  id: number;
  name: string;
  age: number;
  city: string;
  /** Index signature so `Person` satisfies the core `Model` constraint. */
  [key: string]: unknown;
}

const people: Person[] = Array.from({ length: 40 }, (_, i) => ({
  id: i,
  name: `Person ${i}`,
  age: 20 + (i % 30),
  city: ['London', 'Paris', 'Berlin', 'Rome'][i % 4]!,
}));

const columns: ColumnDef<Person>[] = [
  { field: 'name', header: 'Name', width: 160 },
  { field: 'age', header: 'Age', type: 'number', width: 90 },
  { field: 'city', header: 'City', flex: 1 },
];

/** Basic: edits are undoable via Ctrl+Z / Ctrl+Y. */
export function basicUndoRedo(host: HTMLElement): Grid<Person> {
  const grid = new Grid<Person>(host, {
    data: people,
    columns,
    rowHeight: 32,
    editing: true,
    selection: 'range',
  });
  grid.use(new UndoRedoFeature<Person>());
  return grid;
}

/** Toolbar-driven undo/redo with live enabled/disabled binding. */
export function toolbarUndoRedo(host: HTMLElement): Grid<Person> {
  const grid = new Grid<Person>(host, { data: people, columns, rowHeight: 32, editing: true });
  const feature = undoRedoFeature<Person>();
  grid.use(feature);

  const bar = document.createElement('div');
  bar.className = 'jects-grid__undo-toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Undo and redo');

  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'jects-grid__undo-btn';
  undo.textContent = 'Undo';
  undo.addEventListener('click', () => feature.undo());

  const redo = document.createElement('button');
  redo.type = 'button';
  redo.className = 'jects-grid__undo-btn';
  redo.textContent = 'Redo';
  redo.addEventListener('click', () => feature.redo());

  feature.onStateChange((s) => {
    undo.disabled = !s.canUndo;
    redo.disabled = !s.canRedo;
  });
  undo.disabled = true;
  redo.disabled = true;

  bar.append(undo, redo);
  host.prepend(bar);
  return grid;
}

/** Batch many cell writes (paste/fill) into a single undo step. */
export function batchedUndoRedo(host: HTMLElement): Grid<Person> {
  const grid = new Grid<Person>(host, { data: people, columns, rowHeight: 32 });
  const feature = undoRedoFeature<Person>();
  grid.use(feature);

  // Simulate a paste that writes the same city across the first 5 rows as ONE
  // undoable action.
  feature.applyEdits(
    'Paste city',
    people.slice(0, 5).map((p) => ({ id: p.id, field: 'city', value: 'Madrid' })),
  );
  return grid;
}
