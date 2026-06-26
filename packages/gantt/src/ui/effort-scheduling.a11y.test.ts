/**
 * axe-core a11y + visual/interaction browser test for **effort-driven scheduling
 * wired into the default engine path** (Quality Gate Q2). Runs in real Chromium
 * via `pnpm --filter @jects/gantt test:browser`.
 *
 * Beyond zero serious/critical axe violations, this exercises the feature end to
 * end on a real `Gantt` + the (default) wrapped engine:
 *   - passing `resources` + an effort-driven task wraps the default engine in an
 *     effort-aware engine while `gantt.engine` still reports the base scheduler;
 *   - assigning a SECOND full-time resource halves the effort-driven duration, so
 *     the rendered bar gets visibly NARROWER (the work is unchanged, the crew
 *     doubled) and its FS successor slides LEFT;
 *   - the task-tree Effort + Units columns reflect the new staffing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Load the shipped, token-pure package stylesheet so the geometry assertions
// exercise the real CSS rather than unstyled defaults.
import '../styles.css';
import { Gantt } from './gantt.js';
import { DefaultGanttEngine } from './default-engine.js';
import { EFFORT_COLUMN, UNITS_COLUMN } from './effort-scheduling.js';
import type { TaskModel } from '../contract.js';
import { expectNoA11yViolations } from '../test-utils/a11y.js';

const HOUR = 3_600_000;
const WORK_DAY = 8 * HOUR; // one 8h working day in working-ms
const T0 = Date.UTC(2026, 0, 5);

let host: HTMLElement;
let gantt: Gantt | null = null;

beforeEach(() => {
  host = document.createElement('div');
  host.style.position = 'relative';
  host.style.height = '320px';
  host.style.width = '1000px';
  document.body.appendChild(host);
});

afterEach(() => {
  gantt?.destroy();
  gantt = null;
  host.remove();
});

function build(): Gantt {
  return new Gantt(host, {
    tasks: [
      {
        id: 'a',
        name: 'Design',
        start: T0,
        duration: 4 * WORK_DAY,
        end: T0 + 4 * WORK_DAY,
        effortDriven: true,
      } as TaskModel,
      { id: 'b', name: 'Build', duration: 2 * WORK_DAY } as TaskModel,
    ],
    dependencies: [{ id: 'ab', fromId: 'a', toId: 'b', type: 'FS' }],
    resources: [
      { id: 'r1', name: 'Ann' },
      { id: 'r2', name: 'Bob' },
    ],
    columns: [
      { field: 'name', header: 'Task name', width: 200 },
      EFFORT_COLUMN,
      UNITS_COLUMN,
    ],
    projectStart: T0,
  } as never) as Gantt;
}

function barWidth(g: Gantt, id: string): number {
  const bar = g.el.querySelector(`.jects-gantt__bar[data-task-id="${id}"]`) as HTMLElement | null;
  return bar ? bar.getBoundingClientRect().width : 0;
}

function barLeft(g: Gantt, id: string): number {
  const bar = g.el.querySelector(`.jects-gantt__bar[data-task-id="${id}"]`) as HTMLElement | null;
  return bar ? bar.getBoundingClientRect().left : 0;
}

describe('Effort-driven scheduling a11y + visual (real Chromium)', () => {
  it('assigning a second resource narrows the effort-driven bar with no serious/critical violations', async () => {
    gantt = build();

    // The default engine path is effort-aware, but the public engine is still base.
    expect(gantt.engine).toBeInstanceOf(DefaultGanttEngine);
    expect(gantt.effortEngine).not.toBeNull();

    await expectNoA11yViolations(host);

    // One full-time resource seeds effort (no-op on duration).
    gantt.assignResource('a', 'r1');
    const wBefore = barWidth(gantt, 'a');
    const bLeftBefore = barLeft(gantt, 'b');
    expect(wBefore).toBeGreaterThan(0);

    // A second full-time resource halves the effort-driven duration → the bar
    // gets visibly narrower and its FS successor slides left.
    gantt.assignResource('a', 'r2');
    const wAfter = barWidth(gantt, 'a');
    const bLeftAfter = barLeft(gantt, 'b');

    expect(wAfter).toBeLessThan(wBefore);
    // ~half width (allow rounding/border slack).
    expect(wAfter).toBeLessThan(wBefore * 0.7);
    expect(bLeftAfter).toBeLessThan(bLeftBefore);

    expect(gantt.getTask('a')!.duration).toBe(2 * WORK_DAY);
    expect(gantt.getTask('a')!.effort).toBe(4 * WORK_DAY); // work unchanged
    expect(gantt.getAssignedUnits('a')).toBe(200);

    // Still accessible after the reflow.
    await expectNoA11yViolations(host);
  });

  it('renders the Effort + Units columns reflecting the staffing', () => {
    gantt = build();
    gantt.assignResource('a', 'r1');
    gantt.assignResource('a', 'r2');

    const cells = [...gantt.el.querySelectorAll('.jects-gantt__tree-td')].map(
      (c) => c.textContent ?? '',
    );
    expect(cells).toContain('4d'); // effort = 4 person-days (8h/day)
    expect(cells).toContain('200%'); // Σ units = 200% (two FTE)
  });
});
