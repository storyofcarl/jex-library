/**
 * jsdom unit tests for the Advanced scheduling-mode section + the default
 * today/status project line.
 *
 * Covered:
 *   - pure helpers: date <-> input value, effort <-> person-days, constraint
 *     classification (dated / direction), direction mapping;
 *   - SchedulingModeSection: renders a labelled group with an Auto/Manual
 *     radiogroup + constraint select + conditional date row + (opt-in) effort /
 *     effort-driven controls; seeds the draft from the task; show/hides the date
 *     row by constraint; disables direction/constraint while Manual; emits a
 *     typed patch + a change event; honest local draft (no mutation until read);
 *     a clean diff vs the original; leak-free destroy;
 *   - applySchedulingModePatch: routes only the changed branches through a fake
 *     GanttApi (applyConstraint / updateTask);
 *   - defaultTodayLine / defaultProjectLines: a kind:'today' line snapped to the
 *     UTC day boundary, plus optional project-boundary lines.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SchedulingModeSection,
  applySchedulingModePatch,
  defaultTodayLine,
  defaultProjectLines,
  CONSTRAINT_TYPE_OPTIONS,
  SCHEDULING_DIRECTIONS,
  TODAY_LINE_ID,
  constraintTypeIsDated,
  constraintTypeIsDirection,
  directionForConstraint,
  toDateFieldValue,
  parseDateFieldValue,
  effortToPersonDays,
  personDaysToEffort,
  type SchedulingModePatch,
  type SchedulingModeDiff,
} from './scheduling-mode-section.js';
import type { TaskModel, ConstraintType } from '../contract.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  host.remove();
});

/* ════════════════════════════════════════════════════════════════════════════
   pure helpers
   ════════════════════════════════════════════════════════════════════════════ */

describe('scheduling-mode pure helpers', () => {
  it('round-trips a date <-> yyyy-mm-dd input value (UTC)', () => {
    expect(toDateFieldValue(T0)).toBe('2026-01-05');
    expect(toDateFieldValue(undefined)).toBe('');
    expect(toDateFieldValue(NaN)).toBe('');
    expect(parseDateFieldValue('2026-01-05')).toBe(T0);
    expect(parseDateFieldValue('')).toBeUndefined();
    expect(parseDateFieldValue('not-a-date')).toBeUndefined();
  });

  it('converts effort <-> person-days against an hours/day', () => {
    // 16 working hours @ 8h/day = 2 person-days.
    expect(effortToPersonDays(16 * HOUR, 8)).toBe(2);
    expect(personDaysToEffort(2, 8)).toBe(16 * HOUR);
    // default 8h/day.
    expect(effortToPersonDays(8 * HOUR)).toBe(1);
    // guards.
    expect(effortToPersonDays(undefined)).toBe(0);
    expect(personDaysToEffort(-3)).toBe(0);
    expect(personDaysToEffort(Number.NaN)).toBe(0);
  });

  it('classifies constraint types (dated / direction) + maps direction', () => {
    expect(constraintTypeIsDated('asSoonAsPossible')).toBe(false);
    expect(constraintTypeIsDated('mustStartOn')).toBe(true);
    expect(constraintTypeIsDirection('asLateAsPossible')).toBe(true);
    expect(constraintTypeIsDirection('startNoLaterThan')).toBe(false);
    expect(directionForConstraint('asLateAsPossible')).toBe('backward');
    expect(directionForConstraint('asSoonAsPossible')).toBe('forward');
    expect(directionForConstraint('mustFinishOn')).toBe('forward');
  });

  it('exposes the ASAP/ALAP direction options + full constraint set', () => {
    expect(SCHEDULING_DIRECTIONS.map((d) => d.value)).toEqual([
      'asSoonAsPossible',
      'asLateAsPossible',
    ]);
    expect(CONSTRAINT_TYPE_OPTIONS).toHaveLength(8);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   SchedulingModeSection — render + draft
   ════════════════════════════════════════════════════════════════════════════ */

function task(over: Partial<TaskModel> = {}): TaskModel {
  return { id: 't1', name: 'Design', start: T0, end: T0 + 3 * DAY, duration: 3 * DAY, ...over };
}

describe('SchedulingModeSection render + ARIA', () => {
  it('renders a labelled group with mode radiogroup + constraint select', () => {
    const sec = new SchedulingModeSection({ task: task() });
    host.append(sec.el);

    expect(sec.el.getAttribute('role')).toBe('group');
    const labelledby = sec.el.getAttribute('aria-labelledby');
    expect(labelledby).toBeTruthy();
    expect(document.getElementById(labelledby!)?.textContent).toBe('Advanced scheduling');

    const radiogroup = sec.el.querySelector('[role="radiogroup"]')!;
    expect(radiogroup).not.toBeNull();
    const radios = radiogroup.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios.length).toBe(2);
    // Each radio has a label associated by htmlFor.
    for (const r of radios) {
      expect(host.querySelector(`label[for="${r.id}"]`)).not.toBeNull();
    }

    // Constraint select carries all 8 options + an associated label.
    const sel = sec.el.querySelector<HTMLSelectElement>('select.jects-gantt__sched-input')!;
    expect(sel.options.length).toBe(8);
    expect(host.querySelector(`label[for="${sel.id}"]`)).not.toBeNull();

    sec.destroy();
  });

  it('seeds the draft from the task (auto + ASAP by default)', () => {
    const sec = new SchedulingModeSection({ task: task() });
    host.append(sec.el);
    expect(sec.mode).toBe('auto');
    const patch = sec.getPatch();
    expect(patch).toMatchObject({
      mode: 'auto',
      manuallyScheduled: false,
      constraintType: 'asSoonAsPossible',
      effortDriven: false,
    });
    expect(patch.constraintDate).toBeUndefined();
    sec.destroy();
  });

  it('seeds a manual + dated-constraint task and shows the date row', () => {
    const sec = new SchedulingModeSection({
      task: task({
        manuallyScheduled: true,
        constraintType: 'mustStartOn',
        constraintDate: T0 + 2 * DAY,
      }),
    });
    host.append(sec.el);
    expect(sec.mode).toBe('manual');

    const dateRow = sec.el.querySelector<HTMLInputElement>('input[type="date"]')!
      .closest('.jects-gantt__sched-row') as HTMLElement;
    expect(dateRow.hidden).toBe(false);
    expect(sec.el.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe(
      '2026-01-07',
    );
    sec.destroy();
  });

  it('hides the date row for a dateless (ASAP/ALAP) constraint', () => {
    const sec = new SchedulingModeSection({ task: task() });
    host.append(sec.el);
    const dateRow = sec.el
      .querySelector<HTMLInputElement>('input[type="date"]')!
      .closest('.jects-gantt__sched-row') as HTMLElement;
    expect(dateRow.hidden).toBe(true);
    sec.destroy();
  });
});

describe('SchedulingModeSection interactions', () => {
  it('shows the date row when switching to a dated constraint + emits change', () => {
    const changes: SchedulingModePatch[] = [];
    const sec = new SchedulingModeSection({ task: task(), onChange: (p) => changes.push(p) });
    host.append(sec.el);
    const sel = sec.el.querySelector<HTMLSelectElement>('select.jects-gantt__sched-input')!;
    const dateRow = sec.el
      .querySelector<HTMLInputElement>('input[type="date"]')!
      .closest('.jects-gantt__sched-row') as HTMLElement;

    sel.value = 'finishNoLaterThan';
    sel.dispatchEvent(new Event('change'));
    expect(dateRow.hidden).toBe(false);
    expect(changes.at(-1)?.constraintType).toBe('finishNoLaterThan');

    // Set a date → it appears in the patch.
    const dateInput = sec.el.querySelector<HTMLInputElement>('input[type="date"]')!;
    dateInput.value = '2026-01-10';
    dateInput.dispatchEvent(new Event('change'));
    expect(sec.getPatch().constraintDate).toBe(Date.UTC(2026, 0, 10));
    sec.destroy();
  });

  it('disables the constraint/date controls while Manually scheduled', () => {
    const sec = new SchedulingModeSection({ task: task() });
    host.append(sec.el);
    const sel = sec.el.querySelector<HTMLSelectElement>('select.jects-gantt__sched-input')!;
    const dateInput = sec.el.querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(sel.disabled).toBe(false);

    // Choose Manual.
    const manual = sec.el.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]!;
    manual.checked = true;
    manual.dispatchEvent(new Event('change'));
    expect(sec.mode).toBe('manual');
    expect(sel.disabled).toBe(true);
    expect(dateInput.disabled).toBe(true);
    expect(sec.el.classList.contains('jects-gantt__sched-section--manual')).toBe(true);
    expect(sec.getPatch().manuallyScheduled).toBe(true);
    sec.destroy();
  });

  it('shows effort + effort-driven only when effortEnabled', () => {
    const off = new SchedulingModeSection({ task: task() });
    host.append(off.el);
    expect(off.el.querySelector('input[type="checkbox"]')).toBeNull();
    expect(off.el.querySelector('input[type="number"]')).toBeNull();
    off.destroy();

    const on = new SchedulingModeSection({
      task: task({ effort: 24 * HOUR, effortDriven: true } as Partial<TaskModel>),
      effortEnabled: true,
      hoursPerDay: 8,
    });
    host.append(on.el);
    const num = on.el.querySelector<HTMLInputElement>('input[type="number"]')!;
    const check = on.el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(num.value).toBe('3'); // 24h @ 8h/day = 3 days
    expect(check.checked).toBe(true);

    const patch = on.getPatch();
    expect(patch.effortDriven).toBe(true);
    expect(patch.effort).toBe(24 * HOUR);
    on.destroy();
  });

  it('produces an accurate diff vs the original task', () => {
    const sec = new SchedulingModeSection({
      task: task({ constraintType: 'asSoonAsPossible', manuallyScheduled: false }),
      effortEnabled: true,
      hoursPerDay: 8,
    });
    host.append(sec.el);

    // No edits → empty diff.
    let d: SchedulingModeDiff = sec.diff();
    expect(d.constraintChanged).toBe(false);
    expect(d.manualChanged).toBe(false);
    expect(d.effortDrivenChanged).toBe(false);

    // Flip to manual + change effort-driven.
    const manual = sec.el.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]!;
    manual.checked = true;
    manual.dispatchEvent(new Event('change'));
    const check = sec.el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    check.checked = true;
    check.dispatchEvent(new Event('change'));

    d = sec.diff();
    expect(d.manualChanged).toBe(true);
    expect(d.effortDrivenChanged).toBe(true);
    sec.destroy();
  });

  it('is an honest local draft + leaves no listeners after destroy', () => {
    const onChange = vi.fn();
    const sec = new SchedulingModeSection({ task: task(), onChange });
    host.append(sec.el);
    const sel = sec.el.querySelector<HTMLSelectElement>('select.jects-gantt__sched-input')!;
    sec.destroy();
    // After destroy the element is detached and no change fires.
    expect(sec.el.isConnected).toBe(false);
    onChange.mockClear();
    sel.dispatchEvent(new Event('change'));
    expect(onChange).not.toHaveBeenCalled();
    // Idempotent.
    expect(() => sec.destroy()).not.toThrow();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   applySchedulingModePatch — engine routing
   ════════════════════════════════════════════════════════════════════════════ */

describe('applySchedulingModePatch', () => {
  function fakeApi() {
    const constraints: Array<{ id: unknown; type: ConstraintType; date?: number }> = [];
    const patches: Array<{ id: unknown; patch: Record<string, unknown> }> = [];
    return {
      constraints,
      patches,
      applyConstraint(id: unknown, type: ConstraintType, date?: number) {
        constraints.push({ id, type, date });
        return true;
      },
      updateTask(id: unknown, patch: Record<string, unknown>) {
        patches.push({ id, patch });
        return true;
      },
    };
  }

  it('routes only the changed branches', () => {
    const api = fakeApi();
    const patch: SchedulingModePatch = {
      mode: 'manual',
      manuallyScheduled: true,
      constraintType: 'mustStartOn',
      constraintDate: T0,
      effortDriven: true,
      effort: 16 * HOUR,
    };
    const diff: SchedulingModeDiff = {
      constraintChanged: true,
      manualChanged: true,
      effortDrivenChanged: true,
      effortChanged: false,
    };
    const res = applySchedulingModePatch(api as never, 't1', patch, diff);
    expect(res).toEqual({ constraintApplied: true, taskPatched: true });
    expect(api.constraints).toEqual([{ id: 't1', type: 'mustStartOn', date: T0 }]);
    expect(api.patches).toEqual([
      { id: 't1', patch: { manuallyScheduled: true, effortDriven: true } },
    ]);
  });

  it('applies nothing when the diff is empty', () => {
    const api = fakeApi();
    const patch: SchedulingModePatch = {
      mode: 'auto',
      manuallyScheduled: false,
      constraintType: 'asSoonAsPossible',
      effortDriven: false,
    };
    const res = applySchedulingModePatch(api as never, 't1', patch, {
      constraintChanged: false,
      manualChanged: false,
      effortDrivenChanged: false,
      effortChanged: false,
    });
    expect(res).toEqual({ constraintApplied: false, taskPatched: false });
    expect(api.constraints).toHaveLength(0);
    expect(api.patches).toHaveLength(0);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   default today / project lines
   ════════════════════════════════════════════════════════════════════════════ */

describe('defaultTodayLine / defaultProjectLines', () => {
  it('builds a today line snapped to the UTC day boundary', () => {
    const now = T0 + 13 * HOUR + 27 * 60_000; // mid-day
    const line = defaultTodayLine({ now });
    expect(line.id).toBe(TODAY_LINE_ID);
    expect(line.kind).toBe('today');
    expect(line.label).toBe('Today');
    expect(line.date).toBe(T0); // snapped to start of day
  });

  it('honours id/label overrides', () => {
    const line = defaultTodayLine({ now: T0, id: 'status', label: 'Status date' });
    expect(line.id).toBe('status');
    expect(line.label).toBe('Status date');
  });

  it('builds the default set (today only by default)', () => {
    const lines = defaultProjectLines({ now: T0 });
    expect(lines.map((l) => l.id)).toEqual([TODAY_LINE_ID]);
  });

  it('adds project-boundary lines when requested', () => {
    const lines = defaultProjectLines({ now: T0, projectBoundaries: true });
    expect(lines.map((l) => l.id)).toEqual([TODAY_LINE_ID, 'project-start', 'project-end']);
    expect(lines.find((l) => l.id === 'project-start')?.anchor).toBe('projectStart');
    expect(lines.find((l) => l.id === 'project-end')?.anchor).toBe('projectEnd');
  });

  it('can omit the today line', () => {
    const lines = defaultProjectLines({ today: false, projectBoundaries: true });
    expect(lines.map((l) => l.id)).toEqual(['project-start', 'project-end']);
  });
});
