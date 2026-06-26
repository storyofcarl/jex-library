/**
 * axe-core a11y + visual/interaction browser test for the **unified export menu
 * / format dispatcher UI** (`GanttExportMenu`) — Quality Gate Q2. Runs in real
 * Chromium via `pnpm --filter @jects/gantt test:browser`.
 *
 * The dispatch logic is unit-tested in jsdom (`export-feature.test.ts`); here we
 * exercise the real accessible surface end to end:
 *   - the trigger Button exposes `aria-haspopup`/`aria-expanded` and toggles the
 *     popup Menu (real `ContextMenu` floating container, focus trap, Escape),
 *   - the open menu has zero serious/critical axe violations (roles, names,
 *     keyboard operability, focus order),
 *   - keyboard operation works: focus lands in the menu, ArrowDown/Enter selects,
 *   - the real browser download path runs (object-URL created, `<a download>`
 *     clicked) for a string export format (MSPDI), verifying the Blob/anchor
 *     plumbing in a real engine rather than stubbed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Load the shipped, token-pure stylesheets so Button + Menu + the export-menu
// wrapper are themed by the real CSS rather than unstyled defaults.
import '../styles.css';
import '@jects/widgets/style.css';
import { Gantt } from './gantt.js';
import { GanttExportMenu } from './export-feature.js';
import { GanttExportCsv } from '../export/gantt-export-csv.js';
import type { TaskModel } from '../contract.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

function tasks(): TaskModel[] {
  return [
    { id: 'a', name: 'Design', start: T0, duration: 4 * DAY, end: T0 + 4 * DAY } as TaskModel,
    {
      id: 'b',
      name: 'Build',
      start: T0 + 4 * DAY,
      duration: 3 * DAY,
      end: T0 + 7 * DAY,
    } as TaskModel,
  ];
}

let host: HTMLElement;
let gantt: Gantt | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.width = '960px';
  host.style.height = '360px';
  host.style.position = 'relative';
  document.body.appendChild(host);
});

afterEach(() => {
  vi.restoreAllMocks();
  gantt?.destroy();
  gantt = null;
  host.remove();
});

const TRIGGER = '[data-export-menu-trigger]';

describe('GanttExportMenu a11y + visual (real Chromium)', () => {
  it('the trigger button is accessible and themed', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportCsv());
    gantt.use(new GanttExportMenu());

    const btn = host.querySelector(TRIGGER) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    // Real CSS is applied: the shipped Button stylesheet gives it the themed
    // class + a non-default font (proves @jects/widgets/style.css loaded).
    expect(btn.classList.contains('jects-btn')).toBe(true);
    expect(getComputedStyle(btn).cursor).toBe('pointer');

    await expectNoA11yViolations(host);
  });

  it('opening the menu yields an accessible menu with no serious/critical violations', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportCsv());
    const feature = new GanttExportMenu();
    gantt.use(feature);

    const btn = host.querySelector(TRIGGER) as HTMLButtonElement;
    btn.click();
    expect(feature.opened).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('true');

    // The popup Menu is a real ARIA menu with one menuitem per available format.
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).not.toBeNull();
    const items = menu.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBe(feature.availableFormats().length);

    // axe over the whole document (the popup mounts into a fixed container).
    await expectNoA11yViolations(document.body);
  });

  it('is keyboard operable: focus enters the menu, ArrowDown + Enter selects', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportCsv());
    const feature = new GanttExportMenu({ filename: 'plan' });
    gantt.use(feature);

    const exported: string[] = [];
    feature.on('export', (e) => exported.push(e.format));
    // Swallow the implicit download (real anchor) so the test does not navigate.
    const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      /* suppress navigation */
    };

    try {
      (host.querySelector(TRIGGER) as HTMLButtonElement).click();
      const menu = document.querySelector('[role="menu"]') as HTMLElement;

      // The first focusable item holds the roving tab stop and is focused.
      const active = document.activeElement as HTMLElement;
      expect(menu.contains(active)).toBe(true);
      expect(active.getAttribute('role')).toBe('menuitem');

      // Enter activates the focused item (the first available format).
      active.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );

      await new Promise((r) => setTimeout(r, 0));
      expect(exported.length).toBe(1);
      expect(feature.availableFormats()).toContain(exported[0]!);
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
      createURL.mockRestore();
    }
  });

  it('Escape closes the menu and returns focus to the trigger', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttExportMenu();
    gantt.use(feature);

    const btn = host.querySelector(TRIGGER) as HTMLButtonElement;
    btn.click();
    expect(feature.opened).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(feature.opened).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('drives the real browser download path for MSPDI (object-URL + anchor click)', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttExportMenu({ filename: 'project-plan' });
    gantt.use(feature);

    const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let clickedName = '';
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clickedName = (this as HTMLAnchorElement).download;
    };
    try {
      await feature.exportFormat('mspdi');
      expect(createURL).toHaveBeenCalledOnce();
      const blob = createURL.mock.calls[0]![0] as Blob;
      expect(blob.type).toContain('application/xml');
      expect(clickedName).toBe('project-plan.xml');
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
      createURL.mockRestore();
      revoke.mockRestore();
    }
  });
});
