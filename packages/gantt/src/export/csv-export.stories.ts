/**
 * CSV-export stories — framework-free usage examples for the Gantt **CSV export**
 * feature, used by the docs app and as a canonical reference. Each story mounts a
 * configured `Gantt` with the CSV-export feature installed and wires a small
 * toolbar button that triggers `exportCsv()` (download) and renders the accessible
 * preview table alongside.
 */
import { Gantt } from '../ui/gantt.js';
import {
  installCsvExport,
  type GanttCsvExportFeature,
} from './csv-export.js';
import type { TaskModel, DependencyModel } from '../contract.js';

export interface Story {
  name: string;
  render: (host: HTMLElement) => Gantt;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

function plan(): TaskModel[] {
  return [
    { id: 'p', name: 'Release 1.0' } as TaskModel,
    { id: 'a', name: 'Design', parentId: 'p', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY, percentDone: 0.6 } as TaskModel,
    { id: 'b', name: 'Build', parentId: 'p', start: T0 + 3 * DAY, duration: 4 * DAY, end: T0 + 7 * DAY, percentDone: 0.2 } as TaskModel,
    { id: 'c', name: 'QA', parentId: 'p', start: T0 + 7 * DAY, duration: 2 * DAY, end: T0 + 9 * DAY } as TaskModel,
  ];
}

function deps(): DependencyModel[] {
  return [
    { id: 'd1', fromId: 'a', toId: 'b', type: 'FS' } as DependencyModel,
    { id: 'd2', fromId: 'b', toId: 'c', type: 'FS', lag: DAY } as DependencyModel,
  ];
}

/** Mount a Gantt + an "Export CSV" button + the accessible preview table. */
function mountWithToolbar(
  host: HTMLElement,
  feature: GanttCsvExportFeature,
  gantt: Gantt,
): Gantt {
  const bar = document.createElement('div');
  bar.style.display = 'flex';
  bar.style.gap = '0.5rem';
  bar.style.marginBlockEnd = '0.5rem';

  const btn = document.createElement('button');
  btn.className = 'jects-btn jects-btn--primary jects-btn--sm';
  btn.textContent = 'Export CSV';
  btn.addEventListener('click', () => feature.exportCsv());
  bar.appendChild(btn);

  const previewBtn = document.createElement('button');
  previewBtn.className = 'jects-btn jects-btn--sm';
  previewBtn.textContent = 'Show preview';
  const previewMount = document.createElement('div');
  previewMount.style.marginBlockStart = '0.75rem';
  previewBtn.addEventListener('click', () => {
    previewMount.replaceChildren(feature.previewCsv({ caption: 'CSV export preview' }));
  });
  bar.appendChild(previewBtn);

  host.prepend(bar);
  host.appendChild(previewMount);
  return gantt;
}

export const stories: Story[] = [
  {
    name: 'Export the task grid to CSV (download + preview)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: plan(), dependencies: deps(), projectStart: T0 });
      const feature = installCsvExport(gantt, { filename: 'release-1.0.csv' });
      return mountWithToolbar(host, feature, gantt);
    },
  },
  {
    name: 'European Excel variant (";" delimiter)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: plan(), dependencies: deps(), projectStart: T0 });
      const feature = installCsvExport(gantt, {
        filename: 'release-1.0-eu.csv',
        delimiter: ';',
      });
      return mountWithToolbar(host, feature, gantt);
    },
  },
  {
    name: 'Leaf tasks only (no summary rows)',
    render: (host) => {
      const gantt = new Gantt(host, { tasks: plan(), dependencies: deps(), projectStart: T0 });
      const feature = installCsvExport(gantt, { includeSummaryRows: false });
      return mountWithToolbar(host, feature, gantt);
    },
  },
];
