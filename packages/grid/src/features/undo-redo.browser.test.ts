/**
 * Real-Chromium a11y + interaction test for UndoRedoFeature.
 *
 * Mounts a real Grid, installs the feature, renders the optional undo/redo
 * toolbar (token-pure CSS), and verifies:
 *   - the toolbar buttons reflect stack state (disabled when nothing to
 *     undo/redo) and the mounted grid + toolbar are axe-clean;
 *   - a data edit captured by the feature is reversed by clicking Undo and
 *     re-applied by Redo, with the grid repainting the restored value;
 *   - the Ctrl+Z / Ctrl+Y keyboard bindings undo/redo against the live store.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import './undo-redo.css';
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { UndoRedoFeature } from './undo-redo.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

interface Row {
  id: number;
  name: string;
  age: number;
}

const cols: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', width: 200 },
  { field: 'age', header: 'Age', type: 'number', width: 100 },
];

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, name: `Person ${i}`, age: 20 + i }));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Build a small accessible undo/redo toolbar bound to the feature. */
function buildToolbar(feature: UndoRedoFeature<Row>): {
  toolbar: HTMLElement;
  undoBtn: HTMLButtonElement;
  redoBtn: HTMLButtonElement;
} {
  const toolbar = document.createElement('div');
  toolbar.className = 'jects-grid__undo-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Undo and redo');

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'jects-grid__undo-btn';
  undoBtn.textContent = 'Undo';
  undoBtn.addEventListener('click', () => feature.undo());

  const redoBtn = document.createElement('button');
  redoBtn.type = 'button';
  redoBtn.className = 'jects-grid__undo-btn';
  redoBtn.textContent = 'Redo';
  redoBtn.addEventListener('click', () => feature.redo());

  const sync = (): void => {
    undoBtn.disabled = !feature.canUndo;
    redoBtn.disabled = !feature.canRedo;
  };
  feature.onStateChange(sync);
  sync();

  toolbar.append(undoBtn, redoBtn);
  return { toolbar, undoBtn, redoBtn };
}

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '480px';
  host.style.height = '320px';
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  document.body.appendChild(host);
});
afterEach(() => host.remove());

describe('UndoRedoFeature (Chromium)', () => {
  it('renders an accessible toolbar that tracks stack state and is axe-clean', async () => {
    const g = new Grid<Row>(host, { data: rows(20), columns: cols, rowHeight: 32 });
    const f = g.use(new UndoRedoFeature<Row>()) as UndoRedoFeature<Row>;
    const { toolbar, undoBtn, redoBtn } = buildToolbar(f);
    host.appendChild(toolbar);
    g.refresh();
    await nextFrame();

    // Nothing to undo/redo yet → both disabled.
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);

    // A captured edit enables Undo.
    g.store.update(0, { age: 999 });
    expect(undoBtn.disabled).toBe(false);
    expect(redoBtn.disabled).toBe(true);

    await expectNoA11yViolations(host);
    g.destroy();
  });

  it('Undo/Redo buttons reverse and re-apply a data edit (with repaint)', async () => {
    const g = new Grid<Row>(host, { data: rows(20), columns: cols, rowHeight: 32 });
    const f = g.use(new UndoRedoFeature<Row>()) as UndoRedoFeature<Row>;
    const { toolbar, undoBtn, redoBtn } = buildToolbar(f);
    host.appendChild(toolbar);
    g.refresh();
    await nextFrame();

    g.store.update(0, { age: 123 });
    g.refresh();
    await nextFrame();
    expect(g.store.getById(0)!.age).toBe(123);

    undoBtn.click();
    await nextFrame();
    expect(g.store.getById(0)!.age).toBe(20);
    expect(redoBtn.disabled).toBe(false);

    redoBtn.click();
    await nextFrame();
    expect(g.store.getById(0)!.age).toBe(123);

    g.destroy();
  });

  it('Ctrl+Z / Ctrl+Y keyboard bindings undo and redo', async () => {
    const g = new Grid<Row>(host, { data: rows(20), columns: cols, rowHeight: 32 });
    const f = g.use(new UndoRedoFeature<Row>()) as UndoRedoFeature<Row>;
    g.refresh();
    await nextFrame();

    g.store.update(1, { name: 'Edited' });
    expect(g.store.getById(1)!.name).toBe('Edited');

    g.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(g.store.getById(1)!.name).toBe('Person 1');

    g.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
    expect(g.store.getById(1)!.name).toBe('Edited');
    expect(f.canUndo).toBe(true);

    g.destroy();
  });
});
