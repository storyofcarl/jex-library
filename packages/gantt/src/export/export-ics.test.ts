/**
 * jsdom unit tests for the iCalendar (.ics) export — RFC-5545 VCALENDAR/VEVENT
 * shape, DTSTART/DTEND from the scheduled span, milestone handling, all-day vs
 * timed detection, UID/SEQUENCE/DTSTAMP identity, TEXT escaping, 75-octet line
 * folding, and the (jsdom-safe) download helper.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  tasksToIcs,
  taskToVevent,
  flattenTasks,
  isMilestoneTask,
  formatIcsDateTime,
  formatIcsDate,
  isUtcMidnight,
  escapeIcsText,
  foldIcsLine,
  downloadIcs,
  exportIcs,
  ICS_MIME,
  type IcsTaskRow,
} from './export-ics.js';
import type { TaskModel } from '../contract.js';
import type { TaskTreeSource } from './serialize.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5); // 2026-01-05T00:00:00Z (UTC midnight)
const STAMP = Date.UTC(2026, 5, 24, 9, 30, 0);

/** Build a structural tree source from nested tasks. */
function source(roots: Array<TaskModel & { children?: TaskModel[] }>): TaskTreeSource {
  return {
    items: roots,
    getChildren: (n) =>
      (typeof n === 'object' ? (n.children ?? []) : []) as TaskModel[],
  };
}

/* ── RFC-5545 primitives ─────────────────────────────────────────────────── */

describe('iCalendar date/time formatting', () => {
  it('formats UTC date-times as YYYYMMDDTHHMMSSZ', () => {
    expect(formatIcsDateTime(Date.UTC(2026, 0, 5, 13, 7, 9))).toBe('20260105T130709Z');
  });

  it('formats DATE values as YYYYMMDD', () => {
    expect(formatIcsDate(T0)).toBe('20260105');
  });

  it('detects UTC-midnight boundaries', () => {
    expect(isUtcMidnight(T0)).toBe(true);
    expect(isUtcMidnight(T0 + 3_600_000)).toBe(false);
  });
});

describe('escapeIcsText (RFC 5545 §3.3.11)', () => {
  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeIcsText('a;b,c\\d')).toBe('a\\;b\\,c\\\\d');
    expect(escapeIcsText('line1\nline2')).toBe('line1\\nline2');
    expect(escapeIcsText('cr\r\nlf')).toBe('cr\\nlf');
  });

  it('leaves plain text untouched', () => {
    expect(escapeIcsText('Design phase')).toBe('Design phase');
  });
});

describe('foldIcsLine (75-octet folding, §3.1)', () => {
  it('leaves short ASCII lines untouched', () => {
    expect(foldIcsLine('SUMMARY:Hi')).toBe('SUMMARY:Hi');
  });

  it('folds a long line at 75 octets with a leading-space continuation', () => {
    const long = 'DESCRIPTION:' + 'x'.repeat(200);
    const folded = foldIcsLine(long);
    const segments = folded.split('\r\n');
    expect(segments.length).toBeGreaterThan(1);
    // First segment ≤ 75 octets; continuations start with a single space.
    expect(segments[0]!.length).toBeLessThanOrEqual(75);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.startsWith(' ')).toBe(true);
    }
    // Unfolding (drop CRLF + the leading space) reproduces the original.
    const unfolded = segments
      .map((s, i) => (i === 0 ? s : s.slice(1)))
      .join('');
    expect(unfolded).toBe(long);
  });

  it('never splits a multi-byte character across a fold', () => {
    const long = 'SUMMARY:' + '★'.repeat(60); // 3 bytes each → 180 octets
    const folded = foldIcsLine(long);
    // Each segment must be valid UTF-8 (no lone fragments) — round-trips clean.
    const segments = folded.split('\r\n');
    const unfolded = segments.map((s, i) => (i === 0 ? s : s.slice(1))).join('');
    expect(unfolded).toBe(long);
  });
});

/* ── Milestone detection ─────────────────────────────────────────────────── */

describe('isMilestoneTask', () => {
  it('treats an explicit milestone flag as a milestone', () => {
    expect(isMilestoneTask({ id: 1, milestone: true, start: T0, end: T0 + DAY } as TaskModel)).toBe(true);
  });

  it('treats a zero-length / missing-end span as a milestone', () => {
    expect(isMilestoneTask({ id: 1, start: T0, end: T0 } as TaskModel)).toBe(true);
    expect(isMilestoneTask({ id: 2, start: T0 } as TaskModel)).toBe(true);
  });

  it('treats a real span as a normal task', () => {
    expect(isMilestoneTask({ id: 1, start: T0, end: T0 + DAY } as TaskModel)).toBe(false);
  });
});

/* ── Tree flattening ─────────────────────────────────────────────────────── */

describe('flattenTasks', () => {
  const tree = source([
    {
      id: 'p',
      name: 'Phase',
      children: [
        { id: 'a', name: 'A' } as TaskModel,
        { id: 'b', name: 'B' } as TaskModel,
      ],
    } as TaskModel & { children: TaskModel[] },
  ]);

  it('walks depth-first with WBS + depth + summary flags', () => {
    const rows = flattenTasks(tree);
    expect(rows.map((r) => [String(r.task.id), r.wbs, r.depth, r.summary])).toEqual([
      ['p', '1', 0, true],
      ['a', '1.1', 1, false],
      ['b', '1.2', 1, false],
    ]);
  });

  it('omits summary rows when includeSummary is false', () => {
    const rows = flattenTasks(tree, false);
    expect(rows.map((r) => String(r.task.id))).toEqual(['a', 'b']);
  });
});

/* ── VEVENT ──────────────────────────────────────────────────────────────── */

function row(task: TaskModel, extra: Partial<IcsTaskRow> = {}): IcsTaskRow {
  return { task, depth: 0, wbs: '1', summary: false, ...extra };
}

describe('taskToVevent', () => {
  const dtstamp = formatIcsDateTime(STAMP);

  it('emits a timed event with UID/SEQUENCE/DTSTAMP/SUMMARY/DTSTART/DTEND', () => {
    const t = { id: 't1', name: 'Build', start: T0 + 3_600_000, end: T0 + 3_600_000 + 4 * 3_600_000 } as TaskModel;
    const lines = taskToVevent(row(t), { sequence: 2 }, dtstamp);
    expect(lines[0]).toBe('BEGIN:VEVENT');
    expect(lines).toContain('UID:t1@jects.gantt');
    expect(lines).toContain('SEQUENCE:2');
    expect(lines).toContain(`DTSTAMP:${dtstamp}`);
    expect(lines).toContain('SUMMARY:Build');
    expect(lines).toContain(`DTSTART:${formatIcsDateTime(T0 + 3_600_000)}`);
    expect(lines).toContain(`DTEND:${formatIcsDateTime(T0 + 3_600_000 + 4 * 3_600_000)}`);
    expect(lines.at(-1)).toBe('END:VEVENT');
  });

  it('emits an all-day event (VALUE=DATE) for whole-day spans', () => {
    const t = { id: 't2', name: 'Design', start: T0, end: T0 + 2 * DAY } as TaskModel;
    const lines = taskToVevent(row(t), {}, dtstamp);
    expect(lines).toContain('DTSTART;VALUE=DATE:20260105');
    // DTEND is the exclusive day after the last day → the span end passes through.
    expect(lines).toContain('DTEND;VALUE=DATE:20260107');
  });

  it('emits a milestone as a single instant: DTSTART only + CATEGORIES:MILESTONE', () => {
    const t = { id: 'm', name: 'Sign-off', start: T0, milestone: true } as TaskModel;
    const lines = taskToVevent(row(t), {}, dtstamp);
    expect(lines.some((l) => l.startsWith('DTSTART'))).toBe(true);
    expect(lines.some((l) => l.startsWith('DTEND'))).toBe(false);
    expect(lines).toContain('CATEGORIES:MILESTONE');
  });

  it('falls back to the task id when name is missing', () => {
    const lines = taskToVevent(row({ id: 99, start: T0, end: T0 + DAY } as TaskModel), {}, dtstamp);
    expect(lines).toContain('SUMMARY:99');
  });

  it('emits PERCENT-COMPLETE + STATUS', () => {
    const done = taskToVevent(row({ id: 'd', start: T0, end: T0 + DAY, percentDone: 1 } as TaskModel), {}, dtstamp);
    expect(done).toContain('PERCENT-COMPLETE:100');
    expect(done).toContain('STATUS:COMPLETED');
    const partial = taskToVevent(row({ id: 'p', start: T0, end: T0 + DAY, percentDone: 0.4 } as TaskModel), {}, dtstamp);
    expect(partial).toContain('PERCENT-COMPLETE:40');
    expect(partial).toContain('STATUS:IN-PROCESS');
  });

  it('writes a DESCRIPTION with WBS/complete/resources', () => {
    const lines = taskToVevent(
      row({ id: 'x', name: 'X', start: T0, end: T0 + DAY, percentDone: 0.5 } as TaskModel, { wbs: '2.3' }),
      { resourcesOf: () => 'Alice, Bob' },
      dtstamp,
    );
    const desc = lines.find((l) => l.startsWith('DESCRIPTION:'))!;
    expect(desc).toContain('WBS: 2.3');
    expect(desc).toContain('Complete: 50%');
    expect(desc).toContain('Resources: Alice\\, Bob'); // comma escaped
  });

  it('escapes the SUMMARY text', () => {
    const lines = taskToVevent(row({ id: 's', name: 'A; B, C', start: T0, end: T0 + DAY } as TaskModel), {}, dtstamp);
    expect(lines).toContain('SUMMARY:A\\; B\\, C');
  });

  it('honors the allDay override (force timed)', () => {
    const t = { id: 'f', name: 'F', start: T0, end: T0 + DAY } as TaskModel;
    const lines = taskToVevent(row(t), { allDay: false }, dtstamp);
    expect(lines).toContain(`DTSTART:${formatIcsDateTime(T0)}`);
  });
});

/* ── VCALENDAR ───────────────────────────────────────────────────────────── */

describe('tasksToIcs (full document)', () => {
  it('wraps events in a VCALENDAR with the required header props', () => {
    const ics = tasksToIcs(
      source([{ id: 1, name: 'Task', start: T0, end: T0 + DAY } as TaskModel]),
      { now: STAMP },
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//Jects UI//@jects/gantt//EN');
    expect(ics).toContain('CALSCALE:GREGORIAN');
    expect(ics).toContain('METHOD:PUBLISH');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('uses CRLF line endings throughout', () => {
    const ics = tasksToIcs(source([{ id: 1, name: 'T', start: T0, end: T0 + DAY } as TaskModel]), { now: STAMP });
    // Every newline is a CRLF (no bare LF outside a CRLF pair).
    expect(/[^\r]\n/.test(ics)).toBe(false);
    expect(ics.includes('\r\n')).toBe(true);
  });

  it('emits one VEVENT per exported task in outline order', () => {
    const ics = tasksToIcs(
      source([
        {
          id: 'p',
          name: 'Phase',
          start: T0,
          end: T0 + 3 * DAY,
          children: [
            { id: 'a', name: 'A', start: T0, end: T0 + DAY } as TaskModel,
            { id: 'b', name: 'B', start: T0 + DAY, end: T0 + 3 * DAY } as TaskModel,
          ],
        } as TaskModel & { children: TaskModel[] },
      ]),
      { now: STAMP },
    );
    const uids = [...ics.matchAll(/UID:([^\r]+)/g)].map((m) => m[1]);
    expect(uids).toEqual(['p@jects.gantt', 'a@jects.gantt', 'b@jects.gantt']);
  });

  it('drops summary events when includeSummaryRows is false', () => {
    const ics = tasksToIcs(
      source([
        {
          id: 'p',
          name: 'Phase',
          children: [{ id: 'a', name: 'A', start: T0, end: T0 + DAY } as TaskModel],
        } as TaskModel & { children: TaskModel[] },
      ]),
      { now: STAMP, includeSummaryRows: false },
    );
    expect(ics).toContain('UID:a@jects.gantt');
    expect(ics).not.toContain('UID:p@jects.gantt');
  });

  it('applies a custom uidDomain, sequence, and calendar name', () => {
    const ics = tasksToIcs(source([{ id: 7, name: 'T', start: T0, end: T0 + DAY } as TaskModel]), {
      now: STAMP,
      uidDomain: 'acme.example',
      sequence: 5,
      calendarName: 'Q1 Plan',
    });
    expect(ics).toContain('UID:7@acme.example');
    expect(ics).toContain('SEQUENCE:5');
    expect(ics).toContain('X-WR-CALNAME:Q1 Plan');
  });

  it('folds an over-long SUMMARY line inside the document', () => {
    const ics = tasksToIcs(
      source([{ id: 1, name: 'Z'.repeat(120), start: T0, end: T0 + DAY } as TaskModel]),
      { now: STAMP },
    );
    // The SUMMARY content line is folded → a continuation line beginning with a space.
    const idx = ics.indexOf('SUMMARY:');
    const chunk = ics.slice(idx, idx + 200);
    expect(chunk).toContain('\r\n ');
  });
});

/* ── Download helper + one-shot ──────────────────────────────────────────── */

/**
 * jsdom has no object-URL API, so `downloadIcs` deliberately degrades to a no-op
 * there (so pure callers can still produce + return the payload without a DOM
 * side effect). When the API IS present we stub it. The real download plumbing
 * (object-URL + anchor click) is asserted in `ics-export.a11y.test.ts` under
 * Chromium.
 */
const HAS_OBJECT_URL =
  typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';

describe('downloadIcs + exportIcs', () => {
  it('is a safe no-op when the object-URL API is unavailable (jsdom)', () => {
    if (HAS_OBJECT_URL) return; // covered by the browser test instead
    // Must not throw, and must not attempt to touch the DOM.
    expect(() => downloadIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', 'plan')).not.toThrow();
  });

  it.runIf(HAS_OBJECT_URL)('triggers an <a download> click with the .ics extension appended', () => {
    const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let name = '';
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      name = (this as HTMLAnchorElement).download;
    };
    try {
      downloadIcs('x', 'plan');
      expect(createURL).toHaveBeenCalledOnce();
      expect(name).toBe('plan.ics');
      downloadIcs('x', 'schedule.ics');
      expect(name).toBe('schedule.ics'); // explicit extension preserved
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
      createURL.mockRestore();
      revoke.mockRestore();
    }
  });

  it('exportIcs returns the ICS string and only downloads when asked', () => {
    // Without `download`, exportIcs never touches the DOM → safe everywhere.
    const ics = exportIcs(source([{ id: 1, name: 'T', start: T0, end: T0 + DAY } as TaskModel]), { now: STAMP });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('UID:1@jects.gantt');
  });

  it('exposes the iCalendar MIME type', () => {
    expect(ICS_MIME).toBe('text/calendar;charset=utf-8');
  });
});
