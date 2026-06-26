/**
 * jsdom unit tests for the **unified export menu / format dispatcher UI**
 * (`GanttExportMenu`) — the single user-facing entry point (a `@jects/widgets`
 * Button + popup Menu) that lists the *available* export formats + Print and
 * dispatches each to its corresponding exporter (Bryntum/DHTMLX
 * "Export … + print" parity).
 *
 * jsdom has no real 2D-canvas raster path (PNG) and no print device, so the
 * pixel/print paths are exercised by the Chromium a11y test
 * (`export-feature.a11y.test.ts`). Here we assert the deterministic,
 * browser-independent surface:
 *   - the feature renders ONE accessible trigger button (`aria-haspopup`),
 *   - the menu lists exactly the formats whose exporter is reachable (availability
 *     detection), honoring `formats` / `include` / `exclude`,
 *   - selecting a format dispatches to the right exporter + downloads (CSV/XLSX/
 *     ICS/MSPDI verified end-to-end with stubbed `URL`/anchor),
 *   - `beforeExport` / `beforePrint` veto, the typed events fire,
 *   - teardown (`removeFeature` / `gantt.destroy()`) removes the DOM, leaks
 *     nothing, and is idempotent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Gantt } from './gantt.js';
import {
  GanttExportMenu,
  createGanttExportMenu,
  GANTT_EXPORT_MENU_FEATURE,
  DEFAULT_EXPORT_FORMATS,
  type GanttExportResult,
} from './export-feature.js';
import { GanttExportCsv } from '../export/gantt-export-csv.js';
import { GanttExportXlsx } from '../export/gantt-export-xlsx.js';
import { GanttIcsExportFeature } from '../export/gantt-ics-export.js';
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

const WRAP = '.jects-gantt__export-menu';
const TRIGGER = '[data-export-menu-trigger]';

let host: HTMLElement;
let gantt: Gantt | null = null;

/** Stub the jsdom-missing object-URL + anchor click; returns the captured downloads. */
function stubDownloads(): {
  anchors: Array<{ download: string; href: string }>;
  restore: () => void;
} {
  const urlAny = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
  const hadCreate = 'createObjectURL' in URL;
  const hadRevoke = 'revokeObjectURL' in URL;
  urlAny.createObjectURL = () => 'blob:mock';
  urlAny.revokeObjectURL = () => {};

  const anchors: Array<{ download: string; href: string }> = [];
  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      anchors.push({ download: this.download, href: this.href });
    });

  return {
    anchors,
    restore: () => {
      clickSpy.mockRestore();
      if (!hadCreate) delete urlAny.createObjectURL;
      if (!hadRevoke) delete urlAny.revokeObjectURL;
    },
  };
}

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

describe('GanttExportMenu — rendering + a11y wiring', () => {
  it('renders one accessible trigger button with popup semantics', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportMenu());

    const wrap = host.querySelector(WRAP);
    expect(wrap).not.toBeNull();
    expect(wrap!.getAttribute('role')).toBe('toolbar');

    const btn = host.querySelector(TRIGGER) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBe('Export');
    expect(btn.title).toBe('Export');
  });

  it('honors a custom label', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportMenu({ label: 'Download' }));
    const btn = host.querySelector(TRIGGER) as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Download');
    expect(btn.textContent).toContain('Download');
  });

  it('registers under the feature name (reachable via features.get)', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportMenu());
    expect(gantt.features.get(GANTT_EXPORT_MENU_FEATURE)).toBeInstanceOf(GanttExportMenu);
  });

  it('mounts into a custom host when provided', () => {
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportMenu({ host: slot }));
    expect(slot.querySelector(WRAP)).not.toBeNull();
    expect(host.querySelector(WRAP)).toBeNull();
    slot.remove();
  });
});

describe('GanttExportMenu — availability detection', () => {
  it('always offers mspdi + print, and hides formats whose exporter is absent', () => {
    // `exports: false` opts out of the auto-installed export method features so
    // the menu's absent-exporter detection can be exercised in isolation.
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0, exports: false });
    const feature = new GanttExportMenu();
    gantt.use(feature);
    const formats = feature.availableFormats();
    // No per-format export feature installed → only the always-available paths.
    expect(formats).toContain('mspdi');
    expect(formats).toContain('print');
    expect(formats).not.toContain('csv');
    expect(formats).not.toContain('xlsx');
    expect(formats).not.toContain('ics');
  });

  it('offers csv once GanttExportCsv is installed', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportCsv());
    const feature = new GanttExportMenu();
    gantt.use(feature);
    expect(feature.availableFormats()).toContain('csv');
  });

  it('offers csv + xlsx + ics with all three wiring features installed', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportCsv());
    gantt.use(new GanttExportXlsx());
    gantt.use(new GanttIcsExportFeature());
    const feature = new GanttExportMenu();
    gantt.use(feature);
    const formats = feature.availableFormats();
    expect(formats).toEqual(expect.arrayContaining(['csv', 'xlsx', 'ics', 'mspdi', 'print']));
  });

  it('include forces an unavailable format on; exclude hides one', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttExportMenu({ include: ['csv'], exclude: ['print'] });
    gantt.use(feature);
    const formats = feature.availableFormats();
    expect(formats).toContain('csv'); // forced on despite no GanttExportCsv
    expect(formats).not.toContain('print'); // forced off
  });

  it('config.formats restricts + orders the visible set', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttExportMenu({ formats: ['mspdi', 'print'] });
    gantt.use(feature);
    expect(feature.availableFormats()).toEqual(['mspdi', 'print']);
  });

  it('the default catalogue covers every documented format', () => {
    const keys = DEFAULT_EXPORT_FORMATS.map((s) => s.format);
    expect(keys).toEqual(['csv', 'xlsx', 'png', 'pdf', 'ics', 'mspdi', 'print']);
  });
});

describe('GanttExportMenu — menu open / close', () => {
  it('clicking the trigger opens the menu listing the available formats', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportCsv());
    const feature = new GanttExportMenu();
    gantt.use(feature);

    const btn = host.querySelector(TRIGGER) as HTMLButtonElement;
    btn.click();

    expect(feature.opened).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('true');

    // The popup Menu rendered one menuitem per available format.
    const items = document.querySelectorAll('.jects-menu__item');
    expect(items.length).toBe(feature.availableFormats().length);
    const labels = [...items].map((i) => i.textContent);
    expect(labels.some((l) => l?.includes('CSV'))).toBe(true);
    expect(labels.some((l) => l?.includes('MS Project'))).toBe(true);

    // Toggling again closes it.
    btn.click();
    expect(feature.opened).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('open()/close() drive the menu programmatically + fire menuShow/menuHide', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttExportMenu();
    gantt.use(feature);

    const shows: number[] = [];
    const hides: number[] = [];
    feature.on('menuShow', () => shows.push(1));
    feature.on('menuHide', () => hides.push(1));

    feature.open();
    expect(feature.opened).toBe(true);
    feature.close();
    expect(feature.opened).toBe(false);
    expect(shows).toHaveLength(1);
    expect(hides).toHaveLength(1);
  });
});

describe('GanttExportMenu — dispatch to exporters', () => {
  it('dispatches CSV → downloads a .csv file + fires export event', async () => {
    const dl = stubDownloads();
    try {
      gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
      gantt.use(new GanttExportCsv());
      const feature = new GanttExportMenu({ filename: 'plan' });
      gantt.use(feature);

      const events: GanttExportResult[] = [];
      feature.on('export', (e) => events.push(e));

      const result = await feature.exportFormat('csv');
      expect(result?.format).toBe('csv');
      expect(result?.filename).toBe('plan.csv');
      expect(typeof result?.text).toBe('string');
      expect(events).toHaveLength(1);
      expect(events[0]!.format).toBe('csv');
      // A download anchor for plan.csv fired (via grafted exportCsvDownload).
      expect(dl.anchors.some((a) => a.download === 'plan.csv')).toBe(true);
    } finally {
      await new Promise((r) => setTimeout(r, 0));
      dl.restore();
    }
  });

  it('dispatches MSPDI → downloads a .xml file with MS Project XML', async () => {
    const dl = stubDownloads();
    try {
      gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
      const feature = new GanttExportMenu({ filename: 'plan' });
      gantt.use(feature);

      const result = await feature.exportFormat('mspdi');
      expect(result?.format).toBe('mspdi');
      expect(result?.filename).toBe('plan.xml');
      expect(result?.text).toContain('<Project');
      expect(dl.anchors.some((a) => a.download === 'plan.xml')).toBe(true);
    } finally {
      await new Promise((r) => setTimeout(r, 0));
      dl.restore();
    }
  });

  it('dispatches ICS → downloads a .ics file with the exporter output', async () => {
    const dl = stubDownloads();
    try {
      gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
      gantt.use(new GanttIcsExportFeature());
      const feature = new GanttExportMenu({ filename: 'plan' });
      gantt.use(feature);

      // The ICS *serializer* internals are unit-tested in the ICS suite; here we
      // verify the dispatcher routes to the grafted `exportIcs()` and downloads
      // its result. Stub the graft so the test does not depend on jsdom timeline
      // row plumbing inside the ICS feature.
      (gantt as unknown as { exportIcs: () => string }).exportIcs = () =>
        'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';

      const result = await feature.exportFormat('ics');
      expect(result?.format).toBe('ics');
      expect(result?.filename).toBe('plan.ics');
      expect(result?.text).toContain('BEGIN:VCALENDAR');
      expect(dl.anchors.some((a) => a.download === 'plan.ics')).toBe(true);
    } finally {
      await new Promise((r) => setTimeout(r, 0));
      dl.restore();
    }
  });

  it('selecting a menu item dispatches the right format', async () => {
    const dl = stubDownloads();
    try {
      gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
      gantt.use(new GanttExportCsv());
      const feature = new GanttExportMenu({ filename: 'plan' });
      gantt.use(feature);

      const exported: string[] = [];
      feature.on('export', (e) => exported.push(e.format));

      feature.open();
      const csvItem = [...document.querySelectorAll('.jects-menu__item')].find((i) =>
        i.textContent?.includes('CSV'),
      ) as HTMLElement;
      expect(csvItem).toBeTruthy();
      csvItem.click();

      // Let the async dispatch settle.
      await new Promise((r) => setTimeout(r, 0));
      expect(exported).toContain('csv');
    } finally {
      await new Promise((r) => setTimeout(r, 0));
      dl.restore();
    }
  });

  it('beforeExport veto cancels the export (no download, no event)', async () => {
    const dl = stubDownloads();
    try {
      gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
      gantt.use(new GanttExportCsv());
      const feature = new GanttExportMenu({ filename: 'plan' });
      gantt.use(feature);

      feature.on('beforeExport', () => false);
      const exported: string[] = [];
      feature.on('export', (e) => exported.push(e.format));

      const result = await feature.exportFormat('csv');
      expect(result).toBeNull();
      expect(exported).toHaveLength(0);
      expect(dl.anchors).toHaveLength(0);
    } finally {
      await new Promise((r) => setTimeout(r, 0));
      dl.restore();
    }
  });

  it('onExport returning false suppresses the implicit download for string formats', async () => {
    const dl = stubDownloads();
    try {
      gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
      const feature = new GanttExportMenu({ filename: 'plan', onExport: () => false });
      gantt.use(feature);

      const result = await feature.exportFormat('mspdi');
      // The result is still returned (so the consumer has the text)…
      expect(result?.text).toContain('<Project');
      // …but no implicit download fired.
      expect(dl.anchors).toHaveLength(0);
    } finally {
      await new Promise((r) => setTimeout(r, 0));
      dl.restore();
    }
  });

  it('returns null when dispatching a format with no reachable exporter', async () => {
    // Opt out of the auto-installed export features so csv has no exporter.
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0, exports: false });
    const feature = new GanttExportMenu();
    gantt.use(feature);
    // No GanttExportCsv installed → csv has no exporter.
    expect(await feature.exportFormat('csv')).toBeNull();
  });
});

describe('GanttExportMenu — print', () => {
  it('print dispatch fires beforePrint → print and calls window.print()', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    const feature = new GanttExportMenu();
    gantt.use(feature);

    const order: string[] = [];
    feature.on('beforePrint', () => {
      order.push('before');
    });
    feature.on('print', () => {
      order.push('print');
    });

    await feature.exportFormat('print');
    expect(order).toEqual(['before', 'print']);
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('beforePrint veto cancels print', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    const feature = new GanttExportMenu();
    gantt.use(feature);
    feature.on('beforePrint', () => false);
    await feature.exportFormat('print');
    expect(printSpy).not.toHaveBeenCalled();
  });

  it('custom onPrint handler replaces window.print()', async () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    const onPrint = vi.fn();
    const feature = new GanttExportMenu({ onPrint });
    gantt.use(feature);
    await feature.exportFormat('print');
    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(printSpy).not.toHaveBeenCalled();
  });
});

describe('GanttExportMenu — factory + teardown', () => {
  it('createGanttExportMenu returns an installable feature', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = createGanttExportMenu({ label: 'Export…' });
    expect(feature).toBeInstanceOf(GanttExportMenu);
    gantt.use(feature);
    expect((host.querySelector(TRIGGER) as HTMLButtonElement).getAttribute('aria-label')).toBe(
      'Export…',
    );
  });

  it('removeFeature() removes the export-menu DOM', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportMenu());
    expect(host.querySelector(WRAP)).not.toBeNull();
    gantt.removeFeature(GANTT_EXPORT_MENU_FEATURE);
    expect(host.querySelector(WRAP)).toBeNull();
  });

  it('gantt.destroy() removes the export-menu (no leaked DOM)', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    gantt.use(new GanttExportMenu());
    gantt.destroy();
    gantt = null;
    expect(host.querySelector(WRAP)).toBeNull();
  });

  it('destroy() is idempotent', () => {
    gantt = new Gantt(host, { tasks: tasks(), projectStart: T0 });
    const feature = new GanttExportMenu();
    gantt.use(feature);
    gantt.removeFeature(GANTT_EXPORT_MENU_FEATURE);
    expect(() => feature.destroy()).not.toThrow();
  });
});
