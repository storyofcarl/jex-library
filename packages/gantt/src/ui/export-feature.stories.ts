/**
 * Stories — framework-free usage examples for the **unified export menu / format
 * dispatcher UI** (`GanttExportMenu`), used by the docs app and as a canonical
 * reference for how to install + drive the feature.
 *
 * Each story mounts a real `Gantt` over a small project, installs one or more of
 * the per-format export wiring features (so the dispatcher's availability
 * detection lights up the matching menu entries), then installs the
 * `GanttExportMenu` — the single Export button that opens a Menu of the available
 * formats (CSV / Excel / Image / PDF / iCalendar / MS Project) plus Print, and
 * dispatches the chosen one to its exporter.
 */
import { Gantt } from './gantt.js';
import { GanttExportMenu } from './export-feature.js';
import { GanttExportCsv } from '../export/gantt-export-csv.js';
import { GanttExportXlsx } from '../export/gantt-export-xlsx.js';
import { GanttIcsExportFeature } from '../export/gantt-ics-export.js';
import type { TaskModel } from '../contract.js';
import './export-feature.css';

export interface Story {
  name: string;
  render: (host: HTMLElement) => { destroy(): void };
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

function plan(): TaskModel[] {
  return [
    { id: 'p', name: 'Release 1.0' } as TaskModel,
    { id: 'a', name: 'Design', parentId: 'p', start: T0, duration: 5 * DAY, end: T0 + 5 * DAY, percentDone: 1 } as TaskModel,
    { id: 'b', name: 'Build', parentId: 'p', start: T0 + 5 * DAY, duration: 8 * DAY, end: T0 + 13 * DAY, percentDone: 0.4 } as TaskModel,
    { id: 'c', name: 'Test', parentId: 'p', start: T0 + 13 * DAY, duration: 4 * DAY, end: T0 + 17 * DAY, percentDone: 0 } as TaskModel,
  ];
}

function mount(host: HTMLElement): Gantt {
  host.style.position = 'relative';
  host.style.height = '360px';
  return new Gantt(host, { tasks: plan(), projectStart: T0 });
}

export const stories: Story[] = [
  {
    name: 'Export menu — all wired formats + print',
    render(host) {
      const gantt = mount(host);
      // Install the per-format exporters so the dispatcher offers them.
      gantt.use(new GanttExportCsv());
      gantt.use(new GanttExportXlsx());
      gantt.use(new GanttIcsExportFeature());
      // The single user-facing entry point: an Export button → format menu.
      gantt.use(new GanttExportMenu({ filename: 'release-1.0' }));
      return { destroy: () => gantt.destroy() };
    },
  },
  {
    name: 'Export menu — CSV only',
    render(host) {
      const gantt = mount(host);
      gantt.use(new GanttExportCsv());
      // With only CSV wired, the menu shows CSV + MS Project + Print
      // (MS Project + Print are always available through the public API).
      gantt.use(new GanttExportMenu({ label: 'Export plan' }));
      return { destroy: () => gantt.destroy() };
    },
  },
  {
    name: 'Export menu — restricted format set',
    render(host) {
      const gantt = mount(host);
      gantt.use(new GanttExportCsv());
      gantt.use(new GanttExportXlsx());
      // Explicitly choose + order which formats appear (still gated by
      // availability unless force-included via `include`).
      gantt.use(
        new GanttExportMenu({
          formats: ['csv', 'xlsx', 'print'],
          menuLabel: 'Choose a format',
        }),
      );
      return { destroy: () => gantt.destroy() };
    },
  },
];

export default stories;
