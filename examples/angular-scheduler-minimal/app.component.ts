/**
 * Minimal Angular standalone component that renders a Jects scheduler and nothing else.
 *
 * The ONLY Jects imports are the scheduler subpath of the wrapper and the scheduler engine:
 *
 *     import { JectsScheduler } from '@jects/angular/scheduler';   // -> dist/scheduler.js
 *     import type { SchedulerConfig } from '@jects/scheduler';
 *
 * Because `@jects/angular/scheduler` resolves to `dist/scheduler.js` — whose only `@jects/*`
 * import is `@jects/scheduler` — a bundler building this app never resolves any sibling
 * engine (`@jects/grid`, `@jects/gantt`, `@jects/widgets`, …). That is the whole
 * point of the per-component subpath exports: install/bundle one component in isolation.
 *
 * Compare with `import { JectsScheduler } from '@jects/angular'` (the root entry), which
 * re-exports every wrapper and would drag every engine into resolution.
 */
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { JectsScheduler } from '@jects/angular/scheduler';
import type { SchedulerConfig } from '@jects/scheduler';
// Engine CSS for the scheduler (resolves via the package `exports` map to dist/style.css).
import '@jects/scheduler/style.css';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [JectsScheduler],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `[config]` is the wrapper's signal input; `(jectsEvent)` is its typed event output.
  template: `
    <h1>@jects/angular/scheduler — isolated install</h1>
    <jects-scheduler
      [config]="schedulerConfig()"
      [events]="['eventClick']"
      (jectsEvent)="onSchedulerEvent($event)"
    ></jects-scheduler>
  `,
})
export class AppComponent {
  // Tiny but valid config: two resource lanes and two events on them. `startDate`
  // / `endDate` are epoch ms (UTC); `range` bounds the visible timeline span.
  readonly schedulerConfig = signal<SchedulerConfig>({
    resources: [
      { id: 1, name: 'Ada Lovelace' },
      { id: 2, name: 'Grace Hopper' },
    ],
    events: [
      {
        id: 1,
        resourceId: 1,
        name: 'Design review',
        startDate: Date.UTC(2026, 5, 25, 9, 0),
        endDate: Date.UTC(2026, 5, 25, 11, 0),
      },
      {
        id: 2,
        resourceId: 2,
        name: 'Deploy',
        startDate: Date.UTC(2026, 5, 25, 13, 0),
        endDate: Date.UTC(2026, 5, 25, 15, 0),
      },
    ],
  });

  onSchedulerEvent(event: { type: string; payload: unknown }): void {
    // The single typed output: narrow on `event.type` for a typed `event.payload`.
    // eslint-disable-next-line no-console
    console.log('scheduler event', event.type, event.payload);
  }
}
