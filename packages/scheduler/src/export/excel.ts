/**
 * Scheduler — Excel (XLSX-compatible) export.
 *
 * Brings the Scheduler to Bryntum/DHTMLX parity for **Export: Excel**. Like the
 * `@jects/grid` exporter (`packages/grid/src/features/export.ts`), this emits a
 * real, double-clickable workbook using the **SpreadsheetML 2003** XML dialect
 * (`application/vnd.ms-excel`, `.xls`) — a zero-dependency format Excel / Google
 * Sheets / LibreOffice all open natively. That keeps the package dependency-free
 * (D5/D8) while producing a true multi-sheet workbook with typed cells (numbers,
 * dates, strings) rather than a flat CSV.
 *
 * Two parity layouts are supported (matching the Bryntum `ExcelExporter`
 * "schedule" vs "grid" outputs):
 *
 *  - **`'event-list'`** — one row per event (or per assignment, when an
 *    AssignmentStore is present, so a multi-assigned event yields one row per
 *    resource). Columns: Resource, Event, Start, End, Duration (+ optional units,
 *    % done, color). This is the canonical "export the data" form.
 *
 *  - **`'resource-grid'`** — a matrix: resource rows × time-slot columns. Each
 *    cell lists the event name(s) active in that slot for that resource (or a
 *    count when `cellMode: 'count'`). This mirrors the visual scheduler grid in a
 *    spreadsheet.
 *
 * The pure string/matrix builders (`toMatrix*` / `toWorkbookXml` / `toCsv`) are
 * jsdom-unit-testable; `download()` performs the browser Blob side-effect. The
 * exporter reads from a small {@link SchedulerExportSource} (resources / events /
 * assignments + range), so it can run standalone (pass plain arrays) OR be wired
 * to a live `Scheduler` via {@link schedulerExportSource}.
 *
 * Formula-injection is guarded exactly as the grid exporter does: a cell whose
 * text begins with `= + - @` (or a leading TAB/CR) is prefixed with a single
 * quote so the spreadsheet treats it as literal text, defeating CSV/Excel formula
 * injection (e.g. `=cmd|'/c calc'!A1`). Numeric/date cells carry their own
 * `ss:Type` and are never formula-interpreted.
 */

import type { RecordId } from '@jects/core';
import type { TimeSpan, DurationMs } from '@jects/timeline-core';
import type {
  ResourceModel,
  EventModel,
  AssignmentModel,
} from '../contract.js';
import { formatTime } from '../view/format.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1. SOURCE + CONFIG
   ═══════════════════════════════════════════════════════════════════════════ */

/** The data the exporter reads. Pass plain arrays, or adapt a live Scheduler. */
export interface SchedulerExportSource {
  resources: ReadonlyArray<ResourceModel>;
  events: ReadonlyArray<EventModel>;
  /** Optional multi-assignments; when present, event-list rows are per-assignment. */
  assignments?: ReadonlyArray<AssignmentModel>;
  /** Overall covered range (used by the resource-grid layout to size columns). */
  range?: TimeSpan;
}

/** Which spreadsheet layout to produce. */
export type ExcelExportLayout = 'event-list' | 'resource-grid';

/** How a resource-grid cell summarizes the events in a slot. */
export type ResourceGridCellMode = 'names' | 'count';

/** A column in the `event-list` layout. */
export interface ExcelEventColumn {
  /** Header label. */
  header: string;
  /** Excel cell type. Default `'String'`. */
  type?: 'String' | 'Number' | 'DateTime';
  /** Value accessor for a resolved row (event + its resource + units). */
  value: (row: ExportEventRow) => unknown;
}

/** A resolved export row: an event paired with a resource it occupies. */
export interface ExportEventRow {
  event: EventModel;
  resource: ResourceModel | undefined;
  /** Assignment units when sourced from an AssignmentStore (else 1). */
  units: number;
  /** The assignment record, when this row came from one. */
  assignment?: AssignmentModel;
}

export interface ExcelExportConfig {
  /** Layout. Default `'event-list'`. */
  layout?: ExcelExportLayout;
  /** Workbook file name (without extension). Default `'schedule'`. */
  fileName?: string;
  /** Worksheet name. Default derived from the layout. */
  sheetName?: string;
  /** Include a header row. Default `true`. */
  header?: boolean;
  /**
   * Override the event-list columns. When omitted a sensible default set is
   * derived (Resource, Event, Start, End, Duration, [Units], [% Done]).
   */
  columns?: ExcelEventColumn[];
  /** Date/time format pattern (moment-ish, see `format.ts`). Default `'datetime'`. */
  dateFormat?: string;
  /**
   * Resource-grid slot width in ms. Default one day. Only used by the
   * `'resource-grid'` layout.
   */
  slotMs?: DurationMs;
  /** Resource-grid cell content. Default `'names'`. */
  cellMode?: ResourceGridCellMode;
  /** Separator joining multiple event names in a resource-grid cell. Default `', '`. */
  nameSeparator?: string;
  /**
   * Guard against CSV/Excel formula injection by quoting cells that begin with a
   * formula trigger. Default `true`. See module header.
   */
  sanitizeFormulas?: boolean;
}

/** Resolved (defaulted) config. */
interface ResolvedConfig {
  layout: ExcelExportLayout;
  fileName: string;
  sheetName: string;
  header: boolean;
  columns: ExcelEventColumn[] | undefined;
  dateFormat: string;
  slotMs: DurationMs;
  cellMode: ResourceGridCellMode;
  nameSeparator: string;
  sanitizeFormulas: boolean;
}

const MS_DAY = 86_400_000;

/** Characters that trigger formula interpretation in spreadsheet apps. */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/* ═══════════════════════════════════════════════════════════════════════════
   2. THE EXPORTER
   ═══════════════════════════════════════════════════════════════════════════ */

export class SchedulerExcelExporter {
  private readonly source: SchedulerExportSource;
  private readonly cfg: ResolvedConfig;

  constructor(source: SchedulerExportSource, config: ExcelExportConfig = {}) {
    this.source = source;
    const layout = config.layout ?? 'event-list';
    this.cfg = {
      layout,
      fileName: config.fileName ?? 'schedule',
      sheetName:
        config.sheetName ?? (layout === 'resource-grid' ? 'Schedule' : 'Events'),
      header: config.header ?? true,
      columns: config.columns,
      dateFormat: config.dateFormat ?? 'datetime',
      slotMs: config.slotMs ?? MS_DAY,
      cellMode: config.cellMode ?? 'names',
      nameSeparator: config.nameSeparator ?? ', ',
      sanitizeFormulas: config.sanitizeFormulas ?? true,
    };
  }

  /* ── data resolution ──────────────────────────────────────────────────── */

  private resourceById(): Map<RecordId, ResourceModel> {
    const map = new Map<RecordId, ResourceModel>();
    for (const r of this.source.resources) map.set(r.id, r);
    return map;
  }

  /**
   * Resolve the export rows for the event-list layout. With assignments, an event
   * yields one row per assignment (per resource); without, one row per event
   * mapped via its `resourceId`. Stable order: by resource order, then event start.
   */
  resolveRows(): ExportEventRow[] {
    const byId = this.resourceById();
    const eventById = new Map<RecordId, EventModel>();
    for (const e of this.source.events) eventById.set(e.id, e);
    const rows: ExportEventRow[] = [];

    const assignments = this.source.assignments;
    if (assignments && assignments.length > 0) {
      for (const a of assignments) {
        const event = eventById.get(a.eventId);
        if (!event) continue;
        rows.push({
          event,
          resource: byId.get(a.resourceId),
          units: a.units ?? 1,
          assignment: a,
        });
      }
    } else {
      for (const e of this.source.events) {
        rows.push({ event: e, resource: byId.get(e.resourceId), units: 1 });
      }
    }

    // Order by the resource's position in the source, then by event start.
    const resourceIndex = new Map<RecordId, number>();
    this.source.resources.forEach((r, i) => resourceIndex.set(r.id, i));
    rows.sort((a, b) => {
      const ra = a.resource ? resourceIndex.get(a.resource.id) ?? Infinity : Infinity;
      const rb = b.resource ? resourceIndex.get(b.resource.id) ?? Infinity : Infinity;
      if (ra !== rb) return ra - rb;
      return a.event.startDate - b.event.startDate;
    });
    return rows;
  }

  /** The effective range — explicit, else derived (padded) from the events. */
  private resolveRange(): TimeSpan {
    if (this.source.range) return this.source.range;
    let min = Infinity;
    let max = -Infinity;
    for (const e of this.source.events) {
      if (e.startDate < min) min = e.startDate;
      if (e.endDate > max) max = e.endDate;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      const now = Date.now();
      return { start: now, end: now + MS_DAY };
    }
    return { start: min, end: max };
  }

  /** The default event-list columns when none are configured. */
  private defaultColumns(): ExcelEventColumn[] {
    const hasUnits = !!(this.source.assignments && this.source.assignments.length > 0);
    const hasProgress = this.source.events.some((e) => typeof e.percentDone === 'number');
    const cols: ExcelEventColumn[] = [
      { header: 'Resource', value: (r) => r.resource?.name ?? '' },
      { header: 'Event', value: (r) => r.event.name ?? '' },
      { header: 'Start', type: 'DateTime', value: (r) => r.event.startDate },
      { header: 'End', type: 'DateTime', value: (r) => r.event.endDate },
      {
        header: 'Duration (h)',
        type: 'Number',
        value: (r) => (r.event.endDate - r.event.startDate) / 3_600_000,
      },
    ];
    if (hasUnits) cols.push({ header: 'Units', type: 'Number', value: (r) => r.units });
    if (hasProgress) {
      cols.push({
        header: '% Done',
        type: 'Number',
        value: (r) =>
          typeof r.event.percentDone === 'number'
            ? Math.round(r.event.percentDone * 100)
            : '',
      });
    }
    return cols;
  }

  private columns(): ExcelEventColumn[] {
    return this.cfg.columns ?? this.defaultColumns();
  }

  /* ── matrices (pure, testable) ────────────────────────────────────────── */

  /**
   * The event-list as a typed matrix: each cell is `{ value, type }`. The header
   * row (when enabled) is string-typed. Used by both the workbook + CSV builders.
   */
  toMatrixEventList(): ExportCell[][] {
    const cols = this.columns();
    const matrix: ExportCell[][] = [];
    if (this.cfg.header) {
      matrix.push(cols.map((c) => ({ value: c.header, type: 'String' as const })));
    }
    for (const row of this.resolveRows()) {
      matrix.push(
        cols.map((c) => ({
          value: c.value(row),
          type: c.type ?? 'String',
        })),
      );
    }
    return matrix;
  }

  /** Build the time-slot column spans for the resource-grid layout. */
  gridSlots(): TimeSpan[] {
    const { start, end } = this.resolveRange();
    const slotMs = this.cfg.slotMs;
    const count = Math.max(1, Math.ceil((end - start) / slotMs));
    const slots: TimeSpan[] = [];
    for (let i = 0; i < count; i++) {
      slots.push({ start: start + i * slotMs, end: start + (i + 1) * slotMs });
    }
    return slots;
  }

  /**
   * The resource-grid as a typed matrix: a header row of slot labels, then one
   * row per resource whose cells list the events active in each slot.
   */
  toMatrixResourceGrid(): ExportCell[][] {
    const slots = this.gridSlots();
    const rows = this.resolveRows();
    // Group rows by resource id for fast per-slot lookup.
    const byResource = new Map<RecordId, ExportEventRow[]>();
    for (const row of rows) {
      if (!row.resource) continue;
      const list = byResource.get(row.resource.id) ?? [];
      list.push(row);
      byResource.set(row.resource.id, list);
    }

    const matrix: ExportCell[][] = [];
    if (this.cfg.header) {
      const head: ExportCell[] = [{ value: 'Resource', type: 'String' }];
      for (const slot of slots) {
        head.push({ value: this.fmtDate(slot.start), type: 'String' });
      }
      matrix.push(head);
    }

    for (const resource of this.source.resources) {
      const list = byResource.get(resource.id) ?? [];
      const line: ExportCell[] = [{ value: resource.name, type: 'String' }];
      for (const slot of slots) {
        const active = list.filter(
          (r) => r.event.startDate < slot.end && r.event.endDate > slot.start,
        );
        if (this.cfg.cellMode === 'count') {
          line.push({ value: active.length, type: 'Number' });
        } else {
          const names = active
            .map((r) => r.event.name ?? '')
            .filter((n) => n.length > 0)
            .join(this.cfg.nameSeparator);
          line.push({ value: names, type: 'String' });
        }
      }
      matrix.push(line);
    }
    return matrix;
  }

  /** The matrix for the active layout. */
  toMatrix(): ExportCell[][] {
    return this.cfg.layout === 'resource-grid'
      ? this.toMatrixResourceGrid()
      : this.toMatrixEventList();
  }

  /* ── serializers ──────────────────────────────────────────────────────── */

  /** Render a value to its display string (dates via the configured format). */
  private cellText(cell: ExportCell): string {
    const { value, type } = cell;
    if (value == null) return '';
    if (type === 'DateTime' && typeof value === 'number') return this.fmtDate(value);
    return String(value);
  }

  private fmtDate(time: number): string {
    return formatTime(time, this.cfg.dateFormat);
  }

  /** Neutralize a leading formula trigger when sanitization is enabled. */
  private guard(s: string): string {
    if (!this.cfg.sanitizeFormulas) return s;
    if (s.length > 0 && FORMULA_TRIGGERS.includes(s[0]!)) return `'${s}`;
    return s;
  }

  /**
   * Serialize the active layout to a SpreadsheetML 2003 workbook (the `.xls`
   * Excel opens natively). Numeric cells use `ss:Type="Number"`; date cells use
   * `ss:Type="DateTime"` with an ISO-8601 value so Excel parses them as real
   * dates; everything else is a formula-guarded String. The header row (when
   * enabled) is the first matrix line and is rendered bold.
   */
  toWorkbookXml(): string {
    const matrix = this.toMatrix();
    const sheetName = escapeXml(this.cfg.sheetName);
    const rowsXml = matrix
      .map((line, i) => this.rowXml(line, this.cfg.header && i === 0))
      .join('');
    return [
      '<?xml version="1.0"?>',
      '<?mso-application progid="Excel.Sheet"?>',
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
      '<Styles>',
      '<Style ss:ID="hdr"><Font ss:Bold="1"/></Style>',
      '<Style ss:ID="dt"><NumberFormat ss:Format="General Date"/></Style>',
      '</Styles>',
      `<Worksheet ss:Name="${sheetName}"><Table>`,
      rowsXml,
      '</Table></Worksheet></Workbook>',
    ].join('');
  }

  private rowXml(line: ExportCell[], isHeader: boolean): string {
    return `<Row>${line.map((c) => this.cellXml(c, isHeader)).join('')}</Row>`;
  }

  private cellXml(cell: ExportCell, isHeader: boolean): string {
    // Header cells are always bold String cells regardless of column type.
    if (
      !isHeader &&
      cell.type === 'Number' &&
      typeof cell.value === 'number' &&
      Number.isFinite(cell.value)
    ) {
      return `<Cell><Data ss:Type="Number">${cell.value}</Data></Cell>`;
    }
    if (!isHeader && cell.type === 'DateTime' && typeof cell.value === 'number') {
      // SpreadsheetML wants an ISO date-time literal with `ss:Type="DateTime"`.
      const iso = new Date(cell.value).toISOString().replace(/\.\d{3}Z$/, '');
      return `<Cell ss:StyleID="dt"><Data ss:Type="DateTime">${iso}</Data></Cell>`;
    }
    const styleAttr = isHeader ? ' ss:StyleID="hdr"' : '';
    const text = escapeXml(this.guard(this.cellText(cell)));
    return `<Cell${styleAttr}><Data ss:Type="String">${text}</Data></Cell>`;
  }

  /** Serialize the active layout to CSV (RFC-4180-ish), formula-guarded. */
  toCsv(delimiter = ',', newline = '\r\n'): string {
    const quote = (cell: ExportCell): string => {
      const raw = this.guard(this.cellText(cell));
      if (raw.includes(delimiter) || raw.includes('"') || /[\r\n]/.test(raw)) {
        return `"${raw.replace(/"/g, '""')}"`;
      }
      return raw;
    };
    return this.toMatrix()
      .map((line) => line.map(quote).join(delimiter))
      .join(newline);
  }

  /** Build a plain HTML table of the active layout (for preview / browser test). */
  toHtmlTable(): string {
    const matrix = this.toMatrix();
    const head =
      this.cfg.header && matrix.length > 0
        ? `<thead><tr>${matrix[0]!
            .map((c) => `<th scope="col">${escapeHtml(this.cellText(c))}</th>`)
            .join('')}</tr></thead>`
        : '';
    const bodyRows = (this.cfg.header ? matrix.slice(1) : matrix)
      .map(
        (line) =>
          `<tr>${line.map((c) => `<td>${escapeHtml(this.cellText(c))}</td>`).join('')}</tr>`,
      )
      .join('');
    return `<table class="jects-scheduler-export__table">${head}<tbody>${bodyRows}</tbody></table>`;
  }

  /* ── browser side-effect ──────────────────────────────────────────────── */

  /** Trigger an Excel (.xls SpreadsheetML) download in the browser. */
  download(fileName?: string): void {
    const name = `${fileName ?? this.cfg.fileName}.xls`;
    triggerDownload(this.toWorkbookXml(), name, 'application/vnd.ms-excel;charset=utf-8;');
  }

  /** Trigger a CSV download in the browser. */
  downloadCsv(fileName?: string): void {
    triggerDownload(this.toCsv(), `${fileName ?? this.cfg.fileName}.csv`, 'text/csv;charset=utf-8;');
  }

  /** The resolved (defaulted) config — handy for tests / introspection. */
  getConfig(): Readonly<ResolvedConfig> {
    return this.cfg;
  }
}

/** A typed export cell (value + spreadsheet type). */
export interface ExportCell {
  value: unknown;
  type: 'String' | 'Number' | 'DateTime';
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. SCHEDULER WIRING
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The minimal slice of a live `Scheduler` the exporter needs. The Scheduler
 * already exposes `getResourceStore()` / `getEventStore()` / `getAxis()`; the
 * optional assignment store can be passed explicitly.
 */
export interface SchedulerExportHost {
  getResourceStore(): { toArray(): ResourceModel[] };
  getEventStore(): { toArray(): EventModel[] };
  getAxis(): { range: TimeSpan };
}

/**
 * Adapt a live `Scheduler` (or anything matching {@link SchedulerExportHost}) to
 * a {@link SchedulerExportSource} snapshot. Optionally include a multi-assignment
 * list so the event-list layout is per-assignment.
 */
export function schedulerExportSource(
  host: SchedulerExportHost,
  assignments?: ReadonlyArray<AssignmentModel>,
): SchedulerExportSource {
  return {
    resources: host.getResourceStore().toArray(),
    events: host.getEventStore().toArray(),
    ...(assignments && assignments.length > 0 ? { assignments } : {}),
    range: host.getAxis().range,
  };
}

/** Convenience: build an exporter directly from a live Scheduler host. */
export function exportSchedulerToExcel(
  host: SchedulerExportHost,
  config?: ExcelExportConfig,
  assignments?: ReadonlyArray<AssignmentModel>,
): SchedulerExcelExporter {
  return new SchedulerExcelExporter(schedulerExportSource(host, assignments), config);
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. helpers
   ═══════════════════════════════════════════════════════════════════════════ */

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Browser-only: create a Blob + click an anchor to start a download. */
function triggerDownload(content: string, fileName: string, mime: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
