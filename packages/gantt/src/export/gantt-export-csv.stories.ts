/**
 * CSV-export stories — framework-free usage examples for the Gantt **CSV export**
 * feature, used by the docs app and as a canonical reference. Each story mounts a
 * configured `Gantt` (with `GanttExportCsv` installed) plus a "Download CSV"
 * button and a live HTML preview of the exported rows.
 */
import { Gantt } from '../ui/gantt.js';
import { GanttExportCsv } from './gantt-export-csv.js';
import { cellToText, type ExportTable } from './serialize.js';
import type { CsvExportOptions } from './export-csv.js';
import type { TaskModel, DependencyModel } from '../contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Gantt;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

type GanttWithCsv = Gantt & {
  exportCsv(options?: CsvExportOptions): string;
  exportCsvTable(options?: CsvExportOptions): ExportTable;
  exportCsvDownload(fileName?: string, options?: CsvExportOptions): void;
};

function plan(): TaskModel[] {
  return [
    { id: 'p', name: 'Release 1.0' },
    { id: 'a', name: 'Design', parentId: 'p', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY, percentDone: 0.6 } as TaskModel,
    { id: 'b', name: 'Build', parentId: 'p', start: T0 + 4 * DAY, duration: 5 * DAY, end: T0 + 9 * DAY } as TaskModel,
    { id: 'c', name: 'QA', parentId: 'p', start: T0 + 9 * DAY, duration: 3 * DAY, end: T0 + 12 * DAY } as TaskModel,
  ];
}

function deps(): DependencyModel[] {
  return [
    { id: 'd1', fromId: 'a', toId: 'b', type: 'FS', lag: DAY },
    { id: 'd2', fromId: 'b', toId: 'c', type: 'FS' },
  ];
}

/** Render a live preview table of the export below the chart. */
function withPreview(host: HTMLElement, gantt: GanttWithCsv): Gantt {
  const bar = document.createElement('div');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Download CSV';
  btn.addEventListener('click', () => gantt.exportCsvDownload('release-1.0.csv'));
  bar.append(btn);
  host.append(bar);

  const preview = document.createElement('table');
  preview.setAttribute('aria-label', 'CSV export preview');
  const rebuild = (): void => {
    const table = gantt.exportCsvTable();
    const nameCol = table.columns.findIndex((c) => c.field === 'name');
    preview.replaceChildren();
    const thead = preview.insertRow();
    for (const c of table.columns) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = c.header ?? c.field;
      thead.append(th);
    }
    for (const row of table.rows) {
      const tr = preview.insertRow();
      row.cells.forEach((cell, i) => {
        const td = tr.insertCell();
        const indent = i === nameCol && row.depth > 0 ? ' '.repeat(row.depth) : '';
        td.textContent = indent + cellToText(cell);
      });
    }
  };
  rebuild();
  gantt.on('scheduleChange', rebuild);
  host.append(preview);
  return gantt;
}

export const stories: Story[] = [
  {
    name: 'Export project grid to CSV (download + preview)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: plan(), dependencies: deps(), projectStart: T0 });
      gantt.use(new GanttExportCsv({ fileName: 'release-1.0.csv' }));
      return withPreview(host, gantt as GanttWithCsv);
    },
  },
  {
    name: 'CSV with resources + European delimiter',
    render: (host) => {
      const gantt = new Gantt(host, {
        tasks: plan(),
        dependencies: deps(),
        projectStart: T0,
        resources: [
          { id: 'r1', name: 'Alice' },
          { id: 'r2', name: 'Bob' },
        ],
        assignments: [
          { id: 'as1', taskId: 'a', resourceId: 'r1', units: 50 },
          { id: 'as2', taskId: 'b', resourceId: 'r2', units: 100 },
        ],
      });
      gantt.use(new GanttExportCsv({ delimiter: ';', fileName: 'release-1.0-eu.csv' }));
      return withPreview(host, gantt as GanttWithCsv);
    },
  },
];
