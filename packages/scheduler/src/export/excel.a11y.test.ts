/**
 * Accessibility + interaction test for the Scheduler Excel export — real
 * Chromium via `vitest --config vitest.browser.config.ts`. Asserts zero
 * serious/critical axe violations (Quality Gate Q2) on the rendered export
 * preview (toolbar button + data table), and exercises the feature end-to-end:
 * clicking the "Export to Excel" button invokes the exporter and triggers an
 * `.xls` download (intercepted), and the preview table accurately reflects the
 * resolved rows.
 *
 * The exporter is a standalone module (see excel.ts wireNotes) — it reads a
 * `SchedulerExportSource` snapshot — so this test builds the source directly and
 * mounts the preview markup the feature emits.
 */
import { describe, it, afterEach, expect, vi } from 'vitest';
import '@jects/theme/style.css';
import '../styles.css';
import { SchedulerExcelExporter } from './excel.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { ResourceModel, EventModel } from '../contract.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const start = Date.UTC(2025, 0, 1);

const RESOURCES: ResourceModel[] = [
  { id: 'r1', name: 'Alice' },
  { id: 'r2', name: 'Bob' },
];
const EVENTS: EventModel[] = [
  { id: 'e1', resourceId: 'r1', name: 'Kickoff', startDate: start, endDate: start + 2 * HOUR },
  { id: 'e2', resourceId: 'r2', name: 'Review', startDate: start + DAY, endDate: start + DAY + HOUR },
];

let host: HTMLElement;

afterEach(() => {
  host?.remove();
  vi.restoreAllMocks();
});

/** Mount an export panel: a labelled toolbar button + the preview table. */
function mountPanel(exporter: SchedulerExcelExporter): { host: HTMLElement; button: HTMLButtonElement } {
  host = document.createElement('div');
  host.className = 'jects-scheduler-export';
  host.style.width = '600px';
  document.body.appendChild(host);

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

  const region = document.createElement('div');
  region.setAttribute('role', 'region');
  region.setAttribute('aria-label', 'Export preview');
  region.innerHTML = exporter.toHtmlTable();

  host.append(toolbar, region);
  return { host, button };
}

describe('Scheduler Excel export a11y + interaction (browser)', () => {
  it('has no serious/critical axe violations (event-list preview)', async () => {
    const ex = new SchedulerExcelExporter({ resources: RESOURCES, events: EVENTS, range: { start, end: start + 3 * DAY } });
    const { host: h } = mountPanel(ex);
    await expectNoA11yViolations(h);
  });

  it('has no serious/critical axe violations (resource-grid preview)', async () => {
    const ex = new SchedulerExcelExporter(
      { resources: RESOURCES, events: EVENTS, range: { start, end: start + 3 * DAY } },
      { layout: 'resource-grid', slotMs: DAY },
    );
    const { host: h } = mountPanel(ex);
    await expectNoA11yViolations(h);
  });

  it('preview table has column headers with scope and a row per event', () => {
    const ex = new SchedulerExcelExporter({ resources: RESOURCES, events: EVENTS, range: { start, end: start + 3 * DAY } });
    const { host: h } = mountPanel(ex);
    const headers = h.querySelectorAll('th[scope="col"]');
    expect(headers.length).toBeGreaterThan(0);
    expect(Array.from(headers).map((t) => t.textContent)).toContain('Resource');
    const bodyRows = h.querySelectorAll('tbody tr');
    expect(bodyRows.length).toBe(2); // e1, e2
    expect(h.textContent).toContain('Kickoff');
    expect(h.textContent).toContain('Review');
  });

  it('clicking the button triggers an .xls download', () => {
    const ex = new SchedulerExcelExporter(
      { resources: RESOURCES, events: EVENTS, range: { start, end: start + 3 * DAY } },
      { fileName: 'roster' },
    );
    const downloads: string[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {
          downloads.push((el as HTMLAnchorElement).download);
        });
      }
      return el;
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const { button } = mountPanel(ex);
    button.click();
    expect(downloads).toEqual(['roster.xls']);
  });

  it('the export button is keyboard-focusable with an accessible name', () => {
    const ex = new SchedulerExcelExporter({ resources: RESOURCES, events: EVENTS, range: { start, end: start + 3 * DAY } });
    const { button } = mountPanel(ex);
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.textContent).toBe('Export to Excel');
  });
});
