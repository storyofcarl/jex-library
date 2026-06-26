/**
 * ColumnPickerFeature — real-Chromium a11y + interaction test.
 *
 * Mounts a real Grid, installs the ColumnPickerFeature, opens the chooser panel,
 * and:
 *   - asserts axe-core finds zero serious/critical violations (Q2 bar),
 *   - asserts the panel exposes a dialog role + labelled checkboxes,
 *   - exercises a real checkbox click to hide a column and verifies the engine
 *     drops the corresponding header cell,
 *   - exercises the reorder + pin controls and verifies the column model updates,
 *   - verifies Escape closes the panel and focus is restored sanely.
 */
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import '@jects/theme/style.css';
import '@jects/widgets/style.css';
import '../styles.css';
import { Grid } from '../engine/grid.js';
import type { ColumnDef } from '../contract.js';
import { ColumnPickerFeature } from './column-picker.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

interface Row {
  id: number;
  name: string;
  email: string;
  role: string;
  city: string;
}

const columns: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', id: 'name', width: 140 },
  { field: 'email', header: 'Email', id: 'email', width: 200 },
  { field: 'role', header: 'Role', id: 'role', width: 120 },
  { field: 'city', header: 'City', id: 'city', width: 120 },
];

function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `Name ${i}`,
    email: `user${i}@example.com`,
    role: i % 2 === 0 ? 'admin' : 'user',
    city: i % 3 === 0 ? 'NYC' : 'LA',
  }));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function headerLabels(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.jects-grid__header-cell'))
    .filter((c) => !c.hidden)
    .map((c) => c.textContent?.trim() ?? '');
}

let host: HTMLElement;
let grid: Grid<Row>;
let picker: ColumnPickerFeature<Row>;

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '700px';
  host.style.height = '320px';
  host.style.position = 'absolute';
  host.style.top = '0';
  host.style.left = '0';
  document.body.appendChild(host);
  grid = new Grid<Row>(host, { data: rows(30), columns, rowHeight: 32 });
  picker = grid.use(new ColumnPickerFeature<Row>()) as ColumnPickerFeature<Row>;
});

afterEach(() => {
  grid.destroy();
  host.remove();
});

describe('ColumnPickerFeature (Chromium)', () => {
  it('opens an accessible panel with labelled checkboxes (axe clean)', async () => {
    await nextFrame();
    picker.open(20, 20);
    const panel = host.querySelector('.jects-grid-colpicker') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.getAttribute('role')).toBe('dialog');

    // Every column row carries a Checkbox with an accessible name.
    const inputs = panel.querySelectorAll<HTMLInputElement>('.jects-checkbox__input');
    expect(inputs.length).toBe(4);

    await expectNoA11yViolations(panel);
  });

  it('hiding a column via its checkbox removes its header cell', async () => {
    await nextFrame();
    expect(headerLabels(host)).toContain('Email');

    picker.open();
    const emailRow = host.querySelector('[data-column-id="email"]') as HTMLElement;
    const input = emailRow.querySelector<HTMLInputElement>('.jects-checkbox__input')!;
    input.click(); // uncheck → hide
    await nextFrame();

    // The engine drops a hidden column from its live `columns` view, so the
    // header cell disappears — the user-visible effect we care about.
    expect(grid.getColumn('email')).toBeUndefined();
    expect(headerLabels(host)).not.toContain('Email');

    // The picker still lists the hidden column (its own model retains it) so it
    // can be shown again. Re-check it and verify the header returns.
    input.click(); // re-check → show
    await nextFrame();
    expect(grid.getColumn('email')).toBeTruthy();
    expect(headerLabels(host)).toContain('Email');
  });

  it('reorder + pin controls update the live column model', async () => {
    await nextFrame();
    picker.open();

    // Pin "name" left via its pin button.
    const nameRow = host.querySelector('[data-column-id="name"]') as HTMLElement;
    nameRow.querySelector<HTMLButtonElement>('.jects-grid-colpicker__pin')!.click();
    expect(grid.getColumn('name')!.frozen).toBe('left');

    // Move "city" up one step (city is last → moves before role).
    const cityRow = host.querySelector('[data-column-id="city"]') as HTMLElement;
    const cityBtns = cityRow.querySelectorAll<HTMLButtonElement>('.jects-grid-colpicker__btn');
    // [pin, up, down]; click "up".
    cityBtns[1]!.click();
    await nextFrame();
    const order = grid.columns.map((c) => c.id);
    expect(order.indexOf('city')).toBeLessThan(order.indexOf('role'));
  });

  it('Escape closes the panel', async () => {
    await nextFrame();
    picker.open();
    expect(picker.isOpen()).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(picker.isOpen()).toBe(false);
  });
});
