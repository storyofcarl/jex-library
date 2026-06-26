# @jects/gantt — enterprise project-planning Gantt chart with a headless CPM scheduling engine.

## What it is

`@jects/gantt` is a full project-planning Gantt: a left WBS task-tree grid paired with a right dependency timeline, driven by a headless CPM scheduling engine (forward/backward passes, constraints, working-time calendars, critical path). It covers FS/SS/FF/SF dependencies with lag/lead, baselines and multi-baseline compare, milestones, split/segmented tasks, summary roll-ups, resource assignments with histogram and utilization views, a PERT network view, undo/redo, a progress (status) line, and export to CSV/Excel/ICS/PNG/PDF/MS-Project. It is framework-free (light-DOM, imperative API), built on `@jects/timeline-core`, and themed entirely through `--jects-*` CSS variables.

## Install

```bash
pnpm add @jects/gantt @jects/core @jects/timeline-core @jects/grid @jects/widgets @jects/theme
```

Peer dependencies (all required): `@jects/core`, `@jects/timeline-core`, `@jects/grid`, `@jects/widgets`, `@jects/theme`. ESM-only and tree-shakeable.

## CSS

This package ships a side-effect stylesheet. Import it once, after the `@jects/theme` base tokens:

```ts
import '@jects/theme/style.css';   // base --jects-* tokens
import '@jects/gantt/style.css';   // gantt chrome
```

## Minimal example

```ts
import { Gantt } from '@jects/gantt';
import '@jects/theme/style.css';
import '@jects/gantt/style.css';

const DAY = 864e5;
const T0 = Date.UTC(2026, 5, 1);

const gantt = new Gantt(document.getElementById('app')!, {
  tasks: [
    { id: 't1', name: 'Plan',  start: T0,           duration: 3 * DAY },
    { id: 't2', name: 'Build', start: T0 + 4 * DAY, duration: 5 * DAY },
  ],
  dependencies: [{ id: 'd1', fromId: 't1', toId: 't2', type: 'FS' }],
});

// later, on teardown
gantt.destroy();
```

`new Gantt(host, options)` — `host` is an `HTMLElement` or a selector string.

## Subpath exports

- `@jects/gantt/engine` — the headless CPM scheduler: `CpmEngine`, `createSchedulingEngine`, `buildCalculator`, working-time/calendar helpers, plus segmented-task primitives (`splitTask`, `joinSegments`, `rescheduleSegments`, `normalizeSegments`).
- `@jects/gantt/export` — file exporters and their method features: CSV (`tasksToCsv`, `GanttExportCsv`), Excel (`tasksToXlsx`, `GanttXlsxExporter`), ICS (`tasksToIcs`, `GanttIcsExportFeature`), image/PNG/SVG (`ganttToPngBlob`, `GanttImageExporter`), PDF (`ganttToPdfBytes`, `GanttPdfExporter`), and the unified `GanttExportToolbar`.
- `@jects/gantt/io` — MS-Project interchange: MSPDI XML (`importMsProject`, `exportMsProject`, `ganttToMsProjectXml`, `roundTripMsProject`) and the OLE2/CFB `.mpp` round-trip (`importMpp`, `exportMpp`, `roundTripMpp`).
- `@jects/gantt/resource` — the resource layer: `ResourceStore`, `AssignmentStore`, `ResourceManager`, `ResourceAssignmentView`, `ResourceView`, and `installResourceLayer`.

## Common recipes

### Tasks + dependencies, then export to PDF

```ts
import { Gantt } from '@jects/gantt';

const gantt = new Gantt('#app', {
  tasks: [
    { id: 'a', name: 'Spec',  start: Date.UTC(2026, 5, 1), duration: 4 * 864e5 },
    { id: 'b', name: 'Build', start: Date.UTC(2026, 5, 5), duration: 6 * 864e5 },
  ],
  dependencies: [{ id: 'l1', fromId: 'a', toId: 'b', type: 'FS' }],
  exports: { pdf: true, menu: true }, // also mount the visible Export menu
});

const blob = await gantt.exportPdf({
  page: 'A4', orientation: 'landscape', fitToWidth: true,
  download: 'project-plan.pdf',
});
```

### Baselines + critical path

```ts
gantt.setCriticalPathVisible(true);

gantt.captureBaseline('plan', 'As-planned');
gantt.updateTaskSpan('b', {
  start: Date.UTC(2026, 5, 7),
  end:   Date.UTC(2026, 5, 15),
}); // slip
gantt.showBaseline('plan'); // render as-planned variance bars
```

### Resources, then a live histogram

```ts
import { ResourceHistogram } from '@jects/gantt';

const gantt = new Gantt('#app', {
  tasks,
  resources:   [{ id: 'dev', name: 'Dev Team', capacity: 4 }],
  assignments: [{ id: 'as1', taskId: 'b', resourceId: 'dev', units: 100 }],
});

if (gantt.resources) {
  const hist = new ResourceHistogram(histHost, {
    api: gantt.resources,
    axis: gantt.timeline.axis,
    getTaskSpan: (id) => gantt.getTask(id),
  });
  gantt.on('scheduleChange', () => hist.refresh());
}
```

### PERT view from the live schedule

```ts
import { PertView } from '@jects/gantt';

const pert = PertView.fromGantt(pertHost, gantt, {
  tasks, dependencies, showCriticalPath: true,
});
```

## Events

`Gantt` exposes `on` / `once` / `off` / `emit` over the `GanttEvents` surface. Vetoable `beforeX` handlers return `false` to cancel. Key events:

- `taskClick` — a task bar was clicked.
- `beforeTaskChange` / `taskChange` — vetoable before, then after a task move/resize/relink re-propagates.
- `beforeDependencyCreate` / `dependencyCreate` / `dependencyRemove` — dependency mutation lifecycle.
- `scheduleChange` — a full or incremental (re)schedule completed.
- `criticalPathChange` — the critical path was recomputed.
- `baselineCapture` — a baseline was captured.
- `conflict` — a scheduling conflict was detected.
- `progressLineChange` — the progress-line status date changed.

## Theming

The Gantt reads `@jects/theme` design tokens only (CSS custom properties, `--jects-*`) — surfaces, borders, spacing, typography, and the primary/accent/CMYK bar and critical-path colors. Override these tokens on an ancestor element, or swap a `@jects/theme` colorway, to retheme without editing component CSS. See [docs/modules/theme.md](../../docs/modules/theme.md).

## Accessibility

The Gantt is interactive: task bars are keyboard-focusable, the task-tree grid and in-cell dependency editors support keyboard navigation, and the rendered chrome carries ARIA roles. Browser tests assert against `axe-core`.

## Stability & support

Beta — broad feature surface with unit and browser (Playwright) test coverage, API still settling. Part of the Jects UI suite. Commercial terms: see LICENSE.md.

Repository: https://github.com/storyofcarl/jex-library · Live demo: https://jexlibrary.vercel.app
