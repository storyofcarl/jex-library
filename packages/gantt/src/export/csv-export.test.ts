/**
 * jsdom unit tests for the Gantt-level CSV export feature (`csv-export.ts`).
 *
 * Two layers:
 *   1. Controller / resolvers — `GanttCsvExporter` derives the project tree
 *      source from the Gantt store, wires the predecessors + resources labels off
 *      the public `GanttApi`, and serializes the on-screen task-grid columns to
 *      RFC-4180 CSV (hierarchy/WBS preserved, injection hardened).
 *   2. Feature plugin — `GanttCsvExportFeature` / `installCsvExport` install onto
 *      a real `Gantt` via `use(...)`, expose `exportCsv()`/`toCsvTable()`, emit
 *      `csvExport`, and dispose cleanly. `downloadCsv` is a no-op-safe helper.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from '../ui/gantt.js';
import { ResourceManager } from '../resource/resource-manager.js';
import {
  GanttCsvExporter,
  GanttCsvExportFeature,
  createGanttCsvExport,
  installCsvExport,
  downloadCsv,
  GANTT_CSV_EXPORT_FEATURE,
  // re-exported pure API (single-import reach)
  tasksToCsv,
  serializeTasks,
  type ExportTable,
  type GanttCsvExportEvents,
} from './csv-export.js';
import type { TaskModel, DependencyModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

/** A small WBS plan: one summary 'p' with two leaves 'a' (pred of 'b') and 'b'. */
function plan(): TaskModel[] {
  return [
    { id: 'p', name: 'Release 1.0' } as TaskModel,
    {
      id: 'a',
      name: 'Design',
      parentId: 'p',
      start: T0,
      duration: 3 * DAY,
      end: T0 + 3 * DAY,
      percentDone: 0.5,
    } as TaskModel,
    {
      id: 'b',
      name: 'Build',
      parentId: 'p',
      start: T0 + 3 * DAY,
      duration: 2 * DAY,
      end: T0 + 5 * DAY,
      percentDone: 0,
    } as TaskModel,
  ];
}

function deps(): DependencyModel[] {
  return [{ id: 'd1', fromId: 'a', toId: 'b', type: 'FS', lag: DAY } as DependencyModel];
}

/* ═══════════════════════════════════════════════════════════════════════════
   re-exported pure API still works through the feature module
   ═══════════════════════════════════════════════════════════════════════════ */

describe('csv-export re-exports the pure serializer API', () => {
  it('exposes tasksToCsv / serializeTasks for single-import use', () => {
    const source = {
      items: [{ id: 1, name: 'Task' }] as Array<TaskModel & { children?: TaskModel[] }>,
      getChildren: () => [] as Array<TaskModel & { children?: TaskModel[] }>,
    };
    const table = serializeTasks(source, { columns: [{ field: 'name', header: 'Name' }] });
    expect(table.rows).toHaveLength(1);
    const csv = tasksToCsv(source, { bom: false, columns: [{ field: 'name', header: 'Name' }] });
    expect(csv.split('\r\n')[0]).toBe('Name');
    expect(csv.split('\r\n')[1]).toBe('Task');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   GanttCsvExporter — controller over a live Gantt
   ═══════════════════════════════════════════════════════════════════════════ */

describe('GanttCsvExporter (over a live Gantt)', () => {
  it('serializes the project tree to CSV with header + WBS hierarchy', () => {
    gantt = new Gantt(host, { tasks: plan(), dependencies: deps(), projectStart: T0 });
    const exporter = new GanttCsvExporter(gantt);
    const csv = exporter.exportCsv({ download: false, bom: false });
    const lines = csv.split('\r\n');

    // Header row = the default project grid columns.
    expect(lines[0]).toBe('Name,WBS,Start,Finish,Duration,% Done,Predecessors,Resources,Effort');
    // Summary row 'p' at WBS 1, then leaves 1.1 / 1.2.
    expect(lines[1]!.startsWith('Release 1.0,1,')).toBe(true);
    // Child names indented two spaces per depth.
    expect(lines[2]!.startsWith('  Design,1.1,')).toBe(true);
    expect(lines[3]!.startsWith('  Build,1.2,')).toBe(true);
  });

  it('wires the predecessors resolver into the Predecessors column', () => {
    gantt = new Gantt(host, { tasks: plan(), dependencies: deps(), projectStart: T0 });
    const exporter = new GanttCsvExporter(gantt);
    const table = exporter.toTable();
    const predCol = table.columns.findIndex((c) => c.field === 'predecessors');
    const buildRow = table.rows.find((r) => r.id === 'b')!;
    const cell = buildRow.cells[predCol]!;
    // 'b' depends on 'a' FS with +1d lag → "a+1d" (FS implicit).
    expect(cell.kind === 'text' ? cell.value : '').toBe('a+1d');
    // 'a' has no predecessors → empty.
    const designRow = table.rows.find((r) => r.id === 'a')!;
    expect(designRow.cells[predCol]!.kind).toBe('empty');
  });

  it('predecessorsLabel renders FS-implicit notation with typed/lagged links', () => {
    gantt = new Gantt(host, {
      tasks: plan(),
      dependencies: [
        { id: 'd1', fromId: 'a', toId: 'b', type: 'SS', lag: -2 * DAY } as DependencyModel,
      ],
      projectStart: T0,
    });
    const exporter = new GanttCsvExporter(gantt);
    expect(exporter.predecessorsLabel('b')).toBe('aSS-2d');
  });

  it('labels assigned resources off the resource layer (units percentage)', () => {
    gantt = new Gantt(host, {
      tasks: plan(),
      projectStart: T0,
      resources: [
        { id: 'r1', name: 'Alice' },
        { id: 'r2', name: 'Bob' },
      ],
      assignments: [
        { id: 'as1', taskId: 'a', resourceId: 'r1', units: 50 },
        { id: 'as2', taskId: 'a', resourceId: 'r2', units: 100 },
      ],
    } as never);
    const exporter = new GanttCsvExporter(gantt);
    const label = exporter.resourcesLabel('a');
    // 50% gets a units suffix; 100% (full-time) is rendered bare.
    expect(label).toContain('Alice [50%]');
    expect(label).toContain('Bob');
    expect(label).not.toContain('Bob [100%]');
  });

  it('hardens user-controlled task names against CSV/formula injection', () => {
    gantt = new Gantt(host, {
      tasks: [{ id: 'x', name: '=HYPERLINK("http://evil","click")' } as TaskModel],
      projectStart: T0,
    });
    const exporter = new GanttCsvExporter(gantt);
    const csv = exporter.exportCsv({
      download: false,
      bom: false,
      columns: [{ field: 'name', header: 'Name' }],
    });
    const lines = csv.split('\r\n');
    // Leading "=" defused with an apostrophe; quotes doubled per RFC 4180.
    expect(lines[1]!.startsWith(`"'=HYPERLINK`)).toBe(true);
  });

  it('honours delimiter / eol / bom options', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const exporter = new GanttCsvExporter(gantt);
    const csv = exporter.exportCsv({ download: false, delimiter: ';', eol: '\n', bom: false });
    expect(csv.split('\n')[0]).toContain('Name;WBS;Start');
  });

  it('emits csvExport with the produced string + row count', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const exporter = new GanttCsvExporter(gantt);
    const seen: GanttCsvExportEvents['csvExport'][] = [];
    exporter.events.on('csvExport', (p) => seen.push(p));
    exporter.exportCsv({ download: false, filename: 'plan.csv' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.filename).toBe('plan.csv');
    expect(seen[0]!.rowCount).toBe(3); // p + a + b
    expect(seen[0]!.csv.length).toBeGreaterThan(0);
  });

  it('accepts an explicit taskSource override', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const exporter = new GanttCsvExporter(gantt, {
      taskSource: {
        items: [{ id: 'only', name: 'Override' }] as Array<
          TaskModel & { children?: TaskModel[] }
        >,
        getChildren: () => [],
      },
    });
    const csv = exporter.exportCsv({
      download: false,
      bom: false,
      columns: [{ field: 'name', header: 'Name' }],
    });
    expect(csv.split('\r\n')[1]).toBe('Override');
  });

  it('returns "" and stops emitting after destroy()', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const exporter = new GanttCsvExporter(gantt);
    let count = 0;
    exporter.events.on('csvExport', () => count++);
    exporter.destroy();
    expect(exporter.exportCsv({ download: false })).toBe('');
    expect(count).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   GanttCsvExportFeature — plugin install path
   ═══════════════════════════════════════════════════════════════════════════ */

describe('GanttCsvExportFeature (plugin)', () => {
  it('installs via use(...) and exposes exportCsv / toCsvTable on the feature', () => {
    gantt = new Gantt(host, { tasks: plan(), dependencies: deps(), projectStart: T0 });
    const feature = new GanttCsvExportFeature();
    gantt.use(feature);

    expect(gantt.features.get(GANTT_CSV_EXPORT_FEATURE)).toBe(feature);

    const csv = feature.exportCsv({ download: false, bom: false });
    expect(csv.split('\r\n')[0]).toContain('Name,WBS');

    const table: ExportTable = feature.toCsvTable();
    expect(table.rows.map((r) => r.id)).toEqual(['p', 'a', 'b']);
  });

  it('installCsvExport adds the feature and is idempotent', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const f1 = installCsvExport(gantt, { filename: 'x.csv' });
    const f2 = installCsvExport(gantt);
    expect(f1).toBe(f2);
    expect(gantt.features.get(GANTT_CSV_EXPORT_FEATURE)).toBe(f1);
  });

  it('createGanttCsvExport sugars construction', () => {
    const f = createGanttCsvExport({ filename: 'y.csv' });
    expect(f).toBeInstanceOf(GanttCsvExportFeature);
  });

  it('default filename flows from feature config', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const feature = installCsvExport(gantt, { filename: 'project-plan.csv' });
    const seen: string[] = [];
    feature.csvExporter.events.on('csvExport', (p) => seen.push(p.filename));
    feature.exportCsv({ download: false });
    expect(seen[0]).toBe('project-plan.csv');
  });

  it('disposes with the Gantt (csvExporter throws after gantt.destroy)', () => {
    gantt = new Gantt(host, { tasks: plan(), projectStart: T0 });
    const feature = new GanttCsvExportFeature();
    gantt.use(feature);
    gantt.destroy();
    gantt = null;
    expect(() => feature.csvExporter).toThrow(/not initialized/);
  });

  it('honours a ResourceManager passed via plugins for resource labels', () => {
    // A ResourceManager handed to the Gantt via `plugins` is adopted as the
    // active `gantt.resources` during setup, so the exporter labels off it.
    gantt = new Gantt(host, {
      tasks: plan(),
      projectStart: T0,
      plugins: [
        new ResourceManager({
          resources: [{ id: 'r1', name: 'Carol' }],
          assignments: [{ id: 'as1', taskId: 'a', resourceId: 'r1', units: 100 }],
        }),
      ],
    } as never);
    const feature = installCsvExport(gantt);
    const table = feature.toCsvTable();
    const resCol = table.columns.findIndex((c) => c.field === 'resources');
    const designRow = table.rows.find((r) => r.id === 'a')!;
    const cell = designRow.cells[resCol]!;
    expect(cell.kind === 'text' ? cell.value : '').toBe('Carol');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   downloadCsv — DOM-safe helper
   ═══════════════════════════════════════════════════════════════════════════ */

describe('downloadCsv', () => {
  it('is a no-op-safe call (jsdom: no object-URL crash)', () => {
    // jsdom lacks URL.createObjectURL → helper returns silently without throwing.
    expect(() => downloadCsv('a,b\r\n1,2\r\n', 'x.csv')).not.toThrow();
  });
});
