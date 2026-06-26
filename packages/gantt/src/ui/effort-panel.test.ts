import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EffortPanel } from './effort-panel.js';
import { EffortDrivenEngine } from '../engine/effort.js';
import { CpmEngine } from '../engine/scheduler.js';
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
  document.body.appendChild(host);
});

afterEach(() => {
  panel?.destroy();
  panel = null;
  host.remove();
});

describe('EffortPanel', () => {
  it('renders the effort/duration/units metrics and mode badge', () => {
    panel = new EffortPanel(host, { engine: engine(), taskId: 'a' });
    expect(host.querySelector('.jects-effort-panel__mode--driven')).toBeTruthy();
    const dur = host.querySelector('[data-metric="duration"]')?.textContent;
    expect(dur).toBe('4d');
    const units = host.querySelector('[data-metric="units"]')?.textContent;
    expect(units).toBe('0%'); // no assignments yet
  });

  it('assigning a second resource reflows the duration in the panel', () => {
    const e = engine();
    e.assignResource('a', 'r1'); // seeds effort = 4d at 100%
    panel = new EffortPanel(host, { engine: e, taskId: 'a' });
    expect(host.querySelector('[data-metric="duration"]')?.textContent).toBe('4d');

    // Use the panel's "Assign" control to add Bob → 200% → duration halves.
    const select = host.querySelector<HTMLSelectElement>('.jects-effort-panel__select')!;
    select.value = 'r2';
    const add = host.querySelector<HTMLButtonElement>('.jects-effort-panel__btn--add')!;
    add.click();

    expect(e.getTask('a')!.duration).toBe(2 * DAY);
    expect(host.querySelector('[data-metric="duration"]')?.textContent).toBe('2d');
    expect(host.querySelector('[data-metric="units"]')?.textContent).toBe('200%');
  });

  it('removing a resource lengthens the duration again', () => {
    const e = engine();
    e.assignResource('a', 'r1');
    e.assignResource('a', 'r2'); // 2d
    panel = new EffortPanel(host, { engine: e, taskId: 'a' });
    expect(host.querySelector('[data-metric="duration"]')?.textContent).toBe('2d');

    const remove = host.querySelector<HTMLButtonElement>('.jects-effort-panel__btn--remove')!;
    remove.click();
    expect(e.getTask('a')!.duration).toBe(4 * DAY);
    expect(host.querySelector('[data-metric="duration"]')?.textContent).toBe('4d');
  });

  it('emits a reflow event carrying the schedule changes', () => {
    const e = engine();
    e.assignResource('a', 'r1');
    panel = new EffortPanel(host, { engine: e, taskId: 'a' });
    let payload: { taskId: unknown; changes: ReadonlyArray<unknown> } | null = null;
    panel.on('reflow', (p) => {
      payload = p;
    });
    const select = host.querySelector<HTMLSelectElement>('.jects-effort-panel__select')!;
    select.value = 'r2';
    host.querySelector<HTMLButtonElement>('.jects-effort-panel__btn--add')!.click();
    expect(payload).not.toBeNull();
    expect(payload!.taskId).toBe('a');
    expect(payload!.changes.length).toBeGreaterThan(0);
  });

  it('disables the add control once all resources are assigned', () => {
    const e = engine();
    e.assignResource('a', 'r1');
    e.assignResource('a', 'r2');
    panel = new EffortPanel(host, { engine: e, taskId: 'a' });
    const add = host.querySelector<HTMLButtonElement>('.jects-effort-panel__btn--add')!;
    expect(add.disabled).toBe(true);
  });

  it('destroy() removes the element and is idempotent', () => {
    panel = new EffortPanel(host, { engine: engine(), taskId: 'a' });
    const el = panel.el;
    panel.destroy();
    expect(el.isConnected).toBe(false);
    expect(() => panel!.destroy()).not.toThrow();
  });
});
