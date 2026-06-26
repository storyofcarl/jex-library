/**
 * jsdom unit tests for the `GanttExportXlsx` **GanttFeature** — the live-model
 * bridge that surfaces `gantt.exportXlsx()` (and `…Blob/…Table/…Download`) on a
 * live `Gantt` instance, mirroring `GanttExportCsv`.
 *
 * The pure OOXML writer is covered by `export-xlsx.test.ts`; here we verify the
 * FEATURE contract: it installs its methods onto the `GanttApi` on `init`,
 * resolves the live tree through `api.getTask` (so the export reflects the
 * CURRENT schedule, not the construction-time config), supplies the
 * predecessors/resources resolvers from the live engine + resource layer, tracks
 * its own teardown, and removes everything on `destroy`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { GanttExportXlsx, createGanttExportXlsx, GANTT_EXPORT_XLSX_FEATURE } from './gantt-export-xlsx.js';
import { XLSX_MIME } from './export-xlsx.js';
import { crc32 } from './zip.js';
import type { TaskModel, GanttApi } from '../contract.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

/* ── tiny store-method ZIP reader (test-only) ───────────────────────────── */

const DEC = new TextDecoder();
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
    const storedCrc = readU32(bytes, o + 14);
    const nameLen = readU16(bytes, o + 26);
    const extraLen = readU16(bytes, o + 28);
    const nameStart = o + 30;
    const name = DEC.decode(bytes.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const data = bytes.subarray(dataStart, dataStart + size);
    expect(crc32(data)).toBe(storedCrc);
    out.set(name, DEC.decode(data));
    o = dataStart + size;
  }
  return out;
}

/* ── a minimal fake GanttApi exposing only what the feature touches ─────── */

interface FakeOpts {
  /** Construction-time tasks (structure). */
  tasks: Array<TaskModel & { children?: TaskModel[] }>;
  /** Live overrides resolved through getTask (e.g. rescheduled spans). */
  live?: Record<string | number, Partial<TaskModel>>;
  /** Dependencies returned by getDependenciesFor (keyed by toId). */
  deps?: Record<string | number, Array<Record<string, unknown>>>;
  /** Resource assignments returned per task id. */
  assignments?: Record<string | number, Array<{ name: string; units: number }>>;
  hoursPerDay?: number;
}

function fakeApi(opts: FakeOpts): { api: GanttApi; host: Record<string, unknown>; disposers: Array<() => void> } {
  const disposers: Array<() => void> = [];
  const flat = new Map<TaskModel['id'], TaskModel>();
  const walk = (ns: Array<TaskModel & { children?: TaskModel[] }>): void => {
    for (const n of ns) {
      flat.set(n.id, n);
      if (n.children) walk(n.children);
    }
  };
  walk(opts.tasks);

  const resources = opts.assignments
    ? {
        getAssignmentsFor: (id: TaskModel['id']) =>
          (opts.assignments![id] ?? []).map((a) => ({
            resource: { id: a.name, name: a.name },
            assignment: { resourceId: a.name },
            units: a.units,
          })),
      }
    : undefined;

  const api = {
    getTask: (id: TaskModel['id']) => {
      const base = flat.get(id);
      if (!base) return undefined;
      const over = opts.live?.[id as string | number];
      return over ? { ...base, ...over } : base;
    },
    getDependenciesFor: (id: TaskModel['id']) => (opts.deps?.[id as string | number] ?? []),
    resources,
    engine: opts.hoursPerDay != null ? { getHoursPerDay: () => opts.hoursPerDay } : {},
    track: (fn: () => void) => disposers.push(fn),
    getConfig: () => ({ tasks: opts.tasks }),
  } as unknown as GanttApi;

  return { api, host: api as unknown as Record<string, unknown>, disposers };
}

const TREE: Array<TaskModel & { children?: TaskModel[] }> = [
  {
    id: 'p',
    name: 'Phase',
    start: T0,
    end: T0 + 5 * DAY,
    duration: 5 * DAY,
    percentDone: 0.5,
    children: [
      {
        id: 'c',
        name: 'Task',
        start: T0,
        end: T0 + 2 * DAY,
        duration: 2 * DAY,
        percentDone: 1,
      } as TaskModel,
    ],
  } as TaskModel & { children: TaskModel[] },
];

afterEach(() => vi.restoreAllMocks());

describe('GanttExportXlsx — feature lifecycle', () => {
  it('exposes the registry name + factory', () => {
    expect(GANTT_EXPORT_XLSX_FEATURE).toBe('exportXlsx');
    expect(new GanttExportXlsx().name).toBe('exportXlsx');
    expect(createGanttExportXlsx()).toBeInstanceOf(GanttExportXlsx);
  });

  it('installs exportXlsx/Blob/Table/Download on init + tracks its teardown', () => {
    const { api, host, disposers } = fakeApi({ tasks: TREE });
    const feature = new GanttExportXlsx();
    feature.init(api);

    expect(typeof host.exportXlsx).toBe('function');
    expect(typeof host.exportXlsxBlob).toBe('function');
    expect(typeof host.exportXlsxTable).toBe('function');
    expect(typeof host.exportXlsxDownload).toBe('function');
    expect(disposers.length).toBe(1);
  });

  it('removes the installed methods on destroy (and is idempotent)', () => {
    const { api, host } = fakeApi({ tasks: TREE });
    const feature = new GanttExportXlsx();
    feature.init(api);
    feature.destroy();
    feature.destroy(); // idempotent
    expect(host.exportXlsx).toBeUndefined();
    expect(host.exportXlsxBlob).toBeUndefined();
    expect(host.exportXlsxTable).toBeUndefined();
    expect(host.exportXlsxDownload).toBeUndefined();
  });

  it('the tracked disposer tears the feature down (leak-safe)', () => {
    const { api, host, disposers } = fakeApi({ tasks: TREE });
    new GanttExportXlsx().init(api);
    // Simulate gantt.destroy() running the tracked disposers.
    for (const d of disposers) d();
    expect(host.exportXlsx).toBeUndefined();
  });

  it('throws when used after destroy', () => {
    const { api, host } = fakeApi({ tasks: TREE });
    const feature = new GanttExportXlsx();
    feature.init(api);
    const fn = host.exportXlsx as () => Uint8Array;
    feature.destroy();
    expect(() => fn()).toThrow(/not installed/);
  });
});

describe('GanttExportXlsx — export output', () => {
  it('exportXlsx() produces a valid OOXML package with native grouping', () => {
    const { api, host } = fakeApi({ tasks: TREE });
    new GanttExportXlsx().init(api);
    const bytes = (host.exportXlsx as () => Uint8Array)();
    expect(bytes[0]).toBe(0x50); // PK
    expect(bytes[1]).toBe(0x4b);
    const files = unzip(bytes);
    expect(files.has('xl/worksheets/sheet1.xml')).toBe(true);
    // The child row carries the native outline level.
    expect(files.get('xl/worksheets/sheet1.xml')!).toMatch(/outlineLevel="1"/);
  });

  it('exportXlsxBlob() carries the OOXML MIME type', () => {
    const { api, host } = fakeApi({ tasks: TREE });
    new GanttExportXlsx().init(api);
    const blob = (host.exportXlsxBlob as () => Blob)();
    expect(blob.type).toBe(XLSX_MIME);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('exportXlsxTable() returns the resolved table (hierarchy preserved)', () => {
    const { api, host } = fakeApi({ tasks: TREE });
    new GanttExportXlsx().init(api);
    const table = (host.exportXlsxTable as () => { rows: Array<{ depth: number; wbs: string }> })();
    expect(table.rows.length).toBe(2);
    expect(table.rows[0]!.depth).toBe(0);
    expect(table.rows[1]!.depth).toBe(1);
    expect(table.rows[1]!.wbs).toBe('1.1');
  });

  it('reflects the LIVE schedule (getTask overrides), not the stale config', () => {
    const newStart = T0 + 10 * DAY;
    const { api, host } = fakeApi({
      tasks: TREE,
      live: { c: { start: newStart, end: newStart + 2 * DAY } },
    });
    new GanttExportXlsx().init(api);
    const sheet = unzip((host.exportXlsx as () => Uint8Array)()).get(
      'xl/worksheets/sheet1.xml',
    )!;
    // The child's rescheduled start serial must appear (not the original T0 serial).
    const serial = (newStart - Date.UTC(1899, 11, 30)) / DAY;
    expect(sheet).toContain(`<v>${serial}</v>`);
  });

  it('wires predecessors + resources resolvers from the live model', () => {
    const { api, host } = fakeApi({
      tasks: TREE,
      deps: { c: [{ fromId: 'p', toId: 'c', type: 'FS', lag: DAY, active: true }] },
      assignments: { c: [{ name: 'Alice', units: 50 }] },
    });
    new GanttExportXlsx().init(api);
    const sst = unzip((host.exportXlsx as () => Uint8Array)()).get(
      'xl/sharedStrings.xml',
    )!;
    // Predecessor notation: the implicit FS type is omitted, the +1d lag shown.
    expect(sst).toContain('p+1d');
    // Resource label with units annotation.
    expect(sst).toContain('Alice [50%]');
  });

  it('respects a per-call column override', () => {
    const { api, host } = fakeApi({ tasks: TREE });
    new GanttExportXlsx().init(api);
    const exportFn = host.exportXlsxTable as (o?: {
      columns?: Array<{ field: string; header: string }>;
    }) => { columns: Array<{ header?: string }> };
    const table = exportFn({ columns: [{ field: 'name', header: 'Only Name' }] });
    expect(table.columns.length).toBe(1);
    expect(table.columns[0]!.header).toBe('Only Name');
  });

  it('exportXlsxDownload() drives the anchor click + returns true (jsdom DOM)', () => {
    const { api, host } = fakeApi({ tasks: TREE });
    new GanttExportXlsx({ fileName: 'plan.xlsx' }).init(api);
    // jsdom does not implement the object-URL API; stub it so the DOM download
    // path runs (the feature's no-op guard only triggers when it is absent).
    // jsdom does not implement the object-URL API; stub it so the DOM download
    // path runs. We leave the stubs installed (they are harmless no-ops) because
    // downloadXlsx schedules a deferred revokeObjectURL via setTimeout that would
    // otherwise fire after a synchronous cleanup and throw.
    const urlObj = URL as unknown as {
      createObjectURL?: (b: Blob) => string;
      revokeObjectURL?: (u: string) => void;
    };
    urlObj.createObjectURL = () => 'blob:mock';
    urlObj.revokeObjectURL = () => {};
    let clicked = '';
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clicked = (this as HTMLAnchorElement).download;
    };
    try {
      const offered = (host.exportXlsxDownload as (n?: string) => boolean)();
      expect(offered).toBe(true);
      expect(clicked).toBe('plan.xlsx');
    } finally {
      HTMLAnchorElement.prototype.click = orig;
    }
  });
});
