/**
 * Completeness harness: a multi-summary, 24-task project must serialize FULLY in
 * every export format (no truncated rows, no missing tasks, no clipped pages).
 */
import { describe, it, expect } from 'vitest';
import type { TaskModel } from '../contract.js';
import type { TaskTreeSource } from './serialize.js';
import { tasksToCsv } from './export-csv.js';
import { tasksToXlsx } from './export-xlsx.js';
import { tasksToIcs } from './export-ics.js';
import { planPdfPages } from './pdf.js';
import { exportMsProject, type MsProjectBundle } from '../io/msproject.js';
import { ganttTreeSource } from './gantt-ics-export.js';
import type { GanttApi } from '../contract.js';

const DAY = 86_400_000;
const BASE = Date.UTC(2024, 0, 1);

/* 4 phases × 5 leaf tasks = 24 rows (4 summaries + 20 leaves). */
interface Node extends TaskModel {
  children?: Node[];
}

function buildTree(): { roots: Node[]; flat: TaskModel[] } {
  const roots: Node[] = [];
  const flat: TaskModel[] = [];
  let day = 0;
  for (let p = 0; p < 4; p++) {
    const pid = `phase-${p}`;
    const phaseStart = BASE + day * DAY;
    const children: Node[] = [];
    const childFlat: TaskModel[] = [];
    for (let c = 0; c < 5; c++) {
      const start = BASE + day * DAY;
      const end = start + 2 * DAY;
      const leaf: Node = {
        id: `t-${p}-${c}`,
        name: `Task ${p}.${c}`,
        start,
        end,
        duration: 2 * DAY,
        percentDone: 0.5,
        parentId: pid,
      };
      children.push(leaf);
      childFlat.push({ ...leaf, children: undefined });
      day += 2;
    }
    const summary: Node = {
      id: pid,
      name: `Phase ${p}`,
      start: phaseStart,
      end: BASE + day * DAY,
      duration: 10 * DAY,
      parentId: null,
      summary: true,
      children,
    };
    roots.push(summary);
    // flat order: summary first, then its children (depth-first).
    flat.push(
      {
        id: summary.id,
        name: summary.name,
        start: summary.start,
        end: summary.end,
        duration: summary.duration,
        parentId: null,
        summary: true,
      },
      ...childFlat,
    );
  }
  return { roots, flat };
}

function source(roots: Node[]): TaskTreeSource {
  return {
    items: roots,
    getChildren: (n) =>
      (typeof n === 'object' ? (n.children ?? []) : []) as TaskModel[],
  };
}

const TOTAL = 24; // 4 summaries + 20 leaves

/* ── store-method zip reader (mirrors export-xlsx.test.ts) ──────────────── */
const DECODER = new TextDecoder();
function readU16(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}
function readU32(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}
function unzip(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  let o = 0;
  while (o + 4 <= bytes.length && readU32(bytes, o) === 0x04034b50) {
    const size = readU32(bytes, o + 18);
    const nameLen = readU16(bytes, o + 26);
    const extraLen = readU16(bytes, o + 28);
    const nameStart = o + 30;
    const name = DECODER.decode(bytes.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    out.set(name, DECODER.decode(bytes.subarray(dataStart, dataStart + size)));
    o = dataStart + size;
  }
  return out;
}

describe('export completeness — 24-task project', () => {
  it('CSV: every task row present + header', () => {
    const csv = tasksToCsv(source(buildTree().roots), { bom: false });
    const lines = csv.trimEnd().split('\r\n');
    expect(lines.length).toBe(TOTAL + 1); // +1 header
    // every leaf + summary name appears
    for (let p = 0; p < 4; p++) {
      expect(csv).toContain(`Phase ${p}`);
      for (let c = 0; c < 5; c++) expect(csv).toContain(`Task ${p}.${c}`);
    }
  });

  it('XLSX: valid zip whose worksheet carries every row', () => {
    const bytes = tasksToXlsx(source(buildTree().roots));
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
    // EOCD present
    const eocd = bytes.length - 22;
    expect(readU32(bytes, eocd)).toBe(0x06054b50);
    const files = unzip(bytes);
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    const rowCount = (sheet.match(/<row /g) ?? []).length;
    expect(rowCount).toBe(TOTAL + 1); // +1 header
    expect(sheet).toContain(`A${TOTAL + 1}`); // last row addressed
  });

  it('ICS: a VEVENT per task with DTSTART/DTEND', () => {
    const ics = tasksToIcs(source(buildTree().roots), { now: BASE });
    const vevents = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    expect(vevents).toBe(TOTAL);
    const dtstart = (ics.match(/DTSTART/g) ?? []).length;
    expect(dtstart).toBe(TOTAL);
  });

  it('MS-Project XML: a <Task> per task with dates', () => {
    const { flat } = buildTree();
    const bundle: MsProjectBundle = {
      tasks: flat,
      dependencies: [],
      calendars: [],
      resources: [],
      assignments: [],
      baselines: [],
    };
    const xml = exportMsProject(bundle);
    const tasks = (xml.match(/<Task>/g) ?? []).length;
    expect(tasks).toBe(TOTAL);
    const finishes = (xml.match(/<Finish>/g) ?? []).length;
    expect(finishes).toBe(TOTAL);
  });

  it('ICS feature: sources the FULL store, not the visible/virtualized rows', () => {
    // Mimic a real Gantt: `getConfig().tasks` holds the full project, but the
    // timeline row provider is EMPTY (export before first render / collapsed view).
    const { flat } = buildTree();
    const byId = new Map(flat.map((t) => [t.id, t]));
    const api = {
      getConfig: () => ({ tasks: flat }),
      getTask: (id: TaskModel['id']) => byId.get(id),
      getChildren: (id: TaskModel['id']) =>
        flat.filter((t) => t.parentId === id) as ReadonlyArray<TaskModel>,
      // Empty/virtualized row provider — the OLD source would yield 0 events here.
      timeline: { rows: { count: 0, rowAt: () => undefined } },
    } as unknown as GanttApi;

    const src = ganttTreeSource(api);
    const ics = tasksToIcs(src, { now: BASE });
    const vevents = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    expect(vevents).toBe(TOTAL); // every task present despite an empty row provider
    for (let p = 0; p < 4; p++) expect(ics).toContain(`SUMMARY:Phase ${p}`);
  });

  it('PDF: pagination covers the full chart height (not one clipped page)', () => {
    // A tall chart: 24 rows * ~40px + header ≈ 1000px tall, narrow.
    const chartW = 600;
    const chartH = 24 * 40 + 60;
    const plan = planPdfPages(chartW, chartH, { page: 'A4', orientation: 'portrait' });
    // The union of all tile source rects must cover the whole chart height.
    let coveredCss = 0;
    for (const t of plan.tiles) coveredCss = Math.max(coveredCss, (t.sy + t.sh) / 2); // pixelRatio 2
    expect(coveredCss).toBeGreaterThanOrEqual(chartH - 1);
    expect(plan.pageCount).toBe(plan.cols * plan.rows);
    expect(plan.rows).toBeGreaterThan(1); // tall chart paginates
  });
});
