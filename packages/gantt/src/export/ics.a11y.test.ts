/**
 * axe-core a11y + visual/interaction browser test for the **ICS (iCalendar)
 * export** feature (Quality Gate Q2). Runs in real Chromium via
 * `pnpm --filter @jects/gantt test:browser`.
 *
 * The ICS export is a data feature with no intrinsic visual surface, so this test
 * exercises it through a minimal, accessible "Export schedule (.ics)" panel — a
 * labeled trigger button plus a live preview region — that a host app would build
 * on top of `gantt.exportIcs()`. It asserts:
 *   - zero serious/critical axe violations on the mounted, themed panel;
 *   - clicking the button drives `exportIcs()` and renders a valid `VCALENDAR`
 *     into the (focusable, labeled) preview, with one `VEVENT` per task and the
 *     resource attendees resolved through the Gantt's resource layer;
 *   - a real Blob/object-URL download path is reachable in the browser.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@jects/theme/base.css';
import {
  installIcsExport,
  type GanttWithIcsExport,
} from './gantt-ics-export.js';
import type { GanttApi, GanttFeature, TaskModel } from '../contract.js';
import type { ResourceApi, ResolvedAssignment } from '../resource/resource-contract.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 0, 5, 0, 0, 0);
const STAMP = Date.UTC(2026, 0, 1, 9, 30, 0);

type Task = TaskModel & { children?: Task[] };

const TASKS: Task[] = [
  { id: 'p1', name: 'Phase 1', start: BASE, end: BASE + 5 * DAY },
  { id: 't1', name: 'Design', parentId: 'p1', start: BASE, end: BASE + 2 * DAY, percentDone: 0.5 },
  { id: 'm1', name: 'Sign-off', parentId: 'p1', start: BASE + 2 * DAY, milestone: true },
];

function resourceApi(): ResourceApi {
  const resolved: Record<string, ResolvedAssignment[]> = {
    t1: [
      {
        assignment: { id: 'a1', taskId: 't1', resourceId: 'r1' },
        resource: { id: 'r1', name: 'Ada Lovelace', type: 'work', data: { email: 'ada@acme.test' } },
        units: 100,
        effortShare: 1,
        effort: 0,
        cost: 0,
      },
    ],
  };
  return {
    getResources: () => [],
    getResource: () => undefined,
    getAssignmentsFor: (taskId) => resolved[String(taskId)] ?? [],
    getAssignmentsOf: () => [],
    getResourceTasks: () => [],
    assign: () => undefined,
    unassign: () => false,
    allocationOf: () => 0,
    isOverAllocated: () => false,
  };
}

function fakeGantt(tasks: Task[], resources?: ResourceApi): GanttApi {
  const byId = new Map<TaskModel['id'], Task>(tasks.map((t) => [t.id, t]));
  const features = new Map<string, GanttFeature>();
  const api = {
    timeline: {
      rows: {
        count: tasks.length,
        rowAt: (i: number) => (tasks[i] ? { record: tasks[i] } : undefined),
      },
    },
    resources,
    features,
    getTask: (id: TaskModel['id']) => byId.get(id),
    getChildren: (id: TaskModel['id']) =>
      tasks.filter((t) => t.parentId === id) as ReadonlyArray<TaskModel>,
    track: () => {},
    use: (feature: GanttFeature) => {
      features.set(feature.name, feature);
      feature.init(api as unknown as GanttApi);
      return feature;
    },
  } as unknown as GanttApi;
  return api;
}

/** Build a minimal accessible export panel around a Gantt's `exportIcs()`. */
function buildPanel(gantt: GanttWithIcsExport): {
  panel: HTMLElement;
  button: HTMLButtonElement;
  preview: HTMLTextAreaElement;
} {
  const panel = document.createElement('section');
  panel.className = 'jects-gantt-ics-export-demo';
  panel.setAttribute('aria-label', 'Calendar export');
  panel.style.padding = '12px';
  panel.style.color = 'oklch(var(--jects-foreground))';
  panel.style.background = 'oklch(var(--jects-background))';
  panel.style.fontFamily = 'var(--jects-font-family, system-ui)';

  const heading = document.createElement('h2');
  heading.id = 'ics-export-heading';
  heading.textContent = 'Export schedule (.ics)';
  panel.appendChild(heading);

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Export to calendar';
  button.style.color = 'oklch(var(--jects-primary-foreground))';
  button.style.background = 'oklch(var(--jects-primary))';
  button.style.border = '1px solid oklch(var(--jects-border))';
  button.style.borderRadius = 'var(--jects-radius-md, 6px)';
  button.style.padding = '6px 12px';
  panel.appendChild(button);

  const label = document.createElement('label');
  label.htmlFor = 'ics-export-preview';
  label.textContent = 'iCalendar output';
  label.style.display = 'block';
  panel.appendChild(label);

  const preview = document.createElement('textarea');
  preview.id = 'ics-export-preview';
  preview.readOnly = true;
  preview.rows = 8;
  preview.style.width = '100%';
  preview.style.color = 'oklch(var(--jects-foreground))';
  preview.style.background = 'oklch(var(--jects-card))';
  preview.style.border = '1px solid oklch(var(--jects-border))';
  panel.appendChild(preview);

  button.addEventListener('click', () => {
    const ics = gantt.exportIcs({ dtstamp: STAMP });
    // Stash the byte-exact ICS (a <textarea>'s `.value` normalizes CRLF→LF, so
    // the raw, RFC-correct form is preserved out-of-band for assertions).
    preview.dataset.ics = ics;
    preview.value = ics;
  });

  return { panel, button, preview };
}

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '640px';
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

describe('ICS export — a11y + visual (real Chromium)', () => {
  it('mounts an accessible export panel with no serious/critical violations', async () => {
    const gantt = installIcsExport(fakeGantt(TASKS, resourceApi()));
    const { panel } = buildPanel(gantt);
    host.appendChild(panel);

    await expectNoA11yViolations(host);

    // The trigger has an accessible name and the preview is labeled.
    const button = host.querySelector('button')!;
    expect(button.textContent).toBe('Export to calendar');
    const preview = host.querySelector('textarea')!;
    expect(preview.labels?.[0]?.textContent).toBe('iCalendar output');
  });

  it('clicking the trigger renders a valid VCALENDAR with one VEVENT per task and attendees', () => {
    const gantt = installIcsExport(fakeGantt(TASKS, resourceApi()));
    const { panel, button, preview } = buildPanel(gantt);
    host.appendChild(panel);

    button.click();

    // The visible preview is populated (CRLF normalized to LF by the textarea).
    expect(preview.value.startsWith('BEGIN:VCALENDAR')).toBe(true);
    // Assert against the byte-exact ICS captured out-of-band.
    const ics = preview.dataset.ics!;
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    const vevents = ics.split('\r\n').filter((l) => l === 'BEGIN:VEVENT');
    expect(vevents.length).toBe(3);
    expect(ics).toContain('UID:t1@jects.gantt');
    expect(ics).toContain('PERCENT-COMPLETE:50');
    expect(ics).toContain('CATEGORIES:MILESTONE'); // Sign-off
    // Attendee resolved through the resource layer.
    expect(ics).toContain('ORGANIZER;CN=Ada Lovelace:mailto:ada@acme.test');
  });

  it('reaches a real Blob/object-URL download path in the browser', () => {
    const gantt = installIcsExport(fakeGantt(TASKS));
    let downloadName = '';
    const realCreate = document.createElement.bind(document);
    const orig = document.createElement;
    // @ts-expect-error narrow override for the test
    document.createElement = (tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        const a = el as HTMLAnchorElement;
        const realClick = a.click.bind(a);
        a.click = () => {
          downloadName = a.download;
          // Do not actually navigate; just record.
          void realClick;
        };
      }
      return el;
    };

    try {
      const ics = gantt.exportIcs({ download: true, fileName: 'project', dtstamp: STAMP });
      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(downloadName).toBe('project.ics');
    } finally {
      document.createElement = orig;
    }
  });
});
