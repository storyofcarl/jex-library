/**
 * axe-core a11y + visual/interaction browser test for the Gantt **CSV export**
 * feature (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * The CSV export itself is a data path (a string), so the "visual" exercise here
 * builds the accessible HTML-table PREVIEW the export is derived from — the same
 * resolved {@link ExportTable} the CSV writer serializes — renders it as a real
 * `<table>` next to a live `Gantt`, and asserts:
 *   - zero serious/critical axe violations on the rendered preview,
 *   - the preview's header + body cells match the exported CSV rows (ISO dates,
 *     `%` percent, hierarchy indent), proving the on-screen grid and the export
 *     agree,
 *   - the live resolvers (predecessors + resources) reach the rendered cells,
 *   - a "Download CSV" button wired to `gantt.exportCsvDownload()` is operable and
 *     produces a blob whose text round-trips the exported string.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the shipped, token-pure package stylesheet so the preview is themed.
import '../styles.css';
import { Gantt } from '../ui/gantt.js';
import { GanttExportCsv } from './gantt-export-csv.js';
import { cellToText, type ExportTable } from './serialize.js';
import type { CsvExportOptions } from './export-csv.js';
import type { TaskModel, DependencyModel } from '../contract.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

type GanttWithCsv = Gantt & {
  exportCsv(options?: CsvExportOptions): string;
  exportCsvTable(options?: CsvExportOptions): ExportTable;
  exportCsvDownload(fileName?: string, options?: CsvExportOptions): void;
};

let host: HTMLElement;
let mount: HTMLElement;
let gantt: Gantt | null = null;

function tasks(): TaskModel[] {
  return [
    { id: 'p', name: 'Phase 1' },
    { id: 'a', name: 'Design', parentId: 'p', start: T0, duration: 3 * DAY, end: T0 + 3 * DAY, percentDone: 0.4 } as TaskModel,
    { id: 'b', name: 'Build', parentId: 'p', start: T0 + 3 * DAY, duration: 3 * DAY, end: T0 + 6 * DAY } as TaskModel,
  ];
}

function deps(): DependencyModel[] {
  return [{ id: 'd1', fromId: 'a', toId: 'b', type: 'FS', lag: DAY }];
}

/** Render an accessible HTML-table preview from a resolved export table. */
function renderPreview(into: HTMLElement, table: ExportTable): HTMLTableElement {
  const nameCol = table.columns.findIndex((c) => c.field === 'name');
  const tbl = document.createElement('table');
  tbl.className = 'jects-gantt-csv-preview';
  const caption = document.createElement('caption');
  caption.textContent = 'CSV export preview';
  tbl.append(caption);

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const c of table.columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = c.header ?? c.field;
    hr.append(th);
  }
  thead.append(hr);
  tbl.append(thead);

  const tbody = document.createElement('tbody');
  for (const row of table.rows) {
    const tr = document.createElement('tr');
    row.cells.forEach((cell, i) => {
      const td = document.createElement('td');
      const indent = i === nameCol && row.depth > 0 ? ' '.repeat(row.depth) : '';
      td.textContent = indent + cellToText(cell);
      tr.append(td);
    });
    tbody.append(tr);
  }
  tbl.append(tbody);
  into.append(tbl);
  return tbl;
}

beforeEach(() => {
  host = document.createElement('div');
  host.style.position = 'relative';
  host.style.height = '260px';
  host.style.width = '900px';
  document.body.appendChild(host);

  mount = document.createElement('div');
  mount.style.width = '900px';
  document.body.appendChild(mount);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
  mount.remove();
});

describe('GanttExportCsv a11y + visual (real Chromium)', () => {
  it('renders an accessible preview that agrees with the exported CSV', async () => {
    gantt = new Gantt(host, { tasks: tasks(), dependencies: deps(), projectStart: T0 });
    gantt.use(new GanttExportCsv());
    const g = gantt as GanttWithCsv;

    const table = g.exportCsvTable();
    renderPreview(mount, table);

    await expectNoA11yViolations(mount);

    // Header cells present.
    const headers = [...mount.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toContain('Name');
    expect(headers).toContain('WBS');
    expect(headers).toContain('Predecessors');

    // The preview body and the CSV agree on the scheduled ISO start + percent.
    const previewText = mount.textContent ?? '';
    expect(previewText).toContain('2026-01-05');
    expect(previewText).toContain('40%');

    const csv = g.exportCsv({ bom: false });
    expect(csv).toContain('2026-01-05');
    expect(csv).toContain('40%');

    // Hierarchy preserved: a child WBS (1.1) appears.
    expect(csv).toContain(',1.1,');

    // Live predecessor resolver reached the preview: "b" follows "a" FS + 1d lag.
    expect(previewText).toContain('a+1d');
  });

  it('renders resource labels with units % from the live resource layer', async () => {
    gantt = new Gantt(host, {
      tasks: tasks(),
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
    const g = gantt as GanttWithCsv;

    renderPreview(mount, g.exportCsvTable());
    await expectNoA11yViolations(mount);

    const text = mount.textContent ?? '';
    expect(text).toContain('Alice [50%]');
    expect(text).toContain('Bob');
  });

  it('exposes an operable Download CSV button that produces the export blob', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportCsv({ fileName: 'plan.csv' }));
    const g = gantt as GanttWithCsv;

    let downloadedName = '';
    let downloadedHref = '';
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
      downloadedName = this.download;
      downloadedHref = this.href;
    };

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Download CSV';
    btn.addEventListener('click', () => g.exportCsvDownload());
    mount.append(btn);

    try {
      await expectNoA11yViolations(mount);
      btn.click();
      expect(downloadedName).toBe('plan.csv');
      expect(downloadedHref.startsWith('blob:')).toBe(true);

      // The exported string round-trips through the blob URL.
      const res = await fetch(downloadedHref);
      const text = await res.text();
      // Drop the BOM (U+FEFF) for the comparison.
      expect(text.replace(/^\uFEFF/u, '')).toBe(g.exportCsv({ bom: false }));
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
    }
  });
});
