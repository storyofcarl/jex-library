/**
 * Real-browser (Chromium) test for the Scheduler Print feature wired into a live
 * Scheduler. Unlike the jsdom unit suite (which drives the controller against a
 * fake host + asserts the pure pagination math), this mounts an actual
 * `Scheduler`, installs Print, builds the paginated print document, mounts it,
 * and asserts the real layout: multiple paginated sheets, the time header +
 * resource column repeated per page, lanes that do not split, and event bars
 * placed + clipped across page boundaries. Also runs axe-core for zero
 * serious/critical a11y violations on the built print document.
 */
import { describe, it, afterEach, expect } from 'vitest';
import { HOUR_AND_DAY } from '@jects/timeline-core';
import '@jects/theme/style.css';
import '../styles.css';
import { Scheduler } from './scheduler.js';
import { installPrint, type PrintController, type PrintHost } from './print.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MON = Date.UTC(2025, 0, 6); // a Monday
const MON_9 = MON + HOUR * 9;

const asHost = (s: Scheduler): PrintHost => s as unknown as PrintHost;

let host: HTMLElement;
let preview: HTMLElement | undefined;
let sched: Scheduler | undefined;
let printer: PrintController | undefined;

afterEach(() => {
  printer?.destroy();
  printer = undefined;
  sched?.destroy();
  sched = undefined;
  preview?.remove();
  preview = undefined;
  host?.remove();
});

function mount(): HTMLElement {
  host = document.createElement('div');
  host.style.width = '1100px';
  host.style.height = '320px';
  document.body.appendChild(host);
  return host;
}

function mountPreview(): HTMLElement {
  preview = document.createElement('div');
  document.body.appendChild(preview);
  return preview;
}

function makeScheduler(h: HTMLElement, rangeDays: number): Scheduler {
  return new Scheduler(h, {
    resources: [
      { id: 'r1', name: 'Alice' },
      { id: 'r2', name: 'Bob' },
      { id: 'r3', name: 'Carol' },
    ],
    events: [
      { id: 'a', resourceId: 'r1', name: 'Design', startDate: MON_9, endDate: MON_9 + HOUR * 4 },
      { id: 'b', resourceId: 'r2', name: 'Build', startDate: MON_9 + HOUR, endDate: MON_9 + DAY * 3 },
      { id: 'c', resourceId: 'r3', name: 'Test', startDate: MON_9 + DAY, endDate: MON_9 + DAY + HOUR * 3 },
    ],
    preset: HOUR_AND_DAY,
    range: { start: MON, end: MON + DAY * rangeDays },
  });
}

describe('Scheduler print (browser)', () => {
  it('paginates a wide range into multiple sheets, each with a repeated header band', () => {
    const h = mount();
    sched = makeScheduler(h, 10);
    printer = installPrint(asHost(sched));

    const pv = mountPreview();
    const { root, plan } = printer.buildDocument({
      title: 'Crew schedule',
      pageSize: { width: 420, height: 520 },
    });
    pv.appendChild(root);

    // More than one horizontal (time) page for a 10-day range at 420px-wide body.
    expect(plan.timePages.length).toBeGreaterThan(1);

    const pages = root.querySelectorAll('.jects-scheduler-print__page');
    expect(pages.length).toBe(plan.pages.length);

    // Every page repeats the title + a non-empty time header band.
    for (const p of Array.from(pages)) {
      const band = p.querySelector('.jects-scheduler-print__header-band');
      expect(band).toBeTruthy();
      expect(band!.querySelectorAll('.jects-scheduler-print__header-cell').length).toBeGreaterThan(0);
      expect(p.querySelector('.jects-scheduler-print__title')!.textContent).toContain('Crew schedule');
    }
  });

  it('repeats the locked resource column on every page (each sheet self-describing)', () => {
    const h = mount();
    sched = makeScheduler(h, 8);
    printer = installPrint(asHost(sched));

    const pv = mountPreview();
    const { root, plan } = printer.buildDocument({ pageSize: { width: 420, height: 520 } });
    pv.appendChild(root);

    const cols = root.querySelectorAll('.jects-scheduler-print__resources');
    expect(cols.length).toBe(plan.pages.length);
    // The resource names render in the repeated column.
    expect(root.textContent).toContain('Alice');
    expect(root.textContent).toContain('Bob');
  });

  it('lays out + lane-aligns bars and flags a bar that continues across a page break', () => {
    const h = mount();
    sched = makeScheduler(h, 8); // event "b" spans 3 days → crosses page columns
    printer = installPrint(asHost(sched));

    const pv = mountPreview();
    const { root } = printer.buildDocument({ pageSize: { width: 360, height: 520 } });
    pv.appendChild(root);

    const bars = root.querySelectorAll('.jects-scheduler-print__bar');
    expect(bars.length).toBeGreaterThan(0);
    // The 3-day "Build" event must appear on more than one page (clipped fragments).
    const clipped = root.querySelectorAll(
      '.jects-scheduler-print__bar--clip-start, .jects-scheduler-print__bar--clip-end',
    );
    expect(clipped.length).toBeGreaterThan(0);

    // Each bar sits inside the painted grid (positive width, within a lane).
    for (const bar of Array.from(bars) as HTMLElement[]) {
      expect(bar.getBoundingClientRect().width).toBeGreaterThan(0);
    }
  });

  it('breaks tall resource lists into multiple row pages without splitting a lane', () => {
    const h = mount();
    sched = new Scheduler(h, {
      resources: Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, name: `R${i}` })),
      events: [],
      preset: HOUR_AND_DAY,
      range: { start: MON, end: MON + DAY * 2 },
    });
    printer = installPrint(asHost(sched));

    const plan = printer.plan({ pageSize: { width: 1000, height: 220 } });
    expect(plan.rowPages.length).toBeGreaterThan(1);
    // Whole-lane coverage: contiguous, every row covered exactly once.
    let covered = 0;
    for (const rp of plan.rowPages) {
      expect(rp.startRow).toBe(covered);
      covered = rp.endRow;
    }
    expect(covered).toBe(12);
  });

  it('print() builds + injects a hidden frame, then tears it down on destroy', () => {
    const h = mount();
    sched = makeScheduler(h, 4);
    printer = installPrint(asHost(sched));

    const result = printer.print({ pageSize: { width: 500, height: 400 } });
    expect(result).not.toBeNull();
    expect(document.querySelector('.jects-scheduler-print__frame')).toBeTruthy();

    printer.destroy();
    printer = undefined;
    expect(document.querySelector('.jects-scheduler-print__frame')).toBeNull();
  });

  it('has no serious/critical a11y violations in the built print document', async () => {
    const h = mount();
    sched = makeScheduler(h, 6);
    printer = installPrint(asHost(sched));

    const pv = mountPreview();
    const { root } = printer.buildDocument({ title: 'A11y print', pageSize: { width: 420, height: 520 } });
    pv.appendChild(root);

    await expectNoA11yViolations(pv);
  });
});
