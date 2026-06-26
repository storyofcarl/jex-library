# @jects/gantt
> Enterprise Gantt chart — WBS task tree + dependency timeline driven by a pluggable CPM scheduling engine, with critical path, baselines, resources, and PDF/PNG/Excel/ICS/MS-Project export.

## Overview
`@jects/gantt` is a full project-planning Gantt chart: a left task-tree grid plus a right dependency timeline, driven by a headless **CPM scheduling engine** (forward/backward passes, constraints, working-time calendars, critical path). It targets full parity with the category leaders — **Bryntum Gantt** and **DHTMLX Gantt** — covering dependencies (FS/SS/FF/SF + lag/lead), baselines and multi-baseline compare, milestones, split/segmented tasks, summary roll-ups, resource assignments with histogram/utilization views, a PERT network view, undo/redo, a progress (status) line, and export to CSV/Excel/ICS/PNG/PDF/MS-Project.

It is built on `@jects/timeline-core` and reuses `@jects/grid` (task tree / locked columns) and `@jects/widgets` (task editors). The engine is swappable via the `engine` option. The widget is framework-free (light-DOM, imperative API) and themed entirely through `--jects-*` CSS variables.

## Installation

```bash
pnpm add @jects/gantt @jects/core @jects/timeline-core @jects/grid @jects/widgets @jects/theme
```

- ESM-only, tree-shakeable, framework-free.
- Peer dependencies: `@jects/core`, `@jects/timeline-core`, `@jects/grid`, `@jects/widgets`, `@jects/theme`.

## Integration

Import the side-effect stylesheet once, after the `@jects/theme` base tokens:

```ts
import '@jects/theme/style.css';   // base --jects-* tokens
import '@jects/gantt/style.css';   // gantt chrome
```

### Vanilla TS

```ts
import { Gantt } from '@jects/gantt';

const gantt = new Gantt(document.getElementById('app')!, {
  tasks: [
    { id: 't1', name: 'Plan',  start: Date.UTC(2026, 5, 1), duration: 3 * 864e5 },
    { id: 't2', name: 'Build', start: Date.UTC(2026, 5, 4), duration: 5 * 864e5 },
  ],
  dependencies: [{ id: 'd1', fromId: 't1', toId: 't2', type: 'FS' }],
});
```

`new Gantt(host, options)` — `host` is an `HTMLElement` or selector string.

### Framework wrappers (React / Angular / Vue)

Thin wrapper over the imperative API: instantiate in the mount effect, `destroy()` on unmount.

```tsx
import { useEffect, useRef } from 'react';
import { Gantt } from '@jects/gantt';
import '@jects/gantt/style.css';

function GanttView({ options }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const inst = new Gantt(hostRef.current!, options);
    return () => inst.destroy();
  }, []);
  return <div ref={hostRef} style={{ height: 560 }} />;
}
```

Angular/Vue follow the same shape: create in `ngAfterViewInit` / `onMounted`, `.destroy()` in `ngOnDestroy` / `onUnmounted`.

### Theming

Visuals derive from `--jects-*` tokens — override them on an ancestor (or swap a `@jects/theme` colorway) to retheme.

## Features

- **Task tree (WBS)** — hierarchical tasks via `parentId`, summary roll-ups, milestones (diamonds), locked task-tree grid columns from `@jects/grid` (`DEFAULT_GANTT_COLUMNS`, `DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS`, `GanttTaskTree`, `GanttTaskEditor`).
- **Dependencies** — FS/SS/FF/SF links with lag/lead; predecessor/successor columns with in-cell editing (`GanttDependencyColumns`, `DependencyCellEditor`, `parseDependencyNotation`, `serializeDependencyTerms`).
- **CPM scheduling engine** — forward/backward passes, constraints (ASAP/ALAP/SNET/MSO/…), working-time calendars, incremental `recalc` (`DefaultGanttEngine`, `CpmEngine`, `createSchedulingEngine`, `buildCalculator`). Swappable via the `engine` option.
- **Critical path** — highlight on/off (`showCriticalPath`, `setCriticalPathVisible`); per-task slack via `TaskSchedule`.
- **Baselines** — `captureBaseline` / `showBaseline` variance bars; **multi-baseline compare** (`MultiBaselineCompare`, `MULTI_BASELINE_VARIANTS`).
- **Split / segmented tasks** — multi-piece bars joined by connectors (`GanttSegmentedTasksFeature`, `splitTask`, `joinSegments`, `rescheduleSegments`).
- **Roll-ups** — child-bar roll-up markers on summaries and roll-up summary columns (`GanttRollupFeature`, `rollupColumn`, `aggregateRollup`).
- **Indicators** — constraint/deadline icons (`GanttIndicatorsFeature`, `resolveDeadline`).
- **Progress / status line** — line-of-balance status date (`GanttProgressLineFeature`, `computeProgressVertices`).
- **Project lines** — vertical project marker lines (`ProjectLines`, `projectProjectLines`).
- **PERT view** — network/precedence diagram from the live schedule (`PertView`, `PertView.fromGantt`, `computePertLayout`).
- **Resource layer** — resources + assignments (auto-installed when `GanttOptions` carries `resources`/`assignments`), a live Resources column, **Resource Histogram** + **Utilization** views (`ResourceManager`, `ResourceHistogram`, `ResourceUtilizationView`, `installResourceLayer`).
- **Undo/redo** — `GanttUndoRedo` feature.
- **Exports (auto-installed)** — CSV, Excel (XLSX), ICS, PNG/image, PDF method features grafted onto the instance by default (Bryntum/DHTMLX export parity), plus a visible unified **Export menu** + Print (`GanttExportMenu`, `GanttPrintController`).
- **MS-Project I/O** — full **MSPDI XML** import/export, plus a Jects-authored **`.mpp` round-trip via an OLE2/CFB container with an embedded MSPDI XML payload** (`importMsProject`, `exportMsProject`, `ganttToMsProjectXml`, `importMpp`, `exportMpp`, `roundTripMsProject`). Native `.mpp` import is limited to files that carry a recognizable MSPDI XML payload — proprietary native binary record streams are not parsed.
- **Print** — `GanttPrintController`.

## Quick start

Adapted from the gallery demo — a WBS task tree, FS/SS dependencies with lag, %-done, a milestone, resources + assignments, critical path, and a captured baseline:

```ts
import { Gantt, DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS } from '@jects/gantt';
import { WEEK_AND_DAY } from '@jects/timeline-core';
import '@jects/theme/style.css';
import '@jects/gantt/style.css';

const DAY = 864e5, HPD = 8 * 3_600_000; // working hours/day → effort
const T0 = Date.UTC(2026, 5, 1);
const t = (id, name, parentId, off, dur, pct, extra = {}) => ({
  id, name, parentId,
  start: T0 + off * DAY, duration: dur * DAY, end: T0 + (off + dur) * DAY,
  percentDone: pct, effort: dur * HPD, ...extra,
});

const tasks = [
  { id: 'd', name: 'Discovery', expanded: true },
  t('d1', 'Stakeholder interviews', 'd', 0, 3, 1),
  t('d2', 'Requirements doc', 'd', 3, 4, 1, { deadline: T0 + 6 * DAY }),
  { id: 'b', name: 'Build', expanded: true },
  t('b1', 'Frontend', 'b', 7, 12, 0.45),
  t('b2', 'Backend / API', 'b', 7, 14, 0.5),
  { id: 'm', name: 'Go-live', parentId: 'b', start: T0 + 21 * DAY, milestone: true },
];

const dependencies = [
  { id: 'k1', fromId: 'd1', toId: 'd2', type: 'FS' },
  { id: 'k2', fromId: 'd2', toId: 'b1', type: 'FS' },
  { id: 'k3', fromId: 'b1', toId: 'b2', type: 'SS', lag: 3 * DAY },
  { id: 'k4', fromId: 'b2', toId: 'm', type: 'FS' },
];

const gantt = new Gantt(document.getElementById('app')!, {
  projectStart: T0,
  preset: { ...WEEK_AND_DAY, pxPerUnit: 20 },
  showCriticalPath: true,
  columns: DEFAULT_GANTT_COLUMNS_WITH_SUCCESSORS,
  tasks,
  dependencies,
  resources: [
    { id: 'ana', name: 'Ana Pereira', capacity: 1 },
    { id: 'dev', name: 'Dev Team', capacity: 4 },
  ],
  assignments: [
    { id: 'as0', taskId: 'd1', resourceId: 'ana', units: 100 },
    { id: 'as1', taskId: 'b1', resourceId: 'dev', units: 100 },
  ],
});

// Capture an as-planned baseline, then show its variance bars.
gantt.captureBaseline('plan', 'As-planned');
gantt.showBaseline('plan');
```

## Configuration

`GanttOptions` (extends `WidgetConfig` and `ResourceOptions`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `tasks` | `TreeStore<TaskModel> \| TaskModel[]` | — (required) | Task data source (tree via `parentId`). |
| `dependencies` | `DependencyModel[]` | — | Dependency links. |
| `calendars` | `CalendarModel[]` | — | Working-time calendars. |
| `defaultCalendarId` | `string` | — | Project calendar id. |
| `projectStart` | `TimeMs` | — | Project start anchor (forward scheduling). |
| `projectEnd` | `TimeMs` | — | Project deadline anchor (backward scheduling). |
| `direction` | `'forward' \| 'backward'` | `'forward'` | Default scheduling direction. |
| `preset` | `ViewPreset` | — | Timeline view preset to start in. |
| `columns` | `GanttColumnConfig[]` | defaults | Left task-tree pane columns (`{ field, header?, width? }`). |
| `treeWidth` | `number` | — | Width of the left task-tree pane in px. |
| `showCriticalPath` | `boolean` | `true` | Highlight the critical path. |
| `baseline` | `string` | — | Baseline id to render as variance bars. |
| `engine` | `SchedulingEngine` | default CPM | Inject a custom scheduling engine (engine-swap seam). |
| `plugins` | `GanttFeature[]` | — | Features installed at construction. |
| `exports` | `boolean \| GanttExportsConfig` | `true` | Auto-install export method features; `{ menu: true }` also mounts the visible Export menu. |

`GanttExportsConfig`: `{ csv?, xlsx?, ics?, image?, pdf?, menu? }` (each defaults `true` except `menu` which defaults `false`).

`TaskModel` notable fields: `name`, `start`, `end`, `duration` (working ms), `effort`, `percentDone` (0..1), `parentId`, `manuallyScheduled`, `constraintType`, `constraintDate`, `calendarId`, `milestone`, `segments` (split tasks), `summary`, `resourceIds`.

`DependencyModel`: `{ id, fromId, toId, type? (FS/SS/FF/SF), lag?, active? }`.

## Methods

Public methods on the `Gantt` instance (`Gantt` IS-A `GanttApi` plus the Widget lifecycle):

- `getTask(id)` / `getChildren(id)` / `getDependenciesFor(taskId)` / `getSchedule(taskId)` — model lookups.
- `getCriticalPath(): readonly RecordId[]` — current critical path.
- `updateTaskSpan(taskId, span): boolean` — move/resize a task (fires `beforeTaskChange`/`taskChange`).
- `updateTask(taskId, patch): boolean` — patch task fields and re-propagate.
- `applyConstraint(taskId, constraintType, constraintDate?): boolean` — set a constraint and re-propagate.
- `addDependency(dep): DependencyModel | undefined` / `removeDependency(depId): void` — link mutation.
- `reschedule(options?): ScheduleResult` — force a full re-schedule.
- `captureBaseline(id, name?): Baseline` / `showBaseline(baselineId | null): void` — baseline snapshot/overlay.
- `setCriticalPathVisible(visible): void` — toggle critical-path highlight.
- `use(feature): GanttFeature` / `removeFeature(name): void` — feature lifecycle.
- `update(patch): this` / `getConfig(): Readonly<GanttOptions>` — config merge/read.
- `on` / `once` / `off` / `emit`, `show()` / `hide()`, `track(disposer)`, `destroy()` — Widget lifecycle.
- Read-only accessors: `engine` (the headless `SchedulingEngine`), `timeline` (the `TimelineApi`), `resources` (the `ResourceApi`, when a resource layer is installed), `el`, `features`, `isDestroyed`.

**Grafted export methods** (present when `exports` is enabled / the feature is installed):

- `exportCsv(...)` / `exportXlsx(...)` — CSV / Excel.
- `exportPdf(opts?): Promise<Blob | null>` / `exportPdfBytes(opts?)` / `planPdf(opts?)` — PDF.
- `exportPng(opts?): Promise<Blob | null>` / `exportImage(opts?)` / `exportImageDataUrl(opts?)` — image.
- `exportIcs(options?): string` / `getIcsString(options?)` — iCalendar.

## Events

`GanttEvents` (vetoable `beforeX` handlers return `false` to cancel):

| Event | Payload | Fires when |
| --- | --- | --- |
| `taskClick` | `{ task, native }` | A task bar is clicked. |
| `beforeTaskChange` | `{ task, from, to }` | Vetoable — before a task move/resize/relink. |
| `taskChange` | `{ task, changes }` | A task changed and the engine re-propagated. |
| `beforeDependencyCreate` | `{ dependency }` | Vetoable — before a dependency is created. |
| `dependencyCreate` | `{ dependency }` | A dependency was created. |
| `dependencyRemove` | `{ dependencyId }` | A dependency was removed. |
| `scheduleChange` | `{ result }` | A full/incremental (re)schedule completed. |
| `criticalPathChange` | `{ path }` | The critical path was recomputed. |
| `baselineCapture` | `{ baseline }` | A baseline was captured. |
| `conflict` | `{ conflicts }` | A scheduling conflict was detected. |
| `progressLineChange` | `{ statusDate }` | The progress-line status date changed. |

## Examples

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

### Baselines + multi-baseline compare

```ts
import { Gantt, MultiBaselineCompare } from '@jects/gantt';

gantt.captureBaseline('plan', 'As-planned');
gantt.updateTaskSpan('b', { start: Date.UTC(2026, 5, 7), end: Date.UTC(2026, 5, 15) }); // slip
gantt.captureBaseline('rev2', 'Re-plan');
gantt.showBaseline('plan');

gantt.use(new MultiBaselineCompare({ /* MultiBaselineOptions: managed baselines */ }));
```

### Resource histogram + PERT view from the live schedule

```ts
import { ResourceHistogram, PertView } from '@jects/gantt';

if (gantt.resources) {
  const hist = new ResourceHistogram(histHost, {
    api: gantt.resources,
    axis: gantt.timeline.axis,
    getTaskSpan: (id) => gantt.getTask(id),
  });
  gantt.on('scheduleChange', () => hist.refresh());
}

const pert = PertView.fromGantt(pertHost, gantt, {
  tasks, dependencies, showCriticalPath: true,
});
```

### Export to MS-Project XML

```ts
import { ganttToMsProjectXml } from '@jects/gantt';
const xml = ganttToMsProjectXml(gantt, { baselines: [] });
```

## Theming

The Gantt reads `@jects/theme` design tokens only — no hard-coded colors:

- Surfaces / text: `--jects-background`, `--jects-foreground`, `--jects-card`, `--jects-card-foreground`, `--jects-muted`, `--jects-muted-foreground`.
- Structure: `--jects-border`, `--jects-ring`, the `--jects-space-*` scale, `--jects-radius-sm` / `--jects-radius-md`.
- Typography: `--jects-font-family`, `--jects-font-size-xs` / `--jects-font-size-sm`, `--jects-font-weight-medium`.
- Bars / accents: `--jects-primary` / `--jects-primary-foreground` (task bars), `--jects-accent`, and the CMYK set (`--jects-cmyk-cyan`, `--jects-cmyk-magenta`, `--jects-cmyk-key`) for dependency/category coloring and the critical-path highlight.
- Layering: `--jects-z-sticky` for the sticky timeline header.

Override these tokens on an ancestor element to retheme; no component CSS edits are needed.
