/**
 * axe-core a11y + visual/interaction browser test for the Gantt **CSV export**
 * feature (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * The CSV export feature otherwise ships no on-screen DOM (it produces a string +
 * a file download), so this exercises the two real-browser-only surfaces:
 *   1. The accessible HTML `<table>` PREVIEW (`feature.previewCsv()`) — a faithful,
 *      semantic mirror of the CSV contents — mounts with zero serious/critical axe
 *      violations and renders real, laid-out columns/rows with the WBS hierarchy
 *      indent and display formatting.
 *   2. The DOWNLOAD path (`exportCsv()` with `download: true`) actually mints a
 *      `text/csv` object-URL Blob in a real browser (jsdom can't), proving the
 *      end-to-end save path, and the produced CSV string round-trips the grid.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the shipped, token-pure preview stylesheet so the a11y/contrast checks run
// against the real CSS rather than unstyled defaults.
import './csv-export.css';
import { Gantt } from '../ui/gantt.js';
import { installCsvExport } from './csv-export.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { TaskModel, DependencyModel } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let preview: HTMLElement;
let gantt: Gantt | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.height = '320px';
  host.style.width = '960px';
  document.body.appendChild(host);
  // A separate mount point for the accessible preview table.
  preview = document.createElement('div');
  preview.style.width = '960px';
  document.body.appendChild(preview);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
  preview.remove();
});

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
    } as TaskModel,
  ];
}

function deps(): DependencyModel[] {
  return [{ id: 'd1', fromId: 'a', toId: 'b', type: 'FS', lag: DAY } as DependencyModel];
}

describe('Gantt CSV export a11y + visual (real Chromium)', () => {
  it('renders an accessible CSV preview table with real geometry and no serious/critical violations', async () => {
    gantt = new Gantt(host, { tasks: plan(), dependencies: deps(), projectStart: T0 });
    const feature = installCsvExport(gantt);

    const table = feature.previewCsv({ caption: 'Project plan (CSV preview)' });
    preview.appendChild(table);

    await expectNoA11yViolations(preview);

    // Semantic structure: a caption, column headers, and one row per task.
    expect(table.querySelector('caption')!.textContent).toContain('CSV preview');
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toContain('Name');
    expect(headers).toContain('WBS');
    expect(headers).toContain('Predecessors');

    const rows = [...table.querySelectorAll('tbody tr')] as HTMLTableRowElement[];
    expect(rows.map((r) => r.dataset.taskId)).toEqual(['p', 'a', 'b']);

    // The summary (parent) row is flagged and outline level is exposed to AT.
    const summary = rows.find((r) => r.dataset.taskId === 'p')!;
    expect(summary.className).toContain('--summary');
    expect(summary.getAttribute('aria-level')).toBe('1');
    expect(rows.find((r) => r.dataset.taskId === 'a')!.getAttribute('aria-level')).toBe('2');

    // Real layout: the rendered table has non-zero size and laid-out cells.
    const rect = table.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);

    // The Build row's Predecessors cell carries the wired Gantt notation.
    const buildRow = rows.find((r) => r.dataset.taskId === 'b')!;
    const predIdx = headers.indexOf('Predecessors');
    expect(buildRow.cells[predIdx]!.textContent).toBe('a+1d');
  });

  it('downloads a real text/csv Blob (object-URL path) and round-trips the grid', async () => {
    gantt = new Gantt(host, { tasks: plan(), dependencies: deps(), projectStart: T0 });
    const feature = installCsvExport(gantt, { filename: 'project-plan.csv' });

    // Spy on the real browser object-URL + anchor click to prove the save path
    // executes end-to-end in Chromium (jsdom lacks createObjectURL entirely).
    const created: Blob[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    let clicks = 0;
    URL.createObjectURL = ((b: Blob) => {
      created.push(b);
      return origCreate.call(URL, b);
    }) as typeof URL.createObjectURL;
    const clickProto = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clicks++;
      /* swallow the navigation in test */
    };

    try {
      const csv = feature.exportCsv(); // download: true by default
      // The CSV string round-trips the grid. Strip a leading UTF-8 BOM
      // (codepoint 0xFEFF) without embedding the literal char in the source.
      const body = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
      const lines = body.split('\r\n');
      expect(lines[0]).toContain('Name,WBS,Start');
      expect(lines[1]!.startsWith('Release 1.0,1,')).toBe(true);
      expect(lines[2]!.startsWith('  Design,1.1,')).toBe(true);

      // A real text/csv Blob was minted and an anchor was clicked to save it.
      expect(created.length).toBe(1);
      expect(created[0]!.type).toContain('text/csv');
      expect(clicks).toBe(1);
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      HTMLAnchorElement.prototype.click = clickProto;
    }
  });
});
