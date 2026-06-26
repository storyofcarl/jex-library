/**
 * XLSX-export stories — framework-free usage examples for the Gantt **Excel
 * (XLSX) export** feature, used by the docs app and as a canonical reference.
 *
 * The XLSX writer is data-only (it produces an OOXML `.xlsx` package), so these
 * stories mount the accessible "export ready" preview panel + download button
 * over a sample project tree, driven through the disposable `GanttXlsxExporter`
 * controller — the exact resolver wiring (`predecessorsOf` / `resourcesOf` /
 * `hoursPerDay`) a `Gantt` supplies when it installs the feature.
 */
import {
  GanttXlsxExporter,
  buildXlsxPreview,
  tasksToXlsx,
  type XlsxExportOptions,
} from './export-xlsx.js';
import type { TaskModel } from '../contract.js';
import type { TaskTreeSource } from './serialize.js';
import './export-xlsx.css';

export interface Story {
  name: string;
  render: (host: HTMLElement) => { destroy(): void };
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

/** A small project tree (parent → leaves) the stories export. */
function plan(): TaskTreeSource {
  const roots: Array<TaskModel & { children?: TaskModel[] }> = [
    {
      id: 'p',
      name: 'Release 1.0',
      children: [
        { id: 'a', name: 'Design', start: T0, duration: 5 * DAY, end: T0 + 5 * DAY, percentDone: 1 } as TaskModel,
        { id: 'b', name: 'Build', start: T0 + 5 * DAY, duration: 8 * DAY, end: T0 + 13 * DAY, percentDone: 0.4 } as TaskModel,
        { id: 'c', name: 'Test', start: T0 + 13 * DAY, duration: 4 * DAY, end: T0 + 17 * DAY, percentDone: 0 } as TaskModel,
      ],
    } as TaskModel & { children: TaskModel[] },
  ];
  return {
    items: roots,
    getChildren: (n) =>
      (typeof n === 'object' ? (n.children ?? []) : []) as TaskModel[],
  };
}

const RESOLVERS = {
  predecessorsOf: (id: TaskModel['id']) =>
    id === 'b' ? 'a' : id === 'c' ? 'b' : '',
  resourcesOf: (id: TaskModel['id']) =>
    id === 'a' ? 'Alice [100%]' : id === 'b' ? 'Bob, Carol' : '',
};

/** Mount the accessible export preview + download button via the controller. */
function mountPreview(
  host: HTMLElement,
  options: XlsxExportOptions = {},
): { destroy(): void } {
  const exporter = new GanttXlsxExporter({ source: plan(), ...RESOLVERS });
  const preview = exporter.buildPreview({ filename: 'release-1.0', ...options });
  host.appendChild(preview.el);
  return {
    destroy(): void {
      preview.destroy();
      exporter.destroy();
    },
  };
}

export const stories: Story[] = [
  {
    name: 'Default — typed cells, native outline grouping, download',
    render: (host) => mountPreview(host),
  },
  {
    name: 'No textual indent (native Excel grouping carries the hierarchy)',
    render: (host) => mountPreview(host, { indent: '' }),
  },
  {
    name: 'Flat (outline grouping disabled)',
    render: (host) => mountPreview(host, { outline: false }),
  },
  {
    name: 'Custom date mask (dd/mm/yyyy) + sheet name',
    render: (host) =>
      mountPreview(host, { dateFormat: 'dd/mm/yyyy', sheetName: 'Schedule' }),
  },
  {
    name: 'Direct bytes (no preview) — tasksToXlsx → Uint8Array',
    render: (host) => {
      const bytes = tasksToXlsx(plan(), RESOLVERS);
      const preview = buildXlsxPreview(
        { columns: [{ field: 'name', header: 'Result', type: 'text' }], rows: [] },
        { filename: 'release-1.0', title: `Generated ${bytes.length}-byte .xlsx` },
      );
      host.appendChild(preview.el);
      return preview;
    },
  },
];

export default stories;
