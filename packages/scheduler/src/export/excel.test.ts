/**
 * jsdom unit tests for the Scheduler Excel exporter. These exercise the pure
 * builders (matrix / workbook XML / CSV) for both layouts, assignment-aware
 * row resolution, typed cells, the resource-grid matrix, and the formula-
 * injection guard. The browser side-effect (`download`) is covered here via a
 * stubbed anchor/Blob since jsdom provides URL + Blob.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SchedulerExcelExporter,
  schedulerExportSource,
  exportSchedulerToExcel,
  type SchedulerExportSource,
} from './excel.js';
import type { ResourceModel, EventModel, AssignmentModel } from '../contract.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const start = Date.UTC(2025, 0, 1);

const resources: ResourceModel[] = [
  { id: 'r1', name: 'Alice' },
  { id: 'r2', name: 'Bob' },
];

const events: EventModel[] = [
  { id: 'e1', resourceId: 'r1', name: 'Kickoff', startDate: start, endDate: start + 2 * HOUR, percentDone: 0.5 },
  { id: 'e2', resourceId: 'r2', name: 'Review', startDate: start + DAY, endDate: start + DAY + HOUR },
];

function makeSource(over: Partial<SchedulerExportSource> = {}): SchedulerExportSource {
  return { resources, events, range: { start, end: start + 3 * DAY }, ...over };
}

describe('SchedulerExcelExporter — event-list layout', () => {
  it('resolves one row per event mapped via resourceId, ordered by resource then start', () => {
    const ex = new SchedulerExcelExporter(makeSource());
    const rows = ex.resolveRows();
    expect(rows.map((r) => r.event.id)).toEqual(['e1', 'e2']);
    expect(rows[0]!.resource?.name).toBe('Alice');
    expect(rows[0]!.units).toBe(1);
  });

  it('builds a typed matrix with default columns + a header row', () => {
    const ex = new SchedulerExcelExporter(makeSource());
    const m = ex.toMatrixEventList();
    // header + 2 data rows
    expect(m).toHaveLength(3);
    expect(m[0]!.map((c) => c.value)).toEqual([
      'Resource',
      'Event',
      'Start',
      'End',
      'Duration (h)',
      '% Done',
    ]);
    // e1: Alice, Kickoff, <date>, <date>, 2h, 50%
    const row = m[1]!;
    expect(row[0]!.value).toBe('Alice');
    expect(row[1]!.value).toBe('Kickoff');
    expect(row[2]!.type).toBe('DateTime');
    expect(row[4]!.value).toBe(2); // 2 hours duration
    expect(row[5]!.value).toBe(50); // 50% done
  });

  it('emits a SpreadsheetML workbook with typed Number/DateTime cells + bold header', () => {
    const ex = new SchedulerExcelExporter(makeSource(), { fileName: 'sched', sheetName: 'Events' });
    const xml = ex.toWorkbookXml();
    expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(xml).toContain('ss:Name="Events"');
    expect(xml).toContain('<Data ss:Type="Number">2</Data>'); // duration
    expect(xml).toContain('ss:Type="DateTime"');
    expect(xml).toContain('2025-01-01T00:00:00'); // ISO date literal
    // Header cell uses the bold style id.
    expect(xml).toContain('ss:StyleID="hdr"');
  });

  it('serializes to CSV', () => {
    const ex = new SchedulerExcelExporter(makeSource());
    const csv = ex.toCsv();
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Resource,Event,Start,End,Duration (h),% Done');
    expect(lines[1]).toContain('Alice');
    expect(lines[1]).toContain('Kickoff');
  });

  it('honors custom columns', () => {
    const ex = new SchedulerExcelExporter(makeSource(), {
      columns: [
        { header: 'Who', value: (r) => r.resource?.name ?? '' },
        { header: 'Task', value: (r) => r.event.name ?? '' },
      ],
    });
    const m = ex.toMatrixEventList();
    expect(m[0]!.map((c) => c.value)).toEqual(['Who', 'Task']);
    expect(m[1]!).toHaveLength(2);
  });

  it('omits the header row when header:false', () => {
    const ex = new SchedulerExcelExporter(makeSource(), { header: false });
    const m = ex.toMatrixEventList();
    expect(m).toHaveLength(2); // no header
  });
});

describe('SchedulerExcelExporter — assignments (multi-assignment)', () => {
  const assignments: AssignmentModel[] = [
    { id: 'a1', eventId: 'e1', resourceId: 'r1', units: 1 },
    { id: 'a2', eventId: 'e1', resourceId: 'r2', units: 0.5 },
  ];

  it('produces one row per assignment and adds a Units column', () => {
    const ex = new SchedulerExcelExporter(makeSource({ assignments }));
    const rows = ex.resolveRows();
    // e1 is assigned to both r1 and r2 → 2 rows; e2 has no assignment → 0 rows.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.resource?.name).sort()).toEqual(['Alice', 'Bob']);
    const m = ex.toMatrixEventList();
    expect(m[0]!.map((c) => c.value)).toContain('Units');
    const bob = rows.find((r) => r.resource?.id === 'r2')!;
    expect(bob.units).toBe(0.5);
  });
});

describe('SchedulerExcelExporter — resource-grid layout', () => {
  it('builds a resource × time-slot matrix listing active event names', () => {
    const ex = new SchedulerExcelExporter(makeSource(), { layout: 'resource-grid', slotMs: DAY });
    const m = ex.toMatrixResourceGrid();
    // header: Resource + 3 day-slots
    expect(m[0]![0]!.value).toBe('Resource');
    expect(m[0]!).toHaveLength(4);
    const alice = m.find((line, i) => i > 0 && line[0]!.value === 'Alice')!;
    // Kickoff is on day 0 → first slot cell.
    expect(alice[1]!.value).toBe('Kickoff');
    expect(alice[2]!.value).toBe(''); // empty day 1
    const bob = m.find((line, i) => i > 0 && line[0]!.value === 'Bob')!;
    expect(bob[2]!.value).toBe('Review'); // day 1
  });

  it('cellMode "count" emits numeric occupancy', () => {
    const ex = new SchedulerExcelExporter(makeSource(), {
      layout: 'resource-grid',
      slotMs: DAY,
      cellMode: 'count',
    });
    const m = ex.toMatrixResourceGrid();
    const alice = m.find((line, i) => i > 0 && line[0]!.value === 'Alice')!;
    expect(alice[1]!.value).toBe(1);
    expect(alice[1]!.type).toBe('Number');
    expect(alice[2]!.value).toBe(0);
  });

  it('derives the range from events when none is supplied', () => {
    const ex = new SchedulerExcelExporter({ resources, events }, { layout: 'resource-grid', slotMs: DAY });
    const slots = ex.gridSlots();
    expect(slots.length).toBeGreaterThanOrEqual(2);
    expect(slots[0]!.start).toBe(start);
  });
});

describe('SchedulerExcelExporter — formula injection guard', () => {
  it('prefixes a leading formula trigger with a quote in CSV + XML', () => {
    const evil: EventModel[] = [
      { id: 'x', resourceId: 'r1', name: '=cmd|calc', startDate: start, endDate: start + HOUR },
    ];
    const ex = new SchedulerExcelExporter({ resources, events: evil, range: { start, end: start + DAY } });
    expect(ex.toCsv()).toContain("'=cmd|calc");
    // In the XML workbook the leading quote is preserved but the apostrophe is
    // XML-escaped to &apos; — the guard still neutralizes the formula.
    expect(ex.toWorkbookXml()).toContain('&apos;=cmd|calc');
  });

  it('does not guard when sanitizeFormulas:false', () => {
    const evil: EventModel[] = [
      { id: 'x', resourceId: 'r1', name: '=A1', startDate: start, endDate: start + HOUR },
    ];
    const ex = new SchedulerExcelExporter(
      { resources, events: evil, range: { start, end: start + DAY } },
      { sanitizeFormulas: false },
    );
    const csv = ex.toCsv();
    expect(csv).toContain('=A1');
    expect(csv).not.toContain("'=A1");
  });
});

describe('schedulerExportSource — live Scheduler adapter', () => {
  it('snapshots stores + axis range from a host', () => {
    const host = {
      getResourceStore: () => ({ toArray: () => resources }),
      getEventStore: () => ({ toArray: () => events }),
      getAxis: () => ({ range: { start, end: start + DAY } }),
    };
    const source = schedulerExportSource(host);
    expect(source.resources).toBe(resources);
    expect(source.events).toBe(events);
    expect(source.range).toEqual({ start, end: start + DAY });

    const ex = exportSchedulerToExcel(host, { layout: 'event-list' });
    expect(ex.toMatrixEventList().length).toBe(3); // header + 2
  });

  it('includes assignments when supplied', () => {
    const host = {
      getResourceStore: () => ({ toArray: () => resources }),
      getEventStore: () => ({ toArray: () => events }),
      getAxis: () => ({ range: { start, end: start + DAY } }),
    };
    const assignments: AssignmentModel[] = [{ id: 'a1', eventId: 'e1', resourceId: 'r1' }];
    const source = schedulerExportSource(host, assignments);
    expect(source.assignments).toBe(assignments);
  });
});

describe('SchedulerExcelExporter — browser download side-effect', () => {
  afterEach(() => vi.restoreAllMocks());

  it('download() creates an .xls Blob anchor and clicks it', () => {
    // jsdom here does not implement URL.createObjectURL — provide stubs so the
    // download helper's Blob URL plumbing runs.
    const u = URL as unknown as Record<string, unknown>;
    if (typeof u.createObjectURL !== 'function') u.createObjectURL = () => 'blob:mock';
    if (typeof u.revokeObjectURL !== 'function') u.revokeObjectURL = () => {};

    const clicked: string[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLElement;
      if (tag === 'a') {
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {
          clicked.push((el as HTMLAnchorElement).download);
        });
      }
      return el;
    });
    const createObjURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const ex = new SchedulerExcelExporter(makeSource(), { fileName: 'roster' });
    ex.download();
    expect(clicked).toEqual(['roster.xls']);
    expect(createObjURL).toHaveBeenCalled();
  });
});
