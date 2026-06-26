/**
 * Minimal Angular standalone component that renders a Jects gantt and nothing else.
 *
 * The ONLY Jects imports are the gantt subpath of the wrapper and the gantt engine:
 *
 *     import { JectsGantt } from '@jects/angular/gantt'; // -> dist/gantt.js
 *     import type { GanttOptions } from '@jects/gantt';
 *     import '@jects/gantt/style.css';
 *
 * Because `@jects/angular/gantt` resolves to `dist/gantt.js` — whose only `@jects/*`
 * import is `@jects/gantt` — a bundler building this app never resolves any sibling
 * engine (`@jects/grid`, `@jects/scheduler`, `@jects/widgets`, …). That is the whole
 * point of the per-component subpath exports: install/bundle one component in isolation.
 *
 * Compare with `import { JectsGantt } from '@jects/angular'` (the root entry), which
 * re-exports every wrapper and would drag every engine into resolution.
 */
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { JectsGantt } from '@jects/angular/gantt';
import type { GanttOptions } from '@jects/gantt';
import '@jects/gantt/style.css';

const DAY = 24 * 60 * 60 * 1000;
const PROJECT_START = Date.UTC(2026, 0, 5); // Mon 2026-01-05

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [JectsGantt],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `[config]` is the wrapper's signal input; `(jectsEvent)` is its typed event output.
  template: `
    <h1>@jects/angular/gantt — isolated install</h1>
    <jects-gantt
      [config]="ganttConfig()"
      [events]="['taskClick']"
      (jectsEvent)="onGanttEvent($event)"
    ></jects-gantt>
  `,
})
export class AppComponent {
  readonly ganttConfig = signal<GanttOptions>({
    projectStart: PROJECT_START,
    tasks: [
      { id: 1, name: 'Design', start: PROJECT_START, duration: 2 * DAY, percentDone: 1 },
      { id: 2, name: 'Build', start: PROJECT_START + 2 * DAY, duration: 3 * DAY, percentDone: 0.5 },
      { id: 3, name: 'Ship', start: PROJECT_START + 5 * DAY, duration: 0, milestone: true },
    ],
    dependencies: [
      { id: 1, fromId: 1, toId: 2, type: 'FS' },
      { id: 2, fromId: 2, toId: 3, type: 'FS' },
    ],
    columns: [
      { field: 'name', header: 'Task' },
      { field: 'duration', header: 'Duration' },
    ],
  });

  onGanttEvent(event: { type: string; payload: unknown }): void {
    // The single typed output: narrow on `event.type` for a typed `event.payload`.
    // eslint-disable-next-line no-console
    console.log('gantt event', event.type, event.payload);
  }
}
