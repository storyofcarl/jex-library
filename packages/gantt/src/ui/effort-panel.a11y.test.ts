/**
 * axe-core a11y + visual/interaction smoke for the effort-driven scheduling
 * feature, in REAL Chromium (Quality Gate Q2 + a feature-exercising visual
 * check). Run with `pnpm --filter @jects/gantt test:browser`.
 *
 * Mounts the `EffortPanel` (driven by a real `EffortDrivenEngine` over the
 * package `CpmEngine`) and exercises the parity behaviour end-to-end with real
 * layout/geometry:
 *   1. The panel renders the live {effort, duration, units} trio with real
 *      pixel size.
 *   2. Adding a second full-time resource through the panel's "Assign" control
 *      HALVES the duration (effort-driven reflow); removing it restores it.
 *   3. The whole panel (metrics + assignment list + add control) has zero
 *      serious/critical a11y violations.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EffortPanel } from './effort-panel.js';
import { EffortDrivenEngine } from '../engine/effort.js';
import { CpmEngine } from '../engine/scheduler.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';
import type { CalendarModel } from '../contract.js';
import type { EffortDrivenTask, ResourceModel } from '../engine/effort.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

const cal247: CalendarModel = {
  id: 'c',
  hoursPerDay: 8,
  week: Array.from({ length: 7 }, (_, weekday) => ({ weekday, intervals: [{ from: 0, to: 1440 }] })),
};

const resources: ResourceModel[] = [
  { id: 'r1', name: 'Ann', capacity: 1 },
  { id: 'r2', name: 'Bob', capacity: 1 },
];

function engine(): EffortDrivenEngine {
  const e = new EffortDrivenEngine(new CpmEngine());
  e.setCalendars([cal247], 'c');
  e.setResources(resources);
  e.setTasks([
    { id: 'a', name: 'Build', calendarId: 'c', effortDriven: true, duration: 4 * DAY, start: T0 } as EffortDrivenTask,
  ]);
  e.setDependencies([]);
  e.schedule({ projectStart: T0 });
  return e;
}

let host: HTMLElement;
let panel: EffortPanel | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.padding = '16px';
  host.style.width = '420px';
  document.body.appendChild(host);
});

afterEach(() => {
  panel?.destroy();
  panel = null;
  host.remove();
});

describe('EffortPanel (browser)', () => {
  it('renders the effort trio with real pixel geometry', async () => {
    const e = engine();
    e.assignResource('a', 'r1');
    panel = new EffortPanel(host, { engine: e, taskId: 'a' });
    const rect = panel.el.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    expect(host.querySelector('[data-metric="duration"]')?.textContent).toBe('4d');
  });

  it('adding a second full-time resource halves the duration (effort-driven reflow)', async () => {
    const e = engine();
    e.assignResource('a', 'r1'); // 100% → effort seeded at 4d
    panel = new EffortPanel(host, { engine: e, taskId: 'a' });

    const select = host.querySelector<HTMLSelectElement>('.jects-effort-panel__select')!;
    const add = host.querySelector<HTMLButtonElement>('.jects-effort-panel__btn--add')!;
    select.value = 'r2';
    // Keyboard path: focus the button then activate it.
    add.focus();
    expect(document.activeElement).toBe(add);
    add.click();

    expect(e.getTask('a')!.duration).toBe(2 * DAY);
    expect(host.querySelector('[data-metric="duration"]')?.textContent).toBe('2d');
    expect(host.querySelector('[data-metric="units"]')?.textContent).toBe('200%');

    // Remove Bob again → duration grows back.
    const removes = host.querySelectorAll<HTMLButtonElement>('.jects-effort-panel__btn--remove');
    removes[removes.length - 1].click();
    expect(e.getTask('a')!.duration).toBe(4 * DAY);
  });

  it('has no serious/critical accessibility violations', async () => {
    const e = engine();
    e.assignResource('a', 'r1');
    e.assignResource('a', 'r2');
    panel = new EffortPanel(host, { engine: e, taskId: 'a' });
    await expectNoA11yViolations(host);
  });
});
