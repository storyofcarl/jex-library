/**
 * jsdom unit tests for the ICS export preview: line-unfolding, VEVENT parsing
 * (round-tripping the real serializer output), and the accessible table markup
 * produced by renderIcsPreview() — caption, scoped headers, one row per event,
 * milestone accent + no-end marker.
 */
import { describe, it, expect } from 'vitest';
import { tasksToIcs } from './export-ics.js';
import {
  unfoldIcs,
  parseIcsEvents,
  renderIcsPreview,
} from './ics-preview.js';
import type { TaskModel } from '../contract.js';
import type { TaskTreeSource } from './serialize.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const STAMP = Date.UTC(2026, 5, 24, 9, 30, 0);

function source(roots: Array<TaskModel & { children?: TaskModel[] }>): TaskTreeSource {
  return {
    items: roots,
    getChildren: (n) => (typeof n === 'object' ? (n.children ?? []) : []) as TaskModel[],
  };
}

describe('unfoldIcs', () => {
  it('drops the CRLF + leading-space fold indicator (RFC 5545 unfolding)', () => {
    // Folding inserts CRLF+space; unfolding removes BOTH, rejoining the octets.
    const folded = 'SUMMARY:Hello\r\n World\r\nUID:x';
    expect(unfoldIcs(folded)).toEqual(['SUMMARY:HelloWorld', 'UID:x']);
  });
});

describe('parseIcsEvents (round-trip from the real serializer)', () => {
  const ics = tasksToIcs(
    source([
      { id: 'a', name: 'Build, ship', start: T0, end: T0 + 2 * DAY, percentDone: 1 } as TaskModel,
      { id: 'm', name: 'Launch', start: T0 + 2 * DAY, milestone: true } as TaskModel,
    ]),
    { now: STAMP },
  );
  const events = parseIcsEvents(ics);

  it('parses one event per VEVENT with unescaped summaries', () => {
    expect(events).toHaveLength(2);
    expect(events[0]!.uid).toBe('a@jects.gantt');
    expect(events[0]!.summary).toBe('Build, ship'); // comma unescaped
    expect(events[0]!.percentComplete).toBe('100');
    expect(events[0]!.milestone).toBe(false);
  });

  it('flags the milestone (CATEGORIES:MILESTONE) and gives it no end', () => {
    expect(events[1]!.milestone).toBe(true);
    expect(events[1]!.end).toBeUndefined();
    expect(events[1]!.start).not.toBe('');
  });
});

describe('renderIcsPreview (accessible markup)', () => {
  const ics = tasksToIcs(
    source([
      { id: 'a', name: 'Task A', start: T0, end: T0 + DAY } as TaskModel,
      { id: 'm', name: 'Milestone', start: T0 + DAY, milestone: true } as TaskModel,
    ]),
    { now: STAMP },
  );

  it('renders a labelled group + captioned table with scoped headers', () => {
    const el = renderIcsPreview(ics, { caption: 'Export preview' });
    expect(el.getAttribute('role')).toBe('group');
    expect(el.getAttribute('aria-label')).toBe('Export preview');
    expect(el.querySelector('caption')!.textContent).toBe('Export preview');
    expect(el.querySelectorAll('thead th[scope="col"]')).toHaveLength(4);
    expect(el.querySelectorAll('tbody th[scope="row"]')).toHaveLength(2);
    expect(el.querySelector('.jects-gantt-ics-preview__summary')!.textContent).toBe(
      '2 events ready to export',
    );
  });

  it('one row per event, with the milestone row accented + marked no-end', () => {
    const el = renderIcsPreview(ics);
    const rows = el.querySelectorAll('.jects-gantt-ics-preview__row');
    expect(rows).toHaveLength(2);
    const ms = el.querySelector('.jects-gantt-ics-preview__row--milestone') as HTMLElement;
    expect(ms).not.toBeNull();
    expect(ms.dataset.uid).toBe('m@jects.gantt');
    const endCell = ms.querySelectorAll('td')[1] as HTMLElement;
    expect(endCell.getAttribute('aria-label')).toBe('milestone (no end)');
    expect(endCell.textContent).toBe('—');
  });
});
