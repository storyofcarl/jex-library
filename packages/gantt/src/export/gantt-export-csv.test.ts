/**
 * jsdom unit tests for the `GanttExportCsv` feature — the bridge that wires the
 * (previously-orphaned) task-grid CSV export onto the live `Gantt` widget.
 *
 * Covers:
 *   - barrel reachability (the symbols are re-exported from `@jects/gantt`),
 *   - the feature installs `exportCsv`/`exportCsvTable`/`exportCsvDownload`
 *     methods on the Gantt instance and removes them on destroy,
 *   - the CSV reflects the CURRENT (scheduled) task spans, not the stale config,
 *   - the live `predecessorsOf` resolver renders FS/SS + lag notation,
 *   - the live `resourcesOf` resolver renders resource labels with units %,
 *   - hierarchy/WBS + RFC-4180 quoting + the CSV-injection guard survive the wire,
 *   - per-call option overrides (columns / delimiter / bom) pass through.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Gantt } from '../ui/gantt.js';
import { GanttExportCsv, createGanttExportCsv } from './gantt-export-csv.js';
import type { ExportTable } from './serialize.js';
import type { CsvExportOptions } from './export-csv.js';
import type { TaskModel, DependencyModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

/** A Gantt instance with the feature's installed methods typed in. */
type GanttWithCsv = Gantt & {
  exportCsv(options?: CsvExportOptions): string;
  exportCsvTable(options?: CsvExportOptions): ExportTable;
  exportCsvDownload(fileName?: string, options?: CsvExportOptions): void;
};

function sampleTasks(): TaskModel[] {
  return [
    { id: 'p', name: 'Phase 1' },
    { id: 'a', name: 'Design', parentId: 'p', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY, percentDone: 0.4 } as TaskModel,
    { id: 'b', name: 'Build', parentId: 'p', start: T0 + 3 * DAY, duration: 3 * DAY, end: T0 + 6 * DAY } as TaskModel,
  ];
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

describe('GanttExportCsv — barrel reachability', () => {
  it('re-exports the CSV surface from the package root', async () => {
    const mod = await import('../index.js');
    expect(typeof mod.tasksToCsv).toBe('function');
    expect(typeof mod.tableToCsv).toBe('function');
    expect(typeof mod.serializeTasks).toBe('function');
    expect(typeof mod.escapeCsvField).toBe('function');
    expect(typeof mod.sanitizeCsvField).toBe('function');
    expect(typeof mod.GanttExportCsv).toBe('function');
    expect(typeof mod.createGanttExportCsv).toBe('function');
    expect(Array.isArray(mod.DEFAULT_EXPORT_COLUMNS)).toBe(true);
  });
});

describe('GanttExportCsv — install / teardown', () => {
  it('installs exportCsv methods on the live Gantt and removes them on destroy', () => {
    gantt = new Gantt(host, { tasks: sampleTasks(), projectStart: T0 });
    const feature = new GanttExportCsv();
    gantt.use(feature);

    const g = gantt as GanttWithCsv;
    expect(typeof g.exportCsv).toBe('function');
    expect(typeof g.exportCsvTable).toBe('function');
    expect(typeof g.exportCsvDownload).toBe('function');

    gantt.removeFeature('exportCsv');
    expect((gantt as unknown as { exportCsv?: unknown }).exportCsv).toBeUndefined();
  });

  it('installs via the plugins option', () => {
    gantt = new Gantt(host, {
      tasks: sampleTasks(),
      projectStart: T0,
      plugins: [new GanttExportCsv()],
    });
    expect(typeof (gantt as GanttWithCsv).exportCsv).toBe('function');
  });

  it('createGanttExportCsv returns a usable feature', () => {
    const f = createGanttExportCsv({ fileName: 'plan.csv' });
    expect(f.name).toBe('exportCsv');
  });
});

describe('GanttExportCsv — serialization through the live model', () => {
  function exporter(opts?: ConstructorParameters<typeof GanttExportCsv>[0]): GanttWithCsv {
    gantt = new Gantt(host, { tasks: sampleTasks(), projectStart: T0 });
    gantt.use(new GanttExportCsv(opts));
    return gantt as GanttWithCsv;
  }

  it('emits a header row + hierarchy + WBS preserved', () => {
    const csv = exporter().exportCsv({ bom: false });
    const lines = csv.split('\r\n');
    // Header.
    expect(lines[0]).toContain('Name');
    expect(lines[0]).toContain('WBS');
    // Summary parent row at depth 0.
    expect(lines[1]!.startsWith('Phase 1,1,')).toBe(true);
    // Child indented two spaces, WBS 1.1.
    expect(lines[2]).toContain('  Design');
    expect(lines[2]).toContain(',1.1,');
    // Second child WBS 1.2.
    expect(lines[3]).toContain('  Build');
    expect(lines[3]).toContain(',1.2,');
  });

  it('exports the CURRENT scheduled span (ISO dates), not a stale value', () => {
    const g = exporter();
    const table = g.exportCsvTable();
    const designRow = table.rows.find((r) => r.id === 'a')!;
    const startCol = table.columns.findIndex((c) => c.field === 'start');
    const cell = designRow.cells[startCol]!;
    expect(cell.kind).toBe('date');
    // The CSV emits ISO dates.
    const csv = g.exportCsv({ bom: false });
    expect(csv).toContain('2026-01-05');
  });

  it('renders percent-done as a percentage', () => {
    const csv = exporter().exportCsv({ bom: false });
    expect(csv).toContain('40%');
  });

  it('honors per-call column + delimiter + bom overrides', () => {
    const csv = exporter().exportCsv({
      bom: false,
      delimiter: ';',
      columns: [{ field: 'name', header: 'Task' }],
    });
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Task');
    expect(lines.some((l) => l.includes('Design'))).toBe(true);
    // No second column present.
    expect(lines[0]).not.toContain(';');
  });

  it('defuses a CSV/formula-injection payload in a user-controlled name', () => {
    gantt = new Gantt(host, {
      tasks: [{ id: 'x', name: '=HYPERLINK("http://evil","x")' } as TaskModel],
      projectStart: T0,
    });
    gantt.use(new GanttExportCsv());
    const csv = (gantt as GanttWithCsv).exportCsv({
      bom: false,
      columns: [{ field: 'name', header: 'Name' }],
    });
    const lines = csv.split('\r\n');
    expect(lines[1]!.startsWith(`"'=HYPERLINK`)).toBe(true);
  });
});

describe('GanttExportCsv — live resolvers (predecessors + resources)', () => {
  it('renders predecessor notation (FS implicit, SS + lag explicit) from live deps', () => {
    const deps: DependencyModel[] = [
      { id: 'd1', fromId: 'a', toId: 'b', type: 'FS' },
      { id: 'd2', fromId: 'a', toId: 'b', type: 'SS', lag: 2 * DAY },
    ];
    gantt = new Gantt(host, { tasks: sampleTasks(), dependencies: deps, projectStart: T0 });
    gantt.use(new GanttExportCsv());
    const table = (gantt as GanttWithCsv).exportCsvTable();
    const predCol = table.columns.findIndex((c) => c.field === 'predecessors');
    const bRow = table.rows.find((r) => r.id === 'b')!;
    const cell = bRow.cells[predCol]!;
    expect(cell.kind).toBe('text');
    const text = cell.kind === 'text' ? cell.value : '';
    // FS implicit → just "a"; SS + 2d lag → "aSS+2d".
    expect(text).toContain('a');
    expect(text).toContain('aSS+2d');
  });

  it('renders assigned resources with units % from the live resource layer', () => {
    gantt = new Gantt(host, {
      tasks: sampleTasks(),
      projectStart: T0,
      resources: [
        { id: 'r1', name: 'Alice' },
        { id: 'r2', name: 'Bob' },
      ],
      assignments: [
        { id: 'as1', taskId: 'a', resourceId: 'r1', units: 50 },
        { id: 'as2', taskId: 'a', resourceId: 'r2', units: 100 },
      ],
    });
    gantt.use(new GanttExportCsv());
    const table = (gantt as GanttWithCsv).exportCsvTable();
    const resCol = table.columns.findIndex((c) => c.field === 'resources');
    const aRow = table.rows.find((r) => r.id === 'a')!;
    const cell = aRow.cells[resCol]!;
    const text = cell.kind === 'text' ? cell.value : '';
    expect(text).toContain('Alice [50%]');
    expect(text).toContain('Bob');
    // Bob is full-time → no units annotation.
    expect(text).not.toContain('Bob [');
  });
});

describe('GanttExportCsv — download (jsdom)', () => {
  it('triggers an anchor-blob download without throwing', () => {
    gantt = new Gantt(host, { tasks: sampleTasks(), projectStart: T0 });
    gantt.use(new GanttExportCsv({ fileName: 'plan.csv' }));

    let clicked = false;
    const origCreate = document.createElement.bind(document);
    const spy = (tag: string): HTMLElement => {
      const el = origCreate(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = () => {
          clicked = true;
        };
      }
      return el;
    };
    // URL.createObjectURL is not implemented in jsdom by default — stub it.
    const urlAny = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    const hadCreate = 'createObjectURL' in URL;
    if (!hadCreate) {
      urlAny.createObjectURL = () => 'blob:mock';
      urlAny.revokeObjectURL = () => undefined;
    }
    // @ts-expect-error narrow override for the test
    document.createElement = spy;
    try {
      (gantt as GanttWithCsv).exportCsvDownload();
      expect(clicked).toBe(true);
    } finally {
      document.createElement = origCreate;
      if (!hadCreate) {
        delete urlAny.createObjectURL;
        delete urlAny.revokeObjectURL;
      }
    }
  });
});
