/**
 * jsdom unit tests for the **"Export to PNG" toolbar action**
 * (`GanttExportToolbar`) — the visible UI affordance that makes image export
 * reachable out of the box (Bryntum/DHTMLX parity), on top of the programmatic
 * `gantt.exportPng()` surface from `GanttImageExportFeature`.
 *
 * jsdom has no real 2D-canvas raster path, so the actual PNG bytes are exercised
 * by the Chromium a11y/visual test (`export-toolbar.browser.test.ts`). Here we
 * assert the deterministic, browser-independent surface:
 *   - the feature renders ONE focusable, accessible `role="toolbar"` + button,
 *   - clicking it drives an export (and, under jsdom, falls back to a serialized
 *     SVG download so the action still yields an artifact),
 *   - it reuses the controller grafted by `GanttImageExportFeature` when present,
 *   - teardown (`removeFeature` / `gantt.destroy()`) removes the DOM + leaks
 *     nothing, and is idempotent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Gantt } from '../ui/gantt.js';
import {
  GanttExportToolbar,
  createGanttExportToolbar,
  GANTT_EXPORT_TOOLBAR_FEATURE,
} from './export-toolbar.js';
import { GanttImageExportFeature } from './gantt-image-export.js';
import type * as png from './png.js';
import type { TaskModel } from '../contract.js';

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
  host.style.width = '900px';
  host.style.height = '320px';
  document.body.appendChild(host);
});

afterEach(() => {
  vi.restoreAllMocks();
  gantt?.destroy();
  gantt = null;
  host.remove();
});

const TOOLBAR = '.jects-gantt__export-toolbar';
const BUTTON = '.jects-gantt__export-toolbar__btn';

describe('GanttExportToolbar — rendering + a11y wiring', () => {
  it('renders one accessible toolbar with a single export button', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportToolbar());

    const bar = host.querySelector(TOOLBAR);
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute('role')).toBe('toolbar');
    expect(bar!.getAttribute('aria-label')).toBeTruthy();

    const btns = host.querySelectorAll(BUTTON);
    expect(btns).toHaveLength(1);
    const btn = btns[0] as HTMLButtonElement;
    expect(btn.type).toBe('button');
    // Accessible name (aria-label) + tooltip both present.
    expect(btn.getAttribute('aria-label')).toBe('Export to PNG');
    expect(btn.title).toBe('Export to PNG');
    // Icon is decorative (hidden from a11y tree); label text is real.
    expect(btn.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(btn.textContent).toContain('Export to PNG');
  });

  it('honors a custom label and showLabel:false', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportToolbar({ label: 'Save image', showLabel: false }));
    const btn = host.querySelector(BUTTON) as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Save image');
    expect(btn.title).toBe('Save image');
    // No visible label span when showLabel is false (icon-only).
    expect(btn.querySelector('.jects-gantt__export-toolbar__label')).toBeNull();
    // …but the accessible name is still set, so the button is not unlabeled.
    expect(btn.getAttribute('aria-label')).toBeTruthy();
  });

  it('registers under the feature name (reachable via features.get)', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportToolbar());
    expect(gantt.features.get(GANTT_EXPORT_TOOLBAR_FEATURE)).toBeInstanceOf(
      GanttExportToolbar,
    );
  });

  it('mounts into a custom toolbarHost when provided', () => {
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportToolbar({ toolbarHost: slot }));
    expect(slot.querySelector(TOOLBAR)).not.toBeNull();
    expect(host.querySelector(TOOLBAR)).toBeNull();
    slot.remove();
  });
});

describe('GanttExportToolbar — click triggers export', () => {
  it('clicking the button downloads an artifact (SVG fallback under jsdom)', async () => {
    // jsdom does not implement URL.createObjectURL; stub it so the real
    // `downloadImage` anchor-blob path runs, and capture the triggered anchor.
    const urlAny = URL as unknown as {
      createObjectURL?: unknown;
      revokeObjectURL?: unknown;
    };
    const hadCreate = 'createObjectURL' in URL;
    const hadRevoke = 'revokeObjectURL' in URL;
    urlAny.createObjectURL = () => 'blob:mock';
    urlAny.revokeObjectURL = () => {};

    const anchors: Array<{ download: string; clicked: boolean }> = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        anchors.push({ download: this.download, clicked: true });
      });

    try {
      gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
      const feature = new GanttExportToolbar({ filename: 'plan' });
      gantt.use(feature);

      // Drive the same code path the button click runs (await it so the async
      // export settles deterministically — the click handler is fire-and-forget).
      const blob = await feature.exportNow();
      expect(blob).toBeNull(); // jsdom: no canvas → null → SVG fallback path.

      // The SVG fallback fired an anchor download for the serialized standalone
      // SVG (filename's extension swapped to .svg).
      expect(clickSpy).toHaveBeenCalled();
      expect(anchors.some((a) => a.download === 'plan.svg')).toBe(true);
    } finally {
      // `downloadImage` schedules `setTimeout(() => URL.revokeObjectURL(url), 0)`;
      // let that macrotask drain against the stub before removing it.
      await new Promise((r) => setTimeout(r, 0));
      if (!hadCreate) delete urlAny.createObjectURL;
      if (!hadRevoke) delete urlAny.revokeObjectURL;
    }
  });

  it('exportNow() resolves null under jsdom (no real raster path)', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttExportToolbar();
    gantt.use(feature);
    expect(await feature.exportNow()).toBeNull();
  });

  it('reuses the controller grafted by GanttImageExportFeature when present', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const imageExport = new GanttImageExportFeature();
    gantt.use(imageExport);
    const toolbar = new GanttExportToolbar();
    gantt.use(toolbar);

    const grafted = (gantt as unknown as { imageExporter: png.GanttImageExporter })
      .imageExporter;
    const exportSpy = vi.spyOn(grafted, 'export');

    await toolbar.exportNow();
    // The toolbar drove the SAME (grafted) controller, not a private one.
    expect(exportSpy).toHaveBeenCalled();
  });

  it('coalesces re-entrant clicks while an export is in flight', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttExportToolbar();
    gantt.use(feature);
    const p1 = feature.exportNow();
    // Second call while the first is in flight is rejected (busy) → null.
    const p2 = feature.exportNow();
    expect(await p2).toBeNull();
    await p1;
  });
});

describe('GanttExportToolbar — factory + teardown', () => {
  it('createGanttExportToolbar returns an installable feature', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = createGanttExportToolbar({ label: 'Export' });
    expect(feature).toBeInstanceOf(GanttExportToolbar);
    gantt.use(feature);
    expect(host.querySelector(BUTTON)?.getAttribute('aria-label')).toBe('Export');
  });

  it('removeFeature() removes the toolbar DOM', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportToolbar());
    expect(host.querySelector(TOOLBAR)).not.toBeNull();
    gantt.removeFeature(GANTT_EXPORT_TOOLBAR_FEATURE);
    expect(host.querySelector(TOOLBAR)).toBeNull();
  });

  it('gantt.destroy() removes the toolbar (no leaked DOM)', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportToolbar());
    gantt.destroy();
    gantt = null;
    expect(host.querySelector(TOOLBAR)).toBeNull();
  });

  it('destroy() is idempotent', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttExportToolbar();
    gantt.use(feature);
    gantt.removeFeature(GANTT_EXPORT_TOOLBAR_FEATURE);
    expect(() => feature.destroy()).not.toThrow();
  });
});
