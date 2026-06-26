/**
 * axe-core a11y + visual/interaction browser test for the Gantt **ICS
 * (iCalendar) export** feature (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * The ICS serializer itself is pure (covered by `export-ics.test.ts` in jsdom);
 * here we exercise the real DOM surface end to end: a project plan is serialized
 * to a real RFC-5545 document, rendered into the accessible preview table
 * (captioned `<table>` with col/row scoped headers and a milestone accent row),
 * asserted to have zero serious/critical axe violations, and the real browser
 * download path is driven (object-URL created, `<a download>` clicked) so the
 * Blob/anchor plumbing is verified in a real engine rather than stubbed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Load the theme tokens FIRST so `oklch(var(--jects-*))` colors in the package
// CSS resolve to real values (the milestone-row accent reads a real background),
// then the shipped, token-pure package stylesheet so the preview is themed by
// the real CSS rather than unstyled defaults.
import '@jects/theme/base.css';
import '../styles.css';
import { tasksToIcs, downloadIcs, parseIcsEvents } from './export-ics.js';
import { renderIcsPreview } from './ics-preview.js';
import type { TaskModel } from '../contract.js';
import type { TaskTreeSource } from './serialize.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const STAMP = Date.UTC(2026, 5, 24, 9, 30, 0);

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '720px';
  host.style.padding = '16px';
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
  vi.restoreAllMocks();
});

function source(): TaskTreeSource {
  return {
    items: [
      {
        id: 'p',
        name: 'Design phase',
        start: T0,
        end: T0 + 5 * DAY,
        percentDone: 0.4,
        children: [
          { id: 'a', name: 'Wireframes', start: T0, end: T0 + 2 * DAY, percentDone: 1 } as TaskModel,
          { id: 'b', name: 'Visual design', start: T0 + 2 * DAY, end: T0 + 5 * DAY, percentDone: 0.2 } as TaskModel,
          { id: 'm', name: 'Design sign-off', start: T0 + 5 * DAY, milestone: true } as TaskModel,
        ],
      } as TaskModel & { children: TaskModel[] },
    ],
    getChildren: (n) => (typeof n === 'object' ? ((n as { children?: TaskModel[] }).children ?? []) : []),
  };
}

describe('Gantt ICS export a11y + visual (real Chromium)', () => {
  it('renders an accessible export preview with no serious/critical violations', async () => {
    const ics = tasksToIcs(source(), { now: STAMP, calendarName: 'Project plan' });
    const preview = renderIcsPreview(ics, { caption: 'Calendar export preview' });
    host.appendChild(preview);

    await expectNoA11yViolations(host);

    // The preview region is labelled and carries one row per VEVENT.
    expect(preview.getAttribute('role')).toBe('group');
    const rows = preview.querySelectorAll('.jects-gantt-ics-preview__row');
    expect(rows.length).toBe(parseIcsEvents(ics).length);
    expect(rows.length).toBe(4); // phase + 2 leaves + milestone

    // Header cells are column-scoped; each row's name is a row-scoped header.
    const colHeaders = preview.querySelectorAll('thead th[scope="col"]');
    expect(colHeaders.length).toBe(4);
    const rowHeaders = preview.querySelectorAll('tbody th[scope="row"]');
    expect(rowHeaders.length).toBe(4);
  });

  it('flags the milestone row with an accent and a no-end marker', async () => {
    const ics = tasksToIcs(source(), { now: STAMP });
    const preview = renderIcsPreview(ics);
    host.appendChild(preview);

    const milestoneRow = preview.querySelector(
      '.jects-gantt-ics-preview__row--milestone',
    ) as HTMLElement;
    expect(milestoneRow).not.toBeNull();
    expect(milestoneRow.dataset.uid).toBe('m@jects.gantt');

    // The milestone accent paints a non-transparent background (real CSS token).
    const bg = getComputedStyle(milestoneRow).backgroundColor;
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');

    // The end cell reads as a no-end marker for assistive tech.
    const endCell = milestoneRow.querySelectorAll('td')[1] as HTMLElement;
    expect(endCell.getAttribute('aria-label')).toBe('milestone (no end)');

    await expectNoA11yViolations(host);
  });

  it('drives the real browser download path (object-URL + anchor click)', () => {
    const ics = tasksToIcs(source(), { now: STAMP });
    const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let clickedName = '';
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clickedName = (this as HTMLAnchorElement).download;
    };
    try {
      downloadIcs(ics, 'project-plan');
      expect(createURL).toHaveBeenCalledOnce();
      // The Blob handed to createObjectURL carries the iCalendar MIME type.
      const blob = createURL.mock.calls[0]![0] as Blob;
      expect(blob.type).toContain('text/calendar');
      expect(clickedName).toBe('project-plan.ics');
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
      createURL.mockRestore();
      revoke.mockRestore();
    }
  });
});
