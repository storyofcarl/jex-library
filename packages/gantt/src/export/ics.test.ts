/**
 * jsdom unit tests for the DOM-free ICS (iCalendar / RFC 5545) writer:
 * VCALENDAR/VEVENT shape, DTSTART/DTEND/UID/PERCENT-COMPLETE/STATUS, milestone
 * collapsing, attendee/organizer lines, RFC-5545 escaping + 75-octet folding, and
 * the `include` filter.
 */
import { describe, it, expect } from 'vitest';
import {
  escapeIcsText,
  escapeIcsParam,
  foldIcsLine,
  formatIcsUtc,
  formatIcsLocal,
  isMilestone,
  taskToEvent,
  veventLines,
  buildVCalendar,
  tasksToIcs,
  type IcsEvent,
} from './ics.js';
import type { TaskModel } from '../contract.js';
import type { TaskTreeSource } from './serialize.js';

const DAY = 86_400_000;
// A fixed, deterministic base instant: 2026-01-05T00:00:00Z.
const BASE = Date.UTC(2026, 0, 5, 0, 0, 0);
const STAMP = Date.UTC(2026, 0, 1, 9, 30, 0);

function source(roots: Array<TaskModel & { children?: TaskModel[] }>): TaskTreeSource {
  return {
    items: roots,
    getChildren: (n) => (typeof n === 'object' ? (n.children ?? []) : []) as TaskModel[],
  };
}

/** Parse a folded VCALENDAR back into logical (unfolded) content lines. */
function unfold(ics: string): string[] {
  const physical = ics.split('\r\n');
  const logical: string[] = [];
  for (const line of physical) {
    if (line.startsWith(' ') && logical.length > 0) {
      logical[logical.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      logical.push(line);
    }
  }
  return logical;
}

describe('escapeIcsText (RFC 5545 §3.3.11)', () => {
  it('escapes backslash, semicolon, comma and newlines (backslash first)', () => {
    expect(escapeIcsText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
    expect(escapeIcsText('line1\nline2')).toBe('line1\\nline2');
    expect(escapeIcsText('cr\r\nlf')).toBe('cr\\nlf');
  });

  it('leaves a plain value untouched', () => {
    expect(escapeIcsText('Design phase')).toBe('Design phase');
  });
});

describe('escapeIcsParam (RFC 5545 §3.2)', () => {
  it('DQUOTE-wraps a value containing : ; or ,', () => {
    expect(escapeIcsParam('Smith, John')).toBe('"Smith, John"');
    expect(escapeIcsParam('a:b')).toBe('"a:b"');
  });

  it('replaces an embedded DQUOTE with a single quote', () => {
    expect(escapeIcsParam('say "hi"')).toBe("say 'hi'");
  });

  it('strips control characters to a space', () => {
    expect(escapeIcsParam('a\tb\nc')).toBe('a b c');
  });

  it('leaves a plain value bare (no quoting)', () => {
    expect(escapeIcsParam('Alice')).toBe('Alice');
  });
});

describe('foldIcsLine (RFC 5545 §3.1, 75-octet)', () => {
  it('does not fold a short ASCII line', () => {
    expect(foldIcsLine('SUMMARY:Hi')).toBe('SUMMARY:Hi');
  });

  it('folds a long line into <=75-octet physical lines with leading-space continuation', () => {
    const long = 'DESCRIPTION:' + 'x'.repeat(200);
    const folded = foldIcsLine(long);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    // First physical line <= 75 octets.
    expect(Buffer.byteLength(parts[0]!, 'utf8')).toBeLessThanOrEqual(75);
    // Continuations start with exactly one space and are <= 75 octets.
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i]!.startsWith(' ')).toBe(true);
      expect(Buffer.byteLength(parts[i]!, 'utf8')).toBeLessThanOrEqual(75);
    }
    // Unfolding restores the original logical line.
    const restored = parts[0]! + parts.slice(1).map((p) => p.slice(1)).join('');
    expect(restored).toBe(long);
  });

  it('never splits a multi-byte character across a fold boundary (octet-aware)', () => {
    // 40 emoji = 160 octets (4 each), forcing several folds.
    const long = 'SUMMARY:' + '😀'.repeat(40);
    const folded = foldIcsLine(long);
    const parts = folded.split('\r\n');
    for (const p of parts) {
      // Each physical line must be valid UTF-8 (no lone surrogates) and <= 75 octets.
      expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(75);
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(p)).toBe(false);
    }
  });
});

describe('formatIcsUtc / formatIcsLocal', () => {
  it('formats a UTC DATE-TIME with trailing Z', () => {
    expect(formatIcsUtc(BASE)).toBe('20260105T000000Z');
    expect(formatIcsUtc(Date.UTC(2026, 11, 31, 23, 59, 5))).toBe('20261231T235905Z');
  });

  it('formats a floating local DATE-TIME without Z', () => {
    expect(formatIcsLocal(BASE)).toBe('20260105T000000');
  });
});

describe('isMilestone', () => {
  it('treats an explicit milestone flag, zero duration, or start==end as a milestone', () => {
    expect(isMilestone({ id: 1, milestone: true } as TaskModel)).toBe(true);
    expect(isMilestone({ id: 2, duration: 0 } as TaskModel)).toBe(true);
    expect(isMilestone({ id: 3, start: BASE, end: BASE } as TaskModel)).toBe(true);
    expect(isMilestone({ id: 4, start: BASE, end: BASE + DAY } as TaskModel)).toBe(false);
  });
});

describe('taskToEvent', () => {
  it('returns undefined for an unscheduled task (no start)', () => {
    expect(taskToEvent({ id: 1, name: 'x' } as TaskModel, false, {})).toBeUndefined();
  });

  it('maps name/start/end/percentDone and collapses a milestone to a point', () => {
    const ev = taskToEvent(
      { id: 7, name: 'Kickoff', start: BASE, end: BASE, percentDone: 0.4 } as TaskModel,
      false,
      {},
    )!;
    expect(ev.summary).toBe('Kickoff');
    expect(ev.start).toBe(BASE);
    expect(ev.end).toBe(BASE);
    expect(ev.milestone).toBe(true);
    expect(ev.percentComplete).toBe(40);
  });

  it('clamps an inverted span (end < start) to a point and derives attendees from resourceIds', () => {
    const ev = taskToEvent(
      { id: 8, name: 'Bad', start: BASE + DAY, end: BASE, resourceIds: ['r1', 'r2'] } as TaskModel,
      false,
      {},
    )!;
    expect(ev.end).toBe(ev.start);
    expect(ev.attendees?.map((a) => a.id)).toEqual(['r1', 'r2']);
  });
});

describe('veventLines', () => {
  const ev: IcsEvent = {
    id: 'task,1',
    summary: 'Build; phase',
    start: BASE,
    end: BASE + 2 * DAY,
    percentComplete: 100,
    attendees: [
      { id: 'r1', name: 'Alice', email: 'alice@acme.test', cutype: 'INDIVIDUAL' },
      { id: 'r2', name: 'Crane', cutype: 'RESOURCE' },
    ],
  };

  it('emits a fully-formed VEVENT with escaped UID/SUMMARY, DTSTART/DTEND, status and attendees', () => {
    const lines = veventLines(ev, { uidDomain: 'jects.gantt', dtstamp: STAMP });
    expect(lines[0]).toBe('BEGIN:VEVENT');
    expect(lines).toContain('UID:task\\,1@jects.gantt');
    expect(lines).toContain('DTSTAMP:20260101T093000Z');
    expect(lines).toContain('DTSTART:20260105T000000Z');
    expect(lines).toContain('DTEND:20260107T000000Z');
    expect(lines).toContain('SUMMARY:Build\\; phase');
    expect(lines).toContain('PERCENT-COMPLETE:100');
    expect(lines).toContain('STATUS:COMPLETED');
    // First attendee doubles as organizer.
    expect(lines).toContain('ORGANIZER;CN=Alice:mailto:alice@acme.test');
    expect(lines).toContain(
      'ATTENDEE;CN=Alice;ROLE=REQ-PARTICIPANT;CUTYPE=INDIVIDUAL;PARTSTAT=NEEDS-ACTION:mailto:alice@acme.test',
    );
    // The no-email resource falls back to a urn CAL-ADDRESS.
    expect(lines).toContain(
      'ATTENDEE;CN=Crane;ROLE=REQ-PARTICIPANT;CUTYPE=RESOURCE;PARTSTAT=NEEDS-ACTION:urn:jects:resource:r2',
    );
    expect(lines[lines.length - 1]).toBe('END:VEVENT');
  });

  it('uses TZID-tagged floating times when a tzid is supplied', () => {
    const lines = veventLines(ev, {
      uidDomain: 'd',
      dtstamp: STAMP,
      tzid: 'Europe/Stockholm',
    });
    expect(lines).toContain('DTSTART;TZID=Europe/Stockholm:20260105T000000');
    expect(lines).toContain('DTEND;TZID=Europe/Stockholm:20260107T000000');
  });

  it('emits a VALARM when an alarm lead time is set', () => {
    const lines = veventLines(ev, {
      uidDomain: 'd',
      dtstamp: STAMP,
      alarmMinutesBefore: 15,
    });
    expect(lines).toContain('BEGIN:VALARM');
    expect(lines).toContain('ACTION:DISPLAY');
    expect(lines).toContain('TRIGGER:-PT15M');
    expect(lines).toContain('END:VALARM');
  });

  it('marks a partially-done event IN-PROCESS and a 0% event NEEDS-ACTION', () => {
    const a = veventLines({ ...ev, percentComplete: 30 }, { uidDomain: 'd', dtstamp: STAMP });
    expect(a).toContain('STATUS:IN-PROCESS');
    const b = veventLines({ ...ev, percentComplete: 0 }, { uidDomain: 'd', dtstamp: STAMP });
    expect(b).toContain('STATUS:NEEDS-ACTION');
  });
});

describe('buildVCalendar', () => {
  it('wraps events in a VERSION/PRODID/CALSCALE VCALENDAR ending with CRLF', () => {
    const ics = buildVCalendar(
      [{ id: 1, summary: 'A', start: BASE, end: BASE + DAY }],
      { dtstamp: STAMP, prodId: '-//Acme//Test//EN', calendarName: 'Plan' },
    );
    const lines = unfold(ics);
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('PRODID:-//Acme//Test//EN');
    expect(lines).toContain('CALSCALE:GREGORIAN');
    expect(lines).toContain('METHOD:PUBLISH');
    expect(lines).toContain('X-WR-CALNAME:Plan');
    expect(lines[lines.length - 1]).toBe('END:VCALENDAR');
    expect(ics.endsWith('\r\n')).toBe(true);
    // Uses CRLF line endings throughout (no bare LF).
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });
});

describe('tasksToIcs (end-to-end)', () => {
  const tree: Array<TaskModel & { children?: TaskModel[] }> = [
    {
      id: 'p1',
      name: 'Phase 1',
      start: BASE,
      end: BASE + 5 * DAY,
      children: [
        { id: 't1', name: 'Design', start: BASE, end: BASE + 2 * DAY, percentDone: 0.5 } as TaskModel,
        { id: 'm1', name: 'Sign-off', start: BASE + 2 * DAY, milestone: true } as TaskModel,
      ],
    } as TaskModel & { children?: TaskModel[] },
  ];

  it('emits one VEVENT per task by default (summary + leaves)', () => {
    const ics = tasksToIcs(source(tree), { dtstamp: STAMP });
    const begins = unfold(ics).filter((l) => l === 'BEGIN:VEVENT');
    expect(begins.length).toBe(3); // Phase 1 + Design + Sign-off
    const lines = unfold(ics);
    expect(lines).toContain('UID:p1@jects.gantt');
    expect(lines).toContain('UID:t1@jects.gantt');
    expect(lines).toContain('UID:m1@jects.gantt');
  });

  it('include="leaf" skips summary rows', () => {
    const ics = tasksToIcs(source(tree), { dtstamp: STAMP, include: 'leaf' });
    const lines = unfold(ics);
    expect(lines).not.toContain('UID:p1@jects.gantt'); // Phase 1 is a summary
    expect(lines).toContain('UID:t1@jects.gantt');
    expect(lines).toContain('UID:m1@jects.gantt');
  });

  it('include="milestones" keeps only milestones', () => {
    const ics = tasksToIcs(source(tree), { dtstamp: STAMP, include: 'milestones' });
    const lines = unfold(ics);
    const uids = lines.filter((l) => l.startsWith('UID:'));
    expect(uids).toEqual(['UID:m1@jects.gantt']);
  });

  it('resolves attendees via the attendeesOf resolver', () => {
    const ics = tasksToIcs(source(tree), {
      dtstamp: STAMP,
      include: 'leaf',
      attendeesOf: (task) =>
        task.id === 't1'
          ? [{ id: 'u1', name: 'Bob', email: 'bob@acme.test' }]
          : [],
    });
    const lines = unfold(ics);
    expect(lines).toContain('ORGANIZER;CN=Bob:mailto:bob@acme.test');
    expect(
      lines.some((l) => l.includes('ATTENDEE') && l.includes('mailto:bob@acme.test')),
    ).toBe(true);
  });
});
