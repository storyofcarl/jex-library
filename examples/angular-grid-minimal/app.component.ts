/**
 * Minimal Angular standalone component that renders a Jects grid and nothing else.
 *
 * The ONLY Jects imports are the grid subpath of the wrapper and the grid engine:
 *
 *     import { JectsGrid } from '@jects/angular/grid';   // -> dist/grid.js
 *     import type { GridOptions } from '@jects/grid';
 *
 * Because `@jects/angular/grid` resolves to `dist/grid.js` — whose only `@jects/*`
 * import is `@jects/grid` — a bundler building this app never resolves any sibling
 * engine (`@jects/gantt`, `@jects/scheduler`, `@jects/widgets`, …). That is the whole
 * point of the per-component subpath exports: install/bundle one component in isolation.
 *
 * Compare with `import { JectsGrid } from '@jects/angular'` (the root entry), which
 * re-exports every wrapper and would drag every engine into resolution.
 */
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { JectsGrid } from '@jects/angular/grid';
import type { GridOptions } from '@jects/grid';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [JectsGrid],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `[config]` is the wrapper's signal input; `(jectsEvent)` is its typed event output.
  template: `
    <h1>@jects/angular/grid — isolated install</h1>
    <jects-grid
      [config]="gridConfig()"
      [events]="['selectionChange']"
      (jectsEvent)="onGridEvent($event)"
    ></jects-grid>
  `,
})
export class AppComponent {
  readonly gridConfig = signal<GridOptions>({
    data: [
      { id: 1, name: 'Ada Lovelace', role: 'Engineer' },
      { id: 2, name: 'Grace Hopper', role: 'Admiral' },
    ],
    columns: [
      { field: 'name', header: 'Name' },
      { field: 'role', header: 'Role' },
    ],
  });

  onGridEvent(event: { type: string; payload: unknown }): void {
    // The single typed output: narrow on `event.type` for a typed `event.payload`.
    // eslint-disable-next-line no-console
    console.log('grid event', event.type, event.payload);
  }
}
