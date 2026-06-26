/**
 * Minimal isolated React spreadsheet example.
 *
 * The ONLY Jects imports are the spreadsheet wrapper subpath and the engine:
 *
 *   import { JectsSpreadsheet } from '@jects/react/spreadsheet'; // <- per-component subpath
 *   import '@jects/spreadsheet/style.css';                       // <- engine styles
 *
 * Because `@jects/react/spreadsheet` resolves to `dist/spreadsheet.js`, which
 * imports only `@jects/spreadsheet` (plus the shared factory), a bundler
 * building this app never touches `@jects/gantt`, `@jects/scheduler`, or any
 * other sibling engine — they are not dependencies of this package at all. That
 * is the whole point of the per-component subpath exports: install one
 * component, ship one component.
 */
import { JectsSpreadsheet } from '@jects/react/spreadsheet';
import '@jects/spreadsheet/style.css';

export function App(): JSX.Element {
  return (
    <main style={{ padding: 24 }}>
      <h1>Isolated @jects/react/spreadsheet</h1>
      <JectsSpreadsheet
        // Convenience initializer: one sheet, a sparse `"row,col"` cell map.
        // A1 = "Item", B1 = "Qty", C1 = "Total" header row; C4 sums the column.
        sheets={[
          {
            name: 'Budget',
            rowCount: 100,
            colCount: 26,
            cells: {
              '0,0': { value: 'Item' },
              '0,1': { value: 'Qty' },
              '0,2': { value: 'Total' },
              '1,0': { value: 'Widgets' },
              '1,1': { value: 12 },
              '1,2': { value: 240 },
              '2,0': { value: 'Gadgets' },
              '2,1': { value: 7 },
              '2,2': { value: 175 },
              '3,0': { value: 'Sum' },
              '3,2': { formula: '=SUM(C2:C3)' },
            },
          },
        ]}
        style={{ height: 320 }}
        onSelectionChange={(payload) => {
          // The spreadsheet's typed events bridge through to React `on<Event>` props.
          console.log('selection changed', payload);
        }}
      />
    </main>
  );
}
