/**
 * @jects/scheduler — Excel export stories.
 *
 * Living docs / customizer preview scenes for the Excel exporter. Each function
 * builds a `SchedulerExcelExporter` over sample data and renders an export panel
 * (a token-pure toolbar button + the HTML preview of the workbook contents) so
 * the styling recolors live with the active theme. The button triggers a real
 * `.xls` SpreadsheetML download when clicked.
 */

import { SchedulerExcelExporter, type ExcelExportConfig } from './excel.js';
import type { ResourceModel, EventModel, AssignmentModel } from '../contract.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const start = Date.UTC(2025, 0, 6);

const resources: ResourceModel[] = [
  { id: 'r1', name: 'Alice' },
  { id: 'r2', name: 'Bob' },
  { id: 'r3', name: 'Carol' },
];

const events: EventModel[] = [
  { id: 'e1', resourceId: 'r1', name: 'Kickoff', startDate: start, endDate: start + 2 * HOUR, percentDone: 1 },
  { id: 'e2', resourceId: 'r1', name: 'Design', startDate: start + DAY, endDate: start + DAY + 4 * HOUR, percentDone: 0.4 },
  { id: 'e3', resourceId: 'r2', name: 'Build', startDate: start + DAY, endDate: start + 2 * DAY, percentDone: 0.2 },
  { id: 'e4', resourceId: 'r3', name: 'QA', startDate: start + 2 * DAY, endDate: start + 2 * DAY + 3 * HOUR },
];

const assignments: AssignmentModel[] = [
  { id: 'a1', eventId: 'e1', resourceId: 'r1', units: 1 },
  { id: 'a2', eventId: 'e1', resourceId: 'r2', units: 0.5 },
  { id: 'a3', eventId: 'e3', resourceId: 'r2', units: 1 },
];

/** Render an export panel (toolbar + preview table) for an exporter. */
function panel(exporter: SchedulerExcelExporter, host: HTMLElement): HTMLElement {
  host.className = 'jects-scheduler-export';

  const toolbar = document.createElement('div');
  toolbar.className = 'jects-scheduler-export__toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Export');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'jects-scheduler-export__btn';
  button.textContent = 'Export to Excel';
  button.addEventListener('click', () => exporter.download());
  toolbar.appendChild(button);

  const csv = document.createElement('button');
  csv.type = 'button';
  csv.className = 'jects-scheduler-export__btn';
  csv.textContent = 'Export CSV';
  csv.addEventListener('click', () => exporter.downloadCsv());
  toolbar.appendChild(csv);

  const region = document.createElement('div');
  region.setAttribute('role', 'region');
  region.setAttribute('aria-label', 'Export preview');
  region.innerHTML = exporter.toHtmlTable();

  host.replaceChildren(toolbar, region);
  return host;
}

function build(config: ExcelExportConfig, withAssignments = false): HTMLElement {
  const host = document.createElement('div');
  const ex = new SchedulerExcelExporter(
    {
      resources,
      events,
      ...(withAssignments ? { assignments } : {}),
      range: { start, end: start + 4 * DAY },
    },
    config,
  );
  return panel(ex, host);
}

/** Default event-list export. */
export function eventList(): HTMLElement {
  return build({ layout: 'event-list', fileName: 'schedule-events' });
}

/** Event-list with multi-assignments (one row per assignment + a Units column). */
export function eventListWithAssignments(): HTMLElement {
  return build({ layout: 'event-list', fileName: 'schedule-assignments' }, true);
}

/** Resource × time-slot grid (event names per day). */
export function resourceGrid(): HTMLElement {
  return build({ layout: 'resource-grid', slotMs: DAY, fileName: 'schedule-grid' });
}

/** Resource × time-slot grid with numeric occupancy counts. */
export function resourceGridCounts(): HTMLElement {
  return build({ layout: 'resource-grid', slotMs: DAY, cellMode: 'count', fileName: 'schedule-load' });
}

export default {
  title: 'Scheduler/Export Excel',
  stories: { eventList, eventListWithAssignments, resourceGrid, resourceGridCounts },
};
